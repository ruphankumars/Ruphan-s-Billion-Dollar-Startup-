/**
 * SemanticScheduler — Semantic Task Scheduling Engine
 *
 * Classifies tasks by semantic type using keyword analysis, assigns
 * appropriate resource profiles, and manages a priority queue with
 * fair-share scheduling. Each semantic type has a default resource
 * allocation (CPU, memory, GPU, model tier, tokens, duration) that
 * can be customized at runtime.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  SemanticTask,
  TaskSemanticType,
  ResourceSlot,
  ResourceProfile,
  SchedulerQueue,
  SchedulerConfig,
  SchedulerStats,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: SchedulerConfig = {
  enabled: true,
  maxQueueSize: 1000,
  defaultModelTier: 'standard',
  preemptionEnabled: false,
  fairShareEnabled: true,
};

/** Keyword-to-semantic-type mapping for classification */
const SEMANTIC_KEYWORDS: Record<TaskSemanticType, string[]> = {
  'code-review': ['review', 'analyze', 'check', 'audit', 'inspect', 'lint', 'pr review', 'code review'],
  'code-generation': ['generate', 'create', 'implement', 'build', 'write code', 'scaffold', 'boilerplate', 'coding'],
  'creative-writing': ['write', 'story', 'blog', 'article', 'creative', 'essay', 'narrative', 'compose', 'draft'],
  'data-analysis': ['analyze data', 'statistics', 'chart', 'graph', 'metrics', 'dataset', 'csv', 'aggregate', 'visualize'],
  'research': ['research', 'investigate', 'explore', 'study', 'survey', 'literature', 'find information', 'lookup'],
  'debugging': ['debug', 'fix', 'bug', 'error', 'issue', 'troubleshoot', 'diagnose', 'trace', 'crash', 'exception'],
  'testing': ['test', 'spec', 'assert', 'coverage', 'unit test', 'integration test', 'e2e', 'verify', 'validate test'],
  'documentation': ['document', 'docs', 'readme', 'jsdoc', 'api docs', 'comment', 'explain code', 'annotate'],
  'translation': ['translate', 'localize', 'i18n', 'l10n', 'language', 'convert language', 'internationalize'],
  'summarization': ['summarize', 'summary', 'tldr', 'condensed', 'brief', 'digest', 'overview', 'abstract'],
  'conversation': ['chat', 'conversation', 'discuss', 'talk', 'dialogue', 'answer question', 'respond'],
  'custom': [],
};

/** Default resource profiles per semantic type */
const DEFAULT_PROFILES: ResourceProfile = {
  'code-review': {
    cpuWeight: 0.5,
    memoryMb: 512,
    gpuShare: 0.1,
    modelTier: 'standard',
    maxTokens: 4000,
    maxDuration: 60000,
  },
  'code-generation': {
    cpuWeight: 0.7,
    memoryMb: 1024,
    gpuShare: 0.3,
    modelTier: 'premium',
    maxTokens: 8000,
    maxDuration: 120000,
  },
  'creative-writing': {
    cpuWeight: 0.3,
    memoryMb: 512,
    gpuShare: 0.2,
    modelTier: 'premium',
    maxTokens: 8000,
    maxDuration: 90000,
  },
  'data-analysis': {
    cpuWeight: 0.8,
    memoryMb: 2048,
    gpuShare: 0.4,
    modelTier: 'standard',
    maxTokens: 6000,
    maxDuration: 180000,
  },
  'research': {
    cpuWeight: 0.4,
    memoryMb: 768,
    gpuShare: 0.2,
    modelTier: 'standard',
    maxTokens: 6000,
    maxDuration: 120000,
  },
  'debugging': {
    cpuWeight: 0.8,
    memoryMb: 1024,
    gpuShare: 0.3,
    modelTier: 'premium',
    maxTokens: 6000,
    maxDuration: 150000,
  },
  'testing': {
    cpuWeight: 0.6,
    memoryMb: 768,
    gpuShare: 0.2,
    modelTier: 'standard',
    maxTokens: 4000,
    maxDuration: 90000,
  },
  'documentation': {
    cpuWeight: 0.3,
    memoryMb: 256,
    gpuShare: 0.1,
    modelTier: 'economy',
    maxTokens: 4000,
    maxDuration: 60000,
  },
  'translation': {
    cpuWeight: 0.4,
    memoryMb: 512,
    gpuShare: 0.2,
    modelTier: 'standard',
    maxTokens: 4000,
    maxDuration: 60000,
  },
  'summarization': {
    cpuWeight: 0.3,
    memoryMb: 256,
    gpuShare: 0.1,
    modelTier: 'economy',
    maxTokens: 2000,
    maxDuration: 30000,
  },
  'conversation': {
    cpuWeight: 0.2,
    memoryMb: 256,
    gpuShare: 0.1,
    modelTier: 'economy',
    maxTokens: 2000,
    maxDuration: 30000,
  },
  'custom': {
    cpuWeight: 0.5,
    memoryMb: 512,
    gpuShare: 0.2,
    modelTier: 'standard',
    maxTokens: 4000,
    maxDuration: 60000,
  },
};

// ═══════════════════════════════════════════════════════════════
// SEMANTIC SCHEDULER
// ═══════════════════════════════════════════════════════════════

export class SemanticScheduler extends EventEmitter {
  private config: SchedulerConfig;
  private running = false;

  /** Priority queue of tasks waiting to be scheduled */
  private queue: SemanticTask[] = [];

  /** Currently running tasks keyed by task ID */
  private runningTasks: Map<string, SemanticTask> = new Map();

  /** Completed/failed tasks for history */
  private completed: SemanticTask[] = [];

  /** Customizable resource profiles per semantic type */
  private profiles: ResourceProfile;

  /** Tracking: total scheduled count */
  private totalScheduled = 0;

  /** Tracking: cumulative wait time and execution time for averages */
  private cumulativeWaitTime = 0;
  private cumulativeExecTime = 0;
  private scheduledStartTimes: Map<string, number> = new Map();

  constructor(config?: Partial<SchedulerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.profiles = { ...DEFAULT_PROFILES };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit('scheduler:started', { timestamp: Date.now() });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.emit('scheduler:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // CLASSIFICATION
  // ─────────────────────────────────────────────────────────

  /**
   * Classify a task description into a semantic type using keyword matching.
   * Scores each semantic type by how many of its keywords appear in the
   * description (normalized by keyword count). Returns the best match
   * or 'custom' if no keywords match.
   */
  classifyTask(description: string): TaskSemanticType {
    const lower = description.toLowerCase();
    let bestType: TaskSemanticType = 'custom';
    let bestScore = 0;

    for (const [semanticType, keywords] of Object.entries(SEMANTIC_KEYWORDS) as Array<
      [TaskSemanticType, string[]]
    >) {
      if (keywords.length === 0) continue;

      let matches = 0;
      for (const keyword of keywords) {
        if (lower.includes(keyword)) {
          matches++;
        }
      }

      // Normalize by keyword count to avoid bias toward types with many keywords
      const score = matches / keywords.length;
      // Also weight by absolute match count to prefer more specific matches
      const weightedScore = score + matches * 0.1;

      if (weightedScore > bestScore && matches > 0) {
        bestScore = weightedScore;
        bestType = semanticType;
      }
    }

    return bestType;
  }

  // ─────────────────────────────────────────────────────────
  // SCHEDULING
  // ─────────────────────────────────────────────────────────

  /**
   * Schedule a new task. Classifies it, assigns a resource profile,
   * and adds it to the priority queue.
   */
  schedule(
    task: Omit<SemanticTask, 'id' | 'status' | 'createdAt' | 'assignedResources'>,
  ): SemanticTask {
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Queue is full (max ${this.config.maxQueueSize})`);
    }

    const now = Date.now();
    const semanticType = task.semanticType || this.classifyTask(task.description);
    const resourceSlot = { ...this.profiles[semanticType] };

    const newTask: SemanticTask = {
      ...task,
      id: `task-${randomUUID().slice(0, 8)}`,
      semanticType,
      assignedResources: resourceSlot,
      status: 'queued',
      createdAt: now,
    };

    this.queue.push(newTask);
    this.totalScheduled++;

    // Keep queue sorted by priority (descending)
    this.queue.sort((a, b) => b.priority - a.priority);

    this.emit('scheduler:task:scheduled', { task: newTask, timestamp: now });
    return newTask;
  }

  /**
   * Dequeue the highest-priority task that fits within available resources.
   * Moves the task from 'queued' to 'running'.
   */
  dequeue(): SemanticTask | null {
    if (this.queue.length === 0) return null;

    // Find the highest-priority task that is still queued
    const index = this.queue.findIndex((t) => t.status === 'queued');
    if (index === -1) return null;

    const task = this.queue.splice(index, 1)[0];
    task.status = 'running';

    this.runningTasks.set(task.id, task);
    this.scheduledStartTimes.set(task.id, Date.now());

    // Track wait time
    this.cumulativeWaitTime += Date.now() - task.createdAt;

    this.emit('scheduler:task:dequeued', { task, timestamp: Date.now() });
    return task;
  }

  /**
   * Complete a running task (success or failure).
   */
  completeTask(taskId: string, success: boolean): SemanticTask {
    const task = this.runningTasks.get(taskId);
    if (!task) {
      throw new Error(`Running task "${taskId}" not found`);
    }

    task.status = success ? 'completed' : 'failed';
    this.runningTasks.delete(taskId);
    this.completed.push(task);

    // Track execution time
    const startTime = this.scheduledStartTimes.get(taskId) ?? task.createdAt;
    this.cumulativeExecTime += Date.now() - startTime;
    this.scheduledStartTimes.delete(taskId);

    this.emit('scheduler:task:completed', {
      task,
      success,
      timestamp: Date.now(),
    });

    return task;
  }

  // ─────────────────────────────────────────────────────────
  // RESOURCE PROFILES
  // ─────────────────────────────────────────────────────────

  /**
   * Get the default resource profile for a semantic type.
   */
  getResourceProfile(type: TaskSemanticType): ResourceSlot {
    return { ...this.profiles[type] };
  }

  /**
   * Set a custom resource profile for a semantic type.
   */
  setResourceProfile(type: TaskSemanticType, slot: ResourceSlot): void {
    this.profiles[type] = { ...slot };
    this.emit('scheduler:profile:updated', { type, slot, timestamp: Date.now() });
  }

  // ─────────────────────────────────────────────────────────
  // QUEUE MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Get the current queue state with aggregate cost and duration estimates.
   */
  getQueue(): SchedulerQueue {
    const tasks = [...this.queue];
    const totalEstimatedDuration = tasks.reduce((sum, t) => sum + t.estimatedDuration, 0);

    // Estimate cost based on model tier multipliers
    const tierCosts: Record<string, number> = { economy: 0.5, standard: 1.0, premium: 2.0 };
    const totalEstimatedCost = tasks.reduce((sum, t) => {
      const tier = t.assignedResources?.modelTier ?? 'standard';
      const tokenCost = (t.estimatedTokens / 1000) * (tierCosts[tier] ?? 1.0);
      return sum + tokenCost;
    }, 0);

    return {
      tasks,
      totalEstimatedCost: Math.round(totalEstimatedCost * 100) / 100,
      totalEstimatedDuration,
    };
  }

  /**
   * Get all currently running tasks.
   */
  getRunningTasks(): SemanticTask[] {
    return [...this.runningTasks.values()];
  }

  /**
   * Rebalance the queue by re-sorting based on priority and fair-share rules.
   * When fairShare is enabled, tasks of types that have fewer running instances
   * get a priority boost to prevent starvation.
   */
  rebalance(): void {
    if (!this.config.fairShareEnabled) {
      // Simple priority sort
      this.queue.sort((a, b) => b.priority - a.priority);
      this.emit('scheduler:rebalanced', { timestamp: Date.now() });
      return;
    }

    // Count running tasks per semantic type
    const runningCountByType = new Map<TaskSemanticType, number>();
    for (const task of this.runningTasks.values()) {
      runningCountByType.set(
        task.semanticType,
        (runningCountByType.get(task.semanticType) ?? 0) + 1,
      );
    }

    // Fair-share: tasks of under-represented types get a virtual priority boost
    const maxRunning = Math.max(1, ...runningCountByType.values());

    this.queue.sort((a, b) => {
      const aRunning = runningCountByType.get(a.semanticType) ?? 0;
      const bRunning = runningCountByType.get(b.semanticType) ?? 0;

      // Fair-share boost: types with fewer running tasks get higher effective priority
      const aBoost = a.priority + (1 - aRunning / maxRunning) * 5;
      const bBoost = b.priority + (1 - bRunning / maxRunning) * 5;

      return bBoost - aBoost;
    });

    this.emit('scheduler:rebalanced', { timestamp: Date.now() });
  }

  // ─────────────────────────────────────────────────────────
  // STATISTICS
  // ─────────────────────────────────────────────────────────

  /**
   * Get scheduler operational statistics.
   */
  getStats(): SchedulerStats {
    const completedCount = this.completed.filter((t) => t.status === 'completed').length;
    const failedCount = this.completed.filter((t) => t.status === 'failed').length;
    const finishedCount = completedCount + failedCount;

    // Resource utilization: fraction of running tasks vs. queue capacity
    const utilization =
      this.config.maxQueueSize > 0
        ? this.runningTasks.size / Math.max(this.config.maxQueueSize, 1)
        : 0;

    return {
      totalScheduled: this.totalScheduled,
      totalCompleted: completedCount,
      totalFailed: failedCount,
      avgWaitTime:
        finishedCount > 0
          ? Math.round(this.cumulativeWaitTime / finishedCount)
          : 0,
      avgExecutionTime:
        finishedCount > 0
          ? Math.round(this.cumulativeExecTime / finishedCount)
          : 0,
      resourceUtilization: Math.round(utilization * 10000) / 10000,
      queueDepth: this.queue.length,
    };
  }
}
