/**
 * Engine Bridge — Wraps CortexOS SDK for VS Code lifecycle.
 *
 * Manages CortexEngine instance, forwards EventBus events
 * to VS Code UI components, and exposes async methods for commands.
 */

import type { CortexEngine, CortexConfig, ExecutionResult, EventBus, Tracer, MetricsCollector, ProviderRegistry, ConfigManager } from 'cortexos';

export type EventListener = (event: string, data: unknown) => void;

export class EngineBridge {
  private engine: CortexEngine | null = null;
  private workspaceDir: string;
  private listeners: EventListener[] = [];
  private initialized = false;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  /**
   * Lazily initialize the CortexEngine.
   */
  private async ensureEngine(): Promise<CortexEngine> {
    if (this.engine && this.initialized) return this.engine;

    // Dynamic import to avoid loading at extension activation
    const { CortexEngine: Engine, ConfigManager: CM } = await import('cortexos');

    const configManager = new CM(this.workspaceDir);
    const config = configManager.load();

    this.engine = new Engine({ config, projectDir: this.workspaceDir });
    this.initialized = true;

    // Wire up event forwarding
    this.wireEvents();

    return this.engine;
  }

  /**
   * Wire all EventBus events to registered listeners.
   */
  private wireEvents(): void {
    if (!this.engine) return;

    const eventBus = this.engine.getEventBus();
    const events = [
      'engine:start', 'engine:complete', 'engine:error',
      'stage:start', 'stage:complete',
      'plan:created',
      'wave:start', 'wave:complete',
      'agent:start', 'agent:progress', 'agent:tool', 'agent:complete', 'agent:error',
      'memory:recall', 'memory:store',
      'quality:gate', 'cost:update', 'error',
    ];

    for (const event of events) {
      eventBus.on(event as any, (data: unknown) => {
        for (const listener of this.listeners) {
          try {
            listener(event, data);
          } catch {
            // Don't let listener errors break the event chain
          }
        }
      });
    }
  }

  /**
   * Execute a task prompt.
   */
  async run(prompt: string): Promise<ExecutionResult> {
    const engine = await this.ensureEngine();
    return engine.execute(prompt);
  }

  /**
   * Get list of available providers.
   */
  async getAvailableProviders(): Promise<string[]> {
    const engine = await this.ensureEngine();
    const registry = (engine as any).providerRegistry as ProviderRegistry | null;
    return registry ? registry.listAvailable() : [];
  }

  /**
   * Register an event listener.
   */
  onEvent(listener: EventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove an event listener.
   */
  offEvent(listener: EventListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  /**
   * Get the EventBus for direct access.
   */
  getEventBus(): EventBus | null {
    return this.engine?.getEventBus() ?? null;
  }

  /**
   * Get the Tracer for dashboard integration.
   */
  getTracer(): Tracer | null {
    return (this.engine as any)?.tracer ?? null;
  }

  /**
   * Get the MetricsCollector for dashboard integration.
   */
  getMetrics(): MetricsCollector | null {
    return (this.engine as any)?.metrics ?? null;
  }

  /**
   * Shutdown the engine and cleanup.
   */
  async shutdown(): Promise<void> {
    if (this.engine) {
      await this.engine.shutdown();
      this.engine = null;
      this.initialized = false;
    }
    this.listeners = [];
  }
}
