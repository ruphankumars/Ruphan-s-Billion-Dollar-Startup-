/**
 * Prompt System Type Definitions
 * The Super Prompt Engine transforms raw user prompts into enhanced,
 * context-rich prompts with memory, repo context, and chain-of-thought.
 */

export interface PromptAnalysis {
  /** Original user prompt */
  original: string;
  /** Complexity score 0-1 */
  complexity: number;
  /** Detected domains (web, cli, api, database, etc.) */
  domains: string[];
  /** Detected intent */
  intent: PromptIntent;
  /** Estimated number of subtasks */
  estimatedSubtasks: number;
  /** Detected programming languages */
  languages: string[];
  /** Key entities mentioned */
  entities: string[];
  /** Suggested agent roles */
  suggestedRoles: string[];
}

export type PromptIntent =
  | 'create'      // Build something new
  | 'modify'      // Change existing code
  | 'fix'         // Fix a bug
  | 'refactor'    // Restructure code
  | 'test'        // Write tests
  | 'document'    // Write documentation
  | 'analyze'     // Understand/investigate code
  | 'deploy'      // Deploy or configure
  | 'optimize'    // Improve performance
  | 'unknown';

export interface EnhancedPrompt {
  /** The enhanced system prompt */
  systemPrompt: string;
  /** The enhanced user prompt */
  userPrompt: string;
  /** Memory context injected */
  memoryContext: string;
  /** Repository context injected */
  repoContext: string;
  /** Chain-of-thought reasoning injected */
  cotContext: string;
  /** Analysis of the original prompt */
  analysis: PromptAnalysis;
}

export interface DecomposedTask {
  id: string;
  title: string;
  description: string;
  role: string; // Agent role to handle this
  dependencies: string[]; // Task IDs this depends on
  priority: number; // 1-10
  estimatedComplexity: number; // 0-1
  requiredTools: string[];
  context: string; // Additional context for the agent
}

export interface ExecutionPlan {
  tasks: DecomposedTask[];
  waves: PlanWave[];
  totalEstimatedTokens: number;
  totalEstimatedCost: number;
  estimatedDuration: number; // seconds
}

export interface PlanWave {
  waveNumber: number;
  taskIds: string[];
  canParallelize: boolean;
}

export interface PromptTemplate {
  name: string;
  template: string;
  variables: string[];
}

export interface RepoContext {
  /** Repository root directory */
  rootDir: string;
  /** Detected languages and their file counts */
  languages: Record<string, number>;
  /** Key files (package.json, Cargo.toml, etc.) */
  configFiles: string[];
  /** Repository map (file tree with symbols) */
  repoMap: string;
  /** Git status */
  gitStatus?: string;
  /** Git branch */
  gitBranch?: string;
  /** Total file count */
  totalFiles: number;
}
