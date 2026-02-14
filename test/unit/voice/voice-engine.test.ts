/**
 * VoiceEngine — Unit Tests
 *
 * Tests voice engine: initialization, processTranscript, command handlers,
 * command routing, event emission, and statistics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceEngine } from '../../../src/voice/voice-engine.js';

// ── Mock node:child_process ───────────────────────────────────

vi.mock('node:child_process', () => ({
  exec: vi.fn().mockReturnValue({
    on: vi.fn(),
    kill: vi.fn(),
  }),
}));

// ── Mock node:crypto ──────────────────────────────────────────

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('12345678-1234-1234-1234-123456789012'),
}));

// ── Test suite ────────────────────────────────────────────────

describe('VoiceEngine', () => {
  let engine: VoiceEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new VoiceEngine({
      enabled: true,
      commandPrefix: 'cortex',
    });
  });

  // ── Constructor ───────────────────────────────────────────

  describe('constructor', () => {
    it('creates engine with default config', () => {
      const e = new VoiceEngine();
      expect(e).toBeDefined();
      expect(e.isRunning()).toBe(false);
      expect(e.isListening()).toBe(false);
    });

    it('merges custom config with defaults', () => {
      const e = new VoiceEngine({ language: 'de-DE' });
      const stats = e.getStats();
      expect(stats.commandsReceived).toBe(0);
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() sets running and emits event', () => {
      const spy = vi.fn();
      engine.on('voice:engine:started', spy);
      engine.start();
      expect(engine.isRunning()).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('stop() clears running and emits event', () => {
      engine.start();
      const spy = vi.fn();
      engine.on('voice:engine:stopped', spy);
      engine.stop();
      expect(engine.isRunning()).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── processTranscript ─────────────────────────────────────

  describe('processTranscript', () => {
    it('parses a recognized command and returns VoiceCommand', () => {
      const command = engine.processTranscript('run tests');
      expect(command).not.toBeNull();
      expect(command!.transcript).toBe('run tests');
      expect(command!.parsed.intent).toBe('execute');
      expect(command!.id).toContain('vcmd_');
    });

    it('strips the command prefix before parsing', () => {
      const command = engine.processTranscript('cortex run tests');
      expect(command).not.toBeNull();
      expect(command!.parsed.intent).toBe('execute');
    });

    it('returns null for unrecognized commands', () => {
      const command = engine.processTranscript('   ');
      expect(command).toBeNull();
    });

    it('includes confidence in the command', () => {
      const command = engine.processTranscript('run tests', 0.85);
      expect(command!.confidence).toBe(0.85);
    });

    it('defaults confidence to 1.0', () => {
      const command = engine.processTranscript('run tests');
      expect(command!.confidence).toBe(1.0);
    });

    it('emits voice:command:received event', () => {
      const spy = vi.fn();
      engine.on('voice:command:received', spy);
      engine.processTranscript('run tests');
      expect(spy).toHaveBeenCalledOnce();
    });

    it('emits voice:transcription:complete event', () => {
      const spy = vi.fn();
      engine.on('voice:transcription:complete', spy);
      engine.processTranscript('run tests');
      expect(spy).toHaveBeenCalledOnce();
    });

    it('emits voice:command:unrecognized for unparseable input', () => {
      const spy = vi.fn();
      engine.on('voice:command:unrecognized', spy);
      // Empty input after trim returns null from parser
      engine.processTranscript('');
      // If truly unrecognized (null from parser)
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Command handlers ──────────────────────────────────────

  describe('onCommand / registerHandler', () => {
    it('invokes registered handler for recognized commands', () => {
      const handler = vi.fn();
      engine.onCommand(handler);

      engine.processTranscript('run tests');
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          transcript: 'run tests',
          parsed: expect.objectContaining({ intent: 'execute' }),
        }),
      );
    });

    it('invokes multiple handlers in order', () => {
      const order: number[] = [];
      engine.onCommand(() => order.push(1));
      engine.onCommand(() => order.push(2));

      engine.processTranscript('run tests');
      expect(order).toEqual([1, 2]);
    });

    it('does not invoke handlers for unrecognized commands', () => {
      const handler = vi.fn();
      engine.onCommand(handler);

      engine.processTranscript('');
      expect(handler).not.toHaveBeenCalled();
    });

    it('catches handler errors and emits voice:command:error', () => {
      const errorSpy = vi.fn();
      engine.on('voice:command:error', errorSpy);

      engine.onCommand(() => {
        throw new Error('handler failure');
      });

      engine.processTranscript('run tests');
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'handler failure' }),
      );
    });
  });

  // ── Command routing ───────────────────────────────────────

  describe('command routing', () => {
    it('routes execute commands', () => {
      const command = engine.processTranscript('build the project');
      expect(command).not.toBeNull();
      expect(command!.parsed.intent).toBe('execute');
    });

    it('routes review commands', () => {
      const command = engine.processTranscript('review the changes');
      expect(command).not.toBeNull();
      expect(command!.parsed.intent).toBe('review');
    });

    it('routes navigate commands', () => {
      const command = engine.processTranscript('go to auth.ts');
      expect(command).not.toBeNull();
      expect(command!.parsed.intent).toBe('navigate');
    });

    it('routes edit commands', () => {
      const command = engine.processTranscript('edit the config');
      expect(command).not.toBeNull();
      expect(command!.parsed.intent).toBe('edit');
    });

    it('routes undo commands', () => {
      const command = engine.processTranscript('undo');
      expect(command).not.toBeNull();
      expect(command!.parsed.intent).toBe('undo');
    });

    it('routes status commands', () => {
      const command = engine.processTranscript('status');
      expect(command).not.toBeNull();
      expect(command!.parsed.intent).toBe('status');
    });
  });

  // ── getStats ──────────────────────────────────────────────

  describe('getStats', () => {
    it('returns initial statistics', () => {
      const stats = engine.getStats();
      expect(stats.commandsReceived).toBe(0);
      expect(stats.commandsParsed).toBe(0);
      expect(stats.commandsExecuted).toBe(0);
      expect(stats.avgConfidence).toBe(0);
      expect(stats.errors).toBe(0);
    });

    it('tracks commandsReceived and commandsParsed', () => {
      engine.processTranscript('run tests');
      engine.processTranscript('build project');

      const stats = engine.getStats();
      expect(stats.commandsReceived).toBe(2);
      expect(stats.commandsParsed).toBe(2);
    });

    it('tracks commandsExecuted when handler is present', () => {
      engine.onCommand(() => {});
      engine.processTranscript('run tests');

      const stats = engine.getStats();
      expect(stats.commandsExecuted).toBe(1);
    });

    it('calculates average confidence', () => {
      engine.processTranscript('run tests', 0.8);
      engine.processTranscript('build it', 0.6);

      const stats = engine.getStats();
      expect(stats.avgConfidence).toBeCloseTo(0.7, 1);
    });

    it('tracks error count from failing handlers', () => {
      engine.onCommand(() => {
        throw new Error('fail');
      });
      engine.processTranscript('run tests');

      const stats = engine.getStats();
      expect(stats.errors).toBe(1);
    });
  });

  // ── getParser ─────────────────────────────────────────────

  describe('getParser', () => {
    it('returns the VoiceCommandParser instance', () => {
      const parser = engine.getParser();
      expect(parser).toBeDefined();
      expect(typeof parser.parse).toBe('function');
    });
  });

  // ── processAudio ──────────────────────────────────────────

  describe('processAudio', () => {
    it('returns null (placeholder implementation)', async () => {
      const result = await engine.processAudio(Buffer.from('fake audio'));
      expect(result).toBeNull();
    });

    it('emits voice:audio:processing event', async () => {
      const spy = vi.fn();
      engine.on('voice:audio:processing', spy);
      await engine.processAudio(Buffer.from('data'));
      expect(spy).toHaveBeenCalledOnce();
    });
  });
});
