/**
 * Identity Module — CortexOS Digital Agent Identity
 *
 * Manages cryptographic agent identities, ephemeral scoped tokens,
 * trust-level verification, and immutable action logs for zero-trust
 * agent authorization.
 *
 * @example
 * ```typescript
 * import { IdentityManager } from 'cortexos/identity';
 *
 * const manager = new IdentityManager({ tokenTtlMs: 3600000 });
 * manager.start();
 *
 * const identity = manager.createIdentity('agent-001', { role: 'developer' });
 * const token = manager.issueToken(identity.id, ['read', 'write']);
 * const result = manager.validateToken(token.token);
 * ```
 */

export { IdentityManager } from './identity-manager.js';
export type {
  AgentIdentity,
  IdentityToken,
  ActionLog,
  TrustLevel,
  IdentityVerification,
  IdentityConfig,
  IdentityStats,
} from './types.js';
