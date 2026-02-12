/**
 * Provider Configurations — Static configs for OpenAI-compatible providers.
 *
 * Each config defines the provider name, base URL, API key environment variable,
 * available models, and default model. These are consumed by OpenAICompatibleProvider
 * to create provider instances without duplicating implementation code.
 */

import type { OpenAICompatibleConfig } from './openai-compatible.js';

export const GROQ_CONFIG: OpenAICompatibleConfig = {
  name: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKeyEnvVar: 'GROQ_API_KEY',
  models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
  defaultModel: 'llama-3.3-70b-versatile',
};

export const MISTRAL_CONFIG: OpenAICompatibleConfig = {
  name: 'mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  apiKeyEnvVar: 'MISTRAL_API_KEY',
  models: ['mistral-large-latest', 'mistral-small-latest'],
  defaultModel: 'mistral-large-latest',
};

export const TOGETHER_CONFIG: OpenAICompatibleConfig = {
  name: 'together',
  baseUrl: 'https://api.together.xyz/v1',
  apiKeyEnvVar: 'TOGETHER_API_KEY',
  models: ['meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
  defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
};

export const DEEPSEEK_CONFIG: OpenAICompatibleConfig = {
  name: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKeyEnvVar: 'DEEPSEEK_API_KEY',
  models: ['deepseek-chat', 'deepseek-coder'],
  defaultModel: 'deepseek-chat',
};

export const FIREWORKS_CONFIG: OpenAICompatibleConfig = {
  name: 'fireworks',
  baseUrl: 'https://api.fireworks.ai/inference/v1',
  apiKeyEnvVar: 'FIREWORKS_API_KEY',
  models: ['accounts/fireworks/models/llama-v3p1-70b-instruct', 'accounts/fireworks/models/mixtral-8x7b-instruct'],
  defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
};

export const COHERE_CONFIG: OpenAICompatibleConfig = {
  name: 'cohere',
  baseUrl: 'https://api.cohere.com/compatibility/v1',
  apiKeyEnvVar: 'COHERE_API_KEY',
  models: ['command-r-plus', 'command-r'],
  defaultModel: 'command-r-plus',
};

/** All OpenAI-compatible provider configurations */
export const PROVIDER_CONFIGS: OpenAICompatibleConfig[] = [
  GROQ_CONFIG,
  MISTRAL_CONFIG,
  TOGETHER_CONFIG,
  DEEPSEEK_CONFIG,
  FIREWORKS_CONFIG,
  COHERE_CONFIG,
];
