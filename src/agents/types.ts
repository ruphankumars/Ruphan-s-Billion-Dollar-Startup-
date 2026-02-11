export type AgentRoleName =
  | 'orchestrator' | 'researcher' | 'developer'
  | 'architect' | 'tester' | 'validator' | 'ux-agent';

export interface AgentTask {
  id: string;
  description: string;
  role: AgentRoleName;
  dependencies: string[];
  wave: number;
  context?: string;
  constraints?: string[];
}

export interface AgentConfig {
  role: AgentRoleName;
  maxIterations: number;
  model?: string;
  temperature?: number;
  tools: string[];
  systemPrompt: string;
}

export interface AgentState {
  id: string;
  task: AgentTask;
  config: AgentConfig;
  iteration: number;
  status: 'idle' | 'thinking' | 'tool_use' | 'complete' | 'error';
  output: string;
  filesChanged: FileChangeRecord[];
  startTime: number;
  endTime?: number;
}

export interface FileChangeRecord {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  linesAdded: number;
  linesRemoved: number;
}

export interface AgentRole {
  name: AgentRoleName;
  displayName: string;
  description: string;
  defaultModel: 'fast' | 'balanced' | 'powerful';
  defaultTools: string[];
  systemPrompt: string;
  temperature: number;
}
