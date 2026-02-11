import type { AgentRole, AgentRoleName } from '../types.js';

export abstract class BaseRole implements AgentRole {
  abstract name: AgentRoleName;
  abstract displayName: string;
  abstract description: string;
  abstract defaultModel: 'fast' | 'balanced' | 'powerful';
  abstract defaultTools: string[];
  abstract systemPrompt: string;
  temperature: number = 0.3;
}
