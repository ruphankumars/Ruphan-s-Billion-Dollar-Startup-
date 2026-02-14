/**
 * ReasoningEngine — CPU Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReasoningEngine } from '../../../src/kernel/reasoning-engine.js';
import type { SimulationState } from '../../../src/kernel/types.js';

describe('ReasoningEngine', () => {
  let engine: ReasoningEngine;

  beforeEach(() => {
    engine = new ReasoningEngine();
  });

  describe('lifecycle', () => {
    it('should start and stop', () => {
      expect(engine.isRunning()).toBe(false);
      engine.start();
      expect(engine.isRunning()).toBe(true);
      engine.stop();
      expect(engine.isRunning()).toBe(false);
    });

    it('should emit lifecycle events', () => {
      const started = vi.fn();
      const stopped = vi.fn();
      engine.on('kernel:reasoning:started', started);
      engine.on('kernel:reasoning:stopped', stopped);

      engine.start();
      engine.stop();

      expect(started).toHaveBeenCalledTimes(1);
      expect(stopped).toHaveBeenCalledTimes(1);
    });
  });

  describe('reason (Chain-of-Thought)', () => {
    it('should execute zero-shot reasoning', () => {
      const result = engine.reason('What is 2+2?');
      expect(result.chainId).toMatch(/^chain_/);
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.conclusion).toBeTruthy();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should execute few-shot reasoning', () => {
      const result = engine.reason('What is 3+3?', {
        strategy: 'few-shot',
        fewShotExamples: [
          { problem: '1+1', reasoning: 'Add numbers', answer: '2' },
          { problem: '2+2', reasoning: 'Add numbers', answer: '4' },
        ],
      });

      expect(result.steps.length).toBeGreaterThanOrEqual(3); // examples + deduction + conclusion
      const evidenceSteps = result.steps.filter(s => s.type === 'evidence');
      expect(evidenceSteps.length).toBe(2);
    });

    it('should execute self-consistency reasoning', () => {
      const result = engine.reason('Complex problem', {
        strategy: 'self-consistency',
        maxSteps: 10,
      });

      expect(result.steps.length).toBeGreaterThan(1);
      const hypotheses = result.steps.filter(s => s.type === 'hypothesis');
      expect(hypotheses.length).toBeGreaterThanOrEqual(1);
    });

    it('should execute least-to-most reasoning', () => {
      const result = engine.reason('Multi-step problem', {
        strategy: 'least-to-most',
        maxSteps: 10,
      });

      expect(result.steps.length).toBeGreaterThan(1);
      // Last step should be conclusion
      expect(result.steps[result.steps.length - 1].type).toBe('conclusion');
    });

    it('should include context in reasoning', () => {
      const result = engine.reason('What color?', {
        context: 'The sky is blue',
      });

      expect(result.steps[0].content).toContain('Context');
    });

    it('should generate valid step chain', () => {
      const result = engine.reason('Test problem', { maxSteps: 5 });

      for (const step of result.steps) {
        expect(step.id).toMatch(/^step_/);
        expect(step.confidence).toBeGreaterThanOrEqual(0);
        expect(step.confidence).toBeLessThanOrEqual(1);
        expect(step.timestamp).toBeGreaterThan(0);
      }
    });

    it('should emit completed event', () => {
      const listener = vi.fn();
      engine.on('kernel:reasoning:completed', listener);

      engine.reason('Test');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'zero-shot',
          steps: expect.any(Number),
          confidence: expect.any(Number),
        })
      );
    });

    it('should track chain in memory', () => {
      const result = engine.reason('Test');
      const chain = engine.getChain(result.chainId);
      expect(chain).toBeDefined();
      expect(chain!.length).toBe(result.steps.length);
    });

    it('should track metrics', () => {
      engine.reason('Test 1');
      engine.reason('Test 2');

      const stats = engine.getStats();
      expect(stats.totalChains).toBe(2);
      expect(stats.totalSteps).toBeGreaterThan(0);
    });
  });

  describe('addStep', () => {
    it('should add a step to an existing chain', () => {
      const result = engine.reason('Test');
      const step = engine.addStep(result.chainId, 'Additional insight', 'evidence');

      expect(step).not.toBeNull();
      expect(step!.content).toBe('Additional insight');
      expect(step!.type).toBe('evidence');
    });

    it('should link to previous step', () => {
      const result = engine.reason('Test');
      const lastStep = result.steps[result.steps.length - 1];
      const newStep = engine.addStep(result.chainId, 'New', 'deduction');

      expect(newStep!.parentId).toBe(lastStep.id);
    });

    it('should return null for non-existent chain', () => {
      expect(engine.addStep('nonexistent', 'Test', 'hypothesis')).toBeNull();
    });
  });

  describe('search (Tree-of-Thought)', () => {
    const evaluator = (state: string) => {
      // Higher score for longer states
      return Math.min(1, state.length / 100);
    };

    it('should execute BFS search', () => {
      const result = engine.search('Find best path', evaluator, {
        algorithm: 'bfs',
        maxNodes: 20,
        maxDepth: 3,
      });

      expect(result.treeId).toMatch(/^tree_/);
      expect(result.bestPath.length).toBeGreaterThan(0);
      expect(result.bestScore).toBeGreaterThanOrEqual(0);
      expect(result.nodesExplored).toBeGreaterThan(0);
    });

    it('should execute DFS search', () => {
      const result = engine.search('Find path', evaluator, {
        algorithm: 'dfs',
        maxNodes: 20,
        maxDepth: 3,
      });

      expect(result.nodesExplored).toBeGreaterThan(0);
      expect(result.bestPath.length).toBeGreaterThan(0);
    });

    it('should execute beam search', () => {
      const result = engine.search('Find path', evaluator, {
        algorithm: 'beam',
        beamWidth: 3,
        maxNodes: 30,
        maxDepth: 3,
      });

      expect(result.nodesExplored).toBeGreaterThan(0);
      expect(result.bestScore).toBeGreaterThanOrEqual(0);
    });

    it('should execute MCTS', () => {
      const result = engine.search('Find path', evaluator, {
        algorithm: 'mcts',
        maxNodes: 20,
      });

      expect(result.nodesExplored).toBeGreaterThan(0);
      expect(result.bestPath.length).toBeGreaterThan(0);
    });

    it('should respect maxNodes limit', () => {
      const result = engine.search('Test', evaluator, {
        algorithm: 'bfs',
        maxNodes: 10,
        maxDepth: 5,
      });

      expect(result.nodesExplored).toBeLessThanOrEqual(15); // Some tolerance
    });

    it('should emit searched event', () => {
      const listener = vi.fn();
      engine.on('kernel:reasoning:searched', listener);

      engine.search('Test', evaluator, { algorithm: 'beam' });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          algorithm: 'beam',
          nodesExplored: expect.any(Number),
        })
      );
    });

    it('should store search tree', () => {
      const result = engine.search('Test', evaluator);
      const tree = engine.getSearchTree(result.treeId);
      expect(tree).toBeDefined();
      expect(tree!.size).toBe(result.nodesExplored);
    });

    it('should track search metrics', () => {
      engine.search('Test 1', evaluator);
      engine.search('Test 2', evaluator);

      const stats = engine.getStats();
      expect(stats.totalSearches).toBe(2);
      expect(stats.avgSearchNodes).toBeGreaterThan(0);
    });
  });

  describe('simulate (Monte Carlo)', () => {
    const initialState: SimulationState = {
      stateId: 'state_0',
      content: 'Initial',
      reward: 0,
      step: 0,
      terminal: false,
    };

    const transitionFn = (state: SimulationState): SimulationState[] => {
      if (state.step >= 3) return []; // Terminal after 3 steps

      return [
        { stateId: '', content: `${state.content}_A`, reward: Math.random(), step: state.step + 1, terminal: state.step + 1 >= 3 },
        { stateId: '', content: `${state.content}_B`, reward: Math.random(), step: state.step + 1, terminal: state.step + 1 >= 3 },
      ];
    };

    it('should run Monte Carlo simulation', () => {
      const result = engine.simulate(initialState, transitionFn, {
        numTrajectories: 5,
        maxSteps: 10,
      });

      expect(result.simulationId).toMatch(/^sim_/);
      expect(result.trajectories).toHaveLength(5);
      expect(result.bestTrajectory).toBeDefined();
      expect(result.expectedReward).toBeGreaterThanOrEqual(0);
    });

    it('should respect numTrajectories', () => {
      const result = engine.simulate(initialState, transitionFn, {
        numTrajectories: 3,
      });

      expect(result.trajectories).toHaveLength(3);
    });

    it('should sort trajectories by total reward', () => {
      const result = engine.simulate(initialState, transitionFn, {
        numTrajectories: 10,
      });

      for (let i = 1; i < result.trajectories.length; i++) {
        expect(result.trajectories[i].totalReward).toBeLessThanOrEqual(
          result.trajectories[i - 1].totalReward
        );
      }
    });

    it('should handle terminal states', () => {
      const terminalTransition = () => []; // No transitions
      const result = engine.simulate(initialState, terminalTransition, {
        numTrajectories: 3,
      });

      expect(result.trajectories[0].steps).toBe(1); // Only initial state
    });

    it('should emit simulated event', () => {
      const listener = vi.fn();
      engine.on('kernel:reasoning:simulated', listener);

      engine.simulate(initialState, transitionFn);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          numTrajectories: expect.any(Number),
          expectedReward: expect.any(Number),
        })
      );
    });

    it('should track simulation metrics', () => {
      engine.simulate(initialState, transitionFn);
      engine.simulate(initialState, transitionFn);

      expect(engine.getStats().totalSimulations).toBe(2);
    });
  });

  describe('judge (LLM-as-Judge)', () => {
    it('should produce a verdict with majority consensus', () => {
      const verdict = engine.judge('Test output', ['correctness', 'clarity'], {
        numJudges: 3,
        consensusMethod: 'majority',
      });

      expect(verdict.id).toMatch(/^verdict_/);
      expect(typeof verdict.passed).toBe('boolean');
      expect(verdict.overallScore).toBeGreaterThanOrEqual(0);
      expect(verdict.overallScore).toBeLessThanOrEqual(1);
      expect(verdict.votes).toHaveLength(3);
      expect(verdict.categoryScores['correctness']).toBeDefined();
      expect(verdict.categoryScores['clarity']).toBeDefined();
    });

    it('should produce weighted consensus verdict', () => {
      const verdict = engine.judge('Output', ['quality'], {
        numJudges: 5,
        consensusMethod: 'weighted',
      });

      expect(verdict.votes).toHaveLength(5);
      expect(verdict.consensus).toBeGreaterThanOrEqual(0);
      expect(verdict.consensus).toBeLessThanOrEqual(1);
    });

    it('should produce debate consensus verdict', () => {
      const verdict = engine.judge('Output', ['quality'], {
        numJudges: 3,
        consensusMethod: 'debate',
      });

      expect(verdict.consensus).toBeGreaterThanOrEqual(0);
    });

    it('should emit judged event', () => {
      const listener = vi.fn();
      engine.on('kernel:reasoning:judged', listener);

      engine.judge('Output', ['quality']);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          passed: expect.any(Boolean),
          overallScore: expect.any(Number),
          consensus: expect.any(Number),
        })
      );
    });

    it('should store verdict and support retrieval', () => {
      const verdict = engine.judge('Output', ['quality']);
      const retrieved = engine.getVerdict(verdict.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(verdict.id);
    });

    it('should track judgement metrics', () => {
      engine.judge('A', ['q']);
      engine.judge('B', ['q']);

      expect(engine.getStats().totalJudgements).toBe(2);
    });
  });

  describe('addEvidence', () => {
    it('should add evidence to an existing verdict', () => {
      const verdict = engine.judge('Output', ['quality']);

      const result = engine.addEvidence(verdict.id, { content: 'Supporting data' });
      expect(result).toBe(true);

      const updated = engine.getVerdict(verdict.id);
      expect(updated!.evidence).toHaveLength(1);
      expect(updated!.evidence[0].content).toBe('Supporting data');
    });

    it('should return false for non-existent verdict', () => {
      expect(engine.addEvidence('nonexistent', { content: 'data' })).toBe(false);
    });
  });

  describe('evolve (Dr. Zero)', () => {
    it('should run one evolution round', () => {
      const round = engine.evolve({ difficulty: 0.5, numProblems: 3 });

      expect(round.round).toBe(0);
      expect(round.proposedProblems).toHaveLength(3);
      expect(round.solutions).toHaveLength(3);
      expect(round.avgQuality).toBeGreaterThanOrEqual(0);
      expect(round.bestQuality).toBeGreaterThanOrEqual(round.avgQuality);
      expect(round.difficulty).toBe(0.5);
    });

    it('should use custom proposer and solver', () => {
      const proposer = vi.fn().mockReturnValue([
        { difficulty: 0.5, content: 'Custom problem' },
      ]);
      const solver = vi.fn().mockReturnValue({ quality: 0.9, content: 'Custom solution' });

      const round = engine.evolve({ proposer, solver, numProblems: 1 });

      expect(proposer).toHaveBeenCalled();
      expect(solver).toHaveBeenCalled();
      expect(round.solutions[0].quality).toBe(0.9);
    });

    it('should increment round counter', () => {
      engine.evolve({});
      engine.evolve({});
      const third = engine.evolve({});

      expect(third.round).toBe(2);
    });

    it('should emit evolved event', () => {
      const listener = vi.fn();
      engine.on('kernel:reasoning:evolved', listener);

      engine.evolve({ difficulty: 0.3 });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ difficulty: 0.3 })
      );
    });

    it('should track evolution metrics', () => {
      engine.evolve({});
      engine.evolve({});

      expect(engine.getStats().totalEvolutions).toBe(2);
    });
  });

  describe('evolveLoop', () => {
    it('should run multiple evolution rounds', () => {
      const rounds = engine.evolveLoop({ maxRounds: 5, initialDifficulty: 0.3 });

      expect(rounds).toHaveLength(5);
      expect(rounds[0].round).toBe(0);
    });

    it('should increase difficulty with linear schedule', () => {
      const rounds = engine.evolveLoop({
        maxRounds: 5,
        initialDifficulty: 0.2,
        difficultySchedule: 'linear',
      });

      // Difficulty should generally increase
      expect(rounds[rounds.length - 1].difficulty).toBeGreaterThanOrEqual(rounds[0].difficulty);
    });

    it('should increase difficulty with exponential schedule', () => {
      const rounds = engine.evolveLoop({
        maxRounds: 5,
        initialDifficulty: 0.2,
        difficultySchedule: 'exponential',
      });

      expect(rounds[rounds.length - 1].difficulty).toBeGreaterThan(rounds[0].difficulty);
    });

    it('should use adaptive difficulty schedule', () => {
      const rounds = engine.evolveLoop({
        maxRounds: 5,
        initialDifficulty: 0.3,
        difficultySchedule: 'adaptive',
      });

      // Just verify it completes without error
      expect(rounds).toHaveLength(5);
    });

    it('should track all rounds in evolution history', () => {
      engine.evolveLoop({ maxRounds: 3 });

      const history = engine.getEvolutionHistory();
      expect(history).toHaveLength(3);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive stats', () => {
      engine.start();
      engine.reason('Test');
      engine.search('Test', () => 0.5);
      engine.judge('Output', ['quality']);

      const stats = engine.getStats();
      expect(stats.running).toBe(true);
      expect(stats.totalChains).toBe(1);
      expect(stats.totalSearches).toBe(1);
      expect(stats.totalJudgements).toBe(1);
      expect(stats.totalSimulations).toBe(0);
      expect(stats.totalEvolutions).toBe(0);
      expect(stats.avgConfidence).toBeGreaterThan(0);
    });
  });
});
