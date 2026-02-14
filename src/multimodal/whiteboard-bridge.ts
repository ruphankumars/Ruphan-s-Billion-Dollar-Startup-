/**
 * WhiteboardBridge — Whiteboard-to-Task Extraction
 *
 * Processes whiteboard images (via OCR/description) or raw text to
 * extract structured tasks with priorities, assignees, and dependencies.
 * Can generate execution plans and markdown checklists.
 *
 * Part of CortexOS Multi-Modal Input Module
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import type { WhiteboardTask } from './types.js';

// ═══════════════════════════════════════════════════════════════
// PRIORITY KEYWORDS
// ═══════════════════════════════════════════════════════════════

const HIGH_PRIORITY_KEYWORDS = [
  'urgent', 'critical', 'blocker', 'asap', 'hotfix', 'p0', 'p1',
  'must', 'immediately', 'showstopper', 'high priority', 'high-priority',
];

const LOW_PRIORITY_KEYWORDS = [
  'nice to have', 'nice-to-have', 'optional', 'later', 'someday',
  'backlog', 'low priority', 'low-priority', 'p3', 'p4', 'icebox',
];

// ═══════════════════════════════════════════════════════════════
// WHITEBOARD BRIDGE
// ═══════════════════════════════════════════════════════════════

export class WhiteboardBridge extends EventEmitter {
  private processedCount = 0;
  private taskCount = 0;

  constructor() {
    super();
  }

  // ---------------------------------------------------------------------------
  // Image processing
  // ---------------------------------------------------------------------------

  /**
   * Process a whiteboard image to extract tasks.
   *
   * Currently reads the file to verify it exists and returns an empty task
   * list. In a production deployment this would send the image to an OCR /
   * vision provider, then pipe the extracted text through `processText`.
   */
  async processImage(imagePath: string): Promise<WhiteboardTask[]> {
    // Verify the file exists
    await fs.access(imagePath);

    // In production, call vision API for OCR here.
    // For now, return empty list. Consumers should use `processText` with
    // OCR output or manual transcription.

    this.processedCount++;
    this.emit('multimodal:whiteboard:processed', {
      source: imagePath,
      tasks: [],
    });
    return [];
  }

  // ---------------------------------------------------------------------------
  // Text processing
  // ---------------------------------------------------------------------------

  /**
   * Extract tasks from raw text (e.g., OCR output or manual transcription).
   *
   * Supports multiple formats:
   * - Bulleted lists: `- Task description`
   * - Numbered lists: `1. Task description`
   * - Checkbox lists: `[ ] Task description` or `[x] Task description`
   * - Indented sub-tasks (treated as items with dependencies on preceding
   *   non-indented items)
   *
   * Assignee detection: `@username` patterns.
   * Dependency detection: `depends on X` or `after X` patterns.
   */
  processText(text: string): WhiteboardTask[] {
    const lines = text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
    const rawItems: Array<{ text: string; indent: number }> = [];

    for (const line of lines) {
      // Measure indent
      const indent = line.length - line.trimStart().length;
      let cleaned = line.trimStart();

      // Strip bullet / number / checkbox prefixes
      cleaned = cleaned
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .replace(/^\[[ x]\]\s*/i, '');

      if (cleaned.length === 0) continue;

      rawItems.push({ text: cleaned, indent });
    }

    const tasks = this.extractTasks(rawItems);
    const prioritised = this.prioritizeTasks(tasks);

    this.processedCount++;
    this.taskCount += prioritised.length;

    this.emit('multimodal:whiteboard:processed', {
      source: 'text',
      tasks: prioritised,
    });

    return prioritised;
  }

  // ---------------------------------------------------------------------------
  // Task extraction
  // ---------------------------------------------------------------------------

  /**
   * Convert raw line items into structured `WhiteboardTask` objects.
   * Indented items are treated as sub-tasks whose dependency is the
   * closest preceding top-level item.
   */
  extractTasks(
    items: Array<{ text: string; indent: number }>,
  ): WhiteboardTask[] {
    const tasks: WhiteboardTask[] = [];
    let lastTopLevelId: string | null = null;

    for (const item of items) {
      const id = `task_${randomUUID().slice(0, 8)}`;

      // Detect assignee
      const assigneeMatch = item.text.match(/@(\w+)/);
      const assignee = assigneeMatch ? assigneeMatch[1] : undefined;
      const cleanText = item.text.replace(/@\w+/g, '').trim();

      // Detect explicit dependencies
      const depMatch = cleanText.match(/(?:depends on|after|blocked by)\s+["""]?([^""".,]+)/i);
      const dependencies: string[] = [];
      if (depMatch) {
        dependencies.push(depMatch[1].trim());
      }

      // Indented items depend on the last top-level item
      const isSubtask = item.indent > 0;
      if (isSubtask && lastTopLevelId) {
        dependencies.push(lastTopLevelId);
      }

      const task: WhiteboardTask = {
        id,
        title: cleanText.replace(/(?:depends on|after|blocked by)\s+["""]?[^""".,]+["""]?/i, '').trim() || cleanText,
        description: cleanText,
        priority: 'medium',
        assignee,
        dependencies,
        extractedFrom: 'whiteboard',
      };

      tasks.push(task);

      if (!isSubtask) {
        lastTopLevelId = id;
      }
    }

    return tasks;
  }

  // ---------------------------------------------------------------------------
  // Prioritisation
  // ---------------------------------------------------------------------------

  /**
   * Auto-assign priorities based on keyword heuristics in the task
   * title / description.
   */
  prioritizeTasks(tasks: WhiteboardTask[]): WhiteboardTask[] {
    return tasks.map((task) => {
      const lower = task.title.toLowerCase() + ' ' + task.description.toLowerCase();

      let priority: WhiteboardTask['priority'] = 'medium';

      for (const kw of HIGH_PRIORITY_KEYWORDS) {
        if (lower.includes(kw)) {
          priority = 'high';
          break;
        }
      }

      if (priority === 'medium') {
        for (const kw of LOW_PRIORITY_KEYWORDS) {
          if (lower.includes(kw)) {
            priority = 'low';
            break;
          }
        }
      }

      return { ...task, priority };
    });
  }

  // ---------------------------------------------------------------------------
  // Plan generation
  // ---------------------------------------------------------------------------

  /**
   * Generate an execution plan from a list of tasks.
   * Tasks are sorted into waves: a wave contains tasks whose dependencies
   * are all satisfied by previous waves.
   */
  generatePlan(
    tasks: WhiteboardTask[],
  ): Array<{ wave: number; tasks: WhiteboardTask[] }> {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const completed = new Set<string>();
    const plan: Array<{ wave: number; tasks: WhiteboardTask[] }> = [];
    const remaining = new Set(tasks.map((t) => t.id));

    let wave = 1;
    const MAX_WAVES = 100;

    while (remaining.size > 0 && wave <= MAX_WAVES) {
      const waveItems: WhiteboardTask[] = [];

      for (const id of remaining) {
        const task = taskMap.get(id)!;
        // Check if all dependency task IDs are completed
        const depsResolved = task.dependencies.every((dep) => {
          // Dependencies may be task IDs or free-text labels
          // Try matching by ID first, then by title prefix
          if (completed.has(dep)) return true;
          for (const cid of completed) {
            const ct = taskMap.get(cid);
            if (ct && ct.title.toLowerCase().startsWith(dep.toLowerCase())) {
              return true;
            }
          }
          // If the dependency refers to a task not in our list, consider it resolved
          return !taskMap.has(dep);
        });

        if (depsResolved) {
          waveItems.push(task);
        }
      }

      if (waveItems.length === 0) {
        // Circular dependency or unresolvable deps — dump remaining into this wave
        for (const id of remaining) {
          waveItems.push(taskMap.get(id)!);
        }
        remaining.clear();
      } else {
        for (const item of waveItems) {
          remaining.delete(item.id);
          completed.add(item.id);
        }
      }

      // Sort wave by priority: high first, then medium, then low
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      waveItems.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      plan.push({ wave, tasks: waveItems });
      wave++;
    }

    return plan;
  }

  // ---------------------------------------------------------------------------
  // Markdown output
  // ---------------------------------------------------------------------------

  /** Format tasks as a markdown checklist. */
  toMarkdown(tasks: WhiteboardTask[]): string {
    if (tasks.length === 0) {
      return '# Tasks\n\nNo tasks extracted.\n';
    }

    const lines: string[] = ['# Tasks', ''];

    // Group by priority
    const high = tasks.filter((t) => t.priority === 'high');
    const medium = tasks.filter((t) => t.priority === 'medium');
    const low = tasks.filter((t) => t.priority === 'low');

    if (high.length > 0) {
      lines.push('## High Priority');
      lines.push('');
      for (const t of high) {
        lines.push(this.formatTaskLine(t));
      }
      lines.push('');
    }

    if (medium.length > 0) {
      lines.push('## Medium Priority');
      lines.push('');
      for (const t of medium) {
        lines.push(this.formatTaskLine(t));
      }
      lines.push('');
    }

    if (low.length > 0) {
      lines.push('## Low Priority');
      lines.push('');
      for (const t of low) {
        lines.push(this.formatTaskLine(t));
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  getStats(): { whiteboardsProcessed: number; tasksExtracted: number } {
    return {
      whiteboardsProcessed: this.processedCount,
      tasksExtracted: this.taskCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private formatTaskLine(task: WhiteboardTask): string {
    let line = `- [ ] **${task.title}**`;
    if (task.assignee) {
      line += ` (@${task.assignee})`;
    }
    if (task.dependencies.length > 0) {
      line += ` _depends on: ${task.dependencies.join(', ')}_`;
    }
    return line;
  }
}
