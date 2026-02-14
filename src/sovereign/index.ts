/**
 * Sovereign / Air-Gap Mode — CortexOS
 *
 * Barrel exports for the sovereign runtime subsystem.
 */

export { SovereignRuntime } from './sovereign-runtime.js';
export { LocalProvider } from './local-provider.js';
export { OfflineToolkit } from './offline-tools.js';
export type {
  SovereignConfig,
  SovereignStatus,
  SovereignMode,
  OfflineTool,
  ToolResult,
  ToolCategory,
  OllamaModel,
  OllamaGenerateRequest,
  OllamaGenerateResponse,
  OllamaChatMessage,
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaEmbeddingResponse,
} from './types.js';
