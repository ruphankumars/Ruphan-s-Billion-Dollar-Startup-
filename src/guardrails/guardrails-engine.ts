/**
 * GuardrailsEngine — AI Safety Policy Enforcement
 *
 * Comprehensive safety layer for AI agent operations: policy evaluation,
 * PII detection, prompt injection defence, rate limiting, content filtering,
 * audit logging, and compliance reporting.
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  GuardrailsConfig,
  GuardrailsStats,
  SafetyPolicy,
  PolicyRule,
  PolicySeverity,
  PolicyEvaluation,
  PolicyViolation,
  AuditLogEntry,
  AuditAction,
  ComplianceStandard,
  ComplianceReport,
  ComplianceFinding,
  RateLimitRule,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: GuardrailsConfig = {
  enabled: true,
  maxPolicies: 100,
  maxAuditEntries: 10_000,
  auditRetentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  defaultSeverity: 'warn',
  complianceStandards: [],
};

// ═══════════════════════════════════════════════════════════════
// PII DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════════

const PII_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'phone', regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g },
  { type: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'credit-card', regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g },
  { type: 'ip-address', regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g },
];

// ═══════════════════════════════════════════════════════════════
// INJECTION DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════════

const INJECTION_PATTERNS: Array<{ pattern: string; regex: RegExp }> = [
  { pattern: 'ignore previous instructions', regex: /ignore\s+(all\s+)?previous\s+instructions/i },
  { pattern: 'system prompt', regex: /system\s+prompt/i },
  { pattern: 'you are now', regex: /you\s+are\s+now/i },
  { pattern: 'forget your rules', regex: /forget\s+(all\s+)?(your\s+)?rules/i },
  { pattern: 'act as if', regex: /act\s+as\s+if/i },
  { pattern: 'disregard', regex: /disregard\s+(all\s+)?(previous|prior|above)/i },
  { pattern: 'override instructions', regex: /override\s+(all\s+)?(your\s+)?instructions/i },
  { pattern: 'new instructions', regex: /new\s+instructions?\s*:/i },
  { pattern: 'pretend you are', regex: /pretend\s+(that\s+)?you\s+are/i },
  { pattern: 'jailbreak', regex: /\bjailbreak\b/i },
  { pattern: 'DAN mode', regex: /\bDAN\s+mode\b/i },
  { pattern: 'developer mode', regex: /developer\s+mode\s+(enabled|activated|on)/i },
  { pattern: 'ignore safety', regex: /ignore\s+(all\s+)?(safety|guardrails?|filters?)/i },
  { pattern: 'bypass restrictions', regex: /bypass\s+(all\s+)?(restrictions?|limitations?)/i },
  { pattern: 'reveal system message', regex: /reveal\s+(your\s+)?(system\s+)?(message|prompt|instructions)/i },
];

// ═══════════════════════════════════════════════════════════════
// COMPLIANCE REQUIREMENTS
// ═══════════════════════════════════════════════════════════════

const COMPLIANCE_REQUIREMENTS: Record<ComplianceStandard, Array<{ requirement: string; check: string }>> = {
  'eu-ai-act': [
    { requirement: 'Transparency: AI system decisions must be explainable', check: 'audit-logging' },
    { requirement: 'Human oversight: Human-in-the-loop for high-risk decisions', check: 'manual-override' },
    { requirement: 'Data governance: PII must be detected and protected', check: 'pii-detection' },
    { requirement: 'Risk management: Content filtering must be active', check: 'content-filtering' },
    { requirement: 'Technical robustness: Injection detection must be enabled', check: 'injection-detection' },
  ],
  'soc2': [
    { requirement: 'Access control: Rate limiting must be configured', check: 'rate-limiting' },
    { requirement: 'Audit logging: All policy checks must be logged', check: 'audit-logging' },
    { requirement: 'Change management: Policy changes must be tracked', check: 'config-change' },
    { requirement: 'Incident response: Violations must be recorded', check: 'violation-tracking' },
  ],
  'hipaa': [
    { requirement: 'PHI protection: PII/PHI detection must be active', check: 'pii-detection' },
    { requirement: 'Access controls: Rate limiting must be enforced', check: 'rate-limiting' },
    { requirement: 'Audit trail: Complete audit log must be maintained', check: 'audit-logging' },
    { requirement: 'Transmission security: Content filtering must be active', check: 'content-filtering' },
  ],
  'gdpr': [
    { requirement: 'Data minimization: PII detection must be active', check: 'pii-detection' },
    { requirement: 'Right to transparency: Audit logging must be enabled', check: 'audit-logging' },
    { requirement: 'Data protection by design: Content filtering required', check: 'content-filtering' },
    { requirement: 'Security of processing: Injection detection required', check: 'injection-detection' },
  ],
  'custom': [
    { requirement: 'Custom policies must be defined', check: 'policies-defined' },
  ],
};

// ═══════════════════════════════════════════════════════════════
// GUARDRAILS ENGINE
// ═══════════════════════════════════════════════════════════════

export class GuardrailsEngine extends EventEmitter {
  private config: GuardrailsConfig;
  private policies: Map<string, SafetyPolicy> = new Map();
  private auditLog: AuditLogEntry[] = [];
  private rateLimits: Map<string, RateLimitRule> = new Map();
  private running = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Statistics counters
  private totalEvaluations = 0;
  private totalViolations = 0;
  private totalBlocked = 0;
  private totalWarnings = 0;

  constructor(config?: Partial<GuardrailsConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  /**
   * Start the guardrails engine and begin periodic audit log cleanup.
   */
  start(): void {
    this.running = true;

    // Schedule periodic cleanup of old audit entries
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);

    this.emit('guardrails:engine:started', { timestamp: Date.now() });
  }

  /**
   * Stop the guardrails engine and clear the cleanup timer.
   */
  stop(): void {
    this.running = false;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.emit('guardrails:engine:stopped', { timestamp: Date.now() });
  }

  /**
   * Whether the engine is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // POLICY MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Register a new safety policy with the engine.
   * Emits `guardrails:policy:registered` on success.
   */
  registerPolicy(
    policy: Omit<SafetyPolicy, 'id' | 'createdAt' | 'updatedAt'>,
  ): SafetyPolicy {
    if (this.policies.size >= this.config.maxPolicies) {
      throw new Error(
        `Maximum policy limit reached (${this.config.maxPolicies})`,
      );
    }

    const now = Date.now();
    const id = `pol_${randomUUID().slice(0, 8)}`;

    const fullPolicy: SafetyPolicy = {
      ...policy,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.policies.set(id, fullPolicy);

    this.addAuditEntry({
      action: 'config-change',
      agentId: 'system',
      policyId: id,
      details: { operation: 'register', policyName: fullPolicy.name },
    });

    this.emit('guardrails:policy:registered', {
      timestamp: now,
      policy: fullPolicy,
    });

    return fullPolicy;
  }

  /**
   * Remove a policy by ID. Returns true if the policy existed and was removed.
   */
  removePolicy(id: string): boolean {
    const policy = this.policies.get(id);
    if (!policy) {
      return false;
    }

    this.policies.delete(id);

    this.addAuditEntry({
      action: 'config-change',
      agentId: 'system',
      policyId: id,
      details: { operation: 'remove', policyName: policy.name },
    });

    this.emit('guardrails:policy:removed', {
      timestamp: Date.now(),
      policyId: id,
    });

    return true;
  }

  /**
   * Update an existing policy with partial updates.
   * Returns the updated policy.
   */
  updatePolicy(
    id: string,
    updates: Partial<Omit<SafetyPolicy, 'id' | 'createdAt'>>,
  ): SafetyPolicy {
    const existing = this.policies.get(id);
    if (!existing) {
      throw new Error(`Policy not found: ${id}`);
    }

    const updated: SafetyPolicy = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };

    this.policies.set(id, updated);

    this.addAuditEntry({
      action: 'config-change',
      agentId: 'system',
      policyId: id,
      details: { operation: 'update', fields: Object.keys(updates) },
    });

    this.emit('guardrails:policy:updated', {
      timestamp: Date.now(),
      policy: updated,
    });

    return updated;
  }

  /**
   * Get a single policy by ID.
   */
  getPolicy(id: string): SafetyPolicy | undefined {
    return this.policies.get(id);
  }

  /**
   * List policies with optional filtering by severity and/or enabled status.
   */
  listPolicies(filter?: { severity?: PolicySeverity; enabled?: boolean }): SafetyPolicy[] {
    let results = [...this.policies.values()];

    if (filter) {
      if (filter.severity !== undefined) {
        results = results.filter((p) => p.severity === filter.severity);
      }
      if (filter.enabled !== undefined) {
        results = results.filter((p) => p.enabled === filter.enabled);
      }
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ─────────────────────────────────────────────────────────
  // POLICY EVALUATION
  // ─────────────────────────────────────────────────────────

  /**
   * Evaluate all enabled policies against an input string.
   * Records audit entries and emits events for any violations.
   */
  evaluateInput(
    input: string,
    agentId: string,
    context?: Record<string, unknown>,
  ): PolicyEvaluation[] {
    if (!this.config.enabled) {
      return [];
    }

    const evaluations: PolicyEvaluation[] = [];

    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;

      const startTime = Date.now();
      const violations: PolicyViolation[] = [];

      for (const rule of policy.rules) {
        if (!rule.enabled) continue;

        const result = this.evaluateRule(rule, input);
        if (!result.passed) {
          const violation: PolicyViolation = {
            id: `vio_${randomUUID().slice(0, 8)}`,
            policyId: policy.id,
            ruleId: rule.id,
            severity: policy.severity,
            description: result.detail ?? `Rule '${rule.description}' violated`,
            content: input.slice(0, 200),
            agentId,
            timestamp: Date.now(),
          };
          violations.push(violation);
        }
      }

      const evaluation: PolicyEvaluation = {
        policyId: policy.id,
        passed: violations.length === 0,
        violations,
        evaluatedAt: Date.now(),
        latencyMs: Date.now() - startTime,
      };

      evaluations.push(evaluation);
      this.totalEvaluations++;

      // Record audit and emit events for violations
      if (violations.length > 0) {
        this.totalViolations += violations.length;

        if (policy.severity === 'block') {
          this.totalBlocked++;
          this.addAuditEntry({
            action: 'content-blocked',
            agentId,
            policyId: policy.id,
            details: {
              direction: 'input',
              violationCount: violations.length,
              context,
            },
          });
          this.emit('guardrails:input:blocked', {
            timestamp: Date.now(),
            agentId,
            policyId: policy.id,
            violations,
          });
        } else if (policy.severity === 'warn') {
          this.totalWarnings++;
          this.addAuditEntry({
            action: 'policy-violation',
            agentId,
            policyId: policy.id,
            details: {
              direction: 'input',
              severity: 'warn',
              violationCount: violations.length,
              context,
            },
          });
          this.emit('guardrails:input:warned', {
            timestamp: Date.now(),
            agentId,
            policyId: policy.id,
            violations,
          });
        } else {
          this.addAuditEntry({
            action: 'policy-violation',
            agentId,
            policyId: policy.id,
            details: {
              direction: 'input',
              severity: 'audit',
              violationCount: violations.length,
              context,
            },
          });
        }
      } else {
        this.addAuditEntry({
          action: 'policy-check',
          agentId,
          policyId: policy.id,
          details: { direction: 'input', passed: true, context },
        });
      }
    }

    return evaluations;
  }

  /**
   * Evaluate all enabled policies against an output string.
   * Records audit entries and emits events for any violations.
   */
  evaluateOutput(
    output: string,
    agentId: string,
    context?: Record<string, unknown>,
  ): PolicyEvaluation[] {
    if (!this.config.enabled) {
      return [];
    }

    const evaluations: PolicyEvaluation[] = [];

    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;

      const startTime = Date.now();
      const violations: PolicyViolation[] = [];

      for (const rule of policy.rules) {
        if (!rule.enabled) continue;

        const result = this.evaluateRule(rule, output);
        if (!result.passed) {
          const violation: PolicyViolation = {
            id: `vio_${randomUUID().slice(0, 8)}`,
            policyId: policy.id,
            ruleId: rule.id,
            severity: policy.severity,
            description: result.detail ?? `Rule '${rule.description}' violated`,
            content: output.slice(0, 200),
            agentId,
            timestamp: Date.now(),
          };
          violations.push(violation);
        }
      }

      const evaluation: PolicyEvaluation = {
        policyId: policy.id,
        passed: violations.length === 0,
        violations,
        evaluatedAt: Date.now(),
        latencyMs: Date.now() - startTime,
      };

      evaluations.push(evaluation);
      this.totalEvaluations++;

      // Record audit and emit events for violations
      if (violations.length > 0) {
        this.totalViolations += violations.length;

        if (policy.severity === 'block') {
          this.totalBlocked++;
          this.addAuditEntry({
            action: 'content-blocked',
            agentId,
            policyId: policy.id,
            details: {
              direction: 'output',
              violationCount: violations.length,
              context,
            },
          });
          this.emit('guardrails:output:blocked', {
            timestamp: Date.now(),
            agentId,
            policyId: policy.id,
            violations,
          });
        } else if (policy.severity === 'warn') {
          this.totalWarnings++;
          this.addAuditEntry({
            action: 'policy-violation',
            agentId,
            policyId: policy.id,
            details: {
              direction: 'output',
              severity: 'warn',
              violationCount: violations.length,
              context,
            },
          });
          this.emit('guardrails:output:warned', {
            timestamp: Date.now(),
            agentId,
            policyId: policy.id,
            violations,
          });
        } else {
          this.addAuditEntry({
            action: 'policy-violation',
            agentId,
            policyId: policy.id,
            details: {
              direction: 'output',
              severity: 'audit',
              violationCount: violations.length,
              context,
            },
          });
        }
      } else {
        this.addAuditEntry({
          action: 'policy-check',
          agentId,
          policyId: policy.id,
          details: { direction: 'output', passed: true, context },
        });
      }
    }

    return evaluations;
  }

  // ─────────────────────────────────────────────────────────
  // RATE LIMITING
  // ─────────────────────────────────────────────────────────

  /**
   * Check whether an agent is within its rate limit.
   * Uses a sliding window algorithm.
   */
  checkRateLimit(agentId: string): { allowed: boolean; remaining: number; resetAt: number } {
    const rule = this.rateLimits.get(agentId);

    if (!rule) {
      return { allowed: true, remaining: Infinity, resetAt: 0 };
    }

    const now = Date.now();

    // Check if the current window has expired; reset if so
    if (now - rule.windowStart >= rule.windowMs) {
      rule.currentCount = 0;
      rule.windowStart = now;
    }

    const remaining = Math.max(0, rule.maxRequests - rule.currentCount);
    const resetAt = rule.windowStart + rule.windowMs;

    if (rule.currentCount >= rule.maxRequests) {
      this.addAuditEntry({
        action: 'rate-limit-hit',
        agentId,
        details: {
          maxRequests: rule.maxRequests,
          windowMs: rule.windowMs,
          currentCount: rule.currentCount,
        },
      });

      this.emit('guardrails:ratelimit:exceeded', {
        timestamp: now,
        agentId,
        remaining: 0,
        resetAt,
      });

      return { allowed: false, remaining: 0, resetAt };
    }

    // Increment the counter
    rule.currentCount++;

    return {
      allowed: true,
      remaining: Math.max(0, rule.maxRequests - rule.currentCount),
      resetAt,
    };
  }

  /**
   * Configure a rate limit for a specific agent.
   */
  setRateLimit(agentId: string, maxRequests: number, windowMs: number): void {
    this.rateLimits.set(agentId, {
      agentId,
      maxRequests,
      windowMs,
      currentCount: 0,
      windowStart: Date.now(),
    });

    this.addAuditEntry({
      action: 'config-change',
      agentId,
      details: {
        operation: 'set-rate-limit',
        maxRequests,
        windowMs,
      },
    });

    this.emit('guardrails:ratelimit:configured', {
      timestamp: Date.now(),
      agentId,
      maxRequests,
      windowMs,
    });
  }

  // ─────────────────────────────────────────────────────────
  // PII DETECTION
  // ─────────────────────────────────────────────────────────

  /**
   * Detect personally identifiable information (PII) in text.
   * Uses regex patterns to find emails, phone numbers, SSNs,
   * credit card numbers, and IP addresses.
   */
  detectPII(text: string): {
    found: boolean;
    types: string[];
    positions: Array<{ start: number; end: number; type: string }>;
  } {
    const positions: Array<{ start: number; end: number; type: string }> = [];
    const foundTypes = new Set<string>();

    for (const { type, regex } of PII_PATTERNS) {
      // Reset the regex state for each call (global flag)
      const pattern = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        foundTypes.add(type);
        positions.push({
          start: match.index,
          end: match.index + match[0].length,
          type,
        });
      }
    }

    const found = positions.length > 0;

    if (found) {
      this.addAuditEntry({
        action: 'pii-detected',
        agentId: 'system',
        details: {
          typesFound: [...foundTypes],
          count: positions.length,
        },
      });

      this.emit('guardrails:pii:detected', {
        timestamp: Date.now(),
        types: [...foundTypes],
        count: positions.length,
      });
    }

    return {
      found,
      types: [...foundTypes],
      positions,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INJECTION DETECTION
  // ─────────────────────────────────────────────────────────

  /**
   * Detect prompt injection attempts in text.
   * Scans for known adversarial patterns.
   */
  detectInjection(text: string): { detected: boolean; patterns: string[] } {
    const matchedPatterns: string[] = [];

    for (const { pattern, regex } of INJECTION_PATTERNS) {
      if (regex.test(text)) {
        matchedPatterns.push(pattern);
      }
    }

    const detected = matchedPatterns.length > 0;

    if (detected) {
      this.addAuditEntry({
        action: 'injection-detected',
        agentId: 'system',
        details: {
          patternsMatched: matchedPatterns,
          count: matchedPatterns.length,
        },
      });

      this.emit('guardrails:injection:detected', {
        timestamp: Date.now(),
        patterns: matchedPatterns,
      });
    }

    return { detected, patterns: matchedPatterns };
  }

  // ─────────────────────────────────────────────────────────
  // CONTENT FILTERING
  // ─────────────────────────────────────────────────────────

  /**
   * Apply content filtering rules to a text string.
   * Returns the filtered text and a list of rules that were applied.
   */
  filterContent(
    text: string,
    rules: PolicyRule[],
  ): { filtered: string; applied: string[] } {
    let filtered = text;
    const applied: string[] = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;

      try {
        const regex = new RegExp(rule.pattern, 'gi');
        if (regex.test(filtered)) {
          applied.push(rule.id);
          filtered = filtered.replace(regex, '[FILTERED]');
        }
      } catch {
        // Skip invalid regex patterns gracefully
        continue;
      }
    }

    return { filtered, applied };
  }

  // ─────────────────────────────────────────────────────────
  // AUDIT LOG
  // ─────────────────────────────────────────────────────────

  /**
   * Retrieve audit log entries with optional filtering.
   */
  getAuditLog(filter?: {
    agentId?: string;
    action?: AuditAction;
    since?: number;
  }): AuditLogEntry[] {
    let results = [...this.auditLog];

    if (filter) {
      if (filter.agentId) {
        results = results.filter((e) => e.agentId === filter.agentId);
      }
      if (filter.action) {
        results = results.filter((e) => e.action === filter.action);
      }
      if (filter.since) {
        results = results.filter((e) => e.timestamp >= filter.since!);
      }
    }

    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  // ─────────────────────────────────────────────────────────
  // COMPLIANCE REPORTING
  // ─────────────────────────────────────────────────────────

  /**
   * Generate a compliance report for a given standard and time period.
   * Evaluates the current guardrails configuration against the standard's
   * requirements and produces findings with evidence.
   */
  generateComplianceReport(
    standard: ComplianceStandard,
    periodStart: number,
    periodEnd: number,
  ): ComplianceReport {
    const requirements = COMPLIANCE_REQUIREMENTS[standard] ?? [];
    const findings: ComplianceFinding[] = [];
    const periodEntries = this.auditLog.filter(
      (e) => e.timestamp >= periodStart && e.timestamp <= periodEnd,
    );

    for (const req of requirements) {
      const finding = this.evaluateComplianceRequirement(
        req,
        standard,
        periodEntries,
      );
      findings.push(finding);
    }

    const compliantCount = findings.filter((f) => f.status === 'compliant').length;
    const passed = findings.length > 0 && compliantCount === findings.length;

    const report: ComplianceReport = {
      standard,
      passed,
      findings,
      generatedAt: Date.now(),
      periodStart,
      periodEnd,
    };

    this.emit('guardrails:compliance:reported', {
      timestamp: Date.now(),
      standard,
      passed,
      findingCount: findings.length,
    });

    return report;
  }

  // ─────────────────────────────────────────────────────────
  // STATISTICS
  // ─────────────────────────────────────────────────────────

  /**
   * Get current runtime statistics for the guardrails engine.
   */
  getStats(): GuardrailsStats {
    // Calculate compliance score from active standards
    let complianceScore = 100;
    if (this.config.complianceStandards.length > 0) {
      const now = Date.now();
      const periodStart = now - this.config.auditRetentionMs;
      let totalFindings = 0;
      let compliantFindings = 0;

      for (const standard of this.config.complianceStandards) {
        const report = this.generateComplianceReport(standard, periodStart, now);
        totalFindings += report.findings.length;
        compliantFindings += report.findings.filter(
          (f) => f.status === 'compliant',
        ).length;
      }

      complianceScore =
        totalFindings > 0
          ? Math.round((compliantFindings / totalFindings) * 100)
          : 100;
    }

    return {
      totalPolicies: this.policies.size,
      totalEvaluations: this.totalEvaluations,
      totalViolations: this.totalViolations,
      totalBlocked: this.totalBlocked,
      totalWarnings: this.totalWarnings,
      totalAuditEntries: this.auditLog.length,
      complianceScore,
    };
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────

  /**
   * Add an entry to the audit log with auto-generated ID and timestamp.
   */
  private addAuditEntry(
    entry: Omit<AuditLogEntry, 'id' | 'timestamp'>,
  ): void {
    const fullEntry: AuditLogEntry = {
      ...entry,
      id: `aud_${randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
    };

    this.auditLog.push(fullEntry);

    // Enforce max entries limit by dropping oldest
    if (this.auditLog.length > this.config.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(
        this.auditLog.length - this.config.maxAuditEntries,
      );
    }
  }

  /**
   * Evaluate a single rule against a text string.
   * Returns whether the text passes the rule (no match = pass for filters).
   */
  private evaluateRule(
    rule: PolicyRule,
    text: string,
  ): { passed: boolean; detail?: string } {
    switch (rule.type) {
      case 'content-filter':
      case 'topic-block': {
        try {
          const regex = new RegExp(rule.pattern, 'i');
          const match = regex.test(text);
          return match
            ? { passed: false, detail: `Content matched filter pattern: ${rule.description}` }
            : { passed: true };
        } catch {
          return { passed: true, detail: 'Invalid regex pattern, skipping' };
        }
      }

      case 'pii-filter': {
        const piiResult = this.detectPII(text);
        return piiResult.found
          ? { passed: false, detail: `PII detected: ${piiResult.types.join(', ')}` }
          : { passed: true };
      }

      case 'injection-detect': {
        const injResult = this.detectInjection(text);
        return injResult.detected
          ? { passed: false, detail: `Injection patterns detected: ${injResult.patterns.join(', ')}` }
          : { passed: true };
      }

      case 'token-limit': {
        const maxTokens = parseInt(rule.pattern, 10);
        if (isNaN(maxTokens)) return { passed: true };
        // Approximate token count: ~4 chars per token
        const estimatedTokens = Math.ceil(text.length / 4);
        return estimatedTokens > maxTokens
          ? { passed: false, detail: `Estimated ${estimatedTokens} tokens exceeds limit of ${maxTokens}` }
          : { passed: true };
      }

      case 'rate-limit': {
        // Rate limits are checked separately via checkRateLimit()
        return { passed: true };
      }

      case 'cost-limit': {
        // Cost limits require external cost tracking context
        return { passed: true };
      }

      case 'output-format': {
        try {
          const regex = new RegExp(rule.pattern);
          const match = regex.test(text);
          // For output-format, the pattern defines what the output SHOULD match
          return match
            ? { passed: true }
            : { passed: false, detail: `Output does not match required format: ${rule.description}` };
        } catch {
          return { passed: true, detail: 'Invalid regex pattern, skipping' };
        }
      }

      case 'custom': {
        try {
          const regex = new RegExp(rule.pattern, 'i');
          const match = regex.test(text);
          return match
            ? { passed: false, detail: `Custom rule matched: ${rule.description}` }
            : { passed: true };
        } catch {
          return { passed: true, detail: 'Invalid regex pattern, skipping' };
        }
      }

      default:
        return { passed: true };
    }
  }

  /**
   * Evaluate a single compliance requirement against the audit log.
   */
  private evaluateComplianceRequirement(
    req: { requirement: string; check: string },
    standard: ComplianceStandard,
    periodEntries: AuditLogEntry[],
  ): ComplianceFinding {
    const id = `cfnd_${randomUUID().slice(0, 8)}`;

    switch (req.check) {
      case 'audit-logging': {
        const hasEntries = periodEntries.length > 0;
        return {
          id,
          standard,
          requirement: req.requirement,
          status: hasEntries ? 'compliant' : 'non-compliant',
          evidence: hasEntries
            ? `${periodEntries.length} audit entries recorded in period`
            : 'No audit entries found in the assessment period',
          recommendation: hasEntries
            ? undefined
            : 'Enable audit logging and ensure policy checks are being recorded',
        };
      }

      case 'pii-detection': {
        const hasPiiRules = [...this.policies.values()].some((p) =>
          p.enabled && p.rules.some((r) => r.type === 'pii-filter' && r.enabled),
        );
        return {
          id,
          standard,
          requirement: req.requirement,
          status: hasPiiRules ? 'compliant' : 'non-compliant',
          evidence: hasPiiRules
            ? 'Active PII detection rules are configured'
            : 'No active PII detection rules found',
          recommendation: hasPiiRules
            ? undefined
            : 'Register a policy with pii-filter rules to detect and protect PII',
        };
      }

      case 'injection-detection': {
        const hasInjRules = [...this.policies.values()].some((p) =>
          p.enabled && p.rules.some((r) => r.type === 'injection-detect' && r.enabled),
        );
        return {
          id,
          standard,
          requirement: req.requirement,
          status: hasInjRules ? 'compliant' : 'non-compliant',
          evidence: hasInjRules
            ? 'Active injection detection rules are configured'
            : 'No active injection detection rules found',
          recommendation: hasInjRules
            ? undefined
            : 'Register a policy with injection-detect rules to defend against prompt injection',
        };
      }

      case 'content-filtering': {
        const hasContentRules = [...this.policies.values()].some((p) =>
          p.enabled && p.rules.some(
            (r) => (r.type === 'content-filter' || r.type === 'topic-block') && r.enabled,
          ),
        );
        return {
          id,
          standard,
          requirement: req.requirement,
          status: hasContentRules ? 'compliant' : 'non-compliant',
          evidence: hasContentRules
            ? 'Active content filtering rules are configured'
            : 'No active content filtering rules found',
          recommendation: hasContentRules
            ? undefined
            : 'Register policies with content-filter or topic-block rules',
        };
      }

      case 'rate-limiting': {
        const hasRateLimits = this.rateLimits.size > 0;
        return {
          id,
          standard,
          requirement: req.requirement,
          status: hasRateLimits ? 'compliant' : 'non-compliant',
          evidence: hasRateLimits
            ? `${this.rateLimits.size} rate limit rule(s) configured`
            : 'No rate limits configured',
          recommendation: hasRateLimits
            ? undefined
            : 'Configure rate limits for agents using setRateLimit()',
        };
      }

      case 'manual-override': {
        const hasOverrides = periodEntries.some(
          (e) => e.action === 'manual-override',
        );
        return {
          id,
          standard,
          requirement: req.requirement,
          status: hasOverrides ? 'compliant' : 'partial',
          evidence: hasOverrides
            ? 'Manual override events recorded, indicating human-in-the-loop operation'
            : 'No manual override events detected; human oversight may be insufficient',
          recommendation: hasOverrides
            ? undefined
            : 'Ensure human-in-the-loop mechanisms are active for high-risk decisions',
        };
      }

      case 'config-change': {
        const hasConfigChanges = periodEntries.some(
          (e) => e.action === 'config-change',
        );
        return {
          id,
          standard,
          requirement: req.requirement,
          status: hasConfigChanges ? 'compliant' : 'partial',
          evidence: hasConfigChanges
            ? 'Configuration changes are tracked in the audit log'
            : 'No configuration change events found in assessment period',
          recommendation: hasConfigChanges
            ? undefined
            : 'Ensure all policy and configuration changes are audited',
        };
      }

      case 'violation-tracking': {
        const hasViolationTracking = periodEntries.some(
          (e) => e.action === 'policy-violation' || e.action === 'content-blocked',
        );
        return {
          id,
          standard,
          requirement: req.requirement,
          status: hasViolationTracking ? 'compliant' : 'partial',
          evidence: hasViolationTracking
            ? 'Violations are being tracked and recorded'
            : 'No violation events found; either no violations occurred or tracking is not active',
        };
      }

      case 'policies-defined': {
        const hasPolicies = this.policies.size > 0;
        return {
          id,
          standard,
          requirement: req.requirement,
          status: hasPolicies ? 'compliant' : 'non-compliant',
          evidence: hasPolicies
            ? `${this.policies.size} custom policy/policies defined`
            : 'No custom policies defined',
          recommendation: hasPolicies
            ? undefined
            : 'Define custom safety policies using registerPolicy()',
        };
      }

      default:
        return {
          id,
          standard,
          requirement: req.requirement,
          status: 'partial',
          evidence: `Unknown compliance check: ${req.check}`,
          recommendation: 'Review and implement the required compliance control',
        };
    }
  }

  /**
   * Prune audit entries older than the retention period.
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.config.auditRetentionMs;
    const before = this.auditLog.length;

    this.auditLog = this.auditLog.filter((e) => e.timestamp >= cutoff);

    const pruned = before - this.auditLog.length;
    if (pruned > 0) {
      this.emit('guardrails:audit:cleanup', {
        timestamp: Date.now(),
        pruned,
        remaining: this.auditLog.length,
      });
    }
  }
}
