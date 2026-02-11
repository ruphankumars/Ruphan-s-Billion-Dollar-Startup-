export class CortexError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly stage?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'CortexError';
  }
}

export class ConfigError extends CortexError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONFIG_ERROR', 'config', cause);
    this.name = 'ConfigError';
  }
}

export class ProviderError extends CortexError {
  constructor(message: string, public readonly provider: string, cause?: Error) {
    super(message, 'PROVIDER_ERROR', 'execute', cause);
    this.name = 'ProviderError';
  }
}

export class BudgetExceededError extends CortexError {
  constructor(public readonly spent: number, public readonly budget: number) {
    super(
      `Budget exceeded: spent $${spent.toFixed(4)} of $${budget.toFixed(2)} budget`,
      'BUDGET_EXCEEDED',
      'execute',
    );
    this.name = 'BudgetExceededError';
  }
}

export class ToolError extends CortexError {
  constructor(message: string, public readonly tool: string, cause?: Error) {
    super(message, 'TOOL_ERROR', 'execute', cause);
    this.name = 'ToolError';
  }
}

export class MemoryError extends CortexError {
  constructor(message: string, cause?: Error) {
    super(message, 'MEMORY_ERROR', 'recall', cause);
    this.name = 'MemoryError';
  }
}

export class QualityError extends CortexError {
  constructor(message: string, public readonly gate: string) {
    super(message, 'QUALITY_ERROR', 'verify');
    this.name = 'QualityError';
  }
}

export class AgentError extends CortexError {
  constructor(message: string, public readonly agentId: string, cause?: Error) {
    super(message, 'AGENT_ERROR', 'execute', cause);
    this.name = 'AgentError';
  }
}
