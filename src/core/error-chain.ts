/**
 * Structured Error Chain — Rich error context with causal chains, telemetry,
 * and structured metadata for production debugging.
 *
 * Implements error chain pattern: each error carries its full causal chain,
 * stage context, structured metadata, and serialization support.
 */

import type { ExecutionStage } from './types.js';

export interface ErrorContext {
  stage?: ExecutionStage;
  component?: string;
  operation?: string;
  taskId?: string;
  agentId?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface SerializedError {
  name: string;
  message: string;
  code: string;
  context: ErrorContext;
  stack?: string;
  cause?: SerializedError;
  chain: Array<{ name: string; message: string; code: string }>;
}

/**
 * ChainableError extends CortexError with rich structured context,
 * causal chains, and serialization for telemetry/logging.
 */
export class ChainableError extends Error {
  readonly code: string;
  readonly context: ErrorContext;
  readonly causedBy?: ChainableError | Error;

  constructor(
    message: string,
    code: string,
    context: Partial<ErrorContext> = {},
    cause?: Error,
  ) {
    super(message);
    this.name = 'ChainableError';
    this.code = code;
    this.context = {
      timestamp: Date.now(),
      ...context,
    };
    this.causedBy = cause;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ChainableError);
    }
  }

  /**
   * Wrap an existing error with additional context
   */
  static wrap(
    error: Error,
    message: string,
    code: string,
    context: Partial<ErrorContext> = {},
  ): ChainableError {
    return new ChainableError(
      `${message}: ${error.message}`,
      code,
      context,
      error,
    );
  }

  /**
   * Create from a plain Error, inferring context where possible
   */
  static from(error: Error, context: Partial<ErrorContext> = {}): ChainableError {
    if (error instanceof ChainableError) return error;
    return new ChainableError(error.message, 'UNKNOWN_ERROR', context, error);
  }

  /**
   * Get the full causal chain as an array
   */
  getChain(): Array<{ name: string; message: string; code: string }> {
    const chain: Array<{ name: string; message: string; code: string }> = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Error | undefined = this;

    while (current) {
      chain.push({
        name: current.name,
        message: current.message,
        code: current instanceof ChainableError ? current.code : 'UNKNOWN',
      });
      current = current instanceof ChainableError
        ? current.causedBy
        : undefined;
    }

    return chain;
  }

  /**
   * Get the root cause (deepest error in chain)
   */
  getRootCause(): Error {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Error = this;
    while (current instanceof ChainableError && current.causedBy) {
      current = current.causedBy;
    }
    return current;
  }

  /**
   * Serialize for structured logging / telemetry
   */
  serialize(): SerializedError {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack,
      cause: this.causedBy instanceof ChainableError
        ? this.causedBy.serialize()
        : this.causedBy
          ? { name: this.causedBy.name, message: this.causedBy.message, code: 'UNKNOWN', context: { timestamp: 0 }, chain: [] }
          : undefined,
      chain: this.getChain(),
    };
  }

  /**
   * Pretty-print for human-readable debugging
   */
  toDebugString(): string {
    const lines: string[] = [];
    const chain = this.getChain();

    lines.push(`Error: ${this.message}`);
    lines.push(`  Code: ${this.code}`);

    if (this.context.stage) lines.push(`  Stage: ${this.context.stage}`);
    if (this.context.component) lines.push(`  Component: ${this.context.component}`);
    if (this.context.operation) lines.push(`  Operation: ${this.context.operation}`);
    if (this.context.taskId) lines.push(`  Task: ${this.context.taskId}`);
    if (this.context.provider) lines.push(`  Provider: ${this.context.provider}`);

    if (chain.length > 1) {
      lines.push('  Caused by:');
      for (let i = 1; i < chain.length; i++) {
        lines.push(`    ${' '.repeat(i * 2)}→ [${chain[i].code}] ${chain[i].message}`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * ErrorAggregator collects multiple errors from parallel operations
 * and provides summary analysis.
 */
export class ErrorAggregator {
  private errors: ChainableError[] = [];

  add(error: ChainableError): void {
    this.errors.push(error);
  }

  addFromError(error: Error, context: Partial<ErrorContext> = {}): void {
    this.errors.push(ChainableError.from(error, context));
  }

  get count(): number {
    return this.errors.length;
  }

  get hasErrors(): boolean {
    return this.errors.length > 0;
  }

  getAll(): ChainableError[] {
    return [...this.errors];
  }

  /**
   * Group errors by code
   */
  groupByCode(): Map<string, ChainableError[]> {
    const groups = new Map<string, ChainableError[]>();
    for (const error of this.errors) {
      const existing = groups.get(error.code) || [];
      existing.push(error);
      groups.set(error.code, existing);
    }
    return groups;
  }

  /**
   * Group errors by stage
   */
  groupByStage(): Map<string, ChainableError[]> {
    const groups = new Map<string, ChainableError[]>();
    for (const error of this.errors) {
      const stage = error.context.stage || 'unknown';
      const existing = groups.get(stage) || [];
      existing.push(error);
      groups.set(stage, existing);
    }
    return groups;
  }

  /**
   * Get summary for telemetry
   */
  getSummary(): {
    total: number;
    byCode: Record<string, number>;
    byStage: Record<string, number>;
    messages: string[];
  } {
    const byCode: Record<string, number> = {};
    const byStage: Record<string, number> = {};

    for (const error of this.errors) {
      byCode[error.code] = (byCode[error.code] || 0) + 1;
      const stage = error.context.stage || 'unknown';
      byStage[stage] = (byStage[stage] || 0) + 1;
    }

    return {
      total: this.errors.length,
      byCode,
      byStage,
      messages: this.errors.map(e => e.message),
    };
  }

  clear(): void {
    this.errors = [];
  }
}
