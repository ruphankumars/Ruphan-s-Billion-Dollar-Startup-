export interface ModelPricing {
  model: string;
  provider: string;
  inputPer1M: number;  // Cost per 1M input tokens
  outputPer1M: number; // Cost per 1M output tokens
  contextWindow: number;
  tier: 'fast' | 'balanced' | 'powerful';
}

export interface CostEntry {
  id: string;
  timestamp: number;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  executionId: string;
  taskId?: string;
  agentRole?: string;
}

export interface CostSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  modelBreakdown: {
    model: string;
    provider: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }[];
  budgetUsed: number;
  budgetRemaining: number;
}

export interface BudgetConfig {
  perRun: number;
  perDay: number;
}
