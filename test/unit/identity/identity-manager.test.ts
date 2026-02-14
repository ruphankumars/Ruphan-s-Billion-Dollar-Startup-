/**
 * IdentityManager — Unit Tests
 *
 * Tests digital agent identity system: lifecycle, identity creation with
 * simulated key pairs, revocation, ephemeral token management, trust-level
 * verification, signed action logging, and statistics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IdentityManager } from '../../../src/identity/identity-manager.js';

describe('IdentityManager', () => {
  let manager: IdentityManager;

  beforeEach(() => {
    manager = new IdentityManager();
  });

  afterEach(() => {
    manager.stop();
  });

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('creates manager with default config', () => {
      expect(manager.isRunning()).toBe(false);
      expect(manager.getStats().totalIdentities).toBe(0);
    });

    it('merges partial config', () => {
      const custom = new IdentityManager({ tokenTtlMs: 5000 });
      expect(custom.getStats().totalTokens).toBe(0);
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────

  describe('start / stop lifecycle', () => {
    it('starts and emits started event', () => {
      const handler = vi.fn();
      manager.on('identity:started', handler);
      manager.start();
      expect(manager.isRunning()).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('stops and emits stopped event', () => {
      const handler = vi.fn();
      manager.on('identity:stopped', handler);
      manager.start();
      manager.stop();
      expect(manager.isRunning()).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('double start is idempotent', () => {
      const handler = vi.fn();
      manager.on('identity:started', handler);
      manager.start();
      manager.start();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('stop when not running is a no-op', () => {
      const handler = vi.fn();
      manager.on('identity:stopped', handler);
      manager.stop();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── Identity Management ────────────────────────────────────

  describe('createIdentity', () => {
    it('creates identity with simulated key pair', () => {
      const identity = manager.createIdentity('agent-1');

      expect(identity.id).toMatch(/^id-/);
      expect(identity.agentId).toBe('agent-1');
      expect(identity.publicKey).toMatch(/^pk-/);
      expect(identity.fingerprint).toHaveLength(16);
      expect(identity.revoked).toBe(false);
      expect(identity.expiresAt).toBeGreaterThan(identity.createdAt);
    });

    it('stores metadata', () => {
      const identity = manager.createIdentity('agent-2', { role: 'reviewer' });
      expect(identity.metadata.role).toBe('reviewer');
    });

    it('retrieves identity by id', () => {
      const identity = manager.createIdentity('agent-3');
      expect(manager.getIdentity(identity.id)).toBeDefined();
      expect(manager.getIdentity(identity.id)!.agentId).toBe('agent-3');
    });

    it('retrieves identity by agentId', () => {
      manager.createIdentity('agent-4');
      const found = manager.getIdentityByAgent('agent-4');
      expect(found).toBeDefined();
      expect(found!.agentId).toBe('agent-4');
    });

    it('returns undefined for unknown identity', () => {
      expect(manager.getIdentity('nope')).toBeUndefined();
      expect(manager.getIdentityByAgent('nope')).toBeUndefined();
    });
  });

  // ── Revocation ─────────────────────────────────────────────

  describe('revokeIdentity', () => {
    it('revokes identity and returns true', () => {
      const identity = manager.createIdentity('agent-r');
      expect(manager.revokeIdentity(identity.id)).toBe(true);
      expect(manager.getIdentity(identity.id)!.revoked).toBe(true);
    });

    it('returns false for already-revoked identity', () => {
      const identity = manager.createIdentity('agent-rr');
      manager.revokeIdentity(identity.id);
      expect(manager.revokeIdentity(identity.id)).toBe(false);
    });

    it('returns false for non-existent identity', () => {
      expect(manager.revokeIdentity('ghost')).toBe(false);
    });

    it('revokes all associated tokens when identity is revoked', () => {
      const identity = manager.createIdentity('agent-rt');
      const token = manager.issueToken(identity.id, ['read']);

      manager.revokeIdentity(identity.id);

      const validation = manager.validateToken(token.token);
      expect(validation.valid).toBe(false);
    });
  });

  // ── Token Management ───────────────────────────────────────

  describe('issueToken / revokeToken / validateToken', () => {
    it('issues a token with scope and TTL', () => {
      const identity = manager.createIdentity('agent-t');
      const token = manager.issueToken(identity.id, ['read', 'write']);

      expect(token.id).toMatch(/^tkn-/);
      expect(token.token).toMatch(/^tok-/);
      expect(token.scope).toEqual(['read', 'write']);
      expect(token.revoked).toBe(false);
      expect(token.expiresAt).toBeGreaterThan(token.issuedAt);
    });

    it('throws when issuing token for non-existent identity', () => {
      expect(() => manager.issueToken('ghost', ['read'])).toThrow(/not found/);
    });

    it('throws when issuing token for revoked identity', () => {
      const identity = manager.createIdentity('agent-tr');
      manager.revokeIdentity(identity.id);

      expect(() => manager.issueToken(identity.id, ['read'])).toThrow(/revoked/);
    });

    it('validates a valid token', () => {
      const identity = manager.createIdentity('agent-v');
      const token = manager.issueToken(identity.id, ['admin']);

      const result = manager.validateToken(token.token);
      expect(result.valid).toBe(true);
      expect(result.identity!.agentId).toBe('agent-v');
      expect(result.scope).toEqual(['admin']);
    });

    it('rejects unknown token string', () => {
      expect(manager.validateToken('unknown-token').valid).toBe(false);
    });

    it('rejects revoked token', () => {
      const identity = manager.createIdentity('agent-vr');
      const token = manager.issueToken(identity.id, ['read']);

      manager.revokeToken(token.id);

      expect(manager.validateToken(token.token).valid).toBe(false);
    });

    it('revokeToken returns false for non-existent or already-revoked token', () => {
      expect(manager.revokeToken('ghost')).toBe(false);

      const identity = manager.createIdentity('agent-rr2');
      const token = manager.issueToken(identity.id, ['x']);
      manager.revokeToken(token.id);
      expect(manager.revokeToken(token.id)).toBe(false);
    });

    it('enforces maxTokensPerIdentity by revoking oldest', () => {
      const limited = new IdentityManager({ maxTokensPerIdentity: 2 });
      const identity = limited.createIdentity('agent-ml');

      const t1 = limited.issueToken(identity.id, ['a']);
      limited.issueToken(identity.id, ['b']);
      // Issuing a 3rd should revoke the oldest (t1)
      limited.issueToken(identity.id, ['c']);

      expect(limited.validateToken(t1.token).valid).toBe(false);
    });

    it('rejects expired token', () => {
      const shortLived = new IdentityManager({ tokenTtlMs: 1 });
      const identity = shortLived.createIdentity('agent-exp');
      const token = shortLived.issueToken(identity.id, ['read']);

      // Token should expire almost immediately (1ms TTL)
      // We need a small delay
      vi.useFakeTimers();
      vi.advanceTimersByTime(10);

      expect(shortLived.validateToken(token.token).valid).toBe(false);

      vi.useRealTimers();
    });
  });

  // ── Verification ───────────────────────────────────────────

  describe('verifyIdentity', () => {
    it('verifies identity with trust level', () => {
      const identity = manager.createIdentity('agent-ver');
      const verification = manager.verifyIdentity(identity.id, 'admin', 'verified');

      expect(verification.identityId).toBe(identity.id);
      expect(verification.verified).toBe(true);
      expect(verification.trustLevel).toBe('verified');
      expect(verification.verifiedBy).toBe('admin');
    });

    it('marks as unverified when trust level is untrusted', () => {
      const identity = manager.createIdentity('agent-u');
      const verification = manager.verifyIdentity(identity.id, 'admin', 'untrusted');

      expect(verification.verified).toBe(false);
      expect(verification.trustLevel).toBe('untrusted');
    });

    it('retrieves verification record', () => {
      const identity = manager.createIdentity('agent-gv');
      manager.verifyIdentity(identity.id, 'system', 'trusted');

      const record = manager.getVerification(identity.id);
      expect(record).toBeDefined();
      expect(record!.trustLevel).toBe('trusted');
    });

    it('throws for non-existent identity', () => {
      expect(() => manager.verifyIdentity('ghost', 'admin', 'basic')).toThrow(/not found/);
    });

    it('returns undefined for unverified identity', () => {
      expect(manager.getVerification('nope')).toBeUndefined();
    });
  });

  // ── Action Logging ─────────────────────────────────────────

  describe('logAction', () => {
    it('logs action with simulated signature', () => {
      const identity = manager.createIdentity('agent-log');
      const entry = manager.logAction(identity.id, 'read', '/data', 'allowed');

      expect(entry.id).toMatch(/^log-/);
      expect(entry.identityId).toBe(identity.id);
      expect(entry.action).toBe('read');
      expect(entry.resource).toBe('/data');
      expect(entry.result).toBe('allowed');
      expect(entry.signature).toHaveLength(32);
    });

    it('stores optional details', () => {
      const identity = manager.createIdentity('agent-d');
      const entry = manager.logAction(identity.id, 'write', '/file', 'allowed', {
        bytes: 1024,
      });

      expect(entry.details.bytes).toBe(1024);
    });

    it('retrieves action log filtered by identity', () => {
      const id1 = manager.createIdentity('agent-a');
      const id2 = manager.createIdentity('agent-b');

      manager.logAction(id1.id, 'read', '/a', 'allowed');
      manager.logAction(id2.id, 'write', '/b', 'denied');
      manager.logAction(id1.id, 'delete', '/c', 'error');

      const logs = manager.getActionLog(id1.id);
      expect(logs).toHaveLength(2);
    });

    it('retrieves action log filtered by time range', () => {
      vi.useFakeTimers();
      const identity = manager.createIdentity('agent-time');

      manager.logAction(identity.id, 'old', '/x', 'allowed');
      const afterFirst = Date.now();

      vi.advanceTimersByTime(1000);
      manager.logAction(identity.id, 'new', '/y', 'allowed');

      const logs = manager.getActionLog(undefined, afterFirst + 500);
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('new');

      vi.useRealTimers();
    });

    it('emits action:logged event', () => {
      const handler = vi.fn();
      manager.on('identity:action:logged', handler);

      const identity = manager.createIdentity('agent-ev');
      manager.logAction(identity.id, 'test', '/r', 'allowed');

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns zeroed stats initially', () => {
      const stats = manager.getStats();
      expect(stats.totalIdentities).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalActions).toBe(0);
      expect(stats.revokedIdentities).toBe(0);
      expect(stats.verifiedIdentities).toBe(0);
    });

    it('tracks identities, tokens, and actions', () => {
      const id = manager.createIdentity('agent-s');
      manager.issueToken(id.id, ['r']);
      manager.logAction(id.id, 'a', '/x', 'allowed');

      const stats = manager.getStats();
      expect(stats.totalIdentities).toBe(1);
      expect(stats.totalTokens).toBe(1);
      expect(stats.totalActions).toBe(1);
    });

    it('tracks revoked and verified counts', () => {
      const id1 = manager.createIdentity('a1');
      const id2 = manager.createIdentity('a2');

      manager.revokeIdentity(id1.id);
      manager.verifyIdentity(id2.id, 'admin', 'trusted');

      const stats = manager.getStats();
      expect(stats.revokedIdentities).toBe(1);
      expect(stats.verifiedIdentities).toBe(1);
    });
  });
});
