/**
 * Agent FinOps Module — Type Definitions
 *
 * Financial operations types for AI agent cost management,
 * budget tracking, forecasting, and rightsizing in CortexOS.
 */

// ── Consumption Types ───────────────────────────────────────────────

export interface ConsumptionRecord {
  id: string;
  agentId: string;
  taskId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: number;
  timestamp: number;
  tags: Record<string, string>;
}

// ── Forecast Types ──────────────────────────────────────────────────

export interface CostForecast {
  agentId: string;
  period: 'hourly' | 'daily' | 'weekly' | 'monthly';
  estimatedCost: number;
  estimatedTokens: number;
  confidence: number;
  basedOnSamples: number;
  generatedAt: number;
}

// ── Tagging Types ───────────────────────────────────────────────────

export interface ResourceTag {
  key: string;
  value: string;
}

export interface TaggedCost {
  tags: Record<string, string>;
  totalCost: number;
  totalTokens: number;
  recordCount: number;
}

// ── Rightsizing Types ───────────────────────────────────────────────

export interface RightsizingRecommendation {
  id: string;
  agentId: string;
  currentModel: string;
  recommendedModel: string;
  estimatedSavings: number;
  qualityImpact: number;
  reasoning: string;
  generatedAt: number;
}

// ── Budget Types ────────────────────────────────────────────────────

export type BudgetLevel = 'organization' | 'team' | 'agent' | 'task';

export interface Budget {
  id: string;
  name: string;
  level: BudgetLevel;
  entityId: string;
  limit: number;
  spent: number;
  period: 'daily' | 'weekly' | 'monthly';
  alertThreshold: number;
  createdAt: number;
}

export interface BudgetAlert {
  id: string;
  budgetId: string;
  budgetName: string;
  percentUsed: number;
  message: string;
  timestamp: number;
}

// ── Report Types ────────────────────────────────────────────────────

export interface FinOpsReport {
  periodStart: number;
  periodEnd: number;
  totalCost: number;
  totalTokens: number;
  byAgent: Array<{ agentId: string; cost: number; tokens: number }>;
  byModel: Array<{ model: string; cost: number; tokens: number }>;
  byTag: TaggedCost[];
  recommendations: RightsizingRecommendation[];
  budgetStatus: Budget[];
  generatedAt: number;
}

// ── Configuration ───────────────────────────────────────────────────

export interface FinOpsConfig {
  enabled: boolean;
  maxRecords: number;
  forecastEnabled: boolean;
  rightsizingEnabled: boolean;
  reportIntervalMs: number;
  defaultBudgetAlertThreshold: number;
}

// ── Stats ───────────────────────────────────────────────────────────

export interface FinOpsStats {
  totalRecords: number;
  totalCost: number;
  totalTokens: number;
  activeBudgets: number;
  budgetAlertsTriggered: number;
  recommendationsGenerated: number;
  avgCostPerTask: number;
}
