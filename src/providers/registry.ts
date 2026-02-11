import type { LLMProvider } from './types.js';
import type { CortexConfig } from '../core/types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { getLogger } from '../core/logger.js';

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private defaultProvider: string;
  private logger = getLogger();

  constructor(defaultProvider: string = 'anthropic') {
    this.defaultProvider = defaultProvider;
  }

  register(name: string, provider: LLMProvider): void {
    this.providers.set(name, provider);
    this.logger.debug({ provider: name }, 'Provider registered');
  }

  get(name: string): LLMProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Provider "${name}" not found. Available: ${this.listAvailable().join(', ')}`);
    }
    return provider;
  }

  getDefault(): LLMProvider {
    return this.get(this.defaultProvider);
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  listAvailable(): string[] {
    return Array.from(this.providers.keys());
  }

  async discoverProviders(config: CortexConfig): Promise<void> {
    // Anthropic
    const anthropic = new AnthropicProvider({
      apiKey: config.providers.anthropicApiKey,
    });
    if (await anthropic.isAvailable()) {
      this.register('anthropic', anthropic);
    }

    // OpenAI
    const openai = new OpenAIProvider({
      apiKey: config.providers.openaiApiKey,
    });
    if (await openai.isAvailable()) {
      this.register('openai', openai);
    }

    if (this.providers.size === 0) {
      this.logger.warn('No LLM providers available. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
    }
  }

  static async create(config: CortexConfig): Promise<ProviderRegistry> {
    const registry = new ProviderRegistry(config.providers.default);
    await registry.discoverProviders(config);
    return registry;
  }
}
