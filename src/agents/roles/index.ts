import type { AgentRole, AgentRoleName } from '../types.js';
import { DeveloperRole } from './developer.js';
import { ResearcherRole } from './researcher.js';
import { ArchitectRole } from './architect.js';
import { TesterRole } from './tester.js';
import { ValidatorRole } from './validator.js';
import { OrchestratorRole } from './orchestrator.js';
import { UXAgentRole } from './ux-agent.js';
import { DebaterRole } from './debater.js';
import { JudgeRole } from './judge.js';

const roles: Map<AgentRoleName, AgentRole> = new Map();

function registerRoles(): void {
  const allRoles: AgentRole[] = [
    new DeveloperRole(),
    new ResearcherRole(),
    new ArchitectRole(),
    new TesterRole(),
    new ValidatorRole(),
    new OrchestratorRole(),
    new UXAgentRole(),
    new DebaterRole(),
    new JudgeRole(),
  ];
  for (const role of allRoles) {
    roles.set(role.name, role);
  }
}

registerRoles();

export function getRole(name: AgentRoleName): AgentRole {
  const role = roles.get(name);
  if (!role) throw new Error(`Unknown agent role: ${name}`);
  return role;
}

export function getAllRoles(): AgentRole[] {
  return Array.from(roles.values());
}

export { DeveloperRole, ResearcherRole, ArchitectRole, TesterRole, ValidatorRole, OrchestratorRole, UXAgentRole, DebaterRole, JudgeRole };
