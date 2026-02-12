/**
 * `cortexos agents` — Agent introspection commands.
 * `agents list`  — show all 7 roles with model tier + tools
 * `agents status` — show pool stats if running
 */

import { Command } from 'commander';
import { getAllRoles } from '../../agents/roles/index.js';
import type { AgentRole } from '../../agents/types.js';

export function createAgentsCommand(): Command {
  const cmd = new Command('agents');

  cmd.description('Inspect and manage CortexOS agents');

  // agents list
  cmd
    .command('list')
    .description('List all available agent roles')
    .option('--json', 'Output as JSON')
    .action((options: { json?: boolean }) => {
      listAgents(options.json ?? false);
    });

  // agents status
  cmd
    .command('status')
    .description('Show agent pool status')
    .action(() => {
      showStatus();
    });

  return cmd;
}

function listAgents(asJson: boolean): void {
  const roles = getAllRoles();

  if (asJson) {
    const data = roles.map(formatRoleData);
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log();
  console.log('🤖 CortexOS Agent Roles');
  console.log('─'.repeat(60));
  console.log();

  for (const role of roles) {
    printRole(role);
  }

  console.log(`Total: ${roles.length} agents available`);
  console.log();
}

function printRole(role: AgentRole): void {
  const tierColors: Record<string, string> = {
    fast: '⚡',
    balanced: '⚖️',
    powerful: '🚀',
  };

  const tier = tierColors[role.defaultModel] || '❓';
  const tools = role.defaultTools.length > 0
    ? role.defaultTools.join(', ')
    : 'none';

  console.log(`  ${tier} ${role.displayName} (${role.name})`);
  console.log(`     Model: ${role.defaultModel} | Temp: ${role.temperature}`);
  console.log(`     Tools: ${tools}`);
  console.log(`     ${role.description}`);
  console.log();
}

function formatRoleData(role: AgentRole) {
  return {
    name: role.name,
    displayName: role.displayName,
    description: role.description,
    modelTier: role.defaultModel,
    temperature: role.temperature,
    tools: role.defaultTools,
  };
}

function showStatus(): void {
  // Pool stats are only available when the engine is running
  // Since CLI commands are standalone, we can't access a running pool directly
  console.log();
  console.log('🔧 Agent Pool Status');
  console.log('─'.repeat(40));
  console.log();
  console.log('  No active pool. The agent pool is created');
  console.log('  when running `cortexos run` and destroyed');
  console.log('  after execution completes.');
  console.log();
  console.log('  Use `cortexos run --verbose` to see pool');
  console.log('  activity during execution.');
  console.log();
}
