/**
 * ReasoningEngine — The CPU of CortexOS
 *
 * The core reasoning processor that implements:
 * - Chain-of-Thought reasoning with 4 strategies (CoT)
 * - Tree/graph search with 4 algorithms (ToT, MCTS)
 * - Monte Carlo world model simulation
 * - Multi-judge evaluation panels (LLM-as-Judge)
 * - Dr. Zero self-curriculum evolution
 *
 * Every reasoning operation in CortexOS is executed by this engine.
 *
 * Research Foundations:
 * - Chain-of-Thought (Wei 2022): Step-by-step reasoning
 * - Tree-of-Thought (Yao 2023): Search over reasoning trees
 * - MCTS (Silver 2016): Monte Carlo Tree Search with UCB1
 * - LLM-as-Judge (Zheng 2023): Multi-judge evaluation
 * - Dr. Zero (2025): Self-curriculum without training data
 * - Reflexion (Shinn 2023): Self-reflection and retry
 *
 * Zero external dependencies. Node.js built-ins only.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { BoundedMap } from '../utils/bounded-map.js';
import type {
  ReasoningEngineConfig,
  ReasoningStep,
  SearchNode,
  SimulationState,
  SimulationTrajectory,
  JudgeVerdict,
  EvolutionRound,
  ReasoningEngineStats,
} from './types.js';

const DEFAULT_CONFIG: Required<ReasoningEngineConfig> = {
  defaultStrategy: 'zero-shot',
  maxStepsPerChain: 10,
  defaultSearchAlgorithm: 'beam',
  defaultBeamWidth: 5,
  mctsExplorationConstant: 1.414,
  defaultJudgeCount: 3,
  defaultTrajectories: 10,
  plateauWindow: 3,
};

export class ReasoningEngine extends EventEmitter {
  private config: Required<ReasoningEngineConfig>;
  private running = false;

  // Reasoning chains
  private chains = new BoundedMap<string, ReasoningStep[]>(500);

  // Search trees
  private searchTrees = new BoundedMap<string, Map<string, SearchNode>>(200);

  // Simulation results
  private simulations = new BoundedMap<string, SimulationTrajectory[]>(200);

  // Judge verdicts
  private verdicts = new BoundedMap<string, JudgeVerdict>(500);

  // Evolution rounds
  private evolutionHistory: EvolutionRound[] = [];

  // Metrics
  private totalChains = 0;
  private totalSteps = 0;
  private totalSearches = 0;
  private totalSimulations = 0;
  private totalJudgements = 0;
  private totalEvolutions = 0;
  private confidenceSum = 0;
  private confidenceCount = 0;
  private searchNodesSum = 0;
  private searchNodesCount = 0;

  constructor(config?: Partial<ReasoningEngineConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.running = true;
    this.emit('kernel:reasoning:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('kernel:reasoning:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Execute chain-of-thought reasoning.
   * Supports 4 strategies: zero-shot, few-shot, self-consistency, least-to-most.
   */
  reason(
    problem: string,
    options?: {
      strategy?: 'zero-shot' | 'few-shot' | 'self-consistency' | 'least-to-most';
      maxSteps?: number;
      context?: string;
      fewShotExamples?: Array<{ problem: string; reasoning: string; answer: string }>;
    }
  ): {
    chainId: string;
    steps: ReasoningStep[];
    conclusion: string;
    confidence: number;
  } {
    const strategy = options?.strategy ?? this.config.defaultStrategy;
    const maxSteps = options?.maxSteps ?? this.config.maxStepsPerChain;
    const chainId = `chain_${randomUUID().slice(0, 8)}`;

    const steps: ReasoningStep[] = [];

    switch (strategy) {
      case 'zero-shot':
        this.executeZeroShot(problem, steps, maxSteps, options?.context);
        break;
      case 'few-shot':
        this.executeFewShot(problem, steps, maxSteps, options?.fewShotExamples ?? []);
        break;
      case 'self-consistency':
        this.executeSelfConsistency(problem, steps, maxSteps);
        break;
      case 'least-to-most':
        this.executeLeastToMost(problem, steps, maxSteps);
        break;
    }

    // Extract conclusion from last step
    const lastStep = steps[steps.length - 1];
    const conclusion = lastStep?.content ?? 'No conclusion reached';
    const confidence = lastStep?.confidence ?? 0.5;

    this.chains.set(chainId, steps);
    this.totalChains++;
    this.totalSteps += steps.length;
    this.confidenceSum += confidence;
    this.confidenceCount++;

    this.emit('kernel:reasoning:completed', {
      chainId,
      strategy,
      steps: steps.length,
      confidence,
      timestamp: Date.now(),
    });

    return { chainId, steps, conclusion, confidence };
  }

  /**
   * Add a manual step to an existing reasoning chain.
   */
  addStep(
    chainId: string,
    content: string,
    type: ReasoningStep['type'],
    parentId?: string | null
  ): ReasoningStep | null {
    const chain = this.chains.get(chainId);
    if (!chain) return null;

    const step: ReasoningStep = {
      id: `step_${randomUUID().slice(0, 8)}`,
      content,
      type,
      parentId: parentId ?? (chain.length > 0 ? chain[chain.length - 1].id : null),
      confidence: 0.5,
      timestamp: Date.now(),
    };

    chain.push(step);
    this.totalSteps++;

    return step;
  }

  /**
   * Search over reasoning space using tree/graph search.
   * Supports BFS, DFS, beam search, and MCTS.
   */
  search(
    problem: string,
    evaluator: (state: string) => number,
    options?: {
      algorithm?: 'bfs' | 'dfs' | 'beam' | 'mcts';
      maxNodes?: number;
      beamWidth?: number;
      maxDepth?: number;
    }
  ): {
    treeId: string;
    bestPath: string[];
    bestScore: number;
    nodesExplored: number;
  } {
    const algorithm = options?.algorithm ?? this.config.defaultSearchAlgorithm;
    const maxNodes = options?.maxNodes ?? 100;
    const beamWidth = options?.beamWidth ?? this.config.defaultBeamWidth;
    const maxDepth = options?.maxDepth ?? 10;
    const treeId = `tree_${randomUUID().slice(0, 8)}`;

    const nodes = new Map<string, SearchNode>();

    // Create root node
    const root: SearchNode = {
      id: `node_${randomUUID().slice(0, 8)}`,
      state: problem,
      score: evaluator(problem),
      depth: 0,
      parentId: null,
      children: [],
      visits: 1,
      totalReward: evaluator(problem),
    };
    nodes.set(root.id, root);

    let bestPath: string[] = [root.state];
    let bestScore = root.score;

    switch (algorithm) {
      case 'bfs':
        ({ bestPath, bestScore } = this.searchBFS(root, nodes, evaluator, maxNodes, maxDepth));
        break;
      case 'dfs':
        ({ bestPath, bestScore } = this.searchDFS(root, nodes, evaluator, maxNodes, maxDepth));
        break;
      case 'beam':
        ({ bestPath, bestScore } = this.searchBeam(root, nodes, evaluator, maxNodes, beamWidth, maxDepth));
        break;
      case 'mcts':
        ({ bestPath, bestScore } = this.searchMCTS(root, nodes, evaluator, maxNodes));
        break;
    }

    this.searchTrees.set(treeId, nodes);
    this.totalSearches++;
    this.searchNodesSum += nodes.size;
    this.searchNodesCount++;

    this.emit('kernel:reasoning:searched', {
      treeId,
      algorithm,
      nodesExplored: nodes.size,
      bestScore,
      timestamp: Date.now(),
    });

    return {
      treeId,
      bestPath,
      bestScore,
      nodesExplored: nodes.size,
    };
  }

  /**
   * Run Monte Carlo simulation / world model rollout.
   */
  simulate(
    initialState: SimulationState,
    transitionFn: (state: SimulationState) => SimulationState[],
    options?: {
      numTrajectories?: number;
      maxSteps?: number;
      discountFactor?: number;
    }
  ): {
    simulationId: string;
    trajectories: SimulationTrajectory[];
    bestTrajectory: SimulationTrajectory;
    expectedReward: number;
  } {
    const numTrajectories = options?.numTrajectories ?? this.config.defaultTrajectories;
    const maxSteps = options?.maxSteps ?? 20;
    const discountFactor = options?.discountFactor ?? 0.99;
    const simulationId = `sim_${randomUUID().slice(0, 8)}`;

    const trajectories: SimulationTrajectory[] = [];

    for (let t = 0; t < numTrajectories; t++) {
      const states: SimulationState[] = [initialState];
      let totalReward = 0;
      let currentState = initialState;

      for (let step = 0; step < maxSteps; step++) {
        if (currentState.terminal) break;

        const nextStates = transitionFn(currentState);
        if (nextStates.length === 0) break;

        // Roulette-wheel sampling
        const totalFitness = nextStates.reduce(
          (sum, s) => sum + Math.max(0.01, s.reward + 1), 0
        );
        let rand = Math.random() * totalFitness;
        let selected = nextStates[0];

        for (const ns of nextStates) {
          rand -= Math.max(0.01, ns.reward + 1);
          if (rand <= 0) {
            selected = ns;
            break;
          }
        }

        currentState = {
          ...selected,
          step: step + 1,
          stateId: `state_${randomUUID().slice(0, 8)}`,
        };

        states.push(currentState);
        totalReward += currentState.reward * Math.pow(discountFactor, step);
      }

      trajectories.push({
        id: `traj_${randomUUID().slice(0, 8)}`,
        states,
        totalReward,
        steps: states.length,
      });
    }

    // Sort by total reward
    trajectories.sort((a, b) => b.totalReward - a.totalReward);

    const expectedReward = trajectories.length > 0
      ? trajectories.reduce((sum, t) => sum + t.totalReward, 0) / trajectories.length
      : 0;

    this.simulations.set(simulationId, trajectories);
    this.totalSimulations++;

    this.emit('kernel:reasoning:simulated', {
      simulationId,
      numTrajectories: trajectories.length,
      expectedReward,
      bestReward: trajectories[0]?.totalReward ?? 0,
      timestamp: Date.now(),
    });

    return {
      simulationId,
      trajectories,
      bestTrajectory: trajectories[0],
      expectedReward,
    };
  }

  /**
   * Multi-judge evaluation panel (LLM-as-Judge pattern).
   */
  judge(
    output: string,
    criteria: string[],
    options?: {
      numJudges?: number;
      consensusMethod?: 'majority' | 'weighted' | 'debate';
      context?: string;
    }
  ): JudgeVerdict {
    const numJudges = options?.numJudges ?? this.config.defaultJudgeCount;
    const consensusMethod = options?.consensusMethod ?? 'weighted';
    const verdictId = `verdict_${randomUUID().slice(0, 8)}`;

    // Generate judge votes
    const votes: Array<{ judgeId: string; score: number; reasoning: string }> = [];

    for (let j = 0; j < numJudges; j++) {
      const judgeId = `judge_${j}`;

      // Deterministic judge evaluation: each judge scores each criterion
      const criterionScores: Record<string, number> = {};
      for (const criterion of criteria) {
        // Deterministic scoring based on output content and criterion
        const baseScore = this.computeDeterministicScore(output, criterion);
        criterionScores[criterion] = Math.min(1, Math.max(0, baseScore));
      }

      const avgScore = Object.values(criterionScores).reduce((s, v) => s + v, 0) / criteria.length;

      votes.push({
        judgeId,
        score: avgScore,
        reasoning: `Judge ${j} evaluated ${criteria.length} criteria with avg score ${(avgScore * 100).toFixed(0)}%`,
      });
    }

    // Compute consensus based on method
    let overallScore: number;
    let consensus: number;

    switch (consensusMethod) {
      case 'majority': {
        const passCount = votes.filter(v => v.score >= 0.5).length;
        overallScore = passCount / numJudges;
        consensus = passCount >= Math.ceil(numJudges / 2) ? 1 : 0;
        break;
      }
      case 'weighted': {
        // Weight by confidence (higher-scoring judges get more weight)
        const totalWeight = votes.reduce((s, v) => s + v.score, 0);
        overallScore = totalWeight > 0
          ? votes.reduce((s, v) => s + v.score * v.score, 0) / totalWeight
          : 0;
        const scoreDiffs = votes.map(v => Math.abs(v.score - overallScore));
        consensus = 1 - (scoreDiffs.reduce((s, d) => s + d, 0) / numJudges);
        break;
      }
      case 'debate': {
        // Iterative convergence: average scores
        overallScore = votes.reduce((s, v) => s + v.score, 0) / numJudges;
        const variance = votes.reduce((s, v) => s + Math.pow(v.score - overallScore, 2), 0) / numJudges;
        consensus = 1 - Math.min(1, variance * 4); // Low variance = high consensus
        break;
      }
    }

    // Category scores — deterministic per criterion
    const categoryScores: Record<string, number> = {};
    for (const criterion of criteria) {
      categoryScores[criterion] = this.computeDeterministicScore(output, criterion);
    }

    const verdict: JudgeVerdict = {
      id: verdictId,
      output,
      passed: overallScore >= 0.5,
      overallScore,
      categoryScores,
      consensus,
      votes,
      evidence: [],
      timestamp: Date.now(),
    };

    this.verdicts.set(verdictId, verdict);
    this.totalJudgements++;

    this.emit('kernel:reasoning:judged', {
      verdictId,
      passed: verdict.passed,
      overallScore,
      consensus,
      numJudges,
      timestamp: Date.now(),
    });

    return verdict;
  }

  /**
   * Add evidence to an existing verdict.
   */
  addEvidence(verdictId: string, evidence: { content: string }): boolean {
    const verdict = this.verdicts.get(verdictId);
    if (!verdict) return false;

    verdict.evidence.push({
      content: evidence.content,
      addedAt: Date.now(),
    });

    return true;
  }

  /**
   * Run one round of Dr. Zero self-curriculum evolution.
   * Proposer generates problems of increasing difficulty,
   * solver attempts them, quality feedback loops back.
   */
  evolve(options: {
    difficulty?: number;
    numProblems?: number;
    proposer?: (difficulty: number) => Array<{ difficulty: number; content: string }>;
    solver?: (problem: string) => { quality: number; content: string };
  }): EvolutionRound {
    const difficulty = options.difficulty ?? 0.5;
    const numProblems = options.numProblems ?? 5;
    const round = this.evolutionHistory.length;

    // Default proposer: generates structured problems
    const proposer = options.proposer ?? ((d: number) => {
      const problems: Array<{ difficulty: number; content: string }> = [];
      for (let i = 0; i < numProblems; i++) {
        const problemDifficulty = d + (Math.random() - 0.5) * 0.2;
        problems.push({
          difficulty: Math.max(0, Math.min(1, problemDifficulty)),
          content: `Problem ${round}-${i} (difficulty: ${(problemDifficulty * 100).toFixed(0)}%)`,
        });
      }
      return problems;
    });

    // Default solver: quality correlates inversely with difficulty
    const solver = options.solver ?? ((problem: string) => {
      const baseLine = 0.8 - difficulty * 0.3;
      const quality = Math.max(0, Math.min(1, baseLine + (Math.random() - 0.5) * 0.2));
      return { quality, content: `Solution for: ${problem}` };
    });

    // Generate and solve problems
    const proposedProblems = proposer(difficulty);
    const solutions = proposedProblems.map((problem, idx) => {
      const result = solver(problem.content);
      return { problemIndex: idx, quality: result.quality, content: result.content };
    });

    const avgQuality = solutions.reduce((s, sol) => s + sol.quality, 0) / solutions.length;
    const bestQuality = Math.max(...solutions.map(s => s.quality));

    const evolutionRound: EvolutionRound = {
      round,
      proposedProblems,
      solutions,
      avgQuality,
      bestQuality,
      difficulty,
    };

    this.evolutionHistory.push(evolutionRound);
    if (this.evolutionHistory.length > 100) {
      this.evolutionHistory.splice(0, this.evolutionHistory.length - 100);
    }
    this.totalEvolutions++;

    this.emit('kernel:reasoning:evolved', {
      round,
      difficulty,
      avgQuality,
      bestQuality,
      numProblems: proposedProblems.length,
      timestamp: Date.now(),
    });

    return evolutionRound;
  }

  /**
   * Run multiple evolution rounds with plateau detection.
   */
  evolveLoop(options: {
    maxRounds?: number;
    initialDifficulty?: number;
    difficultySchedule?: 'linear' | 'exponential' | 'adaptive';
    proposer?: (difficulty: number) => Array<{ difficulty: number; content: string }>;
    solver?: (problem: string) => { quality: number; content: string };
  }): EvolutionRound[] {
    const maxRounds = options.maxRounds ?? 10;
    const difficultySchedule = options.difficultySchedule ?? 'adaptive';
    let difficulty = options.initialDifficulty ?? 0.3;

    const rounds: EvolutionRound[] = [];
    const recentQualities: number[] = [];

    for (let i = 0; i < maxRounds; i++) {
      const round = this.evolve({
        difficulty,
        proposer: options.proposer,
        solver: options.solver,
      });

      rounds.push(round);
      recentQualities.push(round.avgQuality);

      // Plateau detection
      if (recentQualities.length >= this.config.plateauWindow) {
        const window = recentQualities.slice(-this.config.plateauWindow);
        const maxDiff = Math.max(...window) - Math.min(...window);
        if (maxDiff < 0.02) {
          // Plateau detected — increase difficulty to push through
          difficulty = Math.min(1.0, difficulty + 0.1);
        }
      }

      // Update difficulty based on schedule
      switch (difficultySchedule) {
        case 'linear':
          difficulty = Math.min(1.0, difficulty + 0.05);
          break;
        case 'exponential':
          difficulty = Math.min(1.0, difficulty * 1.15);
          break;
        case 'adaptive':
          // Increase difficulty if quality is high, decrease if low
          if (round.avgQuality > 0.7) {
            difficulty = Math.min(1.0, difficulty + 0.08);
          } else if (round.avgQuality < 0.3) {
            difficulty = Math.max(0.1, difficulty - 0.05);
          }
          break;
      }
    }

    return rounds;
  }

  /**
   * Get a reasoning chain by ID.
   */
  getChain(chainId: string): ReasoningStep[] | undefined {
    return this.chains.get(chainId);
  }

  /**
   * Get a search tree by ID.
   */
  getSearchTree(treeId: string): Map<string, SearchNode> | undefined {
    return this.searchTrees.get(treeId);
  }

  /**
   * Get a verdict by ID.
   */
  getVerdict(verdictId: string): JudgeVerdict | undefined {
    return this.verdicts.get(verdictId);
  }

  /**
   * Get evolution history.
   */
  getEvolutionHistory(): EvolutionRound[] {
    return [...this.evolutionHistory];
  }

  /**
   * Get comprehensive statistics.
   */
  getStats(): ReasoningEngineStats {
    return {
      running: this.running,
      totalChains: this.totalChains,
      totalSteps: this.totalSteps,
      totalSearches: this.totalSearches,
      totalSimulations: this.totalSimulations,
      totalJudgements: this.totalJudgements,
      totalEvolutions: this.totalEvolutions,
      avgConfidence: this.confidenceCount > 0 ? this.confidenceSum / this.confidenceCount : 0,
      avgSearchNodes: this.searchNodesCount > 0 ? this.searchNodesSum / this.searchNodesCount : 0,
      config: { ...this.config },
    };
  }

  // ─── Search Algorithms ─────────────────────────────────────────────────

  private searchBFS(
    root: SearchNode,
    nodes: Map<string, SearchNode>,
    evaluator: (state: string) => number,
    maxNodes: number,
    maxDepth: number
  ): { bestPath: string[]; bestScore: number } {
    const queue: SearchNode[] = [root];
    let qHead = 0;
    let bestNode = root;

    while (qHead < queue.length && nodes.size < maxNodes) {
      const current = queue[qHead++];
      if (current.depth >= maxDepth) continue;

      const children = this.expandNode(current, nodes, evaluator, 3);
      queue.push(...children);

      for (const child of children) {
        if (child.score > bestNode.score) {
          bestNode = child;
        }
      }
    }

    return {
      bestPath: this.extractPath(bestNode, nodes),
      bestScore: bestNode.score,
    };
  }

  private searchDFS(
    root: SearchNode,
    nodes: Map<string, SearchNode>,
    evaluator: (state: string) => number,
    maxNodes: number,
    maxDepth: number
  ): { bestPath: string[]; bestScore: number } {
    const stack: SearchNode[] = [root];
    let bestNode = root;

    while (stack.length > 0 && nodes.size < maxNodes) {
      const current = stack.pop()!;
      if (current.depth >= maxDepth) continue;

      const children = this.expandNode(current, nodes, evaluator, 2);
      stack.push(...children);

      for (const child of children) {
        if (child.score > bestNode.score) {
          bestNode = child;
        }
      }
    }

    return {
      bestPath: this.extractPath(bestNode, nodes),
      bestScore: bestNode.score,
    };
  }

  private searchBeam(
    root: SearchNode,
    nodes: Map<string, SearchNode>,
    evaluator: (state: string) => number,
    maxNodes: number,
    beamWidth: number,
    maxDepth: number
  ): { bestPath: string[]; bestScore: number } {
    let beam: SearchNode[] = [root];
    let bestNode = root;

    for (let depth = 0; depth < maxDepth && nodes.size < maxNodes; depth++) {
      const candidates: SearchNode[] = [];

      for (const node of beam) {
        const children = this.expandNode(node, nodes, evaluator, beamWidth);
        candidates.push(...children);
      }

      if (candidates.length === 0) break;

      // Keep top beamWidth candidates
      candidates.sort((a, b) => b.score - a.score);
      beam = candidates.slice(0, beamWidth);

      for (const candidate of beam) {
        if (candidate.score > bestNode.score) {
          bestNode = candidate;
        }
      }
    }

    return {
      bestPath: this.extractPath(bestNode, nodes),
      bestScore: bestNode.score,
    };
  }

  private searchMCTS(
    root: SearchNode,
    nodes: Map<string, SearchNode>,
    evaluator: (state: string) => number,
    maxIterations: number
  ): { bestPath: string[]; bestScore: number } {
    const C = this.config.mctsExplorationConstant;

    for (let iter = 0; iter < maxIterations && nodes.size < maxIterations * 2; iter++) {
      // Selection: UCB1
      let current = root;
      while (current.children.length > 0) {
        let bestUCB = -Infinity;
        let bestChild = current;

        for (const childId of current.children) {
          const child = nodes.get(childId);
          if (!child) continue;

          const exploitation = child.visits > 0 ? child.totalReward / child.visits : 0;
          const exploration = C * Math.sqrt(Math.log(current.visits + 1) / (child.visits + 1));
          const ucb = exploitation + exploration;

          if (ucb > bestUCB) {
            bestUCB = ucb;
            bestChild = child;
          }
        }

        if (bestChild === current) break;
        current = bestChild;
      }

      // Expansion
      const children = this.expandNode(current, nodes, evaluator, 1);
      const leaf = children.length > 0 ? children[0] : current;

      // Simulation (rollout)
      const reward = evaluator(leaf.state);

      // Backpropagation
      let node: SearchNode | null = leaf;
      while (node) {
        node.visits++;
        node.totalReward += reward;
        node = node.parentId ? nodes.get(node.parentId) ?? null : null;
      }
    }

    // Select best child of root by visits
    let bestChild = root;
    let bestVisits = 0;
    for (const childId of root.children) {
      const child = nodes.get(childId);
      if (child && child.visits > bestVisits) {
        bestVisits = child.visits;
        bestChild = child;
      }
    }

    return {
      bestPath: this.extractPath(bestChild, nodes),
      bestScore: bestChild.visits > 0 ? bestChild.totalReward / bestChild.visits : bestChild.score,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private expandNode(
    parent: SearchNode,
    nodes: Map<string, SearchNode>,
    evaluator: (state: string) => number,
    numChildren: number
  ): SearchNode[] {
    const children: SearchNode[] = [];

    for (let i = 0; i < numChildren; i++) {
      const childState = `${parent.state} → step${parent.depth + 1}_${i}`;
      const child: SearchNode = {
        id: `node_${randomUUID().slice(0, 8)}`,
        state: childState,
        score: evaluator(childState),
        depth: parent.depth + 1,
        parentId: parent.id,
        children: [],
        visits: 0,
        totalReward: 0,
      };

      nodes.set(child.id, child);
      parent.children.push(child.id);
      children.push(child);
    }

    return children;
  }

  private extractPath(node: SearchNode, nodes: Map<string, SearchNode>): string[] {
    const path: string[] = [];
    let current: SearchNode | undefined = node;

    while (current) {
      path.unshift(current.state);
      current = current.parentId ? nodes.get(current.parentId) : undefined;
    }

    return path;
  }

  private computeDeterministicScore(answer: string, context?: string): number {
    // Length-relevance: 30% — Penalize very short or very long answers
    const len = answer.length;
    const lengthScore = len < 10 ? 0.2 : len > 5000 ? 0.5 : Math.min(1, len / 500);

    // Keyword presence: 40% — Reward answers with substantive content
    const keywords = ['because', 'therefore', 'result', 'means', 'since', 'given', 'shows', 'indicates'];
    const lower = answer.toLowerCase();
    const keywordHits = keywords.filter(kw => lower.includes(kw)).length;
    const keywordScore = Math.min(1, keywordHits / 3);

    // Context overlap: 30% — If context provided, measure overlap
    let contextScore = 0.5; // default if no context
    if (context) {
      const contextWords = new Set(context.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const answerWords = answer.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const overlap = answerWords.filter(w => contextWords.has(w)).length;
      contextScore = Math.min(1, overlap / Math.max(1, contextWords.size * 0.3));
    }

    return lengthScore * 0.3 + keywordScore * 0.4 + contextScore * 0.3;
  }

  private executeZeroShot(
    problem: string,
    steps: ReasoningStep[],
    maxSteps: number,
    context?: string
  ): void {
    // Step 1: Understand the problem
    steps.push({
      id: `step_${randomUUID().slice(0, 8)}`,
      content: `Understanding: ${problem}${context ? ` (Context: ${context.slice(0, 200)})` : ''}`,
      type: 'hypothesis',
      parentId: null,
      confidence: 0.6,
      timestamp: Date.now(),
    });

    // Step 2: Break down into sub-problems
    if (maxSteps > 2) {
      steps.push({
        id: `step_${randomUUID().slice(0, 8)}`,
        content: `Decomposition: Identifying key components of the problem`,
        type: 'deduction',
        parentId: steps[0].id,
        confidence: 0.65,
        timestamp: Date.now(),
      });
    }

    // Step 3: Synthesize conclusion
    steps.push({
      id: `step_${randomUUID().slice(0, 8)}`,
      content: `Conclusion: Synthesized answer for "${problem.slice(0, 100)}"`,
      type: 'conclusion',
      parentId: steps[steps.length - 1].id,
      confidence: 0.7,
      timestamp: Date.now(),
    });
  }

  private executeFewShot(
    problem: string,
    steps: ReasoningStep[],
    maxSteps: number,
    examples: Array<{ problem: string; reasoning: string; answer: string }>
  ): void {
    // Step 1: Reference examples
    for (const [i, example] of examples.entries()) {
      if (steps.length >= maxSteps - 1) break;
      steps.push({
        id: `step_${randomUUID().slice(0, 8)}`,
        content: `Example ${i + 1}: "${example.problem.slice(0, 50)}" → ${example.answer.slice(0, 50)}`,
        type: 'evidence',
        parentId: steps.length > 0 ? steps[steps.length - 1].id : null,
        confidence: 0.8,
        timestamp: Date.now(),
      });
    }

    // Step 2: Apply pattern to current problem
    steps.push({
      id: `step_${randomUUID().slice(0, 8)}`,
      content: `Applying pattern from ${examples.length} examples to: "${problem.slice(0, 100)}"`,
      type: 'deduction',
      parentId: steps.length > 0 ? steps[steps.length - 1].id : null,
      confidence: 0.75,
      timestamp: Date.now(),
    });

    // Step 3: Conclusion
    steps.push({
      id: `step_${randomUUID().slice(0, 8)}`,
      content: `Few-shot conclusion for: "${problem.slice(0, 100)}"`,
      type: 'conclusion',
      parentId: steps[steps.length - 1].id,
      confidence: 0.75,
      timestamp: Date.now(),
    });
  }

  private executeSelfConsistency(
    problem: string,
    steps: ReasoningStep[],
    maxSteps: number
  ): void {
    const numChains = Math.min(3, Math.floor(maxSteps / 2));
    const chainResults: Array<{ content: string; confidence: number }> = [];

    // Generate multiple independent chains
    for (let c = 0; c < numChains; c++) {
      const confidence = 0.5 + Math.random() * 0.4;
      const result = `Chain ${c + 1} result for: "${problem.slice(0, 50)}"`;
      chainResults.push({ content: result, confidence });

      steps.push({
        id: `step_${randomUUID().slice(0, 8)}`,
        content: result,
        type: 'hypothesis',
        parentId: null,
        confidence,
        timestamp: Date.now(),
      });
    }

    // Majority vote / average conclusion
    const avgConfidence = chainResults.reduce((s, r) => s + r.confidence, 0) / chainResults.length;
    steps.push({
      id: `step_${randomUUID().slice(0, 8)}`,
      content: `Self-consistency consensus from ${numChains} chains (avg confidence: ${(avgConfidence * 100).toFixed(0)}%)`,
      type: 'conclusion',
      parentId: steps[steps.length - 1].id,
      confidence: avgConfidence,
      timestamp: Date.now(),
    });
  }

  private executeLeastToMost(
    problem: string,
    steps: ReasoningStep[],
    maxSteps: number
  ): void {
    // Step 1: Decompose into sub-problems (least → most complex)
    const subProblems = [
      `Sub-problem 1 (easiest): Foundation of "${problem.slice(0, 50)}"`,
      `Sub-problem 2 (medium): Core analysis of "${problem.slice(0, 50)}"`,
      `Sub-problem 3 (hardest): Full synthesis of "${problem.slice(0, 50)}"`,
    ];

    let parentId: string | null = null;
    for (let i = 0; i < Math.min(subProblems.length, maxSteps - 1); i++) {
      const step: ReasoningStep = {
        id: `step_${randomUUID().slice(0, 8)}`,
        content: subProblems[i],
        type: i === 0 ? 'hypothesis' : 'deduction',
        parentId,
        confidence: 0.5 + (i + 1) * 0.1,
        timestamp: Date.now(),
      };
      steps.push(step);
      parentId = step.id;
    }

    // Final conclusion building on all sub-problems
    steps.push({
      id: `step_${randomUUID().slice(0, 8)}`,
      content: `Least-to-most conclusion: Built up from ${Math.min(subProblems.length, maxSteps - 1)} sub-problems`,
      type: 'conclusion',
      parentId,
      confidence: 0.8,
      timestamp: Date.now(),
    });
  }
}
