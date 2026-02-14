/**
 * VoiceCommandParser — Natural Language Command Parsing
 *
 * Parses natural language transcripts into structured commands
 * using regex-based pattern matching with intent classification.
 * Supports built-in patterns and custom user-defined patterns.
 * Zero npm dependencies.
 */

import { EventEmitter } from 'node:events';
import type { CommandIntent, ParsedCommand } from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface CommandPattern {
  /** Regex pattern to match against transcript */
  pattern: RegExp;
  /** Intent to classify the command as */
  intent: CommandIntent;
  /** Functions to extract parameters from regex matches */
  extractors?: Record<string, (match: RegExpMatchArray) => string>;
  /** Human-readable description */
  description: string;
}

// ═══════════════════════════════════════════════════════════════
// VOICE COMMAND PARSER
// ═══════════════════════════════════════════════════════════════

export class VoiceCommandParser extends EventEmitter {
  private patterns: CommandPattern[] = [];

  constructor() {
    super();
    this.registerBuiltinPatterns();
  }

  // ─────────────────────────────────────────────────────────
  // PARSING
  // ─────────────────────────────────────────────────────────

  /**
   * Parse a natural language transcript into a structured command.
   * Returns null if no pattern matches.
   */
  parse(transcript: string): ParsedCommand | null {
    const normalized = transcript.trim().toLowerCase();
    if (!normalized) return null;

    for (const pattern of this.patterns) {
      const match = normalized.match(pattern.pattern);
      if (match) {
        const parameters: Record<string, string> = {};

        // Extract parameters using registered extractors
        if (pattern.extractors) {
          for (const [key, extractor] of Object.entries(pattern.extractors)) {
            try {
              parameters[key] = extractor(match);
            } catch {
              // Skip failed extractions
            }
          }
        }

        // Extract target from first capture group if present
        const target = match[1]?.trim() || undefined;

        return {
          intent: pattern.intent,
          target,
          parameters,
        };
      }
    }

    // Fallback: try to classify by keywords
    return this.classifyByKeywords(normalized);
  }

  // ─────────────────────────────────────────────────────────
  // PATTERN REGISTRATION
  // ─────────────────────────────────────────────────────────

  /**
   * Register a custom voice command pattern.
   */
  registerPattern(
    pattern: RegExp,
    intent: CommandIntent,
    extractors?: Record<string, (match: RegExpMatchArray) => string>,
    description?: string,
  ): void {
    this.patterns.push({
      pattern,
      intent,
      extractors,
      description: description ?? `Custom pattern: ${pattern.source}`,
    });

    this.emit('voice:pattern:registered', {
      timestamp: Date.now(),
      intent,
      pattern: pattern.source,
    });
  }

  /**
   * Get all supported commands with their descriptions.
   */
  getSupportedCommands(): Array<{ intent: CommandIntent; description: string; pattern: string }> {
    return this.patterns.map((p) => ({
      intent: p.intent,
      description: p.description,
      pattern: p.pattern.source,
    }));
  }

  // ─────────────────────────────────────────────────────────
  // BUILT-IN PATTERNS
  // ─────────────────────────────────────────────────────────

  private registerBuiltinPatterns(): void {
    // ── Execute commands ──

    this.patterns.push({
      pattern: /^(?:run|execute|do|perform)\s+(.+)$/i,
      intent: 'execute',
      extractors: {
        command: (m) => m[1],
      },
      description: 'Execute a command (e.g., "run tests", "execute build")',
    });

    this.patterns.push({
      pattern: /^(?:run|execute)\s+(?:the\s+)?(?:test|tests|test suite)(?:\s+(?:for|in|on)\s+(.+))?$/i,
      intent: 'execute',
      extractors: {
        type: () => 'test',
        scope: (m) => m[1] ?? '',
      },
      description: 'Run tests (e.g., "run tests", "run tests for auth")',
    });

    this.patterns.push({
      pattern: /^(?:build|compile|bundle)\s*(.*)$/i,
      intent: 'execute',
      extractors: {
        type: () => 'build',
        target: (m) => m[1] ?? '',
      },
      description: 'Build/compile (e.g., "build the project", "compile")',
    });

    this.patterns.push({
      pattern: /^(?:install|add)\s+(?:package|dependency|dep)?\s*(.+)$/i,
      intent: 'execute',
      extractors: {
        type: () => 'install',
        package: (m) => m[1],
      },
      description: 'Install a package (e.g., "install lodash", "add dependency express")',
    });

    this.patterns.push({
      pattern: /^(?:deploy|ship|publish|release)\s*(.*)$/i,
      intent: 'execute',
      extractors: {
        type: () => 'deploy',
        target: (m) => m[1] ?? '',
      },
      description: 'Deploy/publish (e.g., "deploy to production", "ship it")',
    });

    // ── Review commands ──

    this.patterns.push({
      pattern: /^(?:review|check|inspect|look at|examine)\s+(.+)$/i,
      intent: 'review',
      extractors: {
        target: (m) => m[1],
      },
      description: 'Review code (e.g., "review the changes", "check auth module")',
    });

    this.patterns.push({
      pattern: /^(?:what is|what's|explain|describe|tell me about)\s+(.+)$/i,
      intent: 'review',
      extractors: {
        target: (m) => m[1],
        type: () => 'explain',
      },
      description: 'Ask about code (e.g., "what is this function", "explain the algorithm")',
    });

    this.patterns.push({
      pattern: /^(?:show me|display|list)\s+(.+)$/i,
      intent: 'review',
      extractors: {
        target: (m) => m[1],
        type: () => 'show',
      },
      description: 'Show information (e.g., "show me the errors", "list all files")',
    });

    // ── Navigate commands ──

    this.patterns.push({
      pattern: /^(?:go to|open|navigate to|jump to|switch to)\s+(.+)$/i,
      intent: 'navigate',
      extractors: {
        target: (m) => m[1],
      },
      description: 'Navigate to (e.g., "go to auth.ts", "open the config file")',
    });

    this.patterns.push({
      pattern: /^(?:find|search|search for|locate|where is)\s+(.+)$/i,
      intent: 'navigate',
      extractors: {
        target: (m) => m[1],
        type: () => 'search',
      },
      description: 'Find/search (e.g., "find the login function", "search for errors")',
    });

    // ── Edit commands ──

    this.patterns.push({
      pattern: /^(?:edit|change|modify|update|fix|refactor)\s+(.+)$/i,
      intent: 'edit',
      extractors: {
        target: (m) => m[1],
      },
      description: 'Edit code (e.g., "edit the config", "fix the bug in auth")',
    });

    this.patterns.push({
      pattern: /^(?:add|create|insert|new)\s+(.+)$/i,
      intent: 'edit',
      extractors: {
        target: (m) => m[1],
        type: () => 'add',
      },
      description: 'Add new code (e.g., "add a new function", "create a component")',
    });

    this.patterns.push({
      pattern: /^(?:remove|delete|drop)\s+(.+)$/i,
      intent: 'edit',
      extractors: {
        target: (m) => m[1],
        type: () => 'remove',
      },
      description: 'Remove code (e.g., "remove the old function", "delete unused imports")',
    });

    this.patterns.push({
      pattern: /^(?:rename|move)\s+(.+?)(?:\s+to\s+(.+))?$/i,
      intent: 'edit',
      extractors: {
        target: (m) => m[1],
        newName: (m) => m[2] ?? '',
        type: () => 'rename',
      },
      description: 'Rename/move (e.g., "rename foo to bar", "move utils to helpers")',
    });

    // ── Undo commands ──

    this.patterns.push({
      pattern: /^(?:undo|revert|rollback|go back|cancel)(?:\s+(.+))?$/i,
      intent: 'undo',
      extractors: {
        target: (m) => m[1] ?? '',
      },
      description: 'Undo (e.g., "undo", "revert changes", "rollback last commit")',
    });

    // ── Status commands ──

    this.patterns.push({
      pattern: /^(?:status|state|how are things|what's happening|progress|report)$/i,
      intent: 'status',
      description: 'Check status (e.g., "status", "progress", "report")',
    });

    this.patterns.push({
      pattern: /^(?:git\s+)?status$/i,
      intent: 'status',
      extractors: {
        type: () => 'git',
      },
      description: 'Git status',
    });
  }

  // ─────────────────────────────────────────────────────────
  // FALLBACK CLASSIFICATION
  // ─────────────────────────────────────────────────────────

  /**
   * Classify by keywords when no pattern matches exactly.
   */
  private classifyByKeywords(transcript: string): ParsedCommand | null {
    const words = transcript.split(/\s+/);

    const intentKeywords: Record<CommandIntent, string[]> = {
      execute: ['run', 'execute', 'do', 'start', 'launch', 'trigger', 'build', 'compile', 'deploy', 'test', 'install'],
      review: ['review', 'check', 'look', 'inspect', 'show', 'display', 'what', 'how', 'explain', 'describe', 'list'],
      navigate: ['go', 'open', 'navigate', 'jump', 'find', 'search', 'where', 'locate', 'switch'],
      edit: ['edit', 'change', 'modify', 'update', 'fix', 'refactor', 'add', 'create', 'remove', 'delete', 'rename'],
      undo: ['undo', 'revert', 'rollback', 'cancel', 'back'],
      status: ['status', 'state', 'progress', 'report'],
    };

    let bestIntent: CommandIntent | null = null;
    let bestScore = 0;

    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      let score = 0;
      for (const word of words) {
        if (keywords.includes(word)) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent as CommandIntent;
      }
    }

    if (bestIntent && bestScore > 0) {
      return {
        intent: bestIntent,
        target: words.slice(1).join(' ') || undefined,
        parameters: { raw: transcript },
      };
    }

    return null;
  }
}
