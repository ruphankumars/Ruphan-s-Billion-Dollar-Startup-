/**
 * PopulationReasoner — RSA-based Population Reasoning Engine
 *
 * Maintains a population of N candidate solutions and iteratively improves them
 * through K-aggregation over T iterations. Implements the Recursive Self-Aggregation
 * (RSA) pattern from arXiv:2509.26626.
 *
 * Key insight: Multiple solution candidates cross-pollinate through aggregation,
 * implicitly verifying correctness without external reward models.
 *
 * Zero external dependencies.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  PopulationConfig,
  Candidate,
  PopulationState,
  AggregationResult,
} from './types.js';

const DEFAULT_CONFIG: Required<PopulationConfig> = {
  populationSize: 5,
  aggregationSetSize: 3,
  maxIterations: 3,
  convergenceThreshold: 0.98,
  maxTokensPerCandidate: 4096,
  trackDiversity: true,
};

export class PopulationReasoner extends EventEmitter {
  private config: Required<PopulationConfig>;
  private running = false;
  private populations: Map<string, PopulationState> = new Map();
  private history: PopulationState[] = [];
  private totalTasksProcessed = 0;
  private totalIterations = 0;

  constructor(config?: Partial<PopulationConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.running = true;
    this.emit('evolution:started', { component: 'PopulationReasoner', timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.populations.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Initialize a new population for a task.
   * Generates N initial candidate solutions.
   */
  initializePopulation(
    taskId: string,
    initialCandidates: string[],
    scores?: number[]
  ): PopulationState {
    const candidates: Candidate[] = initialCandidates.map((content, i) => ({
      id: `cand_${randomUUID().slice(0, 8)}`,
      content,
      score: scores?.[i] ?? 0,
      iteration: 0,
      parentIds: [],
      metadata: {},
    }));

    // Pad population if fewer candidates than populationSize
    while (candidates.length < this.config.populationSize) {
      const template = candidates[candidates.length % initialCandidates.length];
      candidates.push({
        id: `cand_${randomUUID().slice(0, 8)}`,
        content: template.content,
        score: template.score * 0.9, // Slight penalty for copies
        iteration: 0,
        parentIds: [template.id],
        metadata: { cloned: true },
      });
    }

    // Trim if more candidates than populationSize
    const trimmedCandidates = candidates.slice(0, this.config.populationSize);

    const state: PopulationState = {
      candidates: trimmedCandidates,
      iteration: 0,
      diversityScore: this.computeDiversity(trimmedCandidates),
      converged: false,
      bestCandidate: this.selectBest(trimmedCandidates),
    };

    this.populations.set(taskId, state);
    return state;
  }

  /**
   * Run one iteration of the RSA algorithm.
   * For each candidate, sample K others and aggregate into an improved version.
   */
  async iterate(
    taskId: string,
    aggregateFn: (candidates: Candidate[], query: string) => Promise<AggregationResult>
  ): Promise<PopulationState> {
    const state = this.populations.get(taskId);
    if (!state) {
      throw new Error(`No population found for task ${taskId}`);
    }

    if (state.converged) {
      return state;
    }

    const newCandidates: Candidate[] = [];
    const K = Math.min(this.config.aggregationSetSize, state.candidates.length);

    for (const candidate of state.candidates) {
      // Sample K candidates without replacement (excluding self)
      const others = state.candidates.filter(c => c.id !== candidate.id);
      const sampled = this.sampleWithoutReplacement(others, K - 1);
      const aggregationSet = [candidate, ...sampled];

      // Aggregate: the LLM sees K solutions and produces an improved one
      const result = await aggregateFn(aggregationSet, taskId);

      const newCandidate: Candidate = {
        id: `cand_${randomUUID().slice(0, 8)}`,
        content: result.aggregatedContent,
        score: result.improvementScore,
        iteration: state.iteration + 1,
        parentIds: result.sourceIds,
        metadata: { aggregationSetSize: aggregationSet.length },
      };

      newCandidates.push(newCandidate);
    }

    // Update state
    const previousBest = state.bestCandidate;
    state.candidates = newCandidates;
    state.iteration += 1;
    state.bestCandidate = this.selectBest(newCandidates);

    if (this.config.trackDiversity) {
      state.diversityScore = this.computeDiversity(newCandidates);
    }

    // Check convergence
    if (previousBest && state.bestCandidate) {
      const similarity = this.computeSimilarity(
        previousBest.content,
        state.bestCandidate.content
      );
      if (similarity >= this.config.convergenceThreshold) {
        state.converged = true;
        this.emit('evolution:converged', {
          taskId,
          iterations: state.iteration,
          similarity,
        });
      }
    }

    this.totalIterations++;

    this.emit('evolution:iteration', {
      taskId,
      iteration: state.iteration,
      bestScore: state.bestCandidate?.score ?? 0,
      diversity: state.diversityScore,
      converged: state.converged,
    });

    return state;
  }

  /**
   * Run the full RSA loop until convergence or max iterations.
   */
  async evolve(
    taskId: string,
    initialCandidates: string[],
    aggregateFn: (candidates: Candidate[], query: string) => Promise<AggregationResult>,
    scores?: number[]
  ): Promise<PopulationState> {
    this.initializePopulation(taskId, initialCandidates, scores);

    for (let t = 0; t < this.config.maxIterations; t++) {
      const state = await this.iterate(taskId, aggregateFn);
      if (state.converged) break;
    }

    const finalState = this.populations.get(taskId)!;
    this.totalTasksProcessed++;

    // Archive to history
    this.history.push({ ...finalState });
    if (this.history.length > 100) {
      this.history.splice(0, this.history.length - 100);
    }

    return finalState;
  }

  /**
   * Get the best candidate from a population.
   */
  getBest(taskId: string): Candidate | null {
    return this.populations.get(taskId)?.bestCandidate ?? null;
  }

  /**
   * Get full population state.
   */
  getPopulation(taskId: string): PopulationState | undefined {
    return this.populations.get(taskId);
  }

  /**
   * Compute diversity of a candidate population using pairwise Jaccard distance.
   */
  private computeDiversity(candidates: Candidate[]): number {
    if (candidates.length < 2) return 0;

    let totalDistance = 0;
    let pairs = 0;

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const similarity = this.computeJaccard(
          candidates[i].content,
          candidates[j].content
        );
        totalDistance += 1 - similarity;
        pairs++;
      }
    }

    return pairs > 0 ? totalDistance / pairs : 0;
  }

  /**
   * Compute similarity between two strings using a hybrid method.
   * Uses Jaccard similarity on word-level n-grams for efficiency.
   */
  private computeSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    // Use both word-level Jaccard and character-level for robustness
    const jaccard = this.computeJaccard(a, b);
    const charSimilarity = this.computeCharacterSimilarity(a, b);

    // Weighted average: Jaccard for semantic, character for structural
    return jaccard * 0.6 + charSimilarity * 0.4;
  }

  /**
   * Jaccard similarity on word-level trigrams.
   */
  private computeJaccard(a: string, b: string): number {
    const ngramsA = this.wordNgrams(a, 3);
    const ngramsB = this.wordNgrams(b, 3);

    if (ngramsA.size === 0 && ngramsB.size === 0) return 1;
    if (ngramsA.size === 0 || ngramsB.size === 0) return 0;

    let intersection = 0;
    for (const gram of ngramsA) {
      if (ngramsB.has(gram)) intersection++;
    }

    const union = ngramsA.size + ngramsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Generate word-level n-grams.
   */
  private wordNgrams(text: string, n: number): Set<string> {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const ngrams = new Set<string>();

    for (let i = 0; i <= words.length - n; i++) {
      ngrams.add(words.slice(i, i + n).join(' '));
    }

    // Also add individual words for short texts
    if (words.length < n) {
      for (const word of words) {
        ngrams.add(word);
      }
    }

    return ngrams;
  }

  /**
   * Character-level similarity using longest common subsequence ratio.
   */
  private computeCharacterSimilarity(a: string, b: string): number {
    // For very long strings, use a sampling approach
    const maxLen = 1000;
    const sa = a.length > maxLen ? a.slice(0, maxLen) : a;
    const sb = b.length > maxLen ? b.slice(0, maxLen) : b;

    const lcsLen = this.lcsLength(sa, sb);
    return (2 * lcsLen) / (sa.length + sb.length);
  }

  /**
   * LCS length using space-optimized DP.
   */
  private lcsLength(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    // Use two rows instead of full matrix
    let prev = new Array(n + 1).fill(0);
    let curr = new Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          curr[j] = prev[j - 1] + 1;
        } else {
          curr[j] = Math.max(prev[j], curr[j - 1]);
        }
      }
      [prev, curr] = [curr, prev];
      curr.fill(0);
    }

    return prev[n];
  }

  /**
   * Sample K items from array without replacement.
   */
  private sampleWithoutReplacement<T>(arr: T[], k: number): T[] {
    const copy = [...arr];
    const result: T[] = [];
    const count = Math.min(k, copy.length);

    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * copy.length);
      result.push(copy.splice(idx, 1)[0]);
    }

    return result;
  }

  /**
   * Select the best candidate from an array.
   */
  private selectBest(candidates: Candidate[]): Candidate | null {
    if (candidates.length === 0) return null;
    return candidates.reduce((best, c) => c.score > best.score ? c : best);
  }

  getStats() {
    return {
      running: this.running,
      activePopulations: this.populations.size,
      totalTasksProcessed: this.totalTasksProcessed,
      totalIterations: this.totalIterations,
      avgIterationsPerTask: this.totalTasksProcessed > 0
        ? this.totalIterations / this.totalTasksProcessed
        : 0,
      historySize: this.history.length,
      config: { ...this.config },
    };
  }
}
