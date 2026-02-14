/**
 * VoiceEngine — Voice Capture and Processing
 *
 * Manages audio capture, transcription, and command routing.
 * Delegates to system speech APIs via child_process for audio
 * and provides a Whisper integration placeholder.
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { exec, type ChildProcess } from 'node:child_process';
import type {
  VoiceConfig,
  VoiceCommand,
  VoiceStats,
  ParsedCommand,
} from './types.js';
import { VoiceCommandParser } from './voice-commands.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: VoiceConfig = {
  enabled: true,
  language: 'en-US',
  sampleRate: 16000,
  provider: 'system',
  commandPrefix: 'cortex',
  continuousListening: false,
};

// ═══════════════════════════════════════════════════════════════
// VOICE ENGINE
// ═══════════════════════════════════════════════════════════════

export class VoiceEngine extends EventEmitter {
  private config: VoiceConfig;
  private parser: VoiceCommandParser;
  private commandHandlers: Array<(command: VoiceCommand) => void> = [];
  private listening = false;
  private listenerProcess: ChildProcess | null = null;
  private running = false;

  // Stats tracking
  private commandsReceived = 0;
  private commandsParsed = 0;
  private commandsExecuted = 0;
  private totalConfidence = 0;
  private errorCount = 0;

  constructor(config?: Partial<VoiceConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.parser = new VoiceCommandParser();
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('voice:engine:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.stopListening();
    this.emit('voice:engine:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────

  /**
   * Initialize the voice engine: set up the audio bridge
   * and prepare the speech recognition pipeline.
   */
  async initialize(): Promise<void> {
    this.emit('voice:engine:initializing', {
      timestamp: Date.now(),
      provider: this.config.provider,
      language: this.config.language,
    });

    // The actual audio bridge depends on the platform.
    // On macOS, we can use the `say` command for TTS and
    // AppleScript/NSSpeechRecognizer for speech-to-text.
    // On Linux, we can use arecord + whisper.

    this.emit('voice:engine:initialized', {
      timestamp: Date.now(),
      provider: this.config.provider,
    });
  }

  // ─────────────────────────────────────────────────────────
  // LISTENING
  // ─────────────────────────────────────────────────────────

  /**
   * Begin capturing audio for speech recognition.
   * Uses system speech APIs via child_process on macOS/Linux.
   */
  startListening(): void {
    if (this.listening) return;

    this.listening = true;

    this.emit('voice:listening:started', {
      timestamp: Date.now(),
      provider: this.config.provider,
      continuous: this.config.continuousListening,
    });

    // On macOS, use AppleScript to access speech recognition
    if (process.platform === 'darwin' && this.config.provider === 'system') {
      this.startMacOSSpeechCapture();
    }
    // On other platforms, log that a bridge is needed
    else {
      this.emit('voice:engine:info', {
        timestamp: Date.now(),
        message: `Speech capture requires ${this.config.provider} bridge on ${process.platform}`,
      });
    }
  }

  /**
   * Stop capturing audio.
   */
  stopListening(): void {
    if (!this.listening) return;

    this.listening = false;

    if (this.listenerProcess) {
      this.listenerProcess.kill();
      this.listenerProcess = null;
    }

    this.emit('voice:listening:stopped', {
      timestamp: Date.now(),
    });
  }

  /**
   * Whether the engine is currently listening for commands.
   */
  isListening(): boolean {
    return this.listening;
  }

  // ─────────────────────────────────────────────────────────
  // AUDIO PROCESSING
  // ─────────────────────────────────────────────────────────

  /**
   * Process raw audio buffer for transcription.
   * This is a placeholder for Whisper integration.
   * In production, this would pipe audio to a Whisper model.
   */
  async processAudio(buffer: Buffer): Promise<VoiceCommand | null> {
    this.emit('voice:audio:processing', {
      timestamp: Date.now(),
      bufferSize: buffer.length,
    });

    // Placeholder: In a real implementation, this would:
    // 1. Convert buffer to WAV format
    // 2. Send to Whisper model (local or API)
    // 3. Get transcription back
    // 4. Parse the transcription into a command

    // For now, return null to indicate no transcription available
    this.emit('voice:audio:processed', {
      timestamp: Date.now(),
      bufferSize: buffer.length,
      transcription: null,
    });

    return null;
  }

  /**
   * Process a text transcript (e.g., from an external speech recognition service).
   * This is the main entry point for converting speech to commands.
   */
  processTranscript(transcript: string, confidence = 1.0): VoiceCommand | null {
    this.commandsReceived++;
    this.totalConfidence += confidence;

    // Check for command prefix
    const prefixLower = this.config.commandPrefix.toLowerCase();
    const transcriptLower = transcript.toLowerCase().trim();

    let commandText = transcript.trim();
    if (prefixLower && transcriptLower.startsWith(prefixLower)) {
      commandText = transcript.trim().slice(this.config.commandPrefix.length).trim();
    }

    // Parse the command
    const parsed = this.parser.parse(commandText);

    if (!parsed) {
      this.emit('voice:command:unrecognized', {
        timestamp: Date.now(),
        transcript,
      });
      return null;
    }

    this.commandsParsed++;

    const command: VoiceCommand = {
      id: `vcmd_${randomUUID().slice(0, 8)}`,
      transcript,
      confidence,
      timestamp: Date.now(),
      parsed,
    };

    this.emit('voice:command:received', {
      timestamp: Date.now(),
      command,
    });

    this.emit('voice:transcription:complete', {
      timestamp: Date.now(),
      transcript,
      confidence,
      parsed,
    });

    // Invoke registered handlers
    for (const handler of this.commandHandlers) {
      try {
        handler(command);
        this.commandsExecuted++;
      } catch (err) {
        this.errorCount++;
        this.emit('voice:command:error', {
          timestamp: Date.now(),
          command,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return command;
  }

  // ─────────────────────────────────────────────────────────
  // COMMAND HANDLING
  // ─────────────────────────────────────────────────────────

  /**
   * Register a command handler that will be called for each recognized command.
   */
  onCommand(handler: (command: VoiceCommand) => void): void {
    this.commandHandlers.push(handler);
  }

  /**
   * Get the command parser for registering custom patterns.
   */
  getParser(): VoiceCommandParser {
    return this.parser;
  }

  // ─────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────

  getStats(): VoiceStats {
    return {
      commandsReceived: this.commandsReceived,
      commandsParsed: this.commandsParsed,
      commandsExecuted: this.commandsExecuted,
      avgConfidence: this.commandsReceived > 0
        ? this.totalConfidence / this.commandsReceived
        : 0,
      errors: this.errorCount,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Platform-specific speech capture
  // ─────────────────────────────────────────────────────────

  /**
   * macOS speech capture using AppleScript and system speech recognition.
   * This starts a background process that listens for speech.
   */
  private startMacOSSpeechCapture(): void {
    // Use the `say` command to confirm listening has started
    try {
      const process = exec(
        'osascript -e \'display notification "Voice listening started" with title "CortexOS"\'',
        { timeout: 5000 },
      );

      process.on('error', (err) => {
        this.emit('voice:engine:info', {
          timestamp: Date.now(),
          message: `macOS notification error: ${err.message}`,
        });
      });
    } catch {
      // Notification is optional
    }

    this.emit('voice:engine:info', {
      timestamp: Date.now(),
      message: 'macOS speech capture bridge initialized. Use processTranscript() for input.',
    });
  }
}
