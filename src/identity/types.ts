/**
 * Identity Types — CortexOS Digital Agent Identity
 *
 * Type definitions for agent identity management, ephemeral token issuance,
 * action logging with simulated signatures, and trust-level verification.
 */

// ═══════════════════════════════════════════════════════════════
// AGENT IDENTITY
// ═══════════════════════════════════════════════════════════════

export interface AgentIdentity {
  id: string;
  agentId: string;
  publicKey: string;
  fingerprint: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
  metadata: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// TOKENS
// ═══════════════════════════════════════════════════════════════

export interface IdentityToken {
  id: string;
  identityId: string;
  token: string;
  scope: string[];
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
}

// ═══════════════════════════════════════════════════════════════
// ACTION LOG
// ═══════════════════════════════════════════════════════════════

export interface ActionLog {
  id: string;
  identityId: string;
  action: string;
  resource: string;
  result: 'allowed' | 'denied' | 'error';
  details: Record<string, unknown>;
  timestamp: number;
  signature: string;
}

// ═══════════════════════════════════════════════════════════════
// TRUST LEVELS
// ═══════════════════════════════════════════════════════════════

export type TrustLevel = 'untrusted' | 'basic' | 'verified' | 'trusted' | 'privileged';

// ═══════════════════════════════════════════════════════════════
// VERIFICATION
// ═══════════════════════════════════════════════════════════════

export interface IdentityVerification {
  identityId: string;
  verified: boolean;
  trustLevel: TrustLevel;
  verifiedAt: number;
  verifiedBy: string;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface IdentityConfig {
  enabled: boolean;
  tokenTtlMs: number;
  maxTokensPerIdentity: number;
  actionLogRetentionMs: number;
  requireVerification: boolean;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface IdentityStats {
  totalIdentities: number;
  totalTokens: number;
  totalActions: number;
  revokedIdentities: number;
  verifiedIdentities: number;
}
