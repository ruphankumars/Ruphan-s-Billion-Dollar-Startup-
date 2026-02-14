/**
 * Agent FinOps Module
 *
 * Financial operations for AI agent cost management, budget tracking,
 * consumption forecasting, and rightsizing recommendations in CortexOS.
 *
 * Exports:
 * - AgentFinOps: Cost tracking, budgeting, forecasting, and rightsizing engine
 */

export { AgentFinOps } from './agent-finops.js';

export type {
  ConsumptionRecord,
  CostForecast,
  ResourceTag,
  TaggedCost,
  RightsizingRecommendation,
  BudgetLevel,
  Budget,
  BudgetAlert,
  FinOpsReport,
  FinOpsConfig,
  FinOpsStats,
} from './types.js';
