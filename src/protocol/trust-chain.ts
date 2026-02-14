/**
 * TrustChain — Cross-Org Federation Trust with Ed25519
 *
 * Provides Ed25519 key generation, message signing and verification,
 * certificate creation, and a trust store for managing peer trust levels.
 * Uses only `node:crypto` — zero npm dependencies.
 *
 * Part of CortexOS Protocol Layer (Phase IV)
 */

import { EventEmitter } from 'node:events';
import {
  generateKeyPairSync,
  sign,
  verify,
  createPublicKey,
  createPrivateKey,
  randomUUID,
  KeyObject,
} from 'node:crypto';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface TrustKeyPair {
  publicKey: string;   // PEM-encoded Ed25519 public key
  privateKey: string;  // PEM-encoded Ed25519 private key
}

export interface TrustCertificate {
  id: string;
  subject: string;
  issuer: string;
  publicKey: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

export interface TrustedPeer {
  peerId: string;
  publicKey: string;
  trustLevel: 'full' | 'partial' | 'untrusted';
  addedAt: number;
  certificates: TrustCertificate[];
}

// ═══════════════════════════════════════════════════════════════
// TRUST CHAIN
// ═══════════════════════════════════════════════════════════════

export class TrustChain extends EventEmitter {
  private peers: Map<string, TrustedPeer> = new Map();
  private ownKeyPair: TrustKeyPair | null = null;
  private ownCertificates: TrustCertificate[] = [];

  constructor() {
    super();
  }

  // ---------------------------------------------------------------------------
  // Key management
  // ---------------------------------------------------------------------------

  /**
   * Generate a new Ed25519 keypair.
   * Returns PEM-encoded public and private keys.
   */
  generateKeyPair(): TrustKeyPair {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    const keyPair: TrustKeyPair = { publicKey, privateKey };
    this.ownKeyPair = keyPair;
    return keyPair;
  }

  /**
   * Get the current own keypair.
   * Returns null if no keypair has been generated yet.
   */
  getOwnKeyPair(): TrustKeyPair | null {
    return this.ownKeyPair;
  }

  // ---------------------------------------------------------------------------
  // Signing
  // ---------------------------------------------------------------------------

  /**
   * Sign a message string using an Ed25519 private key.
   * Returns a base64url-encoded signature.
   */
  signMessage(message: string, privateKeyPem: string): string {
    const privateKey = createPrivateKey(privateKeyPem);
    const signature = sign(null, Buffer.from(message, 'utf-8'), privateKey);
    return signature.toString('base64url');
  }

  /**
   * Verify an Ed25519 signature against a message and public key.
   * Returns `true` if the signature is valid.
   */
  verifySignature(
    message: string,
    signature: string,
    publicKeyPem: string,
  ): boolean {
    try {
      const publicKey = createPublicKey(publicKeyPem);
      const sigBuffer = Buffer.from(signature, 'base64url');
      return verify(null, Buffer.from(message, 'utf-8'), publicKey, sigBuffer);
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Certificates
  // ---------------------------------------------------------------------------

  /**
   * Create a trust certificate for an identity, signed with the signer's
   * private key. The certificate binds a subject name to a public key.
   *
   * @param identity — object with `subject` name and `publicKey` (PEM)
   * @param signerPrivateKey — PEM-encoded Ed25519 private key of the issuer
   * @param options — optional issuer name and validity period
   */
  createCertificate(
    identity: { subject: string; publicKey: string },
    signerPrivateKey: string,
    options?: {
      issuer?: string;
      validityMs?: number;
    },
  ): TrustCertificate {
    const now = Date.now();
    const validityMs = options?.validityMs ?? 365 * 24 * 60 * 60 * 1000; // 1 year

    const cert: Omit<TrustCertificate, 'signature'> = {
      id: `cert_${randomUUID().slice(0, 8)}`,
      subject: identity.subject,
      issuer: options?.issuer ?? 'self',
      publicKey: identity.publicKey,
      issuedAt: now,
      expiresAt: now + validityMs,
    };

    // Sign the certificate body
    const body = this.serializeCertBody(cert);
    const signature = this.signMessage(body, signerPrivateKey);

    const fullCert: TrustCertificate = { ...cert, signature };
    this.ownCertificates.push(fullCert);

    return fullCert;
  }

  /**
   * Verify a certificate's signature against the signer's public key.
   * Also checks expiry.
   */
  verifyCertificate(
    cert: TrustCertificate,
    signerPublicKey: string,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check expiry
    if (cert.expiresAt < Date.now()) {
      errors.push('Certificate has expired');
    }

    // Check issuedAt is not in the future
    if (cert.issuedAt > Date.now() + 60_000) {
      errors.push('Certificate issuedAt is in the future');
    }

    // Verify signature
    const body = this.serializeCertBody({
      id: cert.id,
      subject: cert.subject,
      issuer: cert.issuer,
      publicKey: cert.publicKey,
      issuedAt: cert.issuedAt,
      expiresAt: cert.expiresAt,
    });

    const sigValid = this.verifySignature(body, cert.signature, signerPublicKey);
    if (!sigValid) {
      errors.push('Signature verification failed');
    }

    return { valid: errors.length === 0, errors };
  }

  // ---------------------------------------------------------------------------
  // Trust store
  // ---------------------------------------------------------------------------

  /**
   * Add a peer to the trust store.
   * If the peer already exists, updates the trust level and public key.
   */
  addTrustedPeer(
    peerId: string,
    publicKey: string,
    trustLevel: TrustedPeer['trustLevel'],
  ): TrustedPeer {
    const existing = this.peers.get(peerId);

    const peer: TrustedPeer = {
      peerId,
      publicKey,
      trustLevel,
      addedAt: existing?.addedAt ?? Date.now(),
      certificates: existing?.certificates ?? [],
    };

    this.peers.set(peerId, peer);
    this.emit('trust:peer:added', { peerId, trustLevel });
    return peer;
  }

  /**
   * Remove a peer from the trust store.
   * Returns `true` if the peer existed.
   */
  removeTrustedPeer(peerId: string): boolean {
    const existed = this.peers.delete(peerId);
    if (existed) {
      this.emit('trust:peer:removed', { peerId });
    }
    return existed;
  }

  /**
   * Get the trust level for a peer.
   * Returns `null` if the peer is not in the trust store.
   */
  getTrustLevel(peerId: string): TrustedPeer['trustLevel'] | null {
    const peer = this.peers.get(peerId);
    return peer?.trustLevel ?? null;
  }

  /** List all trusted peers. */
  listTrustedPeers(): TrustedPeer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Get the full peer record.
   * Returns `null` if not found.
   */
  getPeer(peerId: string): TrustedPeer | null {
    return this.peers.get(peerId) ?? null;
  }

  /**
   * Attach a certificate to a peer's record.
   */
  addCertificateToPeer(peerId: string, certificate: TrustCertificate): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    peer.certificates.push(certificate);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Key rotation
  // ---------------------------------------------------------------------------

  /**
   * Rotate the own keypair. Generates a new Ed25519 keypair and re-signs
   * all own certificates with the new private key.
   *
   * Returns the new keypair and the re-signed certificates.
   */
  rotateKeys(): {
    keyPair: TrustKeyPair;
    certificates: TrustCertificate[];
  } {
    const oldKeyPair = this.ownKeyPair;
    const newKeyPair = this.generateKeyPair();

    // Re-sign all own certificates with the new private key
    const reSigned: TrustCertificate[] = this.ownCertificates.map((cert) => {
      const updated: Omit<TrustCertificate, 'signature'> = {
        id: cert.id,
        subject: cert.subject,
        issuer: cert.issuer,
        publicKey: newKeyPair.publicKey,
        issuedAt: Date.now(),
        expiresAt: cert.expiresAt,
      };

      const body = this.serializeCertBody(updated);
      const signature = this.signMessage(body, newKeyPair.privateKey);

      return { ...updated, signature };
    });

    this.ownCertificates = reSigned;

    this.emit('trust:keys:rotated', {
      oldPublicKey: oldKeyPair?.publicKey,
      newPublicKey: newKeyPair.publicKey,
    });

    return { keyPair: newKeyPair, certificates: reSigned };
  }

  // ---------------------------------------------------------------------------
  // CADP message signing helpers
  // ---------------------------------------------------------------------------

  /**
   * Sign a CADP message object. Produces a signature over the JSON-serialised
   * message body (with sorted keys, excluding the `signature` field).
   */
  signCADPMessage(
    message: Record<string, unknown>,
    privateKeyPem: string,
  ): string {
    const body = this.canonicalise(message);
    return this.signMessage(body, privateKeyPem);
  }

  /**
   * Verify a signed CADP message against a public key.
   */
  verifyCADPMessage(
    message: Record<string, unknown>,
    publicKeyPem: string,
  ): boolean {
    const signature = message.signature;
    if (typeof signature !== 'string') return false;

    const body = this.canonicalise(message);
    return this.verifySignature(body, signature, publicKeyPem);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Serialise a certificate body (excluding signature) for signing. */
  private serializeCertBody(
    cert: Omit<TrustCertificate, 'signature'>,
  ): string {
    return JSON.stringify({
      id: cert.id,
      subject: cert.subject,
      issuer: cert.issuer,
      publicKey: cert.publicKey,
      issuedAt: cert.issuedAt,
      expiresAt: cert.expiresAt,
    });
  }

  /**
   * Canonicalise a message object for signing.
   * Removes the `signature` field and produces a deterministic JSON string
   * with sorted keys.
   */
  private canonicalise(message: Record<string, unknown>): string {
    const clone = { ...message };
    delete clone.signature;
    return JSON.stringify(clone, Object.keys(clone).sort());
  }
}
