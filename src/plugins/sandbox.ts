/**
 * Plugin Sandbox — Resource limits, capability-based permissions,
 * and isolation for third-party plugins.
 *
 * Prevents plugins from:
 * - Exceeding CPU/memory/time limits
 * - Accessing unauthorized APIs
 * - Registering too many components
 * - Interfering with core system
 */

import { getLogger } from '../core/logger.js';

const logger = getLogger();

export interface PluginCapability {
  /** Can register custom tools */
  registerTools: boolean;
  /** Can register LLM providers */
  registerProviders: boolean;
  /** Can register quality gates */
  registerGates: boolean;
  /** Can register middleware (intercept requests) */
  registerMiddleware: boolean;
  /** Can access file system */
  fileSystemAccess: boolean;
  /** Can make network requests */
  networkAccess: boolean;
  /** Can access config */
  configAccess: boolean;
}

export interface PluginLimits {
  /** Maximum number of tools a single plugin can register */
  maxTools: number;
  /** Maximum number of providers a single plugin can register */
  maxProviders: number;
  /** Maximum number of gates a single plugin can register */
  maxGates: number;
  /** Maximum registration time in ms (for async register()) */
  registrationTimeoutMs: number;
  /** Maximum middleware handlers per type */
  maxMiddlewarePerType: number;
}

export interface SandboxViolation {
  plugin: string;
  type: 'capability' | 'limit' | 'timeout';
  message: string;
  timestamp: number;
}

const DEFAULT_CAPABILITIES: PluginCapability = {
  registerTools: true,
  registerProviders: false,
  registerGates: true,
  registerMiddleware: false,
  fileSystemAccess: false,
  networkAccess: false,
  configAccess: true,
};

const DEFAULT_LIMITS: PluginLimits = {
  maxTools: 10,
  maxProviders: 3,
  maxGates: 5,
  registrationTimeoutMs: 5000,
  maxMiddlewarePerType: 3,
};

/**
 * PluginSandbox enforces capability-based permissions and resource
 * limits for third-party plugins.
 */
export class PluginSandbox {
  private capabilities: PluginCapability;
  private limits: PluginLimits;
  private violations: SandboxViolation[] = [];
  private counters = new Map<string, Map<string, number>>();

  constructor(
    capabilities: Partial<PluginCapability> = {},
    limits: Partial<PluginLimits> = {},
  ) {
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...capabilities };
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /**
   * Check if a plugin can register a tool
   */
  canRegisterTool(pluginName: string): boolean {
    if (!this.capabilities.registerTools) {
      this.recordViolation(pluginName, 'capability', 'Tool registration not allowed');
      return false;
    }

    const count = this.getCounter(pluginName, 'tools');
    if (count >= this.limits.maxTools) {
      this.recordViolation(pluginName, 'limit', `Tool limit reached (${this.limits.maxTools})`);
      return false;
    }

    this.incrementCounter(pluginName, 'tools');
    return true;
  }

  /**
   * Check if a plugin can register a provider
   */
  canRegisterProvider(pluginName: string): boolean {
    if (!this.capabilities.registerProviders) {
      this.recordViolation(pluginName, 'capability', 'Provider registration not allowed');
      return false;
    }

    const count = this.getCounter(pluginName, 'providers');
    if (count >= this.limits.maxProviders) {
      this.recordViolation(pluginName, 'limit', `Provider limit reached (${this.limits.maxProviders})`);
      return false;
    }

    this.incrementCounter(pluginName, 'providers');
    return true;
  }

  /**
   * Check if a plugin can register a gate
   */
  canRegisterGate(pluginName: string): boolean {
    if (!this.capabilities.registerGates) {
      this.recordViolation(pluginName, 'capability', 'Gate registration not allowed');
      return false;
    }

    const count = this.getCounter(pluginName, 'gates');
    if (count >= this.limits.maxGates) {
      this.recordViolation(pluginName, 'limit', `Gate limit reached (${this.limits.maxGates})`);
      return false;
    }

    this.incrementCounter(pluginName, 'gates');
    return true;
  }

  /**
   * Check if a plugin can register middleware
   */
  canRegisterMiddleware(pluginName: string, type: string): boolean {
    if (!this.capabilities.registerMiddleware) {
      this.recordViolation(pluginName, 'capability', 'Middleware registration not allowed');
      return false;
    }

    const key = `middleware:${type}`;
    const count = this.getCounter(pluginName, key);
    if (count >= this.limits.maxMiddlewarePerType) {
      this.recordViolation(
        pluginName,
        'limit',
        `Middleware limit for "${type}" reached (${this.limits.maxMiddlewarePerType})`,
      );
      return false;
    }

    this.incrementCounter(pluginName, key);
    return true;
  }

  /**
   * Check if a plugin can access the filesystem
   */
  canAccessFileSystem(pluginName: string): boolean {
    if (!this.capabilities.fileSystemAccess) {
      this.recordViolation(pluginName, 'capability', 'File system access not allowed');
      return false;
    }
    return true;
  }

  /**
   * Check if a plugin can make network requests
   */
  canAccessNetwork(pluginName: string): boolean {
    if (!this.capabilities.networkAccess) {
      this.recordViolation(pluginName, 'capability', 'Network access not allowed');
      return false;
    }
    return true;
  }

  /**
   * Wrap an async registration function with timeout enforcement
   */
  async withTimeout<T>(
    pluginName: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.recordViolation(
          pluginName,
          'timeout',
          `Registration exceeded ${this.limits.registrationTimeoutMs}ms timeout`,
        );
        reject(new Error(`Plugin "${pluginName}" registration timed out after ${this.limits.registrationTimeoutMs}ms`));
      }, this.limits.registrationTimeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Get all recorded violations
   */
  getViolations(): SandboxViolation[] {
    return [...this.violations];
  }

  /**
   * Get violations for a specific plugin
   */
  getPluginViolations(pluginName: string): SandboxViolation[] {
    return this.violations.filter(v => v.plugin === pluginName);
  }

  /**
   * Check if a plugin has any violations
   */
  hasViolations(pluginName: string): boolean {
    return this.violations.some(v => v.plugin === pluginName);
  }

  /**
   * Reset counters for a plugin (on unload)
   */
  resetPlugin(pluginName: string): void {
    this.counters.delete(pluginName);
  }

  /**
   * Get current capabilities
   */
  getCapabilities(): PluginCapability {
    return { ...this.capabilities };
  }

  /**
   * Get current limits
   */
  getLimits(): PluginLimits {
    return { ...this.limits };
  }

  /**
   * Clear all violations
   */
  clearViolations(): void {
    this.violations = [];
  }

  private recordViolation(
    plugin: string,
    type: 'capability' | 'limit' | 'timeout',
    message: string,
  ): void {
    const violation: SandboxViolation = {
      plugin,
      type,
      message,
      timestamp: Date.now(),
    };
    this.violations.push(violation);
    logger.warn({ plugin, type, message }, 'Plugin sandbox violation');
  }

  private getCounter(pluginName: string, resource: string): number {
    return this.counters.get(pluginName)?.get(resource) || 0;
  }

  private incrementCounter(pluginName: string, resource: string): void {
    if (!this.counters.has(pluginName)) {
      this.counters.set(pluginName, new Map());
    }
    const pluginCounters = this.counters.get(pluginName)!;
    pluginCounters.set(resource, (pluginCounters.get(resource) || 0) + 1);
  }
}
