/**
 * ConvergenceDetector — Embedding-Based Convergence Detection
 *
 * Detects when iterative processes have stabilized semantically.
 * Uses multiple similarity methods (Jaccard, cosine-approximation, Levenshtein)
 * to determine convergence without external embedding APIs.
 *
 * From: recursive-agents (hankbesser) — cosine similarity convergence pattern
 * From: RSA (arXiv:2509.26626) — population diversity tracking
 *
 * Zero external dependencies.
 */

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { BoundedMap } from '../utils/bounded-map.js';
import type { ConvergenceConfig, ConvergenceResult } from './types.js';

const DEFAULT_CONFIG: Required<ConvergenceConfig> = {
  similarityThreshold: 0.98,
  minIterations: 2,
  stabilityWindow: 3,
  method: 'jaccard',
};

export class ConvergenceDetector extends EventEmitter {
  private config: Required<ConvergenceConfig>;
  private running = false;
  private histories: BoundedMap<string, number[]> = new BoundedMap(200);
  private checksPerformed = 0;
  private convergencesDetected = 0;

  constructor(config?: Partial<ConvergenceConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.histories.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Check if two strings have converged (are semantically equivalent).
   */
  check(taskId: string, previous: string, current: string, iteration: number): ConvergenceResult {
    this.checksPerformed++;

    const similarity = this.computeSimilarity(previous, current);

    // Track history
    if (!this.histories.has(taskId)) {
      this.histories.set(taskId, []);
    }
    const history = this.histories.get(taskId)!;
    history.push(similarity);

    // Trim history
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }

    // Check convergence conditions
    const meetsThreshold = similarity >= this.config.similarityThreshold;
    const meetsMinIterations = iteration >= this.config.minIterations;
    const isStable = this.isStable(history);

    const converged = meetsThreshold && meetsMinIterations && isStable;

    if (converged) {
      this.convergencesDetected++;
      this.emit('evolution:converged', {
        taskId,
        similarity,
        iteration,
        method: this.config.method,
      });
    }

    return {
      converged,
      similarity,
      iterations: iteration,
      stabilityScore: this.computeStabilityScore(history),
      history: [...history],
    };
  }

  /**
   * Check convergence across a population of candidates.
   * Returns true if population diversity has collapsed below threshold.
   */
  checkPopulation(taskId: string, candidates: string[]): ConvergenceResult {
    if (candidates.length < 2) {
      return {
        converged: true,
        similarity: 1,
        iterations: 0,
        stabilityScore: 1,
        history: [1],
      };
    }

    // Compute pairwise similarities using K=15 random pair sampling
    let totalSimilarity = 0;
    let pairs = 0;

    const totalPossiblePairs = Math.floor(candidates.length * (candidates.length - 1) / 2);
    const maxPairs = Math.min(15, totalPossiblePairs);
    for (let p = 0; p < maxPairs; p++) {
      const i = Math.floor(Math.random() * candidates.length);
      let j = Math.floor(Math.random() * (candidates.length - 1));
      if (j >= i) j++;
      totalSimilarity += this.computeSimilarity(candidates[i], candidates[j]);
      pairs++;
    }

    const avgSimilarity = pairs > 0 ? totalSimilarity / pairs : 1;

    // Track in history
    if (!this.histories.has(`pop_${taskId}`)) {
      this.histories.set(`pop_${taskId}`, []);
    }
    const history = this.histories.get(`pop_${taskId}`)!;
    history.push(avgSimilarity);

    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }

    const converged = avgSimilarity >= this.config.similarityThreshold;

    return {
      converged,
      similarity: avgSimilarity,
      iterations: history.length,
      stabilityScore: this.computeStabilityScore(history),
      history: [...history],
    };
  }

  /**
   * Compute similarity using the configured method.
   */
  computeSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    switch (this.config.method) {
      case 'jaccard':
        return this.jaccardSimilarity(a, b);
      case 'cosine':
        return this.cosineSimilarity(a, b);
      case 'levenshtein':
        return this.levenshteinSimilarity(a, b);
      default:
        return this.jaccardSimilarity(a, b);
    }
  }

  /**
   * Jaccard similarity on word-level trigrams.
   */
  private jaccardSimilarity(a: string, b: string): number {
    const ngramsA = this.wordNgrams(a.toLowerCase(), 3);
    const ngramsB = this.wordNgrams(b.toLowerCase(), 3);

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
   * Cosine similarity approximation using TF-IDF-like word vectors.
   * No external embedding API needed.
   */
  private cosineSimilarity(a: string, b: string): number {
    const wordsA = a.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const wordsB = b.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    // Build vocabulary and TF vectors
    const vocab = new Set([...wordsA, ...wordsB]);
    const vecA = new Map<string, number>();
    const vecB = new Map<string, number>();

    for (const w of wordsA) vecA.set(w, (vecA.get(w) ?? 0) + 1);
    for (const w of wordsB) vecB.set(w, (vecB.get(w) ?? 0) + 1);

    // Compute cosine similarity
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const word of vocab) {
      const a = vecA.get(word) ?? 0;
      const b = vecB.get(word) ?? 0;
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }

  /**
   * Levenshtein distance normalized to similarity (0-1).
   * Uses space-optimized DP for efficiency.
   */
  private levenshteinSimilarity(a: string, b: string): number {
    // For very long strings, truncate to avoid O(n*m) blowup
    const maxLen = 2000;
    const sa = a.length > maxLen ? a.slice(0, maxLen) : a;
    const sb = b.length > maxLen ? b.slice(0, maxLen) : b;

    const m = sa.length;
    const n = sb.length;
    const maxDist = Math.max(m, n);

    if (maxDist === 0) return 1;

    // Space-optimized Levenshtein
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    const curr = new Array(n + 1);

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = sa[i - 1] === sb[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,        // deletion
          curr[j - 1] + 1,    // insertion
          prev[j - 1] + cost  // substitution
        );
      }
      prev = [...curr];
    }

    const distance = prev[n];
    return 1 - distance / maxDist;
  }

  /**
   * Generate word-level n-grams.
   */
  private wordNgrams(text: string, n: number): Set<string> {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const ngrams = new Set<string>();

    for (let i = 0; i <= words.length - n; i++) {
      ngrams.add(words.slice(i, i + n).join(' '));
    }

    if (words.length < n) {
      for (const word of words) ngrams.add(word);
    }

    return ngrams;
  }

  /**
   * Check if recent similarity scores are stable (low variance).
   */
  private isStable(history: number[]): boolean {
    const window = this.config.stabilityWindow;
    if (history.length < window) return false;

    const recent = history.slice(-window);
    const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
    const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;

    // Stable if variance is very low
    return variance < 0.001;
  }

  /**
   * Compute a stability score (0-1) from history.
   * 1 = perfectly stable, 0 = highly variable.
   */
  private computeStabilityScore(history: number[]): number {
    if (history.length < 2) return 0;

    const recent = history.slice(-Math.min(history.length, 10));
    const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
    const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
    const stdDev = Math.sqrt(variance);

    // Convert std dev to stability score (inverse relationship)
    return Math.max(0, 1 - stdDev * 10);
  }

  /**
   * Generate a content hash for quick equality checks.
   */
  hash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Clear history for a specific task.
   */
  clearHistory(taskId: string): void {
    this.histories.delete(taskId);
    this.histories.delete(`pop_${taskId}`);
  }

  getStats() {
    return {
      running: this.running,
      trackedTasks: this.histories.size,
      checksPerformed: this.checksPerformed,
      convergencesDetected: this.convergencesDetected,
      convergenceRate: this.checksPerformed > 0
        ? this.convergencesDetected / this.checksPerformed
        : 0,
      config: { ...this.config },
    };
  }
}
