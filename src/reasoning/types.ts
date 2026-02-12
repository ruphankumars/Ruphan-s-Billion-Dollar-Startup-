/**
 * Reasoning System Type Definitions
 * Shared types for all advanced reasoning modules:
 * ReAct, Reflexion, Tree-of-Thought, Debate, RAG, and Tool Discovery.
 */

import type { AgentResult, TokenUsage } from '../core/types.js';

export type ReasoningStrategy =
  | 'react'
  | 'reflexion'
  | 'tree-of-thought'
  | 'debate'
  | 'rag'
  | 'tool-discovery';

export interface ReasoningConfig {
  enabled: boolean;
  strategies: {
    react: {
      enabled: boolean;
      maxThoughts: number;
    };
    reflexion: {
      enabled: boolean;
      maxRetries: number;
      triggerOn: 'failure' | 'low-quality' | 'both';
    };
    treeOfThought: {
      enabled: boolean;
      candidates: number;
      complexityThreshold: number;
    };
    debate: {
      enabled: boolean;
      debaters: number;
      rounds: number;
      complexityThreshold: number;
    };
    rag: {
      enabled: boolean;
      maxChunks: number;
      chunkSize: number;
      minRelevance: number;
    };
    toolDiscovery: {
      enabled: boolean;
      maxChainLength: number;
    };
  };
  costBudget: number;
}

export interface ThoughtStep {
  type: 'thought' | 'action' | 'observation' | 'reflection';
  content: string;
  timestamp: number;
  tokenCost: number;
}

export interface ReasoningTrace {
  strategy: ReasoningStrategy;
  steps: ThoughtStep[];
  totalTokens: TokenUsage;
  duration: number;
  outcome: 'success' | 'failure' | 'budget-exceeded';
}

export interface ReasoningResult extends AgentResult {
  reasoning?: ReasoningTrace;
}

export interface CandidateApproach {
  id: number;
  description: string;
  plan: string;
  score: number;
}

export interface DebaterArgument {
  debaterId: number;
  perspective: string;
  argument: string;
  round: number;
}

export interface JudgeVerdict {
  selectedApproach: string;
  synthesizedInsights: string;
  confidence: number;
}

export const DEFAULT_REASONING_CONFIG: ReasoningConfig = {
  enabled: false,
  strategies: {
    react: { enabled: true, maxThoughts: 10 },
    reflexion: { enabled: true, maxRetries: 2, triggerOn: 'failure' },
    treeOfThought: { enabled: true, candidates: 3, complexityThreshold: 0.6 },
    debate: { enabled: false, debaters: 3, rounds: 2, complexityThreshold: 0.8 },
    rag: { enabled: true, maxChunks: 10, chunkSize: 500, minRelevance: 0.3 },
    toolDiscovery: { enabled: true, maxChainLength: 5 },
  },
  costBudget: 0.50,
};
