import { nanoid } from 'nanoid';
import type { CortexConfig, ExecutionStage, AgentResult, TokenUsage } from './types.js';

export class ExecutionContext {
  public readonly id: string;
  public readonly startTime: number;
  public stage: ExecutionStage = 'recall';
  public readonly agentResults: AgentResult[] = [];
  public readonly tokenUsage: TokenUsage = { input: 0, output: 0, total: 0 };
  public totalCost: number = 0;
  public memoriesRecalled: number = 0;
  public memoriesStored: number = 0;
  public workingDir: string;

  constructor(
    public readonly prompt: string,
    public readonly config: CortexConfig,
    workingDir?: string,
  ) {
    this.id = nanoid(12);
    this.startTime = Date.now();
    this.workingDir = workingDir || process.cwd();
  }

  setStage(stage: ExecutionStage): void {
    this.stage = stage;
  }

  addTokens(input: number, output: number): void {
    this.tokenUsage.input += input;
    this.tokenUsage.output += output;
    this.tokenUsage.total = this.tokenUsage.input + this.tokenUsage.output;
  }

  addCost(cost: number): void {
    this.totalCost += cost;
  }

  get elapsed(): number {
    return Date.now() - this.startTime;
  }

  get budgetRemaining(): number {
    const budgetPerRun = this.config.budget?.maxCostPerRun ?? this.config.cost?.budgetPerRun ?? 5.0;
    return budgetPerRun - this.totalCost;
  }

  isBudgetExceeded(): boolean {
    const budgetPerRun = this.config.budget?.maxCostPerRun ?? this.config.cost?.budgetPerRun ?? 5.0;
    return this.totalCost >= budgetPerRun;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      prompt: this.prompt,
      stage: this.stage,
      tokenUsage: this.tokenUsage,
      totalCost: this.totalCost,
      elapsed: this.elapsed,
    };
  }
}
