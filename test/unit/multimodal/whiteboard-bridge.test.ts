import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhiteboardBridge } from '../../../src/multimodal/whiteboard-bridge.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Tests ──────────────────────────────────────────────────────

describe('WhiteboardBridge', () => {
  let bridge: WhiteboardBridge;
  let tmpDir: string;

  beforeEach(async () => {
    bridge = new WhiteboardBridge();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-wb-test-'));
  });

  // ─── processImage ─────────────────────────────────────────────

  describe('processImage', () => {
    it('should process an image file and return empty tasks', async () => {
      const filePath = path.join(tmpDir, 'whiteboard.png');
      await fs.writeFile(filePath, Buffer.alloc(10));

      const tasks = await bridge.processImage(filePath);
      expect(tasks).toEqual([]);
    });

    it('should throw for non-existent files', async () => {
      await expect(bridge.processImage('/nonexistent/file.png')).rejects.toThrow();
    });

    it('should emit multimodal:whiteboard:processed event', async () => {
      const handler = vi.fn();
      bridge.on('multimodal:whiteboard:processed', handler);

      const filePath = path.join(tmpDir, 'whiteboard.png');
      await fs.writeFile(filePath, Buffer.alloc(10));
      await bridge.processImage(filePath);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].source).toBe(filePath);
      expect(handler.mock.calls[0][0].tasks).toEqual([]);
    });

    it('should increment processed count', async () => {
      const filePath = path.join(tmpDir, 'wb.png');
      await fs.writeFile(filePath, Buffer.alloc(10));

      await bridge.processImage(filePath);
      await bridge.processImage(filePath);

      expect(bridge.getStats().whiteboardsProcessed).toBe(2);
    });
  });

  // ─── processText ──────────────────────────────────────────────

  describe('processText', () => {
    it('should extract tasks from bulleted list', () => {
      const text = '- Build login page\n- Add validation\n- Write tests';
      const tasks = bridge.processText(text);

      expect(tasks).toHaveLength(3);
      expect(tasks[0].title).toContain('Build login page');
      expect(tasks[1].title).toContain('Add validation');
      expect(tasks[2].title).toContain('Write tests');
    });

    it('should extract tasks from numbered list', () => {
      const text = '1. Design database schema\n2. Create API endpoints\n3. Build frontend';
      const tasks = bridge.processText(text);

      expect(tasks).toHaveLength(3);
      expect(tasks[0].title).toContain('Design database schema');
    });

    it('should extract tasks from checkbox list', () => {
      const text = '[ ] Implement auth\n[x] Setup CI/CD\n[ ] Deploy to prod';
      const tasks = bridge.processText(text);

      expect(tasks).toHaveLength(3);
      expect(tasks[0].title).toContain('Implement auth');
    });

    it('should detect assignees from @mentions', () => {
      const text = '- Fix bug @alice\n- Review PR @bob';
      const tasks = bridge.processText(text);

      expect(tasks[0].assignee).toBe('alice');
      expect(tasks[1].assignee).toBe('bob');
    });

    it('should detect high priority keywords', () => {
      const text = '- URGENT: fix production crash\n- Normal task';
      const tasks = bridge.processText(text);

      expect(tasks[0].priority).toBe('high');
      expect(tasks[1].priority).toBe('medium');
    });

    it('should detect low priority keywords', () => {
      const text = '- Nice to have: add dark mode\n- Optional: refactor utils';
      const tasks = bridge.processText(text);

      expect(tasks[0].priority).toBe('low');
      expect(tasks[1].priority).toBe('low');
    });

    it('should handle indented subtasks with dependency on parent', () => {
      const text = '- Build auth module\n  - Create login form\n  - Add OAuth support';
      const tasks = bridge.processText(text);

      expect(tasks).toHaveLength(3);
      const parentId = tasks[0].id;
      expect(tasks[1].dependencies).toContain(parentId);
      expect(tasks[2].dependencies).toContain(parentId);
    });

    it('should detect explicit dependencies', () => {
      const text = '- Deploy service depends on Build service';
      const tasks = bridge.processText(text);

      expect(tasks[0].dependencies).toHaveLength(1);
      expect(tasks[0].dependencies[0]).toBe('Build service');
    });

    it('should emit multimodal:whiteboard:processed event', () => {
      const handler = vi.fn();
      bridge.on('multimodal:whiteboard:processed', handler);

      bridge.processText('- Task 1\n- Task 2');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].source).toBe('text');
      expect(handler.mock.calls[0][0].tasks).toHaveLength(2);
    });

    it('should skip empty lines', () => {
      const text = '- Task A\n\n\n- Task B\n\n';
      const tasks = bridge.processText(text);

      expect(tasks).toHaveLength(2);
    });

    it('should handle mixed bullet styles', () => {
      const text = '- Dash item\n* Star item\n+ Plus item';
      const tasks = bridge.processText(text);

      expect(tasks).toHaveLength(3);
    });

    it('should set extractedFrom to whiteboard', () => {
      const tasks = bridge.processText('- Task');
      expect(tasks[0].extractedFrom).toBe('whiteboard');
    });
  });

  // ─── extractTasks ─────────────────────────────────────────────

  describe('extractTasks', () => {
    it('should create tasks from raw items', () => {
      const items = [
        { text: 'Build API', indent: 0 },
        { text: 'Add tests', indent: 0 },
      ];

      const tasks = bridge.extractTasks(items);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].title).toBe('Build API');
      expect(tasks[0].id).toContain('task_');
    });

    it('should link indented items as dependencies', () => {
      const items = [
        { text: 'Parent task', indent: 0 },
        { text: 'Child task', indent: 2 },
      ];

      const tasks = bridge.extractTasks(items);
      expect(tasks[1].dependencies).toContain(tasks[0].id);
    });

    it('should detect @assignees', () => {
      const items = [{ text: 'Review code @alice', indent: 0 }];
      const tasks = bridge.extractTasks(items);
      expect(tasks[0].assignee).toBe('alice');
    });

    it('should remove @mentions from title', () => {
      const items = [{ text: 'Review code @alice', indent: 0 }];
      const tasks = bridge.extractTasks(items);
      expect(tasks[0].title).not.toContain('@alice');
    });
  });

  // ─── prioritizeTasks ──────────────────────────────────────────

  describe('prioritizeTasks', () => {
    it('should set high priority for critical keywords', () => {
      const tasks = bridge.extractTasks([{ text: 'Critical bug fix', indent: 0 }]);
      const prioritised = bridge.prioritizeTasks(tasks);
      expect(prioritised[0].priority).toBe('high');
    });

    it('should set low priority for backlog keywords', () => {
      const tasks = bridge.extractTasks([{ text: 'Backlog cleanup item', indent: 0 }]);
      const prioritised = bridge.prioritizeTasks(tasks);
      expect(prioritised[0].priority).toBe('low');
    });

    it('should default to medium priority', () => {
      const tasks = bridge.extractTasks([{ text: 'Regular task', indent: 0 }]);
      const prioritised = bridge.prioritizeTasks(tasks);
      expect(prioritised[0].priority).toBe('medium');
    });

    it('should not modify the original tasks', () => {
      const tasks = bridge.extractTasks([{ text: 'Urgent fix', indent: 0 }]);
      const original = tasks[0].priority;
      bridge.prioritizeTasks(tasks);
      expect(tasks[0].priority).toBe(original);
    });
  });

  // ─── generatePlan ─────────────────────────────────────────────

  describe('generatePlan', () => {
    it('should generate a single wave for independent tasks', () => {
      const tasks = bridge.processText('- Task A\n- Task B\n- Task C');
      const plan = bridge.generatePlan(tasks);

      expect(plan).toHaveLength(1);
      expect(plan[0].wave).toBe(1);
      expect(plan[0].tasks).toHaveLength(3);
    });

    it('should generate multiple waves for dependent tasks', () => {
      const tasks = bridge.processText('- Build service\n  - Deploy service\n  - Test service');
      const plan = bridge.generatePlan(tasks);

      expect(plan.length).toBeGreaterThanOrEqual(2);
      // First wave should contain the parent task
      expect(plan[0].tasks[0].title).toContain('Build service');
    });

    it('should sort tasks within a wave by priority', () => {
      const tasks = bridge.processText(
        '- Optional: low priority task\n- Regular task\n- URGENT: critical task',
      );
      const plan = bridge.generatePlan(tasks);

      const firstWave = plan[0].tasks;
      // High priority should come first
      expect(firstWave[0].priority).toBe('high');
    });

    it('should handle empty task list', () => {
      const plan = bridge.generatePlan([]);
      expect(plan).toHaveLength(0);
    });

    it('should handle circular dependencies by dumping remaining into a wave', () => {
      // Create tasks with circular dependencies (A depends on B, B depends on A)
      const taskA = {
        id: 'a',
        title: 'Task A',
        description: 'Task A',
        priority: 'medium' as const,
        dependencies: ['b'],
        extractedFrom: 'whiteboard',
      };
      const taskB = {
        id: 'b',
        title: 'Task B',
        description: 'Task B',
        priority: 'medium' as const,
        dependencies: ['a'],
        extractedFrom: 'whiteboard',
      };

      const plan = bridge.generatePlan([taskA, taskB]);
      expect(plan.length).toBeGreaterThanOrEqual(1);
      // All tasks should still appear
      const allTasks = plan.flatMap((w) => w.tasks);
      expect(allTasks).toHaveLength(2);
    });
  });

  // ─── toMarkdown ───────────────────────────────────────────────

  describe('toMarkdown', () => {
    it('should generate markdown for empty tasks', () => {
      const md = bridge.toMarkdown([]);
      expect(md).toContain('# Tasks');
      expect(md).toContain('No tasks extracted');
    });

    it('should group tasks by priority', () => {
      const tasks = bridge.processText(
        '- URGENT: critical fix\n- Regular task\n- Nice to have: polish UI',
      );
      const md = bridge.toMarkdown(tasks);

      expect(md).toContain('## High Priority');
      expect(md).toContain('## Medium Priority');
      expect(md).toContain('## Low Priority');
    });

    it('should include task titles with checkboxes', () => {
      const tasks = bridge.processText('- Build feature');
      const md = bridge.toMarkdown(tasks);

      expect(md).toContain('- [ ] **');
      expect(md).toContain('Build feature');
    });

    it('should include assignees', () => {
      const tasks = bridge.processText('- Fix bug @alice');
      const md = bridge.toMarkdown(tasks);

      expect(md).toContain('@alice');
    });

    it('should include dependencies', () => {
      const tasks = bridge.processText('- Build service\n  - Deploy service');
      const md = bridge.toMarkdown(tasks);

      expect(md).toContain('depends on');
    });
  });

  // ─── Stats ────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return zeros initially', () => {
      const stats = bridge.getStats();
      expect(stats.whiteboardsProcessed).toBe(0);
      expect(stats.tasksExtracted).toBe(0);
    });

    it('should track processed count and task count', () => {
      bridge.processText('- Task 1\n- Task 2');
      bridge.processText('- Task 3');

      const stats = bridge.getStats();
      expect(stats.whiteboardsProcessed).toBe(2);
      expect(stats.tasksExtracted).toBe(3);
    });
  });
});
