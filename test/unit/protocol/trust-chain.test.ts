import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TrustChain } from '../../../src/protocol/trust-chain.js';
import type { TrustKeyPair, TrustCertificate } from '../../../src/protocol/trust-chain.js';

describe('TrustChain', () => {
  let chain: TrustChain;

  beforeEach(() => {
    chain = new TrustChain();
  });

  // ─────────────────────────────────────────────────────────
  // generateKeyPair()
  // ─────────────────────────────────────────────────────────

  describe('generateKeyPair()', () => {
    it('creates a valid Ed25519 key pair', () => {
      const keyPair = chain.generateKeyPair();

      expect(keyPair).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
    });

    it('returns PEM-encoded keys', () => {
      const keyPair = chain.generateKeyPair();

      expect(keyPair.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
      expect(keyPair.publicKey).toContain('-----END PUBLIC KEY-----');
      expect(keyPair.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
      expect(keyPair.privateKey).toContain('-----END PRIVATE KEY-----');
    });

    it('stores the key pair as ownKeyPair', () => {
      expect(chain.getOwnKeyPair()).toBeNull();

      const keyPair = chain.generateKeyPair();

      expect(chain.getOwnKeyPair()).toBe(keyPair);
    });

    it('generates unique keys on each call', () => {
      const keyPair1 = chain.generateKeyPair();
      const keyPair2 = chain.generateKeyPair();

      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
    });
  });

  // ─────────────────────────────────────────────────────────
  // signMessage() / verifySignature()
  // ─────────────────────────────────────────────────────────

  describe('signMessage() and verifySignature()', () => {
    let keyPair: TrustKeyPair;

    beforeEach(() => {
      keyPair = chain.generateKeyPair();
    });

    it('signs and verifies a message', () => {
      const message = 'Hello, CortexOS!';
      const signature = chain.signMessage(message, keyPair.privateKey);

      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);

      const valid = chain.verifySignature(message, signature, keyPair.publicKey);
      expect(valid).toBe(true);
    });

    it('rejects a tampered message', () => {
      const message = 'Hello, CortexOS!';
      const signature = chain.signMessage(message, keyPair.privateKey);

      const valid = chain.verifySignature('Tampered message', signature, keyPair.publicKey);
      expect(valid).toBe(false);
    });

    it('rejects a signature from a different key', () => {
      const otherChain = new TrustChain();
      const otherKeyPair = otherChain.generateKeyPair();

      const message = 'Test message';
      const signature = chain.signMessage(message, keyPair.privateKey);

      const valid = chain.verifySignature(message, signature, otherKeyPair.publicKey);
      expect(valid).toBe(false);
    });

    it('returns false for invalid signature format', () => {
      const valid = chain.verifySignature('test', 'invalid-sig', keyPair.publicKey);
      expect(valid).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // createCertificate()
  // ─────────────────────────────────────────────────────────

  describe('createCertificate()', () => {
    let keyPair: TrustKeyPair;

    beforeEach(() => {
      keyPair = chain.generateKeyPair();
    });

    it('generates a certificate with all required fields', () => {
      const cert = chain.createCertificate(
        { subject: 'agent-1', publicKey: keyPair.publicKey },
        keyPair.privateKey,
      );

      expect(cert.id).toMatch(/^cert_/);
      expect(cert.subject).toBe('agent-1');
      expect(cert.publicKey).toBe(keyPair.publicKey);
      expect(cert.issuer).toBe('self');
      expect(cert.issuedAt).toBeLessThanOrEqual(Date.now());
      expect(cert.expiresAt).toBeGreaterThan(Date.now());
      expect(cert.signature).toBeDefined();
      expect(typeof cert.signature).toBe('string');
    });

    it('uses custom issuer name', () => {
      const cert = chain.createCertificate(
        { subject: 'agent-2', publicKey: keyPair.publicKey },
        keyPair.privateKey,
        { issuer: 'CortexOS CA' },
      );

      expect(cert.issuer).toBe('CortexOS CA');
    });

    it('uses custom validity period', () => {
      const validityMs = 60 * 60 * 1000; // 1 hour
      const before = Date.now();

      const cert = chain.createCertificate(
        { subject: 'agent-3', publicKey: keyPair.publicKey },
        keyPair.privateKey,
        { validityMs },
      );

      expect(cert.expiresAt).toBeLessThanOrEqual(before + validityMs + 100);
      expect(cert.expiresAt).toBeGreaterThan(before);
    });

    it('defaults to 1 year validity', () => {
      const before = Date.now();
      const oneYearMs = 365 * 24 * 60 * 60 * 1000;

      const cert = chain.createCertificate(
        { subject: 'agent-4', publicKey: keyPair.publicKey },
        keyPair.privateKey,
      );

      expect(cert.expiresAt).toBeGreaterThanOrEqual(before + oneYearMs - 100);
    });
  });

  // ─────────────────────────────────────────────────────────
  // verifyCertificate()
  // ─────────────────────────────────────────────────────────

  describe('verifyCertificate()', () => {
    let keyPair: TrustKeyPair;

    beforeEach(() => {
      keyPair = chain.generateKeyPair();
    });

    it('validates a correctly signed certificate', () => {
      const cert = chain.createCertificate(
        { subject: 'agent-1', publicKey: keyPair.publicKey },
        keyPair.privateKey,
      );

      const result = chain.verifyCertificate(cert, keyPair.publicKey);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects a certificate with a wrong public key', () => {
      const otherChain = new TrustChain();
      const otherKeyPair = otherChain.generateKeyPair();

      const cert = chain.createCertificate(
        { subject: 'agent-1', publicKey: keyPair.publicKey },
        keyPair.privateKey,
      );

      const result = chain.verifyCertificate(cert, otherKeyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Signature'))).toBe(true);
    });

    it('rejects an expired certificate', () => {
      const cert = chain.createCertificate(
        { subject: 'agent-1', publicKey: keyPair.publicKey },
        keyPair.privateKey,
        { validityMs: -1000 }, // Already expired
      );

      const result = chain.verifyCertificate(cert, keyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('expired'))).toBe(true);
    });

    it('rejects a certificate with a tampered subject', () => {
      const cert = chain.createCertificate(
        { subject: 'agent-1', publicKey: keyPair.publicKey },
        keyPair.privateKey,
      );

      // Tamper with the certificate
      const tamperedCert = { ...cert, subject: 'evil-agent' };

      const result = chain.verifyCertificate(tamperedCert, keyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Signature'))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────
  // addTrustedPeer() / removeTrustedPeer()
  // ─────────────────────────────────────────────────────────

  describe('addTrustedPeer() / removeTrustedPeer()', () => {
    let keyPair: TrustKeyPair;

    beforeEach(() => {
      keyPair = chain.generateKeyPair();
    });

    it('adds a peer with the given trust level', () => {
      const peer = chain.addTrustedPeer('peer-1', keyPair.publicKey, 'full');

      expect(peer.peerId).toBe('peer-1');
      expect(peer.publicKey).toBe(keyPair.publicKey);
      expect(peer.trustLevel).toBe('full');
      expect(peer.addedAt).toBeLessThanOrEqual(Date.now());
      expect(peer.certificates).toEqual([]);
    });

    it('emits trust:peer:added event', () => {
      const listener = vi.fn();
      chain.on('trust:peer:added', listener);

      chain.addTrustedPeer('peer-1', keyPair.publicKey, 'full');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'peer-1', trustLevel: 'full' }),
      );
    });

    it('updates an existing peer', () => {
      chain.addTrustedPeer('peer-1', keyPair.publicKey, 'partial');
      const updated = chain.addTrustedPeer('peer-1', keyPair.publicKey, 'full');

      expect(updated.trustLevel).toBe('full');

      const peers = chain.listTrustedPeers();
      expect(peers).toHaveLength(1);
    });

    it('removes a peer and returns true', () => {
      chain.addTrustedPeer('peer-1', keyPair.publicKey, 'full');

      const removed = chain.removeTrustedPeer('peer-1');
      expect(removed).toBe(true);

      const peers = chain.listTrustedPeers();
      expect(peers).toHaveLength(0);
    });

    it('returns false when removing a non-existent peer', () => {
      const removed = chain.removeTrustedPeer('nonexistent');
      expect(removed).toBe(false);
    });

    it('emits trust:peer:removed event', () => {
      chain.addTrustedPeer('peer-1', keyPair.publicKey, 'full');

      const listener = vi.fn();
      chain.on('trust:peer:removed', listener);

      chain.removeTrustedPeer('peer-1');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'peer-1' }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // isTrusted / getTrustLevel / getPeer
  // ─────────────────────────────────────────────────────────

  describe('getTrustLevel() and getPeer()', () => {
    let keyPair: TrustKeyPair;

    beforeEach(() => {
      keyPair = chain.generateKeyPair();
    });

    it('returns the trust level for a known peer', () => {
      chain.addTrustedPeer('peer-1', keyPair.publicKey, 'partial');

      expect(chain.getTrustLevel('peer-1')).toBe('partial');
    });

    it('returns null for an unknown peer', () => {
      expect(chain.getTrustLevel('unknown')).toBeNull();
    });

    it('getPeer returns the full peer record', () => {
      chain.addTrustedPeer('peer-1', keyPair.publicKey, 'full');

      const peer = chain.getPeer('peer-1');
      expect(peer).not.toBeNull();
      expect(peer!.peerId).toBe('peer-1');
      expect(peer!.trustLevel).toBe('full');
    });

    it('getPeer returns null for unknown peer', () => {
      expect(chain.getPeer('unknown')).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────
  // addCertificateToPeer()
  // ─────────────────────────────────────────────────────────

  describe('addCertificateToPeer()', () => {
    it('attaches a certificate to a peer', () => {
      const keyPair = chain.generateKeyPair();
      chain.addTrustedPeer('peer-1', keyPair.publicKey, 'full');

      const cert = chain.createCertificate(
        { subject: 'peer-1', publicKey: keyPair.publicKey },
        keyPair.privateKey,
      );

      const result = chain.addCertificateToPeer('peer-1', cert);
      expect(result).toBe(true);

      const peer = chain.getPeer('peer-1');
      expect(peer!.certificates).toHaveLength(1);
      expect(peer!.certificates[0].id).toBe(cert.id);
    });

    it('returns false for unknown peer', () => {
      const keyPair = chain.generateKeyPair();
      const cert = chain.createCertificate(
        { subject: 'agent', publicKey: keyPair.publicKey },
        keyPair.privateKey,
      );

      const result = chain.addCertificateToPeer('unknown-peer', cert);
      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // rotateKeys()
  // ─────────────────────────────────────────────────────────

  describe('rotateKeys()', () => {
    it('generates a new key pair', () => {
      const oldKeyPair = chain.generateKeyPair();

      const { keyPair: newKeyPair } = chain.rotateKeys();

      expect(newKeyPair.publicKey).not.toBe(oldKeyPair.publicKey);
      expect(newKeyPair.privateKey).not.toBe(oldKeyPair.privateKey);
      expect(chain.getOwnKeyPair()).toBe(newKeyPair);
    });

    it('re-signs existing certificates with the new key', () => {
      const keyPair = chain.generateKeyPair();

      const cert = chain.createCertificate(
        { subject: 'agent-1', publicKey: keyPair.publicKey },
        keyPair.privateKey,
      );

      const { keyPair: newKeyPair, certificates } = chain.rotateKeys();

      expect(certificates).toHaveLength(1);
      // The re-signed certificate should have the new public key
      expect(certificates[0].publicKey).toBe(newKeyPair.publicKey);
      // The re-signed certificate should verify with the new key
      const result = chain.verifyCertificate(certificates[0], newKeyPair.publicKey);
      expect(result.valid).toBe(true);
    });

    it('emits trust:keys:rotated event', () => {
      const oldKeyPair = chain.generateKeyPair();

      const listener = vi.fn();
      chain.on('trust:keys:rotated', listener);

      chain.rotateKeys();

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          oldPublicKey: oldKeyPair.publicKey,
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // CADP message signing helpers
  // ─────────────────────────────────────────────────────────

  describe('signCADPMessage() / verifyCADPMessage()', () => {
    it('signs and verifies a CADP message', () => {
      const keyPair = chain.generateKeyPair();

      const message = {
        type: 'register',
        id: 'msg-1',
        source: 'peer-1',
        payload: { agentId: 'agent-1' },
        timestamp: Date.now(),
      };

      const signature = chain.signCADPMessage(message, keyPair.privateKey);
      const signedMessage = { ...message, signature };

      const valid = chain.verifyCADPMessage(signedMessage, keyPair.publicKey);
      expect(valid).toBe(true);
    });

    it('rejects a message with no signature field', () => {
      const keyPair = chain.generateKeyPair();

      const message = {
        type: 'register',
        id: 'msg-1',
        source: 'peer-1',
      };

      const valid = chain.verifyCADPMessage(message, keyPair.publicKey);
      expect(valid).toBe(false);
    });

    it('rejects a tampered message', () => {
      const keyPair = chain.generateKeyPair();

      const message = {
        type: 'register',
        id: 'msg-1',
        source: 'peer-1',
        payload: { agentId: 'agent-1' },
        timestamp: Date.now(),
      };

      const signature = chain.signCADPMessage(message, keyPair.privateKey);
      // Tamper with a top-level field to ensure the canonical form changes
      const tampered = { ...message, signature, source: 'evil-peer' };

      const valid = chain.verifyCADPMessage(tampered, keyPair.publicKey);
      expect(valid).toBe(false);
    });
  });
});
