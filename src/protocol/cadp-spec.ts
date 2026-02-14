/**
 * CADPSpecification — CADP Protocol RFC Reference
 *
 * Contains the full CortexOS Agent Discovery Protocol specification as
 * structured constants. Provides message validation, test vector
 * generation, and human-readable specification output.
 *
 * CADP is a lightweight protocol for agent discovery, routing, and
 * cross-organisation federation. It is analogous to DNS + BGP but
 * purpose-built for AI agent ecosystems.
 *
 * Part of CortexOS Protocol Layer (Phase IV)
 */

import { randomUUID } from 'node:crypto';
import type { CADPMessage, CADPMessageType } from './types.js';

// ═══════════════════════════════════════════════════════════════
// PROTOCOL CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const PROTOCOL_VERSION = '1.0.0';

/** All defined CADP message types with human-readable descriptions. */
export const MESSAGE_TYPES: Record<CADPMessageType, { description: string; direction: string }> = {
  'register': {
    description: 'Register an agent with the discovery service',
    direction: 'client -> server',
  },
  'deregister': {
    description: 'Remove an agent from the discovery service',
    direction: 'client -> server',
  },
  'lookup': {
    description: 'Query the discovery service for an agent by ID or capability',
    direction: 'client -> server',
  },
  'lookup-response': {
    description: 'Response to a lookup query containing matching agent records',
    direction: 'server -> client',
  },
  'announce': {
    description: 'Broadcast agent availability to peers in the federation',
    direction: 'peer -> peer',
  },
  'sync-request': {
    description: 'Request full or incremental registry sync from a peer',
    direction: 'peer -> peer',
  },
  'sync-response': {
    description: 'Response containing registry data for synchronisation',
    direction: 'peer -> peer',
  },
  'health-check': {
    description: 'Probe an agent endpoint for liveness',
    direction: 'server -> agent',
  },
  'health-response': {
    description: 'Agent liveness response',
    direction: 'agent -> server',
  },
  'route-update': {
    description: 'Propagate routing table changes to peers',
    direction: 'peer -> peer',
  },
  'error': {
    description: 'Error response for any failed operation',
    direction: 'server -> client',
  },
};

/** Wire format specification. */
export const WIRE_FORMAT = {
  encoding: 'JSON',
  transport: ['HTTP/2', 'WebSocket'],
  contentType: 'application/json',
  maxMessageSize: 1024 * 1024, // 1 MB
  compression: ['gzip', 'br'],
  framing: {
    http2: 'Standard HTTP/2 framing with DATA frames',
    websocket: 'RFC 6455 text frames with JSON payloads',
  },
};

/** Discovery protocol specification. */
export const DISCOVERY_PROTOCOL = {
  /** DNS TXT record format for agent discovery */
  dnsTxt: {
    name: '_cadp._tcp',
    format: 'v=cadp1; url=<endpoint>; cap=<capability1>,<capability2>; pk=<base64-public-key>',
    example: 'v=cadp1; url=https://agents.example.com/cadp; cap=code-review,testing; pk=MCowBQ...',
    ttl: 3600,
  },
  /** .well-known endpoint */
  wellKnown: {
    path: '/.well-known/cadp.json',
    format: {
      version: PROTOCOL_VERSION,
      peerId: '<unique-peer-id>',
      endpoints: [
        {
          protocol: 'a2a | mcp | rest',
          url: '<endpoint-url>',
        },
      ],
      capabilities: ['<capability-tag>'],
      publicKey: '<base64-ed25519-public-key>',
    },
  },
  /** mDNS/Bonjour for local network discovery */
  mdns: {
    serviceType: '_cadp._tcp.local.',
    txtRecords: ['v=cadp1', 'url=<endpoint>', 'cap=<capabilities>'],
  },
};

/** Security specification. */
export const SECURITY = {
  signing: {
    algorithm: 'Ed25519',
    keySize: 256,
    signatureFormat: 'base64url',
    description: 'All CADP messages MUST be signed with the sender Ed25519 private key. ' +
      'The signature covers the JSON-serialised message body (excluding the signature field itself).',
  },
  verification: {
    process: [
      '1. Extract the "signature" field from the message',
      '2. Remove the "signature" field from the message object',
      '3. JSON.stringify the remaining object with sorted keys',
      '4. Verify the signature against the serialised bytes using the sender public key',
    ],
  },
  trustLevels: {
    full: 'Peer is fully trusted — all agents are accepted and routed',
    partial: 'Peer is partially trusted — agents accepted but not auto-routed',
    untrusted: 'Peer is known but not trusted — messages are logged but not acted upon',
  },
  certificateChain: {
    format: 'JSON certificate with Ed25519 signatures',
    fields: ['subject', 'issuer', 'publicKey', 'issuedAt', 'expiresAt', 'signature'],
    maxChainLength: 5,
  },
};

/** Detailed message schemas. */
export const MESSAGE_SCHEMAS: Record<
  CADPMessageType,
  { required: string[]; optional: string[]; payloadFields: Record<string, string> }
> = {
  register: {
    required: ['type', 'id', 'source', 'payload', 'timestamp', 'signature'],
    optional: ['destination'],
    payloadFields: {
      agentId: 'string — globally unique agent identifier',
      domain: 'string — hosting domain',
      endpoints: 'AgentEndpoint[] — array of reachable endpoints',
      capabilities: 'string[] — capability tags',
      ttl: 'number — time-to-live in seconds',
      priority: 'number — lower = higher priority',
      weight: 'number — load balancing weight',
      publicKey: 'string — agent Ed25519 public key (base64)',
    },
  },
  deregister: {
    required: ['type', 'id', 'source', 'payload', 'timestamp', 'signature'],
    optional: ['destination'],
    payloadFields: {
      agentId: 'string — agent to remove',
      reason: 'string — optional deregistration reason',
    },
  },
  lookup: {
    required: ['type', 'id', 'source', 'payload', 'timestamp'],
    optional: ['destination', 'signature'],
    payloadFields: {
      query: 'string — agent ID, domain, or capability to search',
      queryType: '"id" | "domain" | "capability"',
      maxResults: 'number — maximum results to return',
    },
  },
  'lookup-response': {
    required: ['type', 'id', 'source', 'payload', 'timestamp'],
    optional: ['destination', 'signature'],
    payloadFields: {
      records: 'AgentDNSRecord[] — matching agent records',
      total: 'number — total matches (may exceed returned count)',
      queryId: 'string — ID of the original lookup message',
    },
  },
  announce: {
    required: ['type', 'id', 'source', 'payload', 'timestamp', 'signature'],
    optional: ['destination'],
    payloadFields: {
      agentId: 'string — announced agent',
      domain: 'string — hosting domain',
      capabilities: 'string[] — capability tags',
      endpoints: 'AgentEndpoint[] — reachable endpoints',
    },
  },
  'sync-request': {
    required: ['type', 'id', 'source', 'payload', 'timestamp', 'signature'],
    optional: ['destination'],
    payloadFields: {
      since: 'number — timestamp for incremental sync (0 = full)',
      capabilities: 'string[] — filter by capability (empty = all)',
    },
  },
  'sync-response': {
    required: ['type', 'id', 'source', 'payload', 'timestamp', 'signature'],
    optional: ['destination'],
    payloadFields: {
      records: 'AgentDNSRecord[] — registry data',
      syncTimestamp: 'number — server timestamp of this sync',
      hasMore: 'boolean — whether more data is available',
    },
  },
  'health-check': {
    required: ['type', 'id', 'source', 'timestamp'],
    optional: ['destination', 'payload', 'signature'],
    payloadFields: {
      agentId: 'string — agent being checked',
      endpointUrl: 'string — specific endpoint to probe',
    },
  },
  'health-response': {
    required: ['type', 'id', 'source', 'payload', 'timestamp'],
    optional: ['destination', 'signature'],
    payloadFields: {
      healthy: 'boolean — whether the agent is healthy',
      latencyMs: 'number — round-trip latency',
      version: 'string — agent version',
      uptime: 'number — agent uptime in seconds',
    },
  },
  'route-update': {
    required: ['type', 'id', 'source', 'payload', 'timestamp', 'signature'],
    optional: ['destination'],
    payloadFields: {
      routes: 'RouteEntry[] — updated routing entries',
      withdrawn: 'string[] — route patterns being withdrawn',
    },
  },
  error: {
    required: ['type', 'id', 'source', 'payload', 'timestamp'],
    optional: ['destination', 'signature'],
    payloadFields: {
      code: 'number — error code',
      message: 'string — human-readable error message',
      originalMessageId: 'string — ID of the message that caused the error',
    },
  },
};

// ═══════════════════════════════════════════════════════════════
// CADP SPECIFICATION CLASS
// ═══════════════════════════════════════════════════════════════

export class CADPSpecification {
  // ---------------------------------------------------------------------------
  // Specification generation
  // ---------------------------------------------------------------------------

  /**
   * Generate the full CADP specification as a structured object.
   */
  generateSpec(): {
    version: string;
    name: string;
    messageTypes: typeof MESSAGE_TYPES;
    wireFormat: typeof WIRE_FORMAT;
    discoveryProtocol: typeof DISCOVERY_PROTOCOL;
    security: typeof SECURITY;
    messageSchemas: typeof MESSAGE_SCHEMAS;
  } {
    return {
      version: PROTOCOL_VERSION,
      name: 'CortexOS Agent Discovery Protocol (CADP)',
      messageTypes: MESSAGE_TYPES,
      wireFormat: WIRE_FORMAT,
      discoveryProtocol: DISCOVERY_PROTOCOL,
      security: SECURITY,
      messageSchemas: MESSAGE_SCHEMAS,
    };
  }

  // ---------------------------------------------------------------------------
  // Message validation
  // ---------------------------------------------------------------------------

  /**
   * Validate a CADP message against the specification.
   * Returns an object with `valid` and an array of `errors`.
   */
  validateMessage(message: Record<string, unknown>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check top-level required fields
    if (!message.type || typeof message.type !== 'string') {
      errors.push('Missing or invalid "type" field');
    }
    if (!message.id || typeof message.id !== 'string') {
      errors.push('Missing or invalid "id" field');
    }
    if (!message.source || typeof message.source !== 'string') {
      errors.push('Missing or invalid "source" field');
    }
    if (typeof message.timestamp !== 'number') {
      errors.push('Missing or invalid "timestamp" field');
    }

    // Check type is a known message type
    const type = message.type as string;
    if (type && !MESSAGE_SCHEMAS[type as CADPMessageType]) {
      errors.push(`Unknown message type: "${type}"`);
    }

    // Validate against schema
    if (type && MESSAGE_SCHEMAS[type as CADPMessageType]) {
      const schema = MESSAGE_SCHEMAS[type as CADPMessageType];

      // Check required fields
      for (const field of schema.required) {
        if (field === 'payload') {
          if (!message.payload || typeof message.payload !== 'object') {
            errors.push(`Missing required field: "${field}" (must be an object)`);
          }
        } else if (!(field in message)) {
          errors.push(`Missing required field: "${field}"`);
        }
      }

      // Check payload fields
      if (message.payload && typeof message.payload === 'object') {
        const payload = message.payload as Record<string, unknown>;
        const payloadFieldNames = Object.keys(schema.payloadFields);

        // Warn about unknown payload fields
        for (const key of Object.keys(payload)) {
          if (!payloadFieldNames.includes(key)) {
            // Unknown fields are allowed but generate a warning (not an error)
          }
        }
      }
    }

    // Validate timestamp is a reasonable epoch millisecond
    if (typeof message.timestamp === 'number') {
      const ts = message.timestamp as number;
      if (ts < 1_000_000_000_000 || ts > 10_000_000_000_000) {
        errors.push(
          `Timestamp "${ts}" appears invalid — expected epoch milliseconds`,
        );
      }
    }

    // Validate signature format if present
    if (message.signature !== undefined) {
      if (typeof message.signature !== 'string' || message.signature.length === 0) {
        errors.push('Signature must be a non-empty string');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ---------------------------------------------------------------------------
  // Test vectors
  // ---------------------------------------------------------------------------

  /**
   * Generate reference test vectors for interoperability testing.
   * Returns an array of valid CADP messages covering every message type.
   */
  generateTestVectors(): CADPMessage[] {
    const now = Date.now();
    const sourceId = `test-peer_${randomUUID().slice(0, 8)}`;

    return [
      {
        type: 'register',
        id: `msg_${randomUUID().slice(0, 8)}`,
        source: sourceId,
        payload: {
          agentId: `cortexos:agent:test_${randomUUID().slice(0, 8)}`,
          domain: 'agents.test.example.com',
          endpoints: [
            { protocol: 'a2a', url: 'https://agents.test.example.com/a2a', healthy: true },
          ],
          capabilities: ['code-review', 'testing'],
          ttl: 3600,
          priority: 10,
          weight: 100,
        },
        timestamp: now,
        signature: 'test-signature-placeholder',
      },
      {
        type: 'deregister',
        id: `msg_${randomUUID().slice(0, 8)}`,
        source: sourceId,
        payload: {
          agentId: 'cortexos:agent:old-agent',
          reason: 'shutdown',
        },
        timestamp: now,
        signature: 'test-signature-placeholder',
      },
      {
        type: 'lookup',
        id: `msg_${randomUUID().slice(0, 8)}`,
        source: sourceId,
        payload: {
          query: 'code-review',
          queryType: 'capability',
          maxResults: 10,
        },
        timestamp: now,
      },
      {
        type: 'lookup-response',
        id: `msg_${randomUUID().slice(0, 8)}`,
        source: sourceId,
        payload: {
          records: [],
          total: 0,
          queryId: 'test-query-id',
        },
        timestamp: now,
      },
      {
        type: 'announce',
        id: `msg_${randomUUID().slice(0, 8)}`,
        source: sourceId,
        payload: {
          agentId: 'cortexos:agent:new-agent',
          domain: 'agents.test.example.com',
          capabilities: ['deployment', 'monitoring'],
          endpoints: [
            { protocol: 'rest', url: 'https://agents.test.example.com/api', healthy: true },
          ],
        },
        timestamp: now,
        signature: 'test-signature-placeholder',
      },
      {
        type: 'sync-request',
        id: `msg_${randomUUID().slice(0, 8)}`,
        source: sourceId,
        payload: {
          since: 0,
          capabilities: [],
        },
        timestamp: now,
        signature: 'test-signature-placeholder',
      },
      {
        type: 'sync-response',
        id: `msg_${randomUUID().slice(0, 8)}`,
        source: sourceId,
        payload: {
          records: [],
          syncTimestamp: now,
          hasMore: false,
        },
        timestamp: now,
        signature: 'test-signature-placeholder',
      },
      {
        type: 'health-check',
        id: `msg_${randomUUID().slice(0, 8)}`,
        source: sourceId,
        payload: {
          agentId: 'cortexos:agent:target',
          endpointUrl: 'https://agents.test.example.com/health',
        },
        timestamp: now,
      },
      {
        type: 'health-response',
        id: `msg_${randomUUID().slice(0, 8)}`,
        source: sourceId,
        payload: {
          healthy: true,
          latencyMs: 42,
          version: '1.0.0',
          uptime: 86400,
        },
        timestamp: now,
      },
      {
        type: 'route-update',
        id: `msg_${randomUUID().slice(0, 8)}`,
        source: sourceId,
        payload: {
          routes: [],
          withdrawn: [],
        },
        timestamp: now,
        signature: 'test-signature-placeholder',
      },
      {
        type: 'error',
        id: `msg_${randomUUID().slice(0, 8)}`,
        source: sourceId,
        payload: {
          code: 404,
          message: 'Agent not found',
          originalMessageId: 'msg_test',
        },
        timestamp: now,
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // Markdown generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a human-readable specification document in Markdown format.
   */
  toMarkdown(): string {
    const lines: string[] = [];

    lines.push('# CADP — CortexOS Agent Discovery Protocol');
    lines.push('');
    lines.push(`**Version:** ${PROTOCOL_VERSION}`);
    lines.push('');
    lines.push('## Overview');
    lines.push('');
    lines.push(
      'CADP is a lightweight protocol for AI agent discovery, routing, and ' +
      'cross-organisation federation. It provides DNS-like name resolution, ' +
      'BGP-like route propagation, and a trust framework based on Ed25519 signatures.',
    );
    lines.push('');

    // Wire format
    lines.push('## Wire Format');
    lines.push('');
    lines.push(`- **Encoding:** ${WIRE_FORMAT.encoding}`);
    lines.push(`- **Transport:** ${WIRE_FORMAT.transport.join(', ')}`);
    lines.push(`- **Content-Type:** ${WIRE_FORMAT.contentType}`);
    lines.push(`- **Max Message Size:** ${WIRE_FORMAT.maxMessageSize} bytes`);
    lines.push(`- **Compression:** ${WIRE_FORMAT.compression.join(', ')}`);
    lines.push('');

    // Discovery
    lines.push('## Discovery');
    lines.push('');
    lines.push('### DNS TXT Record');
    lines.push('');
    lines.push(`- **Name:** \`${DISCOVERY_PROTOCOL.dnsTxt.name}\``);
    lines.push(`- **Format:** \`${DISCOVERY_PROTOCOL.dnsTxt.format}\``);
    lines.push(`- **Example:** \`${DISCOVERY_PROTOCOL.dnsTxt.example}\``);
    lines.push('');
    lines.push('### .well-known Endpoint');
    lines.push('');
    lines.push(`- **Path:** \`${DISCOVERY_PROTOCOL.wellKnown.path}\``);
    lines.push('- **Response Format:**');
    lines.push('```json');
    lines.push(JSON.stringify(DISCOVERY_PROTOCOL.wellKnown.format, null, 2));
    lines.push('```');
    lines.push('');

    // Security
    lines.push('## Security');
    lines.push('');
    lines.push(`- **Algorithm:** ${SECURITY.signing.algorithm}`);
    lines.push(`- **Key Size:** ${SECURITY.signing.keySize} bits`);
    lines.push(`- **Signature Format:** ${SECURITY.signing.signatureFormat}`);
    lines.push('');
    lines.push(SECURITY.signing.description);
    lines.push('');
    lines.push('### Verification Process');
    lines.push('');
    for (const step of SECURITY.verification.process) {
      lines.push(step);
    }
    lines.push('');
    lines.push('### Trust Levels');
    lines.push('');
    lines.push('| Level | Description |');
    lines.push('|-------|-------------|');
    for (const [level, desc] of Object.entries(SECURITY.trustLevels)) {
      lines.push(`| ${level} | ${desc} |`);
    }
    lines.push('');

    // Message types
    lines.push('## Message Types');
    lines.push('');
    lines.push('| Type | Direction | Description |');
    lines.push('|------|-----------|-------------|');
    for (const [type, info] of Object.entries(MESSAGE_TYPES)) {
      lines.push(`| \`${type}\` | ${info.direction} | ${info.description} |`);
    }
    lines.push('');

    // Message schemas
    lines.push('## Message Schemas');
    lines.push('');
    for (const [type, schema] of Object.entries(MESSAGE_SCHEMAS)) {
      lines.push(`### \`${type}\``);
      lines.push('');
      lines.push(`**Required fields:** ${schema.required.map((f) => `\`${f}\``).join(', ')}`);
      if (schema.optional.length > 0) {
        lines.push(`**Optional fields:** ${schema.optional.map((f) => `\`${f}\``).join(', ')}`);
      }
      lines.push('');
      lines.push('**Payload:**');
      lines.push('');
      lines.push('| Field | Type |');
      lines.push('|-------|------|');
      for (const [field, desc] of Object.entries(schema.payloadFields)) {
        lines.push(`| \`${field}\` | ${desc} |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
