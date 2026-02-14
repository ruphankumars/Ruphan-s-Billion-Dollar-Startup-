/**
 * Sovereign / Air-Gap Mode Types — CortexOS
 *
 * Type definitions for offline-capable, air-gapped operation using
 * local models (Ollama), offline tools, and connectivity detection.
 */

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface SovereignConfig {
  /** Whether sovereign mode is enabled */
  enabled: boolean;
  /** Ollama API base URL */
  ollamaUrl: string;
  /** Default Ollama model to use */
  defaultModel: string;
  /** Fallback models in priority order */
  fallbackModels: string[];
  /** Directory containing offline tool definitions */
  offlineToolsDir: string;
  /** Model to use for embeddings */
  embeddingModel: string;
  /** Maximum context tokens for local models */
  maxContextTokens: number;
  /** Whether to periodically check connectivity */
  checkConnectivity: boolean;
}

// ═══════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════

export type SovereignMode = 'online' | 'offline' | 'hybrid';

export interface SovereignStatus {
  /** Current operating mode */
  mode: SovereignMode;
  /** List of available provider names */
  providersAvailable: string[];
  /** List of available offline tool names */
  toolsAvailable: string[];
  /** Whether a local model is loaded and ready */
  modelLoaded: boolean;
  /** Unix timestamp (ms) of last connectivity check */
  lastConnectivityCheck: number;
}

// ═══════════════════════════════════════════════════════════════
// OFFLINE TOOLS
// ═══════════════════════════════════════════════════════════════

export interface ToolResult {
  /** Whether the tool execution succeeded */
  success: boolean;
  /** Output data from the tool */
  output: string;
  /** Error message if failed */
  error?: string;
}

export type ToolCategory = 'filesystem' | 'git' | 'shell' | 'analysis';

export interface OfflineTool {
  /** Tool name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Tool execution handler */
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
  /** Tool category */
  category: ToolCategory;
}

// ═══════════════════════════════════════════════════════════════
// OLLAMA API TYPES
// ═══════════════════════════════════════════════════════════════

export interface OllamaModel {
  /** Model name */
  name: string;
  /** Model size in bytes */
  size: number;
  /** Model digest */
  digest: string;
  /** Last modified timestamp */
  modified_at: string;
}

export interface OllamaGenerateRequest {
  /** Model name */
  model: string;
  /** Prompt text */
  prompt: string;
  /** Whether to stream the response */
  stream?: boolean;
  /** Additional options */
  options?: Record<string, unknown>;
}

export interface OllamaGenerateResponse {
  /** Model name */
  model: string;
  /** Generated response text */
  response: string;
  /** Whether generation is complete */
  done: boolean;
  /** Total duration in nanoseconds */
  total_duration?: number;
  /** Token count */
  eval_count?: number;
}

export interface OllamaChatMessage {
  /** Role: system, user, or assistant */
  role: 'system' | 'user' | 'assistant';
  /** Message content */
  content: string;
}

export interface OllamaChatRequest {
  /** Model name */
  model: string;
  /** Chat messages */
  messages: OllamaChatMessage[];
  /** Whether to stream the response */
  stream?: boolean;
  /** Additional options */
  options?: Record<string, unknown>;
}

export interface OllamaChatResponse {
  /** Model name */
  model: string;
  /** Generated message */
  message: OllamaChatMessage;
  /** Whether generation is complete */
  done: boolean;
  /** Total duration in nanoseconds */
  total_duration?: number;
  /** Token count */
  eval_count?: number;
}

export interface OllamaEmbeddingResponse {
  /** Embedding vector */
  embedding: number[];
}
