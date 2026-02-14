/**
 * AI Guardrails Engine Types — CortexOS
 *
 * Type definitions for the guardrails subsystem: safety policies,
 * policy evaluation, audit logging, compliance reporting, rate limiting,
 * PII detection, and prompt injection defence.
 *
 * Part of CortexOS AI Guardrails Module
 */

// ═══════════════════════════════════════════════════════════════
// POLICY SEVERITY
// ═══════════════════════════════════════════════════════════════

/** Severity level for a safety policy */
export type PolicySeverity = 'block' | 'warn' | 'audit';

// ═══════════════════════════════════════════════════════════════
// RULE TYPES
// ═══════════════════════════════════════════════════════════════

/** Classification of a policy rule */
export type RuleType =
  | 'content-filter'
  | 'rate-limit'
  | 'token-limit'
  | 'cost-limit'
  | 'topic-block'
  | 'pii-filter'
  | 'injection-detect'
  | 'output-format'
  | 'custom';

// ═══════════════════════════════════════════════════════════════
// POLICY RULES
// ═══════════════════════════════════════════════════════════════

/** Individual rule within a safety policy */
export interface PolicyRule {
  /** Unique rule identifier */
  id: string;
  /** Rule classification type */
  type: RuleType;
  /** Regex or matching pattern for the rule */
  pattern: string;
  /** Human-readable description of the rule */
  description: string;
  /** Whether this rule is currently active */
  enabled: boolean;
}

// ═══════════════════════════════════════════════════════════════
// SAFETY POLICIES
// ═══════════════════════════════════════════════════════════════

/** A safety policy comprising one or more rules */
export interface SafetyPolicy {
  /** Unique policy identifier */
  id: string;
  /** Human-readable policy name */
  name: string;
  /** Detailed description of what this policy enforces */
  description: string;
  /** Severity level when the policy is violated */
  severity: PolicySeverity;
  /** Whether this policy is currently active */
  enabled: boolean;
  /** Rules that comprise this policy */
  rules: PolicyRule[];
  /** Unix timestamp (ms) when the policy was created */
  createdAt: number;
  /** Unix timestamp (ms) when the policy was last updated */
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// POLICY EVALUATION
// ═══════════════════════════════════════════════════════════════

/** Result of evaluating a single policy against input/output */
export interface PolicyEvaluation {
  /** Policy that was evaluated */
  policyId: string;
  /** Whether the content passed all rules in this policy */
  passed: boolean;
  /** List of violations found during evaluation */
  violations: PolicyViolation[];
  /** Unix timestamp (ms) when the evaluation was performed */
  evaluatedAt: number;
  /** Time taken to evaluate this policy in milliseconds */
  latencyMs: number;
}

/** A single violation detected during policy evaluation */
export interface PolicyViolation {
  /** Unique violation identifier */
  id: string;
  /** Policy that was violated */
  policyId: string;
  /** Specific rule that was violated */
  ruleId: string;
  /** Severity of the violation */
  severity: PolicySeverity;
  /** Human-readable description of the violation */
  description: string;
  /** Offending content snippet (if applicable) */
  content?: string;
  /** Agent that triggered the violation (if applicable) */
  agentId?: string;
  /** Unix timestamp (ms) when the violation occurred */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// AUDIT LOGGING
// ═══════════════════════════════════════════════════════════════

/** Actions tracked in the audit log */
export type AuditAction =
  | 'policy-check'
  | 'policy-violation'
  | 'rate-limit-hit'
  | 'content-blocked'
  | 'pii-detected'
  | 'injection-detected'
  | 'manual-override'
  | 'config-change';

/** A single entry in the audit trail */
export interface AuditLogEntry {
  /** Unique audit entry identifier */
  id: string;
  /** Action that was recorded */
  action: AuditAction;
  /** Agent that triggered the action */
  agentId: string;
  /** Policy related to this entry (if applicable) */
  policyId?: string;
  /** Additional context and metadata */
  details: Record<string, unknown>;
  /** Unix timestamp (ms) when the entry was created */
  timestamp: number;
  /** Session identifier (if applicable) */
  sessionId?: string;
  /** IP address of the requester (if applicable) */
  ip?: string;
}

// ═══════════════════════════════════════════════════════════════
// COMPLIANCE
// ═══════════════════════════════════════════════════════════════

/** Supported compliance standards */
export type ComplianceStandard = 'eu-ai-act' | 'soc2' | 'hipaa' | 'gdpr' | 'custom';

/** A single finding within a compliance report */
export interface ComplianceFinding {
  /** Unique finding identifier */
  id: string;
  /** Compliance standard this finding relates to */
  standard: ComplianceStandard;
  /** Specific requirement being assessed */
  requirement: string;
  /** Compliance status for this requirement */
  status: 'compliant' | 'non-compliant' | 'partial';
  /** Evidence or rationale supporting the status */
  evidence: string;
  /** Recommended remediation action (if non-compliant) */
  recommendation?: string;
}

/** Full compliance report for a given standard and period */
export interface ComplianceReport {
  /** Compliance standard assessed */
  standard: ComplianceStandard;
  /** Whether the overall assessment passed */
  passed: boolean;
  /** Individual findings */
  findings: ComplianceFinding[];
  /** Unix timestamp (ms) when the report was generated */
  generatedAt: number;
  /** Unix timestamp (ms) for the start of the assessment period */
  periodStart: number;
  /** Unix timestamp (ms) for the end of the assessment period */
  periodEnd: number;
}

// ═══════════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════════

/** Sliding-window rate limit state for a single agent */
export interface RateLimitRule {
  /** Agent this rate limit applies to */
  agentId: string;
  /** Maximum requests allowed within the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Number of requests in the current window */
  currentCount: number;
  /** Unix timestamp (ms) when the current window started */
  windowStart: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

/** Configuration for the guardrails engine */
export interface GuardrailsConfig {
  /** Whether guardrails are enabled */
  enabled: boolean;
  /** Maximum number of policies that can be registered */
  maxPolicies: number;
  /** Maximum number of audit log entries to retain in memory */
  maxAuditEntries: number;
  /** How long to retain audit entries in milliseconds */
  auditRetentionMs: number;
  /** Default severity for new policies */
  defaultSeverity: PolicySeverity;
  /** Compliance standards to enforce */
  complianceStandards: ComplianceStandard[];
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

/** Runtime statistics for the guardrails engine */
export interface GuardrailsStats {
  /** Total number of registered policies */
  totalPolicies: number;
  /** Total number of policy evaluations performed */
  totalEvaluations: number;
  /** Total number of violations detected */
  totalViolations: number;
  /** Total number of inputs/outputs blocked */
  totalBlocked: number;
  /** Total number of warnings issued */
  totalWarnings: number;
  /** Total number of audit log entries */
  totalAuditEntries: number;
  /** Overall compliance score (0-100) */
  complianceScore: number;
}
