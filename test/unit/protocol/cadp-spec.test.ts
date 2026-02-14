import { describe, it, expect, beforeEach } from 'vitest';
import {
  CADPSpecification,
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  WIRE_FORMAT,
  DISCOVERY_PROTOCOL,
  SECURITY,
  MESSAGE_SCHEMAS,
} from '../../../src/protocol/cadp-spec.js';

describe('CADPSpecification', () => {
  let spec: CADPSpecification;

  beforeEach(() => {
    spec = new CADPSpecification();
  });

  // ─────────────────────────────────────────────────────────
  // Protocol version
  // ─────────────────────────────────────────────────────────

  describe('PROTOCOL_VERSION', () => {
    it('is defined and follows semver format', () => {
      expect(PROTOCOL_VERSION).toBeDefined();
      expect(typeof PROTOCOL_VERSION).toBe('string');
      expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('is version 1.0.0', () => {
      expect(PROTOCOL_VERSION).toBe('1.0.0');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Message types
  // ─────────────────────────────────────────────────────────

  describe('MESSAGE_TYPES', () => {
    it('enumerates all 11 message types', () => {
      const types = Object.keys(MESSAGE_TYPES);
      expect(types).toHaveLength(11);
    });

    it('includes core CRUD types', () => {
      expect(MESSAGE_TYPES).toHaveProperty('register');
      expect(MESSAGE_TYPES).toHaveProperty('deregister');
      expect(MESSAGE_TYPES).toHaveProperty('lookup');
      expect(MESSAGE_TYPES).toHaveProperty('lookup-response');
    });

    it('includes federation types', () => {
      expect(MESSAGE_TYPES).toHaveProperty('announce');
      expect(MESSAGE_TYPES).toHaveProperty('sync-request');
      expect(MESSAGE_TYPES).toHaveProperty('sync-response');
    });

    it('includes health and routing types', () => {
      expect(MESSAGE_TYPES).toHaveProperty('health-check');
      expect(MESSAGE_TYPES).toHaveProperty('health-response');
      expect(MESSAGE_TYPES).toHaveProperty('route-update');
    });

    it('includes error type', () => {
      expect(MESSAGE_TYPES).toHaveProperty('error');
    });

    it('each type has a description and direction', () => {
      for (const [type, info] of Object.entries(MESSAGE_TYPES)) {
        expect(info.description).toBeDefined();
        expect(typeof info.description).toBe('string');
        expect(info.description.length).toBeGreaterThan(0);
        expect(info.direction).toBeDefined();
        expect(info.direction).toMatch(/->/);
      }
    });
  });

  // ─────────────────────────────────────────────────────────
  // Wire format specification
  // ─────────────────────────────────────────────────────────

  describe('WIRE_FORMAT', () => {
    it('uses JSON encoding', () => {
      expect(WIRE_FORMAT.encoding).toBe('JSON');
    });

    it('supports HTTP/2 and WebSocket transports', () => {
      expect(WIRE_FORMAT.transport).toContain('HTTP/2');
      expect(WIRE_FORMAT.transport).toContain('WebSocket');
    });

    it('has application/json content type', () => {
      expect(WIRE_FORMAT.contentType).toBe('application/json');
    });

    it('has a max message size of 1 MB', () => {
      expect(WIRE_FORMAT.maxMessageSize).toBe(1024 * 1024);
    });

    it('supports gzip and br compression', () => {
      expect(WIRE_FORMAT.compression).toContain('gzip');
      expect(WIRE_FORMAT.compression).toContain('br');
    });

    it('defines framing for http2 and websocket', () => {
      expect(WIRE_FORMAT.framing).toHaveProperty('http2');
      expect(WIRE_FORMAT.framing).toHaveProperty('websocket');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Discovery protocol constants
  // ─────────────────────────────────────────────────────────

  describe('DISCOVERY_PROTOCOL', () => {
    it('defines DNS TXT record format', () => {
      expect(DISCOVERY_PROTOCOL.dnsTxt.name).toBe('_cadp._tcp');
      expect(DISCOVERY_PROTOCOL.dnsTxt.format).toContain('v=cadp1');
      expect(DISCOVERY_PROTOCOL.dnsTxt.ttl).toBe(3600);
    });

    it('defines .well-known endpoint path', () => {
      expect(DISCOVERY_PROTOCOL.wellKnown.path).toBe('/.well-known/cadp.json');
    });

    it('.well-known format includes version matching PROTOCOL_VERSION', () => {
      expect(DISCOVERY_PROTOCOL.wellKnown.format.version).toBe(PROTOCOL_VERSION);
    });

    it('defines mDNS service type', () => {
      expect(DISCOVERY_PROTOCOL.mdns.serviceType).toBe('_cadp._tcp.local.');
      expect(DISCOVERY_PROTOCOL.mdns.txtRecords).toBeInstanceOf(Array);
      expect(DISCOVERY_PROTOCOL.mdns.txtRecords.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Security specification
  // ─────────────────────────────────────────────────────────

  describe('SECURITY', () => {
    it('uses Ed25519 signing algorithm', () => {
      expect(SECURITY.signing.algorithm).toBe('Ed25519');
    });

    it('has 256-bit key size', () => {
      expect(SECURITY.signing.keySize).toBe(256);
    });

    it('uses base64url signature format', () => {
      expect(SECURITY.signing.signatureFormat).toBe('base64url');
    });

    it('defines a 4-step verification process', () => {
      expect(SECURITY.verification.process).toHaveLength(4);
      expect(SECURITY.verification.process[0]).toContain('Extract');
    });

    it('defines trust levels: full, partial, untrusted', () => {
      expect(SECURITY.trustLevels).toHaveProperty('full');
      expect(SECURITY.trustLevels).toHaveProperty('partial');
      expect(SECURITY.trustLevels).toHaveProperty('untrusted');
    });

    it('defines certificate chain format', () => {
      expect(SECURITY.certificateChain.format).toContain('Ed25519');
      expect(SECURITY.certificateChain.fields).toContain('subject');
      expect(SECURITY.certificateChain.fields).toContain('signature');
      expect(SECURITY.certificateChain.maxChainLength).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Message schemas
  // ─────────────────────────────────────────────────────────

  describe('MESSAGE_SCHEMAS', () => {
    it('has a schema for every message type', () => {
      const messageTypeKeys = Object.keys(MESSAGE_TYPES);
      const schemaKeys = Object.keys(MESSAGE_SCHEMAS);
      expect(schemaKeys).toEqual(expect.arrayContaining(messageTypeKeys));
    });

    it('each schema has required, optional, and payloadFields', () => {
      for (const [type, schema] of Object.entries(MESSAGE_SCHEMAS)) {
        expect(schema.required).toBeInstanceOf(Array);
        expect(schema.optional).toBeInstanceOf(Array);
        expect(typeof schema.payloadFields).toBe('object');
        // Every schema should require at least type, id, source, timestamp
        expect(schema.required).toContain('type');
        expect(schema.required).toContain('id');
        expect(schema.required).toContain('source');
        expect(schema.required).toContain('timestamp');
      }
    });

    it('register schema requires signature', () => {
      expect(MESSAGE_SCHEMAS.register.required).toContain('signature');
    });

    it('lookup schema does not require signature', () => {
      expect(MESSAGE_SCHEMAS.lookup.required).not.toContain('signature');
      expect(MESSAGE_SCHEMAS.lookup.optional).toContain('signature');
    });

    it('error schema includes code and message in payload', () => {
      expect(MESSAGE_SCHEMAS.error.payloadFields).toHaveProperty('code');
      expect(MESSAGE_SCHEMAS.error.payloadFields).toHaveProperty('message');
      expect(MESSAGE_SCHEMAS.error.payloadFields).toHaveProperty('originalMessageId');
    });
  });

  // ─────────────────────────────────────────────────────────
  // generateSpec()
  // ─────────────────────────────────────────────────────────

  describe('generateSpec()', () => {
    it('returns the full specification object', () => {
      const fullSpec = spec.generateSpec();

      expect(fullSpec.version).toBe(PROTOCOL_VERSION);
      expect(fullSpec.name).toBe('CortexOS Agent Discovery Protocol (CADP)');
      expect(fullSpec.messageTypes).toBe(MESSAGE_TYPES);
      expect(fullSpec.wireFormat).toBe(WIRE_FORMAT);
      expect(fullSpec.discoveryProtocol).toBe(DISCOVERY_PROTOCOL);
      expect(fullSpec.security).toBe(SECURITY);
      expect(fullSpec.messageSchemas).toBe(MESSAGE_SCHEMAS);
    });
  });

  // ─────────────────────────────────────────────────────────
  // validateMessage()
  // ─────────────────────────────────────────────────────────

  describe('validateMessage()', () => {
    it('validates a correct register message', () => {
      const result = spec.validateMessage({
        type: 'register',
        id: 'msg_test1',
        source: 'peer-1',
        payload: { agentId: 'agent-1', domain: 'example.com' },
        timestamp: Date.now(),
        signature: 'valid-sig',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects a message missing the type field', () => {
      const result = spec.validateMessage({
        id: 'msg_test1',
        source: 'peer-1',
        payload: {},
        timestamp: Date.now(),
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('type'))).toBe(true);
    });

    it('rejects a message missing the id field', () => {
      const result = spec.validateMessage({
        type: 'lookup',
        source: 'peer-1',
        payload: {},
        timestamp: Date.now(),
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('id'))).toBe(true);
    });

    it('rejects a message missing the source field', () => {
      const result = spec.validateMessage({
        type: 'lookup',
        id: 'msg_test1',
        payload: {},
        timestamp: Date.now(),
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('source'))).toBe(true);
    });

    it('rejects a message with an invalid timestamp', () => {
      const result = spec.validateMessage({
        type: 'lookup',
        id: 'msg_test1',
        source: 'peer-1',
        payload: { query: 'test' },
        timestamp: 12345, // Too small for epoch ms
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Timestamp'))).toBe(true);
    });

    it('rejects a message with an unknown message type', () => {
      const result = spec.validateMessage({
        type: 'nonexistent-type',
        id: 'msg_test1',
        source: 'peer-1',
        payload: {},
        timestamp: Date.now(),
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Unknown message type'))).toBe(true);
    });

    it('rejects a register message missing required signature', () => {
      const result = spec.validateMessage({
        type: 'register',
        id: 'msg_test1',
        source: 'peer-1',
        payload: { agentId: 'agent-1' },
        timestamp: Date.now(),
        // missing signature
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('signature'))).toBe(true);
    });

    it('rejects a message with empty string signature', () => {
      const result = spec.validateMessage({
        type: 'register',
        id: 'msg_test1',
        source: 'peer-1',
        payload: { agentId: 'agent-1' },
        timestamp: Date.now(),
        signature: '',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Signature'))).toBe(true);
    });

    it('rejects a message with missing payload when required', () => {
      const result = spec.validateMessage({
        type: 'register',
        id: 'msg_test1',
        source: 'peer-1',
        timestamp: Date.now(),
        signature: 'test-sig',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('payload'))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────
  // generateTestVectors()
  // ─────────────────────────────────────────────────────────

  describe('generateTestVectors()', () => {
    it('generates test vectors covering all 11 message types', () => {
      const vectors = spec.generateTestVectors();

      expect(vectors).toHaveLength(11);

      const types = vectors.map((v) => v.type);
      expect(types).toContain('register');
      expect(types).toContain('deregister');
      expect(types).toContain('lookup');
      expect(types).toContain('lookup-response');
      expect(types).toContain('announce');
      expect(types).toContain('sync-request');
      expect(types).toContain('sync-response');
      expect(types).toContain('health-check');
      expect(types).toContain('health-response');
      expect(types).toContain('route-update');
      expect(types).toContain('error');
    });

    it('each test vector has required fields', () => {
      const vectors = spec.generateTestVectors();

      for (const vector of vectors) {
        expect(vector.type).toBeDefined();
        expect(vector.id).toBeDefined();
        expect(vector.source).toBeDefined();
        expect(vector.payload).toBeDefined();
        expect(vector.timestamp).toBeDefined();
        expect(typeof vector.timestamp).toBe('number');
      }
    });

    it('each test vector validates against the spec', () => {
      const vectors = spec.generateTestVectors();

      for (const vector of vectors) {
        const result = spec.validateMessage(vector as unknown as Record<string, unknown>);
        expect(result.valid).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────────────────
  // toMarkdown()
  // ─────────────────────────────────────────────────────────

  describe('toMarkdown()', () => {
    it('returns a non-empty markdown string', () => {
      const md = spec.toMarkdown();
      expect(typeof md).toBe('string');
      expect(md.length).toBeGreaterThan(0);
    });

    it('includes the protocol title', () => {
      const md = spec.toMarkdown();
      expect(md).toContain('CADP');
      expect(md).toContain('CortexOS Agent Discovery Protocol');
    });

    it('includes the protocol version', () => {
      const md = spec.toMarkdown();
      expect(md).toContain(PROTOCOL_VERSION);
    });

    it('includes wire format section', () => {
      const md = spec.toMarkdown();
      expect(md).toContain('Wire Format');
      expect(md).toContain('JSON');
    });

    it('includes security section', () => {
      const md = spec.toMarkdown();
      expect(md).toContain('Security');
      expect(md).toContain('Ed25519');
    });

    it('includes message types table', () => {
      const md = spec.toMarkdown();
      expect(md).toContain('Message Types');
      expect(md).toContain('register');
      expect(md).toContain('deregister');
    });

    it('includes message schemas section', () => {
      const md = spec.toMarkdown();
      expect(md).toContain('Message Schemas');
    });
  });
});
