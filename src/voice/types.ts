/**
 * Voice-to-Code Types — CortexOS
 *
 * Type definitions for the voice subsystem: audio capture, transcription,
 * command parsing, and voice-driven code navigation.
 */

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export type VoiceProvider = 'webspeech' | 'whisper' | 'system';

export interface VoiceConfig {
  /** Whether voice features are enabled */
  enabled: boolean;
  /** Language code for speech recognition (e.g. 'en-US') */
  language: string;
  /** Audio sample rate in Hz */
  sampleRate: number;
  /** Speech recognition provider */
  provider: VoiceProvider;
  /** Prefix to trigger commands (e.g. 'cortex') */
  commandPrefix: string;
  /** Whether to continuously listen for commands */
  continuousListening: boolean;
}

// ═══════════════════════════════════════════════════════════════
// PARSED COMMANDS
// ═══════════════════════════════════════════════════════════════

export type CommandIntent =
  | 'execute'
  | 'review'
  | 'navigate'
  | 'edit'
  | 'undo'
  | 'status';

export interface ParsedCommand {
  /** Classified intent of the command */
  intent: CommandIntent;
  /** Target entity (file, function, etc.) */
  target?: string;
  /** Additional parameters extracted from the transcript */
  parameters: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════
// VOICE COMMANDS
// ═══════════════════════════════════════════════════════════════

export interface VoiceCommand {
  /** Unique command identifier */
  id: string;
  /** Raw transcript from speech recognition */
  transcript: string;
  /** Confidence score from the recognizer (0-1) */
  confidence: number;
  /** Unix timestamp (ms) when the command was received */
  timestamp: number;
  /** Parsed command with intent and parameters */
  parsed: ParsedCommand;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface VoiceStats {
  /** Total voice commands received */
  commandsReceived: number;
  /** Total commands successfully parsed */
  commandsParsed: number;
  /** Total commands executed */
  commandsExecuted: number;
  /** Average confidence across all commands */
  avgConfidence: number;
  /** Total error count */
  errors: number;
}
