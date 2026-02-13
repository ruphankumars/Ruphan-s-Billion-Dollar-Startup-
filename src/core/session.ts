/**
 * Agent Conversation History & Session Persistence
 *
 * Manages multi-turn conversation state, session persistence,
 * conversation replay, and queryable message logs.
 */

// ═══════════════════════════════════════════════════════════════
// SESSION TYPES
// ═══════════════════════════════════════════════════════════════

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  agentRole?: string;
  model?: string;
  provider?: string;
  tokenCount?: number;
  cost?: number;
  toolCalls?: ToolCallRecord[];
  stage?: string;
  tags?: string[];
}

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ConversationMessage[];
  metadata: SessionMetadata;
  status: 'active' | 'completed' | 'archived';
}

export interface SessionMetadata {
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  provider?: string;
  model?: string;
  tags: string[];
  summary?: string;
  parentSessionId?: string;
}

export interface SessionQuery {
  status?: Session['status'];
  tags?: string[];
  since?: number;
  until?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

// ═══════════════════════════════════════════════════════════════
// SESSION MANAGER
// ═══════════════════════════════════════════════════════════════

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private activeSessionId: string | null = null;
  private persistPath: string | null;
  private maxMessagesPerSession: number;

  constructor(config: { persistPath?: string; maxMessages?: number } = {}) {
    this.persistPath = config.persistPath ?? null;
    this.maxMessagesPerSession = config.maxMessages ?? 10000;

    if (this.persistPath) {
      this.loadFromDisk();
    }
  }

  // ─── Session Lifecycle ────────────────────────────────────────

  /** Create a new conversation session */
  createSession(title?: string, metadata?: Partial<SessionMetadata>): Session {
    const session: Session = {
      id: this.generateId(),
      title: title ?? `Session ${this.sessions.size + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      metadata: {
        totalTokens: 0,
        totalCost: 0,
        messageCount: 0,
        tags: [],
        ...metadata,
      },
      status: 'active',
    };

    this.sessions.set(session.id, session);
    this.activeSessionId = session.id;
    this.autoPersist();
    return session;
  }

  /** Get the active session, creating one if none exists */
  getOrCreateActiveSession(): Session {
    if (this.activeSessionId) {
      const session = this.sessions.get(this.activeSessionId);
      if (session && session.status === 'active') return session;
    }
    return this.createSession();
  }

  /** Switch to an existing session */
  setActiveSession(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    this.activeSessionId = sessionId;
    return session;
  }

  /** Get a session by ID */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** Complete the active session */
  completeSession(sessionId?: string): void {
    const id = sessionId ?? this.activeSessionId;
    if (!id) return;

    const session = this.sessions.get(id);
    if (session) {
      session.status = 'completed';
      session.updatedAt = Date.now();
      if (this.activeSessionId === id) {
        this.activeSessionId = null;
      }
      this.autoPersist();
    }
  }

  /** Archive a session */
  archiveSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'archived';
      session.updatedAt = Date.now();
      this.autoPersist();
    }
  }

  /** Fork a session (create a branch from a point in history) */
  forkSession(sessionId: string, afterMessageIndex?: number): Session {
    const source = this.sessions.get(sessionId);
    if (!source) throw new Error(`Session "${sessionId}" not found`);

    const messages = afterMessageIndex !== undefined
      ? source.messages.slice(0, afterMessageIndex + 1)
      : [...source.messages];

    const fork = this.createSession(`Fork of ${source.title}`, {
      parentSessionId: sessionId,
      tags: [...source.metadata.tags, 'fork'],
    });

    fork.messages = messages.map(m => ({ ...m, id: this.generateId() }));
    fork.metadata.messageCount = fork.messages.length;
    fork.metadata.totalTokens = messages.reduce((sum, m) => sum + (m.metadata?.tokenCount ?? 0), 0);
    fork.metadata.totalCost = messages.reduce((sum, m) => sum + (m.metadata?.cost ?? 0), 0);

    this.autoPersist();
    return fork;
  }

  // ─── Message Management ───────────────────────────────────────

  /** Add a message to the active session */
  addMessage(content: string, role: ConversationMessage['role'], metadata?: MessageMetadata): ConversationMessage {
    const session = this.getOrCreateActiveSession();
    return this.addMessageToSession(session.id, content, role, metadata);
  }

  /** Add a message to a specific session */
  addMessageToSession(
    sessionId: string,
    content: string,
    role: ConversationMessage['role'],
    metadata?: MessageMetadata
  ): ConversationMessage {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    const message: ConversationMessage = {
      id: this.generateId(),
      role,
      content,
      timestamp: Date.now(),
      metadata,
    };

    session.messages.push(message);
    session.metadata.messageCount = session.messages.length;
    session.metadata.totalTokens += metadata?.tokenCount ?? 0;
    session.metadata.totalCost += metadata?.cost ?? 0;
    session.updatedAt = Date.now();

    // Enforce max messages (remove oldest non-system messages)
    if (session.messages.length > this.maxMessagesPerSession) {
      const systemMessages = session.messages.filter(m => m.role === 'system');
      const nonSystem = session.messages.filter(m => m.role !== 'system');
      const trimmed = nonSystem.slice(-this.maxMessagesPerSession + systemMessages.length);
      session.messages = [...systemMessages, ...trimmed];
    }

    this.autoPersist();
    return message;
  }

  /** Get conversation history for LLM context */
  getConversationHistory(sessionId?: string, limit?: number): ConversationMessage[] {
    const id = sessionId ?? this.activeSessionId;
    if (!id) return [];

    const session = this.sessions.get(id);
    if (!session) return [];

    if (limit) {
      return session.messages.slice(-limit);
    }
    return [...session.messages];
  }

  /** Search messages across sessions */
  searchMessages(query: string, options?: { sessionId?: string; role?: string; limit?: number }): Array<{ session: Session; message: ConversationMessage }> {
    const results: Array<{ session: Session; message: ConversationMessage }> = [];
    const lowerQuery = query.toLowerCase();
    const limit = options?.limit ?? 50;

    const sessions = options?.sessionId
      ? [this.sessions.get(options.sessionId)].filter(Boolean) as Session[]
      : Array.from(this.sessions.values());

    for (const session of sessions) {
      for (const message of session.messages) {
        if (options?.role && message.role !== options.role) continue;
        if (message.content.toLowerCase().includes(lowerQuery)) {
          results.push({ session, message });
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  // ─── Session Queries ──────────────────────────────────────────

  /** List sessions with filtering */
  listSessions(query?: SessionQuery): Session[] {
    let sessions = Array.from(this.sessions.values());

    if (query?.status) {
      sessions = sessions.filter(s => s.status === query.status);
    }

    if (query?.tags?.length) {
      sessions = sessions.filter(s =>
        query.tags!.some(tag => s.metadata.tags.includes(tag))
      );
    }

    if (query?.since) {
      sessions = sessions.filter(s => s.createdAt >= query.since!);
    }

    if (query?.until) {
      sessions = sessions.filter(s => s.createdAt <= query.until!);
    }

    if (query?.search) {
      const q = query.search.toLowerCase();
      sessions = sessions.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some(m => m.content.toLowerCase().includes(q))
      );
    }

    // Sort by most recently updated
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);

    const offset = query?.offset ?? 0;
    const limit = query?.limit ?? 100;
    return sessions.slice(offset, offset + limit);
  }

  /** Get aggregate stats across all sessions */
  getStats(): SessionStats {
    const sessions = Array.from(this.sessions.values());
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.status === 'active').length,
      completedSessions: sessions.filter(s => s.status === 'completed').length,
      archivedSessions: sessions.filter(s => s.status === 'archived').length,
      totalMessages: sessions.reduce((sum, s) => sum + s.metadata.messageCount, 0),
      totalTokens: sessions.reduce((sum, s) => sum + s.metadata.totalTokens, 0),
      totalCost: sessions.reduce((sum, s) => sum + s.metadata.totalCost, 0),
    };
  }

  // ─── Persistence ──────────────────────────────────────────────

  /** Export a session as JSON */
  exportSession(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    return JSON.stringify(session, null, 2);
  }

  /** Import a session from JSON */
  importSession(json: string): Session {
    const session = JSON.parse(json) as Session;
    // Generate new ID to avoid conflicts
    session.id = this.generateId();
    this.sessions.set(session.id, session);
    this.autoPersist();
    return session;
  }

  /** Persist all sessions to disk */
  persist(): void {
    if (!this.persistPath) return;

    try {
      const data = JSON.stringify({
        version: 1,
        activeSessionId: this.activeSessionId,
        sessions: Object.fromEntries(this.sessions),
      });

      // Use globalThis.process for Node.js fs access
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.persistPath, data, 'utf8');
    } catch {
      // Silently fail on persist errors (e.g., browser environment)
    }
  }

  /** Load sessions from disk */
  private loadFromDisk(): void {
    if (!this.persistPath) return;

    try {
      const fs = require('fs');
      if (!fs.existsSync(this.persistPath)) return;

      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const data = JSON.parse(raw);

      if (data.version === 1) {
        this.activeSessionId = data.activeSessionId;
        for (const [id, session] of Object.entries(data.sessions)) {
          this.sessions.set(id, session as Session);
        }
      }
    } catch {
      // Silently fail on load errors
    }
  }

  private autoPersist(): void {
    if (this.persistPath) {
      // Debounced persist
      this.persist();
    }
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }
}

export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  archivedSessions: number;
  totalMessages: number;
  totalTokens: number;
  totalCost: number;
}

// ═══════════════════════════════════════════════════════════════
// CONVERSATION CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Builds optimized LLM context from conversation history.
 * Handles token budgeting, message prioritization, and compression.
 */
export class ConversationContextBuilder {
  private maxTokens: number;
  private reserveTokens: number;

  constructor(config: { maxTokens?: number; reserveTokens?: number } = {}) {
    this.maxTokens = config.maxTokens ?? 100000;
    this.reserveTokens = config.reserveTokens ?? 4000;
  }

  /**
   * Build an optimized message array for LLM context.
   * Prioritizes recent messages, system messages, and tool results.
   */
  build(messages: ConversationMessage[]): ConversationMessage[] {
    const budget = this.maxTokens - this.reserveTokens;
    let tokenCount = 0;

    // Always include system messages
    const system = messages.filter(m => m.role === 'system');
    for (const m of system) {
      tokenCount += this.estimateTokens(m.content);
    }

    // Include messages from most recent, working backwards
    const nonSystem = messages.filter(m => m.role !== 'system');
    const included: ConversationMessage[] = [];

    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const msg = nonSystem[i];
      const msgTokens = this.estimateTokens(msg.content);

      if (tokenCount + msgTokens > budget) break;

      included.unshift(msg);
      tokenCount += msgTokens;
    }

    return [...system, ...included];
  }

  /**
   * Summarize older messages to fit more context.
   */
  summarize(messages: ConversationMessage[], maxLength = 500): string {
    if (messages.length === 0) return '';

    const parts = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const prefix = m.role === 'user' ? 'User' :
                       m.role === 'assistant' ? 'Assistant' : 'Tool';
        const content = m.content.substring(0, 200);
        return `[${prefix}]: ${content}`;
      });

    const summary = parts.join('\n');
    return summary.length > maxLength
      ? summary.substring(0, maxLength) + '...'
      : summary;
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}
