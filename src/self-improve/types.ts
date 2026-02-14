/**
 * Self-Improvement Loop Types — CortexOS
 *
 * Type definitions for the self-improvement subsystem: feedback recording,
 * regression detection, capability gap analysis, and strategy adaptation.
 */

// ═══════════════════════════════════════════════════════════════
// FEEDBACK
// ═══════════════════════════════════════════════════════════════

export interface FeedbackMetrics {
  /** Quality score (0-1) */
  quality: number;
  /** Speed score (0-1, higher is faster) */
  speed: number;
  /** Cost efficiency (0-1, higher is cheaper) */
  cost: number;
  /** Token efficiency (0-1, higher means fewer tokens used for same result) */
  tokenEfficiency: number;
}

export interface FeedbackRecord {
  /** Unique feedback identifier */
  id: string;
  /** Task ID this feedback relates to */
  taskId: string;
  /** Unix timestamp (ms) when the feedback was recorded */
  timestamp: number;
  /** Outcome of the task execution */
  outcome: 'success' | 'failure' | 'partial';
  /** Detailed metrics for the execution */
  metrics: FeedbackMetrics;
  /** Name of the strategy that was used */
  strategyUsed: string;
  /** Additional context about the execution */
  context: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// REGRESSION DETECTION
// ═══════════════════════════════════════════════════════════════

export interface RegressionAlert {
  /** Unique alert identifier */
  id: string;
  /** Name of the metric that regressed */
  metric: string;
  /** Previous average value for the metric */
  previousValue: number;
  /** Current average value for the metric */
  currentValue: number;
  /** Threshold percentage that was breached (e.g. 0.15 = 15%) */
  threshold: number;
  /** Unix timestamp (ms) when the regression was detected */
  detectedAt: number;
  /** Number of data points in the sliding window */
  windowSize: number;
}

// ═══════════════════════════════════════════════════════════════
// CAPABILITY EXPANSION
// ═══════════════════════════════════════════════════════════════

export interface CapabilityGap {
  /** Unique gap identifier */
  id: string;
  /** Description of the task that failed */
  taskDescription: string;
  /** Reason the task failed */
  failureReason: string;
  /** Suggested capability to address the gap */
  suggestedCapability: string;
  /** Confidence in the suggestion (0-1) */
  confidence: number;
  /** Unix timestamp (ms) when the gap was detected */
  detectedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface SelfImproveConfig {
  /** Whether the self-improvement loop is enabled */
  enabled: boolean;
  /** Number of recent feedback records to use for sliding window analysis */
  feedbackWindowSize: number;
  /** Percentage degradation that triggers a regression alert (e.g. 0.15 = 15%) */
  regressionThreshold: number;
  /** Learning rate for exponential moving average weight adjustment (0-1) */
  learningRate: number;
  /** Maximum number of feedback records to retain in history */
  maxHistory: number;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface SelfImproveStats {
  /** Total number of feedback records received */
  feedbackCount: number;
  /** Total number of regressions detected */
  regressionsDetected: number;
  /** Total number of capability gaps identified */
  capabilitiesExpanded: number;
  /** Total number of strategy weight adjustments made */
  strategyAdjustments: number;
}
