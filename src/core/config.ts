import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { CortexConfigSchema, type CortexConfig } from './types.js';
import { ConfigError } from './errors.js';

export class ConfigManager {
  private config: CortexConfig | null = null;
  private globalDir: string;
  private projectDir: string;

  constructor(projectDir?: string) {
    this.globalDir = join(homedir(), '.cortexos');
    this.projectDir = projectDir || process.cwd();
  }

  /**
   * Load configuration from all sources, merged in order:
   * defaults <- global config <- project config <- env vars <- overrides
   */
  load(overrides?: Partial<CortexConfig>): CortexConfig {
    let raw: Record<string, unknown> = {};

    // 1. Load global config
    const globalConfigPath = join(this.globalDir, 'config.yaml');
    if (existsSync(globalConfigPath)) {
      try {
        const content = readFileSync(globalConfigPath, 'utf-8');
        const parsed = parseYaml(content);
        if (parsed && typeof parsed === 'object') {
          raw = { ...raw, ...parsed };
        }
      } catch (err) {
        throw new ConfigError(`Failed to parse global config at ${globalConfigPath}`, err as Error);
      }
    }

    // 2. Load project config
    const projectConfigPath = join(this.projectDir, '.cortexos.yaml');
    if (existsSync(projectConfigPath)) {
      try {
        const content = readFileSync(projectConfigPath, 'utf-8');
        const parsed = parseYaml(content);
        if (parsed && typeof parsed === 'object') {
          raw = this.deepMerge(raw, parsed as Record<string, unknown>);
        }
      } catch (err) {
        throw new ConfigError(`Failed to parse project config at ${projectConfigPath}`, err as Error);
      }
    }

    // 3. Apply environment variables
    raw = this.applyEnvVars(raw);

    // 4. Apply overrides
    if (overrides) {
      raw = this.deepMerge(raw, overrides as Record<string, unknown>);
    }

    // 5. Validate with Zod
    try {
      this.config = CortexConfigSchema.parse(raw);
    } catch (err) {
      throw new ConfigError(`Invalid configuration: ${(err as Error).message}`, err as Error);
    }

    return this.config;
  }

  /**
   * Get the loaded configuration
   */
  get(): CortexConfig {
    if (!this.config) {
      return this.load();
    }
    return this.config;
  }

  /**
   * Get the global CortexOS directory path
   */
  getGlobalDir(): string {
    return this.globalDir;
  }

  /**
   * Get the project directory path
   */
  getProjectDir(): string {
    return this.projectDir;
  }

  /**
   * Ensure all required directories exist
   */
  ensureDirectories(): void {
    const dirs = [
      this.globalDir,
      join(this.globalDir, 'memory'),
      join(this.globalDir, 'cache'),
      join(this.globalDir, 'logs'),
      join(this.globalDir, 'daemon'),
    ];
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Create default global config if it doesn't exist
   */
  createDefaultConfig(): void {
    this.ensureDirectories();
    const configPath = join(this.globalDir, 'config.yaml');
    if (!existsSync(configPath)) {
      const defaultConfig = `# CortexOS Global Configuration
# API keys (or set via environment variables)
providers:
  default: anthropic
  # anthropicApiKey: sk-ant-...
  # openaiApiKey: sk-...

memory:
  enabled: true

agents:
  maxParallel: 4
  maxIterations: 25

cost:
  budgetPerRun: 1.00
  budgetPerDay: 10.00
`;
      writeFileSync(configPath, defaultConfig, 'utf-8');
    }
  }

  private applyEnvVars(raw: Record<string, unknown>): Record<string, unknown> {
    const providers = (raw.providers || {}) as Record<string, unknown>;

    if (process.env.ANTHROPIC_API_KEY) {
      providers.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    }
    if (process.env.OPENAI_API_KEY) {
      providers.openaiApiKey = process.env.OPENAI_API_KEY;
    }
    if (process.env.GOOGLE_API_KEY) {
      providers.googleApiKey = process.env.GOOGLE_API_KEY;
    }
    if (process.env.OLLAMA_BASE_URL) {
      providers.ollamaBaseUrl = process.env.OLLAMA_BASE_URL;
    }
    if (process.env.GROQ_API_KEY) {
      providers.groqApiKey = process.env.GROQ_API_KEY;
    }
    if (process.env.MISTRAL_API_KEY) {
      providers.mistralApiKey = process.env.MISTRAL_API_KEY;
    }
    if (process.env.TOGETHER_API_KEY) {
      providers.togetherApiKey = process.env.TOGETHER_API_KEY;
    }
    if (process.env.DEEPSEEK_API_KEY) {
      providers.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
    }
    if (process.env.FIREWORKS_API_KEY) {
      providers.fireworksApiKey = process.env.FIREWORKS_API_KEY;
    }
    if (process.env.COHERE_API_KEY) {
      providers.cohereApiKey = process.env.COHERE_API_KEY;
    }
    if (process.env.CORTEXOS_DEFAULT_PROVIDER) {
      providers.default = process.env.CORTEXOS_DEFAULT_PROVIDER;
    }

    raw.providers = providers;
    return raw;
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        result[key] = this.deepMerge(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>,
        );
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}
