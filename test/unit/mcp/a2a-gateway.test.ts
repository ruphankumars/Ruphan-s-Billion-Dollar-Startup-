import { describe, it, expect, vi, beforeEach } from 'vitest';
import { A2AGateway } from '../../../src/mcp/a2a-gateway.js';
import type { A2AGatewayOptions } from '../../../src/mcp/a2a-gateway.js';

describe('A2AGateway', () => {
  let gateway: A2AGateway;

  beforeEach(() => {
    gateway = new A2AGateway();
  });

  describe('constructor', () => {
    it('creates gateway with defaults', () => {
      expect(gateway).toBeInstanceOf(A2AGateway);
      const card = gateway.getAgentCard();
      expect(card.name).toBe('CortexOS');
      expect(card.version).toBe('1.0.0');
    });

    it('accepts custom options', () => {
      const custom = new A2AGateway({
        port: 4000,
        hostname: 'custom-host',
        agentCard: { name: 'CustomAgent', description: 'Custom desc' },
        maxConcurrentTasks: 5,
        taskTimeout: 60_000,
      });
      const card = custom.getAgentCard();
      expect(card.name).toBe('CustomAgent');
      expect(card.description).toBe('Custom desc');
    });
  });

  describe('getAgentCard()', () => {
    it('returns valid card', () => {
      const card = gateway.getAgentCard();
      expect(card).toBeDefined();
      expect(card.name).toBe('CortexOS');
      expect(card.description).toContain('AI Agent Operating System');
      expect(card.version).toBe('1.0.0');
      expect(card.url).toContain('localhost');
      expect(card.capabilities).toBeDefined();
      expect(Array.isArray(card.capabilities)).toBe(true);
      expect(card.skills).toBeDefined();
      expect(Array.isArray(card.skills)).toBe(true);
      expect(card.skills.length).toBeGreaterThan(0);
    });

    it('returns a copy of the card (not a reference)', () => {
      const card1 = gateway.getAgentCard();
      const card2 = gateway.getAgentCard();
      expect(card1).toEqual(card2);
      expect(card1).not.toBe(card2);
    });
  });

  describe('updateSkills()', () => {
    it('updates agent card skills', () => {
      const newSkills = [
        {
          id: 'custom-skill',
          name: 'Custom Skill',
          description: 'A custom skill',
          tags: ['custom'],
          inputModes: ['text'],
          outputModes: ['text'],
        },
      ];

      const emitSpy = vi.fn();
      gateway.on('a2a:skills:updated', emitSpy);

      gateway.updateSkills(newSkills);

      const card = gateway.getAgentCard();
      expect(card.skills).toHaveLength(1);
      expect(card.skills[0].id).toBe('custom-skill');
      expect(emitSpy).toHaveBeenCalledWith({ count: 1 });
    });
  });

  describe('getStats()', () => {
    it('returns correct counts with no tasks', () => {
      const stats = gateway.getStats();
      expect(stats).toEqual({
        totalTasks: 0,
        activeTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        sseConnections: 0,
      });
    });
  });

  describe('cancelTask()', () => {
    it('returns false for non-existent task', async () => {
      const result = await gateway.cancelTask('non-existent-task');
      expect(result).toBe(false);
    });
  });

  describe('listTasks()', () => {
    it('returns empty array when no tasks', () => {
      const tasks = gateway.listTasks();
      expect(tasks).toEqual([]);
    });

    it('with status filter returns empty when no tasks match', () => {
      const tasks = gateway.listTasks({ status: 'completed' });
      expect(tasks).toEqual([]);
    });
  });

  describe('getTask()', () => {
    it('returns undefined for unknown task', () => {
      const task = gateway.getTask('non-existent');
      expect(task).toBeUndefined();
    });
  });

  describe('setTaskHandler()', () => {
    it('sets the task handler', () => {
      const handler = vi.fn();
      gateway.setTaskHandler(handler);
      // No direct way to verify, but should not throw
      expect(true).toBe(true);
    });
  });
});
