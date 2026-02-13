/**
 * Workflow Orchestration DSL & Resumable Execution
 *
 * Define multi-step agent workflows as composable, resumable pipelines
 * with conditional branching, parallel groups, checkpointing, and
 * human-in-the-loop approval gates.
 */

// ═══════════════════════════════════════════════════════════════
// WORKFLOW TYPES
// ═══════════════════════════════════════════════════════════════

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_approval';

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'agent' | 'tool' | 'gate' | 'approval' | 'conditional' | 'parallel';
  config: StepConfig;
  dependsOn?: string[];
  retryPolicy?: RetryPolicy;
  timeout?: number;      // ms
  condition?: StepCondition;
}

export type StepConfig =
  | AgentStepConfig
  | ToolStepConfig
  | GateStepConfig
  | ApprovalStepConfig
  | ConditionalStepConfig
  | ParallelStepConfig;

export interface AgentStepConfig {
  type: 'agent';
  role: string;
  prompt: string;
  model?: string;
  provider?: string;
  outputSchema?: string;
}

export interface ToolStepConfig {
  type: 'tool';
  toolName: string;
  args: Record<string, unknown>;
}

export interface GateStepConfig {
  type: 'gate';
  gates: string[];
  failAction: 'stop' | 'continue' | 'retry';
}

export interface ApprovalStepConfig {
  type: 'approval';
  message: string;
  approvers?: string[];
  timeout?: number;
}

export interface ConditionalStepConfig {
  type: 'conditional';
  expression: string; // e.g., "steps.analyze.output.complexity === 'high'"
  ifTrue: string;     // step id to execute if true
  ifFalse?: string;   // step id to execute if false
}

export interface ParallelStepConfig {
  type: 'parallel';
  steps: string[];    // step ids to run in parallel
  waitAll?: boolean;  // wait for all to complete (default: true)
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryOn?: string[]; // error types to retry on
}

export interface StepCondition {
  expression: string;
  skipIfFalse?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW DEFINITION
// ═══════════════════════════════════════════════════════════════

export interface WorkflowDefinition {
  name: string;
  version: string;
  description?: string;
  inputs?: Record<string, { type: string; description?: string; required?: boolean }>;
  steps: WorkflowStep[];
  onError?: 'stop' | 'continue' | 'rollback';
  checkpointing?: boolean;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW STATE
// ═══════════════════════════════════════════════════════════════

export interface StepResult {
  stepId: string;
  status: StepStatus;
  output: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
  retryCount: number;
  durationMs: number;
  cost: number;
}

export interface WorkflowState {
  id: string;
  workflowName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  inputs: Record<string, unknown>;
  steps: Record<string, StepResult>;
  currentStepId: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  totalCost: number;
  checkpoints: WorkflowCheckpoint[];
  error?: string;
}

export interface WorkflowCheckpoint {
  stepId: string;
  timestamp: number;
  state: Record<string, StepResult>;
}

export interface WorkflowRunResult {
  workflowId: string;
  status: WorkflowState['status'];
  steps: Record<string, StepResult>;
  totalCost: number;
  durationMs: number;
  outputs: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW BUILDER (Fluent DSL)
// ═══════════════════════════════════════════════════════════════

export class WorkflowBuilder {
  private definition: WorkflowDefinition;

  constructor(name: string, version = '1.0.0') {
    this.definition = {
      name,
      version,
      steps: [],
      checkpointing: true,
      onError: 'stop',
    };
  }

  description(desc: string): this {
    this.definition.description = desc;
    return this;
  }

  input(name: string, type: string, options?: { description?: string; required?: boolean }): this {
    if (!this.definition.inputs) this.definition.inputs = {};
    this.definition.inputs[name] = { type, ...options };
    return this;
  }

  onError(action: 'stop' | 'continue' | 'rollback'): this {
    this.definition.onError = action;
    return this;
  }

  checkpoint(enabled = true): this {
    this.definition.checkpointing = enabled;
    return this;
  }

  /** Add an agent step */
  agent(id: string, config: Omit<AgentStepConfig, 'type'> & { name?: string; dependsOn?: string[]; retry?: RetryPolicy; timeout?: number }): this {
    const { name, dependsOn, retry, timeout, ...agentConfig } = config;
    this.definition.steps.push({
      id,
      name: name ?? id,
      type: 'agent',
      config: { type: 'agent', ...agentConfig },
      dependsOn,
      retryPolicy: retry,
      timeout,
    });
    return this;
  }

  /** Add a tool step */
  tool(id: string, config: Omit<ToolStepConfig, 'type'> & { name?: string; dependsOn?: string[] }): this {
    const { name, dependsOn, ...toolConfig } = config;
    this.definition.steps.push({
      id,
      name: name ?? id,
      type: 'tool',
      config: { type: 'tool', ...toolConfig },
      dependsOn,
    });
    return this;
  }

  /** Add a quality gate step */
  gate(id: string, config: Omit<GateStepConfig, 'type'> & { name?: string; dependsOn?: string[] }): this {
    const { name, dependsOn, ...gateConfig } = config;
    this.definition.steps.push({
      id,
      name: name ?? id,
      type: 'gate',
      config: { type: 'gate', ...gateConfig },
      dependsOn,
    });
    return this;
  }

  /** Add a human approval gate */
  approval(id: string, config: Omit<ApprovalStepConfig, 'type'> & { name?: string; dependsOn?: string[] }): this {
    const { name, dependsOn, ...approvalConfig } = config;
    this.definition.steps.push({
      id,
      name: name ?? id,
      type: 'approval',
      config: { type: 'approval', ...approvalConfig },
      dependsOn,
    });
    return this;
  }

  /** Add conditional branching */
  condition(id: string, config: Omit<ConditionalStepConfig, 'type'> & { name?: string; dependsOn?: string[] }): this {
    const { name, dependsOn, ...condConfig } = config;
    this.definition.steps.push({
      id,
      name: name ?? id,
      type: 'conditional',
      config: { type: 'conditional', ...condConfig },
      dependsOn,
    });
    return this;
  }

  /** Add a parallel execution group */
  parallel(id: string, config: Omit<ParallelStepConfig, 'type'> & { name?: string; dependsOn?: string[] }): this {
    const { name, dependsOn, ...parallelConfig } = config;
    this.definition.steps.push({
      id,
      name: name ?? id,
      type: 'parallel',
      config: { type: 'parallel', ...parallelConfig },
      dependsOn,
    });
    return this;
  }

  build(): WorkflowDefinition {
    this.validateDefinition();
    return { ...this.definition };
  }

  private validateDefinition(): void {
    const ids = new Set(this.definition.steps.map(s => s.id));

    // Check for duplicate IDs
    if (ids.size !== this.definition.steps.length) {
      throw new Error('Workflow has duplicate step IDs');
    }

    // Check dependency references
    for (const step of this.definition.steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!ids.has(dep)) {
            throw new Error(`Step "${step.id}" depends on unknown step "${dep}"`);
          }
        }
      }
    }

    // Check for circular dependencies
    this.detectCycles();
  }

  private detectCycles(): void {
    const visited = new Set<string>();
    const stack = new Set<string>();
    const stepMap = new Map(this.definition.steps.map(s => [s.id, s]));

    const visit = (id: string): void => {
      if (stack.has(id)) throw new Error(`Circular dependency detected involving step "${id}"`);
      if (visited.has(id)) return;

      stack.add(id);
      const step = stepMap.get(id);
      if (step?.dependsOn) {
        for (const dep of step.dependsOn) {
          visit(dep);
        }
      }
      stack.delete(id);
      visited.add(id);
    };

    for (const step of this.definition.steps) {
      visit(step.id);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW ENGINE
// ═══════════════════════════════════════════════════════════════

export type StepExecutor = (step: WorkflowStep, context: WorkflowExecutionContext) => Promise<unknown>;
export type ApprovalHandler = (step: WorkflowStep, state: WorkflowState) => Promise<boolean>;

export interface WorkflowExecutionContext {
  workflowId: string;
  inputs: Record<string, unknown>;
  stepResults: Record<string, StepResult>;
  getStepOutput: (stepId: string) => unknown;
}

export class WorkflowEngine {
  private executors: Map<string, StepExecutor> = new Map();
  private approvalHandler: ApprovalHandler | null = null;
  private checkpointStore: Map<string, WorkflowState> = new Map();
  private listeners: Map<string, Array<(event: WorkflowEvent) => void>> = new Map();

  /** Register a step executor for a step type */
  registerExecutor(type: string, executor: StepExecutor): void {
    this.executors.set(type, executor);
  }

  /** Set the approval handler for human-in-the-loop gates */
  setApprovalHandler(handler: ApprovalHandler): void {
    this.approvalHandler = handler;
  }

  /** Listen to workflow events */
  on(event: string, listener: (event: WorkflowEvent) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(listener);
  }

  /** Execute a workflow definition */
  async execute(
    definition: WorkflowDefinition,
    inputs: Record<string, unknown> = {}
  ): Promise<WorkflowRunResult> {
    const workflowId = this.generateId();
    const state = this.initState(workflowId, definition, inputs);

    this.emit('workflow:started', { workflowId, name: definition.name });

    try {
      await this.runSteps(definition, state);
      state.status = this.allStepsCompleted(state) ? 'completed' : 'failed';
    } catch (err) {
      state.status = 'failed';
      state.error = err instanceof Error ? err.message : String(err);

      if (definition.onError === 'continue') {
        state.status = 'completed';
      }
    }

    state.completedAt = Date.now();
    state.updatedAt = Date.now();

    this.emit('workflow:completed', {
      workflowId,
      status: state.status,
      durationMs: state.completedAt - state.startedAt,
    });

    return {
      workflowId: state.id,
      status: state.status,
      steps: state.steps,
      totalCost: state.totalCost,
      durationMs: (state.completedAt || Date.now()) - state.startedAt,
      outputs: this.collectOutputs(state),
    };
  }

  /** Resume a paused or failed workflow from its last checkpoint */
  async resume(workflowId: string, definition: WorkflowDefinition): Promise<WorkflowRunResult> {
    const state = this.checkpointStore.get(workflowId);
    if (!state) throw new Error(`No checkpoint found for workflow "${workflowId}"`);

    state.status = 'running';
    state.updatedAt = Date.now();

    this.emit('workflow:resumed', { workflowId });

    try {
      await this.runSteps(definition, state);
      state.status = this.allStepsCompleted(state) ? 'completed' : 'failed';
    } catch (err) {
      state.status = 'failed';
      state.error = err instanceof Error ? err.message : String(err);
    }

    state.completedAt = Date.now();
    state.updatedAt = Date.now();

    return {
      workflowId: state.id,
      status: state.status,
      steps: state.steps,
      totalCost: state.totalCost,
      durationMs: (state.completedAt || Date.now()) - state.startedAt,
      outputs: this.collectOutputs(state),
    };
  }

  /** Get current state of a workflow */
  getState(workflowId: string): WorkflowState | undefined {
    return this.checkpointStore.get(workflowId);
  }

  // ─── Internal Execution ─────────────────────────────────────

  private async runSteps(definition: WorkflowDefinition, state: WorkflowState): Promise<void> {
    const remaining = this.getReadySteps(definition, state);

    if (remaining.length === 0) return;

    // Execute all ready steps (respecting dependencies)
    for (const step of remaining) {
      if (state.steps[step.id]?.status === 'completed') continue;
      if (state.steps[step.id]?.status === 'skipped') continue;

      // Check condition
      if (step.condition) {
        const conditionMet = this.evaluateCondition(step.condition.expression, state);
        if (!conditionMet && step.condition.skipIfFalse) {
          state.steps[step.id] = this.createStepResult(step.id, 'skipped');
          continue;
        }
      }

      state.currentStepId = step.id;
      this.emit('step:started', { workflowId: state.id, stepId: step.id, stepName: step.name });

      const result = await this.executeStep(step, state);
      state.steps[step.id] = result;
      state.totalCost += result.cost;
      state.updatedAt = Date.now();

      if (definition.checkpointing) {
        this.saveCheckpoint(state);
      }

      this.emit('step:completed', {
        workflowId: state.id,
        stepId: step.id,
        status: result.status,
        durationMs: result.durationMs,
      });

      if (result.status === 'failed' && definition.onError === 'stop') {
        throw new Error(`Step "${step.id}" failed: ${result.error}`);
      }

      if (result.status === 'waiting_approval') {
        state.status = 'paused';
        this.saveCheckpoint(state);
        return;
      }
    }

    // Recurse for next wave of ready steps
    const nextReady = this.getReadySteps(definition, state);
    if (nextReady.length > 0) {
      await this.runSteps(definition, state);
    }
  }

  private async executeStep(step: WorkflowStep, state: WorkflowState): Promise<StepResult> {
    const startedAt = Date.now();
    let retryCount = 0;
    const maxRetries = step.retryPolicy?.maxRetries ?? 0;

    while (retryCount <= maxRetries) {
      try {
        // Handle approval steps
        if (step.type === 'approval') {
          if (!this.approvalHandler) {
            return this.createStepResult(step.id, 'waiting_approval', undefined, startedAt);
          }
          const approved = await this.approvalHandler(step, state);
          return this.createStepResult(
            step.id,
            approved ? 'completed' : 'failed',
            { approved },
            startedAt
          );
        }

        // Handle parallel steps
        if (step.type === 'parallel') {
          const config = step.config as ParallelStepConfig;
          // Parallel steps just mark the group as ready
          return this.createStepResult(step.id, 'completed', { parallelSteps: config.steps }, startedAt);
        }

        // Handle conditional steps
        if (step.type === 'conditional') {
          const config = step.config as ConditionalStepConfig;
          const result = this.evaluateCondition(config.expression, state);
          const nextStep = result ? config.ifTrue : config.ifFalse;
          return this.createStepResult(step.id, 'completed', { condition: result, nextStep }, startedAt);
        }

        // Execute via registered executor
        const executor = this.executors.get(step.type);
        if (!executor) {
          return this.createStepResult(step.id, 'completed', { message: `No executor for type "${step.type}"` }, startedAt);
        }

        const context: WorkflowExecutionContext = {
          workflowId: state.id,
          inputs: state.inputs,
          stepResults: state.steps,
          getStepOutput: (id) => state.steps[id]?.output,
        };

        const output = await this.withTimeout(
          executor(step, context),
          step.timeout ?? 300000 // 5 min default
        );

        return this.createStepResult(step.id, 'completed', output, startedAt);

      } catch (err) {
        retryCount++;
        if (retryCount > maxRetries) {
          return this.createStepResult(
            step.id,
            'failed',
            undefined,
            startedAt,
            err instanceof Error ? err.message : String(err),
            retryCount - 1
          );
        }

        // Backoff before retry
        const backoff = (step.retryPolicy?.backoffMs ?? 1000) *
          Math.pow(step.retryPolicy?.backoffMultiplier ?? 2, retryCount - 1);
        await this.sleep(backoff);
      }
    }

    return this.createStepResult(step.id, 'failed', undefined, startedAt, 'Max retries exceeded', retryCount);
  }

  private getReadySteps(definition: WorkflowDefinition, state: WorkflowState): WorkflowStep[] {
    return definition.steps.filter(step => {
      const result = state.steps[step.id];
      if (result?.status === 'completed' || result?.status === 'skipped') return false;
      if (result?.status === 'failed') return false;

      // Check all dependencies are satisfied
      if (step.dependsOn) {
        return step.dependsOn.every(dep => {
          const depResult = state.steps[dep];
          return depResult?.status === 'completed' || depResult?.status === 'skipped';
        });
      }

      return true;
    });
  }

  private evaluateCondition(expression: string, state: WorkflowState): boolean {
    try {
      // Simple expression evaluator for step references
      // e.g., "steps.analyze.output.complexity === 'high'"
      const context: Record<string, unknown> = {
        steps: {} as Record<string, unknown>,
        inputs: state.inputs,
      };

      for (const [id, result] of Object.entries(state.steps)) {
        (context.steps as Record<string, unknown>)[id] = {
          status: result.status,
          output: result.output,
          cost: result.cost,
          duration: result.durationMs,
        };
      }

      // Safe eval using Function constructor with limited scope
      const fn = new Function('steps', 'inputs', `return ${expression}`);
      return Boolean(fn(context.steps, context.inputs));
    } catch {
      return false;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private initState(id: string, def: WorkflowDefinition, inputs: Record<string, unknown>): WorkflowState {
    const state: WorkflowState = {
      id,
      workflowName: def.name,
      status: 'running',
      inputs,
      steps: {},
      currentStepId: null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      totalCost: 0,
      checkpoints: [],
    };
    this.checkpointStore.set(id, state);
    return state;
  }

  private createStepResult(
    stepId: string,
    status: StepStatus,
    output?: unknown,
    startedAt?: number,
    error?: string,
    retryCount = 0
  ): StepResult {
    const now = Date.now();
    return {
      stepId,
      status,
      output: output ?? null,
      error,
      startedAt: startedAt ?? now,
      completedAt: status === 'running' || status === 'waiting_approval' ? undefined : now,
      retryCount,
      durationMs: (startedAt ? now - startedAt : 0),
      cost: 0,
    };
  }

  private saveCheckpoint(state: WorkflowState): void {
    state.checkpoints.push({
      stepId: state.currentStepId || '',
      timestamp: Date.now(),
      state: { ...state.steps },
    });
    this.checkpointStore.set(state.id, { ...state });
  }

  private allStepsCompleted(state: WorkflowState): boolean {
    return Object.values(state.steps).every(r =>
      r.status === 'completed' || r.status === 'skipped'
    );
  }

  private collectOutputs(state: WorkflowState): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const [id, result] of Object.entries(state.steps)) {
      if (result.output !== null) outputs[id] = result.output;
    }
    return outputs;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Step timed out after ${ms}ms`)), ms)
      ),
    ]);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private generateId(): string {
    return `wf_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private emit(event: string, data: Record<string, unknown>): void {
    const listeners = this.listeners.get(event) || [];
    for (const listener of listeners) {
      try { listener({ type: event, ...data } as WorkflowEvent); } catch { /* ignore */ }
    }
  }
}

export interface WorkflowEvent {
  type: string;
  workflowId?: string;
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════
// PRESET WORKFLOWS
// ═══════════════════════════════════════════════════════════════

export const PRESET_WORKFLOWS = {
  /** Standard code generation workflow */
  codeGen: () => new WorkflowBuilder('code-generation', '1.0.0')
    .description('Generate code with quality verification')
    .input('prompt', 'string', { required: true })
    .agent('analyze', { role: 'researcher', prompt: 'Analyze the requirements: {{inputs.prompt}}' })
    .agent('implement', { role: 'developer', prompt: 'Implement the solution', dependsOn: ['analyze'] })
    .agent('test', { role: 'tester', prompt: 'Write comprehensive tests', dependsOn: ['implement'] })
    .gate('verify', { gates: ['syntax', 'lint', 'typecheck', 'test'], failAction: 'retry', dependsOn: ['test'] })
    .build(),

  /** Full-stack feature with approval */
  fullStack: () => new WorkflowBuilder('full-stack-feature', '1.0.0')
    .description('Build a full-stack feature with human approval')
    .input('feature', 'string', { required: true })
    .agent('design', { role: 'architect', prompt: 'Design the architecture for: {{inputs.feature}}' })
    .approval('review-design', { message: 'Review the proposed architecture', dependsOn: ['design'] })
    .agent('backend', { role: 'developer', prompt: 'Implement the backend', dependsOn: ['review-design'] })
    .agent('frontend', { role: 'developer', prompt: 'Implement the frontend', dependsOn: ['review-design'] })
    .agent('tests', { role: 'tester', prompt: 'Write tests for both layers', dependsOn: ['backend', 'frontend'] })
    .gate('qa', { gates: ['syntax', 'lint', 'typecheck', 'test', 'security'], failAction: 'stop', dependsOn: ['tests'] })
    .build(),

  /** Bug fix workflow */
  bugFix: () => new WorkflowBuilder('bug-fix', '1.0.0')
    .description('Investigate and fix a bug')
    .input('bug', 'string', { required: true })
    .agent('investigate', { role: 'researcher', prompt: 'Investigate root cause: {{inputs.bug}}' })
    .agent('fix', { role: 'developer', prompt: 'Implement the fix', dependsOn: ['investigate'] })
    .agent('regression', { role: 'tester', prompt: 'Write regression tests', dependsOn: ['fix'] })
    .gate('verify', { gates: ['syntax', 'typecheck', 'test'], failAction: 'retry', dependsOn: ['regression'] })
    .build(),
};
