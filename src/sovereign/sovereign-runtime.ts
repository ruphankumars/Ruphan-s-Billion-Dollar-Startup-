/**
 * SovereignRuntime — Air-Gap Capable Runtime
 *
 * Orchestrates offline-first operation: detects connectivity, routes
 * to local Ollama models, manages offline tools, and tracks mode.
 * Zero npm dependencies.
 */

import { EventEmitter } from 'node:events';
import * as http from 'node:http';
import type {
  SovereignConfig,
  SovereignStatus,
  SovereignMode,
} from './types.js';
import { LocalProvider } from './local-provider.js';
import { OfflineToolkit } from './offline-tools.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: SovereignConfig = {
  enabled: true,
  ollamaUrl: 'http://localhost:11434',
  defaultModel: 'llama3',
  fallbackModels: ['mistral', 'codellama', 'phi'],
  offlineToolsDir: '.cortex/tools',
  embeddingModel: 'nomic-embed-text',
  maxContextTokens: 4096,
  checkConnectivity: true,
};

const CONNECTIVITY_CHECK_URL = 'http://httpbin.org/get';
const CONNECTIVITY_TIMEOUT_MS = 5000;

// ═══════════════════════════════════════════════════════════════
// SOVEREIGN RUNTIME
// ═══════════════════════════════════════════════════════════════

export class SovereignRuntime extends EventEmitter {
  private config: SovereignConfig;
  private provider: LocalProvider;
  private toolkit: OfflineToolkit;
  private mode: SovereignMode = 'offline';
  private modelLoaded = false;
  private lastConnectivityCheck = 0;
  private running = false;
  private availableModels: string[] = [];
  private tasksExecuted = 0;
  private modelsUsed: Set<string> = new Set();
  private offlineSince: number | null = null;

  constructor(config?: Partial<SovereignConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.provider = new LocalProvider(this.config.ollamaUrl);
    this.toolkit = new OfflineToolkit();
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.provider.start();
    this.toolkit.start();
    this.emit('sovereign:runtime:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.provider.stop();
    this.toolkit.stop();
    this.emit('sovereign:runtime:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────

  /**
   * Initialize: check connectivity, detect available Ollama models,
   * and determine operating mode.
   */
  async initialize(): Promise<SovereignStatus> {
    // Check connectivity
    const isOnline = await this.checkConnectivity();

    // Check Ollama availability
    const ollamaAvailable = await this.provider.isAvailable();

    if (ollamaAvailable) {
      try {
        const models = await this.provider.listModels();
        this.availableModels = models.map((m) => m.name);
        this.modelLoaded = this.availableModels.length > 0;
      } catch {
        this.availableModels = [];
        this.modelLoaded = false;
      }
    }

    // Determine mode
    if (isOnline && ollamaAvailable) {
      this.mode = 'hybrid';
    } else if (ollamaAvailable) {
      this.mode = 'offline';
      this.offlineSince = this.offlineSince ?? Date.now();
    } else if (isOnline) {
      this.mode = 'online';
    } else {
      this.mode = 'offline';
      this.offlineSince = this.offlineSince ?? Date.now();
    }

    this.emit('sovereign:initialized', {
      timestamp: Date.now(),
      mode: this.mode,
      modelsAvailable: this.availableModels,
    });

    return this.getStatus();
  }

  // ─────────────────────────────────────────────────────────
  // STATUS
  // ─────────────────────────────────────────────────────────

  /**
   * Get current sovereign status.
   */
  getStatus(): SovereignStatus {
    const providers: string[] = [];
    if (this.mode === 'online' || this.mode === 'hybrid') {
      providers.push('cloud');
    }
    if (this.modelLoaded) {
      providers.push('ollama');
    }

    return {
      mode: this.mode,
      providersAvailable: providers,
      toolsAvailable: this.toolkit.listTools().map((t) => t.name),
      modelLoaded: this.modelLoaded,
      lastConnectivityCheck: this.lastConnectivityCheck,
    };
  }

  /**
   * Whether we are currently operating without internet.
   */
  isOffline(): boolean {
    return this.mode === 'offline';
  }

  // ─────────────────────────────────────────────────────────
  // TASK EXECUTION
  // ─────────────────────────────────────────────────────────

  /**
   * Execute a task using local models, falling back gracefully
   * if the primary model is unavailable.
   */
  async executeTask(
    prompt: string,
    options?: { model?: string; maxTokens?: number },
  ): Promise<{ response: string; model: string; duration: number }> {
    const startTime = Date.now();
    const requestedModel = options?.model ?? this.config.defaultModel;

    // Try models in order: requested, then fallbacks
    const modelsToTry = [requestedModel, ...this.config.fallbackModels.filter((m) => m !== requestedModel)];
    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      try {
        const result = await this.provider.generate(model, prompt, {
          num_predict: options?.maxTokens ?? this.config.maxContextTokens,
        });

        this.tasksExecuted++;
        this.modelsUsed.add(model);

        const duration = Date.now() - startTime;

        this.emit('sovereign:task:completed', {
          timestamp: Date.now(),
          model,
          duration,
          responseLength: result.response.length,
        });

        return {
          response: result.response,
          model,
          duration,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.emit('sovereign:task:fallback', {
          timestamp: Date.now(),
          failedModel: model,
          error: lastError.message,
        });
        continue;
      }
    }

    // All models failed
    const duration = Date.now() - startTime;
    this.emit('sovereign:task:failed', {
      timestamp: Date.now(),
      duration,
      error: lastError?.message ?? 'No models available',
    });

    throw new Error(
      `All models failed. Last error: ${lastError?.message ?? 'No models available'}`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // MODE MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Force a specific operating mode.
   */
  switchMode(mode: SovereignMode): void {
    const previousMode = this.mode;
    this.mode = mode;

    if (mode === 'offline' && previousMode !== 'offline') {
      this.offlineSince = Date.now();
    } else if (mode !== 'offline') {
      this.offlineSince = null;
    }

    this.emit('sovereign:mode:changed', {
      timestamp: Date.now(),
      from: previousMode,
      to: mode,
    });
  }

  // ─────────────────────────────────────────────────────────
  // CONNECTIVITY
  // ─────────────────────────────────────────────────────────

  /**
   * Check external connectivity by making a simple HTTP request.
   */
  async checkConnectivity(): Promise<boolean> {
    this.lastConnectivityCheck = Date.now();

    return new Promise<boolean>((resolve) => {
      const url = new URL(CONNECTIVITY_CHECK_URL);

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method: 'HEAD',
          timeout: CONNECTIVITY_TIMEOUT_MS,
        },
        (res) => {
          res.resume(); // Drain the response
          const online = (res.statusCode ?? 0) < 500;

          if (online && this.mode === 'offline') {
            this.offlineSince = null;
          }

          resolve(online);
        },
      );

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  // ─────────────────────────────────────────────────────────
  // COMPONENT ACCESS
  // ─────────────────────────────────────────────────────────

  getProvider(): LocalProvider {
    return this.provider;
  }

  getToolkit(): OfflineToolkit {
    return this.toolkit;
  }

  // ─────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────

  getStats(): {
    tasksExecuted: number;
    modelsUsed: string[];
    offlineDuration: number;
    mode: SovereignMode;
    availableModels: number;
    availableTools: number;
  } {
    return {
      tasksExecuted: this.tasksExecuted,
      modelsUsed: [...this.modelsUsed],
      offlineDuration: this.offlineSince ? Date.now() - this.offlineSince : 0,
      mode: this.mode,
      availableModels: this.availableModels.length,
      availableTools: this.toolkit.listTools().length,
    };
  }
}
