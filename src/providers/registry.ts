import type { LLMProvider } from './types.js';
import type { CortexConfig } from '../core/types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GoogleProvider } from './google.js';
import { OllamaProvider } from './ollama.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { PROVIDER_CONFIGS } from './provider-configs.js';
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

    // Google Gemini
    const google = new GoogleProvider({
      apiKey: config.providers.googleApiKey,
    });
    if (await google.isAvailable()) {
      this.register('google', google);
    }

    // Ollama (local)
    const ollama = new OllamaProvider({
      baseUrl: config.providers.ollamaBaseUrl,
    });
    if (await ollama.isAvailable()) {
      this.register('ollama', ollama);
    }

    // OpenAI-compatible providers (Groq, Mistral, Together, DeepSeek, Fireworks, Cohere)
    const configKeyMap: Record<string, string> = {
      groq: 'groqApiKey',
      mistral: 'mistralApiKey',
      together: 'togetherApiKey',
      deepseek: 'deepseekApiKey',
      fireworks: 'fireworksApiKey',
      cohere: 'cohereApiKey',
    };

    for (const providerConfig of PROVIDER_CONFIGS) {
      const configKey = configKeyMap[providerConfig.name];
      const apiKey = configKey
        ? (config.providers as Record<string, unknown>)[configKey] as string | undefined
        : undefined;

      const provider = new OpenAICompatibleProvider(providerConfig, {
        apiKey,
      });

      if (await provider.isAvailable()) {
        this.register(providerConfig.name, provider);
      }
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
