import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PopulationReasoner } from '../../../src/evolution/population-reasoner.js';
import type { Candidate, AggregationResult, PopulationState } from '../../../src/evolution/types.js';

describe('PopulationReasoner', () => {
  let reasoner: PopulationReasoner;

  beforeEach(() => {
    reasoner = new PopulationReasoner();
  });

  // ─── Constructor and Defaults ───────────────────────────────────────────────

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const stats = reasoner.getStats();
      expect(stats.config.populationSize).toBe(5);
      expect(stats.config.aggregationSetSize).toBe(3);
      expect(stats.config.maxIterations).toBe(3);
      expect(stats.config.convergenceThreshold).toBe(0.98);
      expect(stats.config.maxTokensPerCandidate).toBe(4096);
      expect(stats.config.trackDiversity).toBe(true);
    });

    it('should accept partial configuration overrides', () => {
      const custom = new PopulationReasoner({ populationSize: 10, maxIterations: 5 });
      const stats = custom.getStats();
      expect(stats.config.populationSize).toBe(10);
      expect(stats.config.maxIterations).toBe(5);
      expect(stats.config.aggregationSetSize).toBe(3); // default preserved
    });

    it('should start in stopped state', () => {
      expect(reasoner.isRunning()).toBe(false);
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  describe('start/stop/isRunning', () => {
    it('should transition to running on start()', () => {
      reasoner.start();
      expect(reasoner.isRunning()).toBe(true);
    });

    it('should emit evolution:started event on start()', () => {
      const handler = vi.fn();
      reasoner.on('evolution:started', handler);
      reasoner.start();
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'PopulationReasoner' })
      );
    });

    it('should transition to stopped and clear populations on stop()', () => {
      reasoner.start();
      reasoner.initializePopulation('task-1', ['a', 'b', 'c']);
      reasoner.stop();
      expect(reasoner.isRunning()).toBe(false);
      expect(reasoner.getPopulation('task-1')).toBeUndefined();
    });

    it('should handle multiple start/stop cycles', () => {
      reasoner.start();
      reasoner.stop();
      reasoner.start();
      expect(reasoner.isRunning()).toBe(true);
      reasoner.stop();
      expect(reasoner.isRunning()).toBe(false);
    });
  });

  // ─── initializePopulation ───────────────────────────────────────────────────

  describe('initializePopulation', () => {
    it('should initialize population with given candidates', () => {
      const state = reasoner.initializePopulation('task-1', ['sol-a', 'sol-b', 'sol-c']);
      expect(state.candidates.length).toBe(5); // padded to populationSize
      expect(state.iteration).toBe(0);
      expect(state.converged).toBe(false);
    });

    it('should assign provided scores to candidates', () => {
      const state = reasoner.initializePopulation('task-1', ['a', 'b', 'c'], [0.9, 0.8, 0.7]);
      expect(state.candidates[0].score).toBe(0.9);
      expect(state.candidates[1].score).toBe(0.8);
      expect(state.candidates[2].score).toBe(0.7);
    });

    it('should pad population to populationSize with clones', () => {
      const small = new PopulationReasoner({ populationSize: 4 });
      const state = small.initializePopulation('task-1', ['single']);
      expect(state.candidates.length).toBe(4);
      // Clones should have parentIds and cloned metadata
      expect(state.candidates[1].metadata).toEqual({ cloned: true });
    });

    it('should trim candidates if more than populationSize', () => {
      const small = new PopulationReasoner({ populationSize: 2 });
      const state = small.initializePopulation('task-1', ['a', 'b', 'c', 'd', 'e']);
      expect(state.candidates.length).toBe(2);
    });

    it('should select the best candidate', () => {
      const state = reasoner.initializePopulation('task-1', ['a', 'b', 'c'], [0.3, 0.9, 0.5]);
      expect(state.bestCandidate).not.toBeNull();
      expect(state.bestCandidate!.score).toBe(0.9);
    });

    it('should compute diversity score', () => {
      const state = reasoner.initializePopulation(
        'task-1',
        ['the quick brown fox', 'entirely different content', 'yet another unique phrase']
      );
      expect(state.diversityScore).toBeGreaterThanOrEqual(0);
      expect(state.diversityScore).toBeLessThanOrEqual(1);
    });

    it('should store population retrievable via getPopulation', () => {
      reasoner.initializePopulation('task-1', ['a', 'b']);
      const pop = reasoner.getPopulation('task-1');
      expect(pop).toBeDefined();
      expect(pop!.iteration).toBe(0);
    });
  });

  // ─── iterate ────────────────────────────────────────────────────────────────

  describe('iterate', () => {
    const mockAggregateFn = vi.fn(async (candidates: Candidate[]): Promise<AggregationResult> => ({
      aggregatedContent: candidates.map(c => c.content).join('+'),
      sourceIds: candidates.map(c => c.id),
      improvementScore: 0.85,
    }));

    beforeEach(() => {
      mockAggregateFn.mockClear();
    });

    it('should throw if no population exists for taskId', async () => {
      await expect(reasoner.iterate('nonexistent', mockAggregateFn)).rejects.toThrow(
        'No population found for task nonexistent'
      );
    });

    it('should advance iteration count by 1', async () => {
      reasoner.initializePopulation('task-1', ['a', 'b', 'c']);
      const state = await reasoner.iterate('task-1', mockAggregateFn);
      expect(state.iteration).toBe(1);
    });

    it('should produce new candidates via aggregation function', async () => {
      reasoner.initializePopulation('task-1', ['a', 'b', 'c']);
      const state = await reasoner.iterate('task-1', mockAggregateFn);
      expect(mockAggregateFn).toHaveBeenCalled();
      // Each candidate gets a new id
      for (const c of state.candidates) {
        expect(c.id).toMatch(/^cand_/);
        expect(c.iteration).toBe(1);
      }
    });

    it('should emit evolution:iteration event', async () => {
      const handler = vi.fn();
      reasoner.on('evolution:iteration', handler);
      reasoner.initializePopulation('task-1', ['a', 'b', 'c']);
      await reasoner.iterate('task-1', mockAggregateFn);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-1',
          iteration: 1,
        })
      );
    });

    it('should return immediately if population already converged', async () => {
      reasoner.initializePopulation('task-1', ['a', 'b', 'c']);
      const pop = reasoner.getPopulation('task-1')!;
      // Manually mark converged
      pop.converged = true;
      const state = await reasoner.iterate('task-1', mockAggregateFn);
      expect(state.converged).toBe(true);
      expect(mockAggregateFn).not.toHaveBeenCalled();
    });

    it('should detect convergence when similarity is high', async () => {
      // Use identical content to force high similarity
      const identicalFn = vi.fn(async (): Promise<AggregationResult> => ({
        aggregatedContent: 'same content',
        sourceIds: ['a'],
        improvementScore: 0.9,
      }));

      const r = new PopulationReasoner({ populationSize: 2, convergenceThreshold: 0.5 });
      r.initializePopulation('task-1', ['same content', 'same content'], [0.5, 0.5]);
      const state = await r.iterate('task-1', identicalFn);
      // With identical content the similarity should be 1, triggering convergence
      expect(state.converged).toBe(true);
    });
  });

  // ─── evolve ─────────────────────────────────────────────────────────────────

  describe('evolve', () => {
    it('should run full evolution loop and return final state', async () => {
      let callCount = 0;
      const aggregateFn = vi.fn(async (): Promise<AggregationResult> => ({
        aggregatedContent: `iteration-${callCount++}`,
        sourceIds: [],
        improvementScore: 0.8,
      }));

      const r = new PopulationReasoner({ populationSize: 2, maxIterations: 3 });
      const finalState = await r.evolve('task-1', ['a', 'b'], aggregateFn);
      expect(finalState.iteration).toBeGreaterThanOrEqual(1);
      expect(finalState.iteration).toBeLessThanOrEqual(3);
    });

    it('should stop early on convergence', async () => {
      const aggregateFn = vi.fn(async (): Promise<AggregationResult> => ({
        aggregatedContent: 'converged answer',
        sourceIds: [],
        improvementScore: 0.99,
      }));

      const r = new PopulationReasoner({
        populationSize: 2,
        maxIterations: 10,
        convergenceThreshold: 0.5,
      });
      const finalState = await r.evolve('task-1', ['converged answer', 'converged answer'], aggregateFn);
      // Should converge early, not reach 10 iterations
      expect(finalState.iteration).toBeLessThan(10);
      expect(finalState.converged).toBe(true);
    });

    it('should increment totalTasksProcessed', async () => {
      const aggregateFn = vi.fn(async (): Promise<AggregationResult> => ({
        aggregatedContent: 'result',
        sourceIds: [],
        improvementScore: 0.5,
      }));

      const r = new PopulationReasoner({ populationSize: 2, maxIterations: 1 });
      await r.evolve('task-1', ['a'], aggregateFn);
      await r.evolve('task-2', ['b'], aggregateFn);
      expect(r.getStats().totalTasksProcessed).toBe(2);
    });

    it('should store history of evolved populations', async () => {
      const aggregateFn = vi.fn(async (): Promise<AggregationResult> => ({
        aggregatedContent: 'result',
        sourceIds: [],
        improvementScore: 0.5,
      }));

      const r = new PopulationReasoner({ populationSize: 2, maxIterations: 1 });
      await r.evolve('task-1', ['a'], aggregateFn);
      expect(r.getStats().historySize).toBe(1);
    });
  });

  // ─── getBest / getPopulation ────────────────────────────────────────────────

  describe('getBest', () => {
    it('should return null for unknown task', () => {
      expect(reasoner.getBest('unknown')).toBeNull();
    });

    it('should return the best candidate for an initialized population', () => {
      reasoner.initializePopulation('task-1', ['a', 'b'], [0.3, 0.9]);
      const best = reasoner.getBest('task-1');
      expect(best).not.toBeNull();
      expect(best!.score).toBe(0.9);
    });
  });

  describe('getPopulation', () => {
    it('should return undefined for unknown task', () => {
      expect(reasoner.getPopulation('unknown')).toBeUndefined();
    });
  });

  // ─── getStats ───────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return comprehensive stats object', () => {
      const stats = reasoner.getStats();
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('activePopulations');
      expect(stats).toHaveProperty('totalTasksProcessed');
      expect(stats).toHaveProperty('totalIterations');
      expect(stats).toHaveProperty('avgIterationsPerTask');
      expect(stats).toHaveProperty('historySize');
      expect(stats).toHaveProperty('config');
    });

    it('should reflect running state', () => {
      expect(reasoner.getStats().running).toBe(false);
      reasoner.start();
      expect(reasoner.getStats().running).toBe(true);
    });

    it('should track active populations', () => {
      expect(reasoner.getStats().activePopulations).toBe(0);
      reasoner.initializePopulation('task-1', ['a']);
      expect(reasoner.getStats().activePopulations).toBe(1);
    });

    it('should compute avgIterationsPerTask as 0 when no tasks processed', () => {
      expect(reasoner.getStats().avgIterationsPerTask).toBe(0);
    });
  });

  // ─── Event Emission ─────────────────────────────────────────────────────────

  describe('events', () => {
    it('should emit evolution:converged when convergence detected', async () => {
      const handler = vi.fn();
      const r = new PopulationReasoner({
        populationSize: 2,
        convergenceThreshold: 0.5,
      });
      r.on('evolution:converged', handler);

      const aggregateFn = vi.fn(async (): Promise<AggregationResult> => ({
        aggregatedContent: 'same',
        sourceIds: [],
        improvementScore: 0.9,
      }));

      r.initializePopulation('task-1', ['same', 'same'], [0.5, 0.5]);
      await r.iterate('task-1', aggregateFn);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-1',
        })
      );
    });
  });
});
