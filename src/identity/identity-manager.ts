/**
 * IdentityManager — Digital Agent Identity System
 *
 * Manages cryptographic identities for AI agents with simulated key pairs,
 * ephemeral scoped tokens, trust-level verification, and immutable
 * (simulated-signed) action logs. Provides a foundation for zero-trust
 * agent-to-agent and agent-to-resource authorization.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  AgentIdentity,
  IdentityToken,
  ActionLog,
  TrustLevel,
  IdentityVerification,
  IdentityConfig,
  IdentityStats,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: IdentityConfig = {
  enabled: true,
  tokenTtlMs: 60 * 60 * 1000, // 1 hour
  maxTokensPerIdentity: 10,
  actionLogRetentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  requireVerification: false,
};

/** Default identity expiration: 365 days */
const DEFAULT_IDENTITY_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** Max action log entries before pruning */
const MAX_ACTION_LOG_ENTRIES = 10000;

// ═══════════════════════════════════════════════════════════════
// IDENTITY MANAGER
// ═══════════════════════════════════════════════════════════════

export class IdentityManager extends EventEmitter {
  private config: IdentityConfig;
  private running = false;

  /** Agent identities keyed by identity ID */
  private identities: Map<string, AgentIdentity> = new Map();

  /** Tokens keyed by token ID */
  private tokens: Map<string, IdentityToken> = new Map();

  /** Immutable action log */
  private actionLog: ActionLog[] = [];

  /** Verification records keyed by identity ID */
  private verifications: Map<string, IdentityVerification> = new Map();

  /** Reverse lookup: agentId -> identityId for getIdentityByAgent */
  private agentIndex: Map<string, string> = new Map();

  /** Reverse lookup: token string -> token ID for validateToken */
  private tokenIndex: Map<string, string> = new Map();

  constructor(config?: Partial<IdentityConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit('identity:started', { timestamp: Date.now() });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.emit('identity:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // IDENTITY MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Create a new agent identity with a simulated key pair.
   * The public key is a UUID-based string; the fingerprint is a
   * SHA-256 hash of the public key (first 16 hex chars).
   */
  createIdentity(
    agentId: string,
    metadata?: Record<string, unknown>,
  ): AgentIdentity {
    const now = Date.now();
    const publicKey = `pk-${randomUUID()}`;
    const fingerprint = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);

    const identity: AgentIdentity = {
      id: `id-${randomUUID().slice(0, 8)}`,
      agentId,
      publicKey,
      fingerprint,
      createdAt: now,
      expiresAt: now + DEFAULT_IDENTITY_TTL_MS,
      revoked: false,
      metadata: metadata ? { ...metadata } : {},
    };

    this.identities.set(identity.id, identity);
    this.agentIndex.set(agentId, identity.id);

    this.emit('identity:created', { identity, timestamp: now });
    return identity;
  }

  /**
   * Revoke an agent identity. Also revokes all associated tokens.
   */
  revokeIdentity(identityId: string): boolean {
    const identity = this.identities.get(identityId);
    if (!identity || identity.revoked) return false;

    identity.revoked = true;

    // Revoke all tokens belonging to this identity
    for (const token of this.tokens.values()) {
      if (token.identityId === identityId && !token.revoked) {
        token.revoked = true;
      }
    }

    this.emit('identity:revoked', { identityId, timestamp: Date.now() });
    return true;
  }

  /**
   * Get an identity by its ID.
   */
  getIdentity(id: string): AgentIdentity | undefined {
    return this.identities.get(id);
  }

  /**
   * Get an identity by its agent ID.
   */
  getIdentityByAgent(agentId: string): AgentIdentity | undefined {
    const identityId = this.agentIndex.get(agentId);
    if (!identityId) return undefined;
    return this.identities.get(identityId);
  }

  // ─────────────────────────────────────────────────────────
  // TOKEN MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Issue an ephemeral scoped token for an identity.
   */
  issueToken(
    identityId: string,
    scope: string[],
    ttlMs?: number,
  ): IdentityToken {
    const identity = this.identities.get(identityId);
    if (!identity) {
      throw new Error(`Identity "${identityId}" not found`);
    }
    if (identity.revoked) {
      throw new Error(`Identity "${identityId}" is revoked`);
    }

    // Enforce max tokens per identity
    const existingTokens = [...this.tokens.values()].filter(
      (t) => t.identityId === identityId && !t.revoked,
    );
    if (existingTokens.length >= this.config.maxTokensPerIdentity) {
      // Revoke the oldest token to make room
      const oldest = existingTokens.sort((a, b) => a.issuedAt - b.issuedAt)[0];
      if (oldest) {
        oldest.revoked = true;
        this.tokenIndex.delete(oldest.token);
      }
    }

    const now = Date.now();
    const tokenString = `tok-${randomUUID()}`;

    const token: IdentityToken = {
      id: `tkn-${randomUUID().slice(0, 8)}`,
      identityId,
      token: tokenString,
      scope: [...scope],
      issuedAt: now,
      expiresAt: now + (ttlMs ?? this.config.tokenTtlMs),
      revoked: false,
    };

    this.tokens.set(token.id, token);
    this.tokenIndex.set(tokenString, token.id);

    this.emit('identity:token:issued', { token, timestamp: now });
    return token;
  }

  /**
   * Revoke a specific token by its ID.
   */
  revokeToken(tokenId: string): boolean {
    const token = this.tokens.get(tokenId);
    if (!token || token.revoked) return false;

    token.revoked = true;
    this.tokenIndex.delete(token.token);

    this.emit('identity:token:revoked', { tokenId, timestamp: Date.now() });
    return true;
  }

  /**
   * Validate a token string. Checks existence, revocation, and expiry.
   * Returns the associated identity and scope if valid.
   */
  validateToken(
    token: string,
  ): { valid: boolean; identity?: AgentIdentity; scope?: string[] } {
    const tokenId = this.tokenIndex.get(token);
    if (!tokenId) {
      return { valid: false };
    }

    const tokenRecord = this.tokens.get(tokenId);
    if (!tokenRecord) {
      return { valid: false };
    }

    // Check revocation
    if (tokenRecord.revoked) {
      return { valid: false };
    }

    // Check expiry
    if (Date.now() > tokenRecord.expiresAt) {
      return { valid: false };
    }

    // Check identity
    const identity = this.identities.get(tokenRecord.identityId);
    if (!identity || identity.revoked) {
      return { valid: false };
    }

    // Check identity expiry
    if (Date.now() > identity.expiresAt) {
      return { valid: false };
    }

    return {
      valid: true,
      identity,
      scope: [...tokenRecord.scope],
    };
  }

  // ─────────────────────────────────────────────────────────
  // VERIFICATION
  // ─────────────────────────────────────────────────────────

  /**
   * Verify an identity and assign a trust level.
   */
  verifyIdentity(
    identityId: string,
    verifiedBy: string,
    trustLevel: TrustLevel,
  ): IdentityVerification {
    const identity = this.identities.get(identityId);
    if (!identity) {
      throw new Error(`Identity "${identityId}" not found`);
    }

    const now = Date.now();
    const verification: IdentityVerification = {
      identityId,
      verified: trustLevel !== 'untrusted',
      trustLevel,
      verifiedAt: now,
      verifiedBy,
    };

    this.verifications.set(identityId, verification);

    this.emit('identity:verified', { verification, timestamp: now });
    return verification;
  }

  /**
   * Get the verification record for an identity.
   */
  getVerification(identityId: string): IdentityVerification | undefined {
    return this.verifications.get(identityId);
  }

  // ─────────────────────────────────────────────────────────
  // ACTION LOGGING
  // ─────────────────────────────────────────────────────────

  /**
   * Log an action performed by an identity. Creates a simulated signature
   * (SHA-256 of the log entry contents) for tamper detection.
   */
  logAction(
    identityId: string,
    action: string,
    resource: string,
    result: ActionLog['result'],
    details?: Record<string, unknown>,
  ): ActionLog {
    const now = Date.now();
    const logId = `log-${randomUUID().slice(0, 8)}`;

    // Create a simulated signature by hashing the log entry contents
    const signatureInput = `${logId}:${identityId}:${action}:${resource}:${result}:${now}`;
    const signature = createHash('sha256').update(signatureInput).digest('hex').slice(0, 32);

    const entry: ActionLog = {
      id: logId,
      identityId,
      action,
      resource,
      result,
      details: details ? { ...details } : {},
      timestamp: now,
      signature,
    };

    this.actionLog.push(entry);

    // Enforce bounded log
    if (this.actionLog.length > MAX_ACTION_LOG_ENTRIES) {
      this.actionLog.splice(0, this.actionLog.length - MAX_ACTION_LOG_ENTRIES);
    }

    // Prune old entries beyond retention period
    const retentionCutoff = now - this.config.actionLogRetentionMs;
    const firstValidIndex = this.actionLog.findIndex((e) => e.timestamp >= retentionCutoff);
    if (firstValidIndex > 0) {
      this.actionLog.splice(0, firstValidIndex);
    }

    this.emit('identity:action:logged', { entry, timestamp: now });
    return entry;
  }

  /**
   * Get action log entries, optionally filtered by identity ID and/or time range.
   */
  getActionLog(identityId?: string, since?: number): ActionLog[] {
    let entries = [...this.actionLog];

    if (identityId) {
      entries = entries.filter((e) => e.identityId === identityId);
    }

    if (since !== undefined) {
      entries = entries.filter((e) => e.timestamp >= since);
    }

    return entries;
  }

  // ─────────────────────────────────────────────────────────
  // STATISTICS
  // ─────────────────────────────────────────────────────────

  /**
   * Get identity system statistics.
   */
  getStats(): IdentityStats {
    const allIdentities = [...this.identities.values()];
    const revokedIdentities = allIdentities.filter((i) => i.revoked).length;
    const verifiedIdentities = [...this.verifications.values()].filter((v) => v.verified).length;

    return {
      totalIdentities: this.identities.size,
      totalTokens: this.tokens.size,
      totalActions: this.actionLog.length,
      revokedIdentities,
      verifiedIdentities,
    };
  }
}
