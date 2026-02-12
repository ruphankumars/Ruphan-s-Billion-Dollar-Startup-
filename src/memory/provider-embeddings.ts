/**
 * Provider Embedding Engine — Neural embeddings via LLM provider APIs.
 *
 * Supports OpenAI and Cohere embedding APIs. Falls back to the local
 * TF-IDF engine (LocalEmbeddingEngine) on any API error, ensuring
 * the system always works even without API keys.
 *
 * Uses raw fetch() — no additional SDK dependencies required.
 */

import type { EmbeddingEngine } from './types.js';
import { LocalEmbeddingEngine } from './embeddings.js';

export interface ProviderEmbeddingConfig {
  /** Embedding provider to use */
  provider: 'openai' | 'cohere';
  /** Model name (defaults: text-embedding-3-small for OpenAI, embed-english-v3.0 for Cohere) */
  model?: string;
  /** API key (falls back to env vars: OPENAI_API_KEY, COHERE_API_KEY) */
  apiKey?: string;
}

const PROVIDER_DEFAULTS = {
  openai: {
    model: 'text-embedding-3-small',
    url: 'https://api.openai.com/v1/embeddings',
    envVar: 'OPENAI_API_KEY',
    dimensions: 1536,
  },
  cohere: {
    model: 'embed-english-v3.0',
    url: 'https://api.cohere.com/v2/embed',
    envVar: 'COHERE_API_KEY',
    dimensions: 1024,
  },
} as const;

export class ProviderEmbeddingEngine implements EmbeddingEngine {
  private providerName: 'openai' | 'cohere';
  private model: string;
  private apiKey: string;
  private apiUrl: string;
  private dims: number;
  private fallback: LocalEmbeddingEngine;

  constructor(config: ProviderEmbeddingConfig) {
    this.providerName = config.provider;
    const defaults = PROVIDER_DEFAULTS[config.provider];

    this.model = config.model || defaults.model;
    this.apiKey = config.apiKey || process.env[defaults.envVar] || '';
    this.apiUrl = defaults.url;
    this.dims = defaults.dimensions;
    this.fallback = new LocalEmbeddingEngine(this.dims);
  }

  dimensions(): number {
    return this.dims;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      return this.fallback.embed(text);
    }

    try {
      if (this.providerName === 'openai') {
        return await this.embedOpenAI(text);
      } else {
        return await this.embedCohere([text]).then(r => r[0]);
      }
    } catch {
      return this.fallback.embed(text);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey || texts.length === 0) {
      return this.fallback.embedBatch(texts);
    }

    try {
      if (this.providerName === 'openai') {
        return await this.embedBatchOpenAI(texts);
      } else {
        return await this.embedCohere(texts);
      }
    } catch {
      return this.fallback.embedBatch(texts);
    }
  }

  /** Check if the provider API is accessible */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ---- OpenAI Embedding API ----

  private async embedOpenAI(text: string): Promise<number[]> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: this.model,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding API error: ${response.status}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }

  private async embedBatchOpenAI(texts: string[]): Promise<number[][]> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding API error: ${response.status}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map(d => d.embedding);
  }

  // ---- Cohere Embedding API ----

  private async embedCohere(texts: string[]): Promise<number[][]> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        texts,
        model: this.model,
        input_type: 'search_document',
        embedding_types: ['float'],
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere embedding API error: ${response.status}`);
    }

    const data = await response.json() as { embeddings: { float: number[][] } };
    return data.embeddings.float;
  }
}
