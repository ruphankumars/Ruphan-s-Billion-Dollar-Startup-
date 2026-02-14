/**
 * Formal Verification Types
 *
 * Design-by-contract primitives for runtime specification checking,
 * invariant monitoring, and pre/post-condition verification.
 *
 * Part of CortexOS Formal Verification Module
 */

// ---------------------------------------------------------------------------
// Specification contracts
// ---------------------------------------------------------------------------

export interface SpecContract {
  id: string;
  name: string;
  description: string;
  preconditions: Condition[];
  postconditions: Condition[];
  invariants: Condition[];
  targetFunction?: string;
  targetFile?: string;
  createdAt: number;
}

export interface Condition {
  id: string;
  expression: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Verification results
// ---------------------------------------------------------------------------

export interface VerificationResult {
  contractId: string;
  passed: boolean;
  preconditionResults: ConditionResult[];
  postconditionResults: ConditionResult[];
  invariantResults: ConditionResult[];
  timestamp: number;
  duration: number;
}

export interface ConditionResult {
  conditionId: string;
  passed: boolean;
  expression: string;
  actualValue?: unknown;
  expectedValue?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Invariant violations
// ---------------------------------------------------------------------------

export interface InvariantViolation {
  id: string;
  invariantId: string;
  contractId: string;
  expression: string;
  actualValue: unknown;
  context: Record<string, unknown>;
  timestamp: number;
  stackTrace?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface VerificationConfig {
  enabled: boolean;
  strictMode: boolean;
  maxViolations: number;
  autoHalt: boolean;
  reportFormat: 'json' | 'text' | 'markdown';
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface VerificationStats {
  contractsRegistered: number;
  verificationsRun: number;
  passed: number;
  failed: number;
  violationsDetected: number;
  avgDuration: number;
}
