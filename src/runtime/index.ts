export { WASMSandbox } from './wasm-sandbox.js';
export { EdgeAdapter } from './edge-adapter.js';
export { NeuralEmbeddingEngine } from './neural-embeddings.js';
export type {
  WASMSandboxConfig, WASMModule, WASMInstance, SandboxExecResult,
  EdgeTarget, EdgeCapability, EdgeConstraints, EdgeConnection,
  EdgeDeployment, EdgeDeploymentMetrics,
  EmbeddingModel, EmbeddingRequest, EmbeddingResult, VectorSearchResult,
  RuntimeConfig, RuntimeEventType,
} from './types.js';
