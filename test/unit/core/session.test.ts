import { describe, it, expect, beforeEach } from 'vitest';
import {
  SessionManager,
  ConversationContextBuilder,
  type Session,
} from '../../../src/core/session.js';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({ maxMessages: 100 });
  });

  // ─── Session Lifecycle ───────────────────────────────────────

  describe('createSession', () => {
    it('should create a session with defaults', () => {
      const session = manager.createSession();
      expect(session.id).toBeTruthy();
      expect(session.title).toContain('Session');
      expect(session.status).toBe('active');
      expect(session.messages).toHaveLength(0);
      expect(session.metadata.totalTokens).toBe(0);
      expect(session.metadata.totalCost).toBe(0);
      expect(session.metadata.tags).toEqual([]);
    });

    it('should create a session with custom title', () => {
      const session = manager.createSession('My Session');
      expect(session.title).toBe('My Session');
    });

    it('should create a session with custom metadata', () => {
      const session = manager.createSession('Test', { tags: ['test', 'debug'] });
      expect(session.metadata.tags).toEqual(['test', 'debug']);
    });

    it('should set the new session as active', () => {
      const session = manager.createSession();
      const active = manager.getOrCreateActiveSession();
      expect(active.id).toBe(session.id);
    });
  });

  describe('getOrCreateActiveSession', () => {
    it('should create a session if none exists', () => {
      const session = manager.getOrCreateActiveSession();
      expect(session).toBeDefined();
      expect(session.status).toBe('active');
    });

    it('should return existing active session', () => {
      const first = manager.getOrCreateActiveSession();
      const second = manager.getOrCreateActiveSession();
      expect(first.id).toBe(second.id);
    });
  });

  describe('setActiveSession', () => {
    it('should switch to an existing session', () => {
      const s1 = manager.createSession('S1');
      const s2 = manager.createSession('S2');
      manager.setActiveSession(s1.id);
      const active = manager.getOrCreateActiveSession();
      expect(active.id).toBe(s1.id);
    });

    it('should throw for unknown session ID', () => {
      expect(() => manager.setActiveSession('nonexistent')).toThrow('not found');
    });
  });

  describe('completeSession', () => {
    it('should mark a session as completed', () => {
      const session = manager.createSession();
      manager.completeSession(session.id);
      const updated = manager.getSession(session.id);
      expect(updated?.status).toBe('completed');
    });

    it('should clear active session if it was active', () => {
      const session = manager.createSession();
      manager.completeSession();
      // Should create a new one since active was cleared
      const next = manager.getOrCreateActiveSession();
      expect(next.id).not.toBe(session.id);
    });
  });

  describe('archiveSession', () => {
    it('should archive a session', () => {
      const session = manager.createSession();
      manager.archiveSession(session.id);
      expect(manager.getSession(session.id)?.status).toBe('archived');
    });
  });

  describe('forkSession', () => {
    it('should fork a session with all messages', () => {
      const session = manager.createSession('Original');
      manager.addMessage('Hello', 'user');
      manager.addMessage('Hi!', 'assistant');

      const fork = manager.forkSession(session.id);
      expect(fork.title).toContain('Fork of Original');
      expect(fork.messages).toHaveLength(2);
      expect(fork.metadata.parentSessionId).toBe(session.id);
      expect(fork.metadata.tags).toContain('fork');
    });

    it('should fork up to a specific message index', () => {
      const session = manager.createSession();
      manager.addMessage('Msg 1', 'user');
      manager.addMessage('Msg 2', 'assistant');
      manager.addMessage('Msg 3', 'user');

      const fork = manager.forkSession(session.id, 1);
      expect(fork.messages).toHaveLength(2);
    });

    it('should fork with new message IDs', () => {
      const session = manager.createSession();
      manager.addMessage('Hello', 'user');

      const fork = manager.forkSession(session.id);
      expect(fork.messages[0].id).not.toBe(session.messages[0].id);
    });

    it('should throw for unknown session', () => {
      expect(() => manager.forkSession('nonexistent')).toThrow('not found');
    });
  });

  // ─── Message Management ──────────────────────────────────────

  describe('addMessage', () => {
    it('should add a message to the active session', () => {
      manager.createSession();
      const msg = manager.addMessage('Hello', 'user');

      expect(msg.id).toBeTruthy();
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('should update session metadata', () => {
      const session = manager.createSession();
      manager.addMessage('Hello', 'user', { tokenCount: 10, cost: 0.001 });

      expect(session.metadata.messageCount).toBe(1);
      expect(session.metadata.totalTokens).toBe(10);
      expect(session.metadata.totalCost).toBeCloseTo(0.001);
    });

    it('should enforce max messages', () => {
      const small = new SessionManager({ maxMessages: 5 });
      small.createSession();

      for (let i = 0; i < 10; i++) {
        small.addMessage(`Message ${i}`, 'user');
      }

      const history = small.getConversationHistory();
      expect(history.length).toBeLessThanOrEqual(5);
    });

    it('should preserve system messages during trimming', () => {
      const small = new SessionManager({ maxMessages: 3 });
      small.createSession();
      small.addMessage('System prompt', 'system');

      for (let i = 0; i < 5; i++) {
        small.addMessage(`User ${i}`, 'user');
      }

      const history = small.getConversationHistory();
      expect(history.some(m => m.role === 'system')).toBe(true);
    });
  });

  describe('addMessageToSession', () => {
    it('should throw for unknown session', () => {
      expect(() => manager.addMessageToSession('bad', 'hi', 'user')).toThrow('not found');
    });
  });

  describe('getConversationHistory', () => {
    it('should return all messages', () => {
      manager.createSession();
      manager.addMessage('A', 'user');
      manager.addMessage('B', 'assistant');

      const history = manager.getConversationHistory();
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('A');
      expect(history[1].content).toBe('B');
    });

    it('should support limit parameter', () => {
      manager.createSession();
      for (let i = 0; i < 10; i++) {
        manager.addMessage(`Msg ${i}`, 'user');
      }

      const history = manager.getConversationHistory(undefined, 3);
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('Msg 7');
    });

    it('should return empty array when no active session', () => {
      const empty = new SessionManager();
      expect(empty.getConversationHistory()).toEqual([]);
    });
  });

  describe('searchMessages', () => {
    it('should find messages by content', () => {
      manager.createSession('S1');
      manager.addMessage('TypeScript is great', 'user');
      manager.addMessage('I agree about TypeScript', 'assistant');
      manager.addMessage('What about Python?', 'user');

      const results = manager.searchMessages('TypeScript');
      expect(results).toHaveLength(2);
    });

    it('should filter by role', () => {
      manager.createSession();
      manager.addMessage('Hello', 'user');
      manager.addMessage('Hi there', 'assistant');

      const results = manager.searchMessages('', { role: 'assistant' });
      expect(results.every(r => r.message.role === 'assistant')).toBe(true);
    });

    it('should respect limit', () => {
      manager.createSession();
      for (let i = 0; i < 20; i++) {
        manager.addMessage(`test ${i}`, 'user');
      }

      const results = manager.searchMessages('test', { limit: 5 });
      expect(results).toHaveLength(5);
    });

    it('should search across sessions', () => {
      manager.createSession('S1');
      manager.addMessage('Alpha in session 1', 'user');

      manager.createSession('S2');
      manager.addMessage('Alpha in session 2', 'user');

      const results = manager.searchMessages('Alpha');
      expect(results).toHaveLength(2);
    });
  });

  // ─── Session Queries ────────────────────────────────────────

  describe('listSessions', () => {
    it('should list all sessions', () => {
      manager.createSession('A');
      manager.createSession('B');
      manager.createSession('C');

      const list = manager.listSessions();
      expect(list).toHaveLength(3);
    });

    it('should filter by status', () => {
      const s1 = manager.createSession('Active');
      const s2 = manager.createSession('Done');
      manager.completeSession(s2.id);

      const active = manager.listSessions({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].title).toBe('Active');
    });

    it('should filter by tags', () => {
      manager.createSession('A', { tags: ['debug'] });
      manager.createSession('B', { tags: ['prod'] });

      const debug = manager.listSessions({ tags: ['debug'] });
      expect(debug).toHaveLength(1);
      expect(debug[0].title).toBe('A');
    });

    it('should search by title', () => {
      manager.createSession('Auth Feature');
      manager.createSession('DB Migration');

      const results = manager.listSessions({ search: 'auth' });
      expect(results).toHaveLength(1);
    });

    it('should support pagination', () => {
      for (let i = 0; i < 10; i++) {
        manager.createSession(`Session ${i}`);
      }

      const page = manager.listSessions({ offset: 2, limit: 3 });
      expect(page).toHaveLength(3);
    });

    it('should sort by updatedAt descending', () => {
      const s1 = manager.createSession('Old');
      // Force s1 to have an older updatedAt
      s1.updatedAt = Date.now() - 10000;
      const s2 = manager.createSession('New');
      s2.updatedAt = Date.now();

      const list = manager.listSessions();
      expect(list[0].id).toBe(s2.id);
    });
  });

  describe('getStats', () => {
    it('should return aggregate stats', () => {
      const s1 = manager.createSession();
      manager.addMessage('Hello', 'user', { tokenCount: 100, cost: 0.01 });

      const s2 = manager.createSession();
      manager.addMessage('World', 'user', { tokenCount: 200, cost: 0.02 });
      manager.completeSession(s2.id);

      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(2);
      expect(stats.activeSessions).toBe(1);
      expect(stats.completedSessions).toBe(1);
      expect(stats.totalMessages).toBe(2);
      expect(stats.totalTokens).toBe(300);
      expect(stats.totalCost).toBeCloseTo(0.03);
    });
  });

  // ─── Persistence ────────────────────────────────────────────

  describe('exportSession / importSession', () => {
    it('should export a session as JSON', () => {
      const session = manager.createSession('Export Test');
      manager.addMessage('Hello', 'user');

      const json = manager.exportSession(session.id);
      const parsed = JSON.parse(json);
      expect(parsed.title).toBe('Export Test');
      expect(parsed.messages).toHaveLength(1);
    });

    it('should import a session from JSON', () => {
      const session = manager.createSession('Import Source');
      manager.addMessage('Data', 'user');
      const json = manager.exportSession(session.id);

      const imported = manager.importSession(json);
      expect(imported.title).toBe('Import Source');
      expect(imported.messages).toHaveLength(1);
      // New ID assigned
      expect(imported.id).not.toBe(session.id);
    });

    it('should throw when exporting unknown session', () => {
      expect(() => manager.exportSession('nonexistent')).toThrow('not found');
    });
  });
});

describe('ConversationContextBuilder', () => {
  const builder = new ConversationContextBuilder({ maxTokens: 1000, reserveTokens: 100 });

  it('should include system messages first', () => {
    const messages = [
      { id: '1', role: 'system' as const, content: 'You are a helpful assistant', timestamp: 1 },
      { id: '2', role: 'user' as const, content: 'Hello', timestamp: 2 },
      { id: '3', role: 'assistant' as const, content: 'Hi!', timestamp: 3 },
    ];

    const result = builder.build(messages);
    expect(result[0].role).toBe('system');
    expect(result.length).toBe(3);
  });

  it('should prioritize recent messages', () => {
    const messages = [];
    for (let i = 0; i < 100; i++) {
      messages.push({
        id: String(i),
        role: 'user' as const,
        content: `Message ${i} with some content to use tokens`,
        timestamp: i,
      });
    }

    const result = builder.build(messages);
    // Should include fewer than all 100 messages due to token budget
    expect(result.length).toBeLessThan(100);
    // Last message should be the most recent
    expect(result[result.length - 1].content).toContain('Message 99');
  });

  it('should respect token budget', () => {
    const tinyBuilder = new ConversationContextBuilder({ maxTokens: 100, reserveTokens: 20 });
    const messages = [
      { id: '1', role: 'user' as const, content: 'A'.repeat(400), timestamp: 1 },
      { id: '2', role: 'user' as const, content: 'Short', timestamp: 2 },
    ];

    const result = tinyBuilder.build(messages);
    // Should include the short message but not the very long one
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  describe('summarize', () => {
    it('should summarize conversation history', () => {
      const messages = [
        { id: '1', role: 'user' as const, content: 'Fix the bug in auth', timestamp: 1 },
        { id: '2', role: 'assistant' as const, content: 'I found the issue in login.ts', timestamp: 2 },
      ];

      const summary = builder.summarize(messages);
      expect(summary).toContain('User');
      expect(summary).toContain('Assistant');
      expect(summary).toContain('auth');
    });

    it('should truncate long summaries', () => {
      const messages = [];
      for (let i = 0; i < 50; i++) {
        messages.push({
          id: String(i),
          role: 'user' as const,
          content: `Long message ${i}: ${'x'.repeat(200)}`,
          timestamp: i,
        });
      }

      const summary = builder.summarize(messages, 500);
      expect(summary.length).toBeLessThanOrEqual(503); // 500 + "..."
    });

    it('should return empty string for no messages', () => {
      expect(builder.summarize([])).toBe('');
    });

    it('should skip system messages in summary', () => {
      const messages = [
        { id: '1', role: 'system' as const, content: 'System prompt', timestamp: 1 },
        { id: '2', role: 'user' as const, content: 'Hello', timestamp: 2 },
      ];

      const summary = builder.summarize(messages);
      expect(summary).not.toContain('System prompt');
      expect(summary).toContain('User');
    });
  });
});
