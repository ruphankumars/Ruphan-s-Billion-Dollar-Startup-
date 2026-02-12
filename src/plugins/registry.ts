/**
 * Plugin System — Extensible registration for tools, providers, gates.
 * Allows third-party extensions to register custom components with CortexOS.
 *
 * @example
 * ```typescript
 * const plugin: CortexPlugin = {
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   register(ctx) {
 *     ctx.registerTool(myCustomTool);
 *     ctx.registerGate(myCustomGate);
 *   }
 * };
 * pluginRegistry.load(plugin);
 * ```
 */

import type { Tool } from '../tools/types.js';
import type { LLMProvider } from '../providers/types.js';
import type { QualityGate } from '../quality/types.js';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

/** Plugin lifecycle hooks */
export interface CortexPlugin {
  name: string;
  version: string;
  description?: string;
  author?: string;

  /** Register components with CortexOS */
  register(context: PluginContext): void | Promise<void>;

  /** Optional cleanup when plugin is unloaded */
  unload?(): void | Promise<void>;
}

/** Plugin registration context — provided to plugins during registration */
export interface PluginContext {
  /** Register a custom tool */
  registerTool(tool: Tool): void;

  /** Register a custom LLM provider */
  registerProvider(name: string, provider: LLMProvider): void;

  /** Register a custom quality gate */
  registerGate(name: string, gate: QualityGate): void;

  /** Register a custom agent role template */
  registerRole(name: string, config: RoleTemplate): void;

  /** Register middleware */
  registerMiddleware(type: MiddlewareType, handler: MiddlewareHandler): void;

  /** Get plugin configuration from cortexos.yaml */
  getConfig(key: string): unknown;
}

export interface RoleTemplate {
  systemPrompt: string;
  defaultModel?: string;
  defaultTools?: string[];
  maxIterations?: number;
}

export type MiddlewareType = 'pre-execute' | 'post-execute' | 'pre-verify' | 'post-verify';
export type MiddlewareHandler = (data: unknown) => unknown | Promise<unknown>;

export interface PluginRegistration {
  plugin: CortexPlugin;
  loadedAt: number;
  tools: string[];
  providers: string[];
  gates: string[];
  roles: string[];
  middlewares: MiddlewareType[];
}

/**
 * PluginRegistry manages loading, registration, and lifecycle of plugins.
 */
export class PluginRegistry {
  private plugins = new Map<string, PluginRegistration>();
  private tools = new Map<string, Tool>();
  private providers = new Map<string, LLMProvider>();
  private gates = new Map<string, QualityGate>();
  private roles = new Map<string, RoleTemplate>();
  private middlewares = new Map<MiddlewareType, MiddlewareHandler[]>();
  private config: Record<string, unknown>;

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
  }

  /**
   * Load and register a plugin
   */
  async load(plugin: CortexPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      await this.unload(plugin.name);
    }

    const registration: PluginRegistration = {
      plugin,
      loadedAt: Date.now(),
      tools: [],
      providers: [],
      gates: [],
      roles: [],
      middlewares: [],
    };

    const context: PluginContext = {
      registerTool: (tool: Tool) => {
        this.tools.set(tool.name, tool);
        registration.tools.push(tool.name);
        logger.debug({ plugin: plugin.name, tool: tool.name }, 'Plugin registered tool');
      },
      registerProvider: (name: string, provider: LLMProvider) => {
        this.providers.set(name, provider);
        registration.providers.push(name);
        logger.debug({ plugin: plugin.name, provider: name }, 'Plugin registered provider');
      },
      registerGate: (name: string, gate: QualityGate) => {
        this.gates.set(name, gate);
        registration.gates.push(name);
        logger.debug({ plugin: plugin.name, gate: name }, 'Plugin registered gate');
      },
      registerRole: (name: string, config: RoleTemplate) => {
        this.roles.set(name, config);
        registration.roles.push(name);
        logger.debug({ plugin: plugin.name, role: name }, 'Plugin registered role');
      },
      registerMiddleware: (type: MiddlewareType, handler: MiddlewareHandler) => {
        const handlers = this.middlewares.get(type) || [];
        handlers.push(handler);
        this.middlewares.set(type, handlers);
        registration.middlewares.push(type);
      },
      getConfig: (key: string) => {
        const pluginConfig = this.config.plugins as Record<string, unknown> | undefined;
        return pluginConfig?.[plugin.name]?.[key as keyof (typeof pluginConfig)[string]];
      },
    };

    try {
      await plugin.register(context);
      this.plugins.set(plugin.name, registration);

      logger.info(
        {
          plugin: plugin.name,
          version: plugin.version,
          tools: registration.tools.length,
          providers: registration.providers.length,
          gates: registration.gates.length,
        },
        'Plugin loaded',
      );
    } catch (err) {
      logger.error({ plugin: plugin.name, error: err }, 'Plugin registration failed');
      throw err;
    }
  }

  /**
   * Unload a plugin and remove its registrations
   */
  async unload(name: string): Promise<void> {
    const registration = this.plugins.get(name);
    if (!registration) return;

    // Call plugin cleanup
    try {
      await registration.plugin.unload?.();
    } catch (err) {
      logger.warn({ plugin: name, error: err }, 'Plugin unload hook failed');
    }

    // Remove registered components
    for (const tool of registration.tools) this.tools.delete(tool);
    for (const provider of registration.providers) this.providers.delete(provider);
    for (const gate of registration.gates) this.gates.delete(gate);
    for (const role of registration.roles) this.roles.delete(role);

    // Remove middlewares (best effort — handlers are function refs)
    for (const type of registration.middlewares) {
      this.middlewares.delete(type);
    }

    this.plugins.delete(name);
    logger.info({ plugin: name }, 'Plugin unloaded');
  }

  /**
   * Get all tools registered by plugins
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get a specific plugin tool
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all providers registered by plugins
   */
  getProviders(): Map<string, LLMProvider> {
    return new Map(this.providers);
  }

  /**
   * Get all gates registered by plugins
   */
  getGates(): Map<string, QualityGate> {
    return new Map(this.gates);
  }

  /**
   * Get all role templates registered by plugins
   */
  getRoles(): Map<string, RoleTemplate> {
    return new Map(this.roles);
  }

  /**
   * Run middleware handlers for a given type
   */
  async runMiddleware(type: MiddlewareType, data: unknown): Promise<unknown> {
    const handlers = this.middlewares.get(type);
    if (!handlers || handlers.length === 0) return data;

    let result = data;
    for (const handler of handlers) {
      result = await handler(result);
    }
    return result;
  }

  /**
   * List all loaded plugins
   */
  listPlugins(): Array<{
    name: string;
    version: string;
    loadedAt: number;
    tools: string[];
    providers: string[];
    gates: string[];
  }> {
    return Array.from(this.plugins.values()).map(r => ({
      name: r.plugin.name,
      version: r.plugin.version,
      loadedAt: r.loadedAt,
      tools: r.tools,
      providers: r.providers,
      gates: r.gates,
    }));
  }

  /**
   * Check if a plugin is loaded
   */
  isLoaded(name: string): boolean {
    return this.plugins.has(name);
  }
}
