export interface QualityGate {
  name: string;
  description: string;
  run(context: QualityContext): Promise<GateResult>;
}

export interface QualityContext {
  workingDir: string;
  filesChanged: string[];
  diff?: string;
  executionId: string;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  issues: GateIssue[];
  duration: number;
  autoFixed?: number;
}

export interface GateIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  rule?: string;
  autoFixable: boolean;
  suggestion?: string;
}

export interface FixResult {
  file: string;
  rule?: string;
  description: string;
  type: 'lint' | 'syntax' | 'suggestion';
  success: boolean;
}
