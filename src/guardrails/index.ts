/**
 * AI Guardrails Engine — CortexOS
 *
 * Safety policy enforcement, PII detection, prompt injection defence,
 * rate limiting, content filtering, audit logging, and compliance reporting.
 *
 * @example
 * ```typescript
 * import { GuardrailsEngine } from 'cortexos';
 *
 * const engine = new GuardrailsEngine({ enabled: true });
 * engine.start();
 *
 * const policy = engine.registerPolicy({
 *   name: 'no-pii',
 *   description: 'Block PII in outputs',
 *   severity: 'block',
 *   enabled: true,
 *   rules: [{
 *     id: 'pii-1', type: 'pii-filter', pattern: '',
 *     description: 'Detect PII', enabled: true,
 *   }],
 * });
 *
 * const evals = engine.evaluateOutput('Email: user@example.com', 'agent-1');
 * console.log(evals[0].passed); // false
 * ```
 */

export { GuardrailsEngine } from './guardrails-engine.js';
export type {
  PolicySeverity,
  RuleType,
  PolicyRule,
  SafetyPolicy,
  PolicyEvaluation,
  PolicyViolation,
  AuditAction,
  AuditLogEntry,
  ComplianceStandard,
  ComplianceFinding,
  ComplianceReport,
  RateLimitRule,
  GuardrailsConfig,
  GuardrailsStats,
} from './types.js';
