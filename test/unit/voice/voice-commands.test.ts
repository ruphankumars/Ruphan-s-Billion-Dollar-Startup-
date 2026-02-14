/**
 * VoiceCommandParser — Unit Tests
 *
 * Tests command parsing: intent classification for execute, review,
 * navigate, edit, undo, and status commands. Tests built-in patterns,
 * custom pattern registration, and fallback keyword classification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceCommandParser } from '../../../src/voice/voice-commands.js';

// ── Test suite ────────────────────────────────────────────────

describe('VoiceCommandParser', () => {
  let parser: VoiceCommandParser;

  beforeEach(() => {
    vi.clearAllMocks();
    parser = new VoiceCommandParser();
  });

  // ── parse — null cases ────────────────────────────────────

  describe('parse — null cases', () => {
    it('returns null for empty string', () => {
      expect(parser.parse('')).toBeNull();
    });

    it('returns null for whitespace only', () => {
      expect(parser.parse('   ')).toBeNull();
    });
  });

  // ── Execute commands ──────────────────────────────────────

  describe('execute commands', () => {
    it('parses "run tests"', () => {
      const result = parser.parse('run tests');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
    });

    it('parses "execute build"', () => {
      const result = parser.parse('execute build');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
    });

    it('parses "run the tests for auth"', () => {
      const result = parser.parse('run the tests for auth');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
    });

    it('parses "build the project"', () => {
      const result = parser.parse('build the project');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
    });

    it('parses "build"', () => {
      const result = parser.parse('build');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
    });

    it('parses "deploy to production"', () => {
      const result = parser.parse('deploy to production');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
    });

    it('parses "install lodash"', () => {
      const result = parser.parse('install lodash');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
    });

    it('parses "do something"', () => {
      const result = parser.parse('do something');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
    });
  });

  // ── Review commands ───────────────────────────────────────

  describe('review commands', () => {
    it('parses "review the changes"', () => {
      const result = parser.parse('review the changes');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('review');
    });

    it('parses "check auth module"', () => {
      const result = parser.parse('check auth module');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('review');
    });

    it('parses "explain the algorithm"', () => {
      const result = parser.parse('explain the algorithm');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('review');
    });

    it('parses "what is this function"', () => {
      const result = parser.parse('what is this function');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('review');
    });

    it('parses "show me the errors"', () => {
      const result = parser.parse('show me the errors');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('review');
    });

    it('parses "inspect the code"', () => {
      const result = parser.parse('inspect the code');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('review');
    });

    it('parses "describe the module"', () => {
      const result = parser.parse('describe the module');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('review');
    });
  });

  // ── Navigate commands ─────────────────────────────────────

  describe('navigate commands', () => {
    it('parses "go to auth.ts"', () => {
      const result = parser.parse('go to auth.ts');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('navigate');
      expect(result!.target).toBe('auth.ts');
    });

    it('parses "open the config file"', () => {
      const result = parser.parse('open the config file');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('navigate');
    });

    it('parses "navigate to settings"', () => {
      const result = parser.parse('navigate to settings');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('navigate');
    });

    it('parses "jump to line 42"', () => {
      const result = parser.parse('jump to line 42');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('navigate');
    });

    it('parses "find the login function"', () => {
      const result = parser.parse('find the login function');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('navigate');
    });

    it('parses "search for errors"', () => {
      const result = parser.parse('search for errors');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('navigate');
    });

    it('parses "switch to dashboard"', () => {
      const result = parser.parse('switch to dashboard');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('navigate');
    });
  });

  // ── Edit commands ─────────────────────────────────────────

  describe('edit commands', () => {
    it('parses "edit the config"', () => {
      const result = parser.parse('edit the config');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('edit');
    });

    it('parses "fix the bug in auth"', () => {
      const result = parser.parse('fix the bug in auth');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('edit');
    });

    it('parses "change the variable name"', () => {
      const result = parser.parse('change the variable name');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('edit');
    });

    it('parses "add a new function" as execute (install pattern matches first)', () => {
      // "add" matches the install/add execute pattern before the edit pattern
      const result = parser.parse('add a new function');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
    });

    it('parses "create a component"', () => {
      const result = parser.parse('create a component');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('edit');
    });

    it('parses "remove the old function"', () => {
      const result = parser.parse('remove the old function');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('edit');
    });

    it('parses "delete unused imports"', () => {
      const result = parser.parse('delete unused imports');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('edit');
    });

    it('parses "rename foo to bar"', () => {
      const result = parser.parse('rename foo to bar');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('edit');
      expect(result!.target).toBe('foo');
    });

    it('parses "refactor the module"', () => {
      const result = parser.parse('refactor the module');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('edit');
    });
  });

  // ── Undo commands ─────────────────────────────────────────

  describe('undo commands', () => {
    it('parses "undo"', () => {
      const result = parser.parse('undo');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('undo');
    });

    it('parses "revert changes"', () => {
      const result = parser.parse('revert changes');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('undo');
    });

    it('parses "rollback last commit"', () => {
      const result = parser.parse('rollback last commit');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('undo');
    });

    it('parses "go back"', () => {
      const result = parser.parse('go back');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('undo');
    });

    it('parses "cancel"', () => {
      const result = parser.parse('cancel');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('undo');
    });
  });

  // ── Status commands ───────────────────────────────────────

  describe('status commands', () => {
    it('parses "status"', () => {
      const result = parser.parse('status');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('status');
    });

    it('parses "progress"', () => {
      const result = parser.parse('progress');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('status');
    });

    it('parses "report"', () => {
      const result = parser.parse('report');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('status');
    });

    it('parses "git status"', () => {
      const result = parser.parse('git status');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('status');
    });
  });

  // ── registerPattern ───────────────────────────────────────

  describe('registerPattern', () => {
    it('adds a custom pattern that can be matched', () => {
      parser.registerPattern(
        /^(?:optimize|perf)\s+(.+)$/i,
        'execute',
        { target: (m) => m[1] },
        'Optimize something',
      );

      const result = parser.parse('optimize the database');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
      expect(result!.target).toBe('the database');
    });

    it('emits voice:pattern:registered event', () => {
      const spy = vi.fn();
      parser.on('voice:pattern:registered', spy);

      parser.registerPattern(/^test$/, 'execute');
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── getSupportedCommands ──────────────────────────────────

  describe('getSupportedCommands', () => {
    it('returns all registered command patterns', () => {
      const commands = parser.getSupportedCommands();
      expect(commands.length).toBeGreaterThan(0);
      expect(commands[0]).toHaveProperty('intent');
      expect(commands[0]).toHaveProperty('description');
      expect(commands[0]).toHaveProperty('pattern');
    });
  });

  // ── Fallback keyword classification ───────────────────────

  describe('fallback keyword classification', () => {
    it('classifies by keyword when no pattern matches exactly', () => {
      // A transcript that does not match any regex pattern directly
      // but contains keywords from the execute intent
      const result = parser.parse('please trigger the deployment pipeline now');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
    });

    it('classifies review by keywords', () => {
      const result = parser.parse('can you inspect this carefully');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('review');
    });
  });

  // ── Case insensitivity ────────────────────────────────────

  describe('case insensitivity', () => {
    it('parses uppercase commands', () => {
      const result = parser.parse('RUN TESTS');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('execute');
    });

    it('parses mixed case commands', () => {
      const result = parser.parse('Go To settings');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('navigate');
    });
  });
});
