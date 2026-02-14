/**
 * Slack Block Kit Builder — Rich Message Formatting Utilities
 *
 * Static utility methods for constructing Slack Block Kit payloads
 * from CortexOS data structures. Converts ExecutionResults, agent status,
 * cost summaries, quality reports, and task progress into formatted
 * Slack blocks.
 *
 * Uses the Slack Block Kit specification:
 * https://api.slack.com/reference/block-kit/blocks
 */

import type { SlackBlock } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES (simplified CortexOS data for block rendering)
// ═══════════════════════════════════════════════════════════════

export interface ExecutionResultData {
  success: boolean;
  response: string;
  filesChanged: Array<{ path: string; type: string }>;
  duration: number;
  cost?: { totalCost: number; totalTokens: number };
  quality?: { passed: boolean; score: number };
}

export interface AgentStatusData {
  id: string;
  role: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  currentTask?: string;
  iterations?: number;
}

export interface CostSummaryData {
  totalCost: number;
  budgetRemaining: number;
  budgetUsedPercent: number;
  modelBreakdown: Array<{ model: string; cost: number; calls: number }>;
}

export interface QualityReportData {
  passed: boolean;
  overallScore: number;
  gates: Array<{ gate: string; passed: boolean; issues: number }>;
}

export interface TaskProgressData {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  subtasks?: Array<{ title: string; status: string }>;
}

// ═══════════════════════════════════════════════════════════════
// SLACK BLOCKS BUILDER
// ═══════════════════════════════════════════════════════════════

export class SlackBlocks {

  /**
   * Format an ExecutionResult as Slack blocks.
   */
  static executionResult(result: ExecutionResultData): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    // Status header
    const statusIcon = result.success ? ':white_check_mark:' : ':x:';
    blocks.push(SlackBlocks.header(`${statusIcon} Execution ${result.success ? 'Complete' : 'Failed'}`));

    // Response summary
    const truncatedResponse = result.response.length > 2000
      ? result.response.slice(0, 2000) + '...'
      : result.response;
    blocks.push(SlackBlocks.section(truncatedResponse));

    blocks.push(SlackBlocks.divider());

    // Metrics fields
    const fields: Array<{ type: string; text: string }> = [
      { type: 'mrkdwn', text: `*Duration:*\n${SlackBlocks.formatDuration(result.duration)}` },
      { type: 'mrkdwn', text: `*Files Changed:*\n${result.filesChanged.length}` },
    ];

    if (result.cost) {
      fields.push(
        { type: 'mrkdwn', text: `*Cost:*\n$${result.cost.totalCost.toFixed(4)}` },
        { type: 'mrkdwn', text: `*Tokens:*\n${result.cost.totalTokens.toLocaleString()}` },
      );
    }

    if (result.quality) {
      fields.push(
        { type: 'mrkdwn', text: `*Quality:*\n${result.quality.passed ? 'Passed' : 'Failed'}` },
        { type: 'mrkdwn', text: `*Score:*\n${result.quality.score}/100` },
      );
    }

    blocks.push({
      type: 'section',
      fields,
    });

    // File changes (limited to first 10)
    if (result.filesChanged.length > 0) {
      const fileList = result.filesChanged
        .slice(0, 10)
        .map((f) => `\`${f.type}\` ${f.path}`)
        .join('\n');

      blocks.push(SlackBlocks.context([
        `*Changed files:*\n${fileList}` +
        (result.filesChanged.length > 10 ? `\n...and ${result.filesChanged.length - 10} more` : ''),
      ]));
    }

    return blocks;
  }

  /**
   * Format agent status as Slack blocks.
   */
  static agentStatus(agents: AgentStatusData[]): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    blocks.push(SlackBlocks.header(':robot_face: Agent Status'));

    for (const agent of agents) {
      const statusIcon = {
        idle: ':white_circle:',
        running: ':large_blue_circle:',
        completed: ':green_circle:',
        failed: ':red_circle:',
      }[agent.status];

      let text = `${statusIcon} *${agent.role}* (${agent.id}) — ${agent.status}`;
      if (agent.currentTask) {
        text += `\n> ${agent.currentTask}`;
      }
      if (agent.iterations !== undefined) {
        text += `\n_Iterations: ${agent.iterations}_`;
      }

      blocks.push(SlackBlocks.section(text));
    }

    return blocks;
  }

  /**
   * Format cost summary as Slack blocks.
   */
  static costSummary(cost: CostSummaryData): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    blocks.push(SlackBlocks.header(':money_with_wings: Cost Summary'));

    // Budget progress bar
    const filled = Math.round(cost.budgetUsedPercent / 5);
    const empty = 20 - filled;
    const bar = '|'.repeat(filled) + '\u00b7'.repeat(empty);
    const budgetStatus = cost.budgetUsedPercent >= 90 ? ':warning:' :
      cost.budgetUsedPercent >= 75 ? ':large_orange_diamond:' : ':large_green_circle:';

    blocks.push(SlackBlocks.section(
      `${budgetStatus} Budget: \`[${bar}]\` ${cost.budgetUsedPercent.toFixed(1)}%\n` +
      `*Total cost:* $${cost.totalCost.toFixed(4)} | *Remaining:* $${cost.budgetRemaining.toFixed(4)}`,
    ));

    // Model breakdown
    if (cost.modelBreakdown.length > 0) {
      blocks.push(SlackBlocks.divider());

      const breakdown = cost.modelBreakdown
        .map((m) => `\`${m.model}\` — $${m.cost.toFixed(4)} (${m.calls} calls)`)
        .join('\n');

      blocks.push(SlackBlocks.section(`*Model Breakdown:*\n${breakdown}`));
    }

    return blocks;
  }

  /**
   * Format quality report as Slack blocks.
   */
  static qualityReport(report: QualityReportData): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    const overallIcon = report.passed ? ':white_check_mark:' : ':x:';
    blocks.push(SlackBlocks.header(`${overallIcon} Quality Report — Score: ${report.overallScore}/100`));

    // Gate results
    if (report.gates.length > 0) {
      const gateLines = report.gates.map((g) => {
        const icon = g.passed ? ':white_check_mark:' : ':x:';
        const issueText = g.issues > 0 ? ` (${g.issues} issue${g.issues !== 1 ? 's' : ''})` : '';
        return `${icon} *${g.gate}*${issueText}`;
      });

      blocks.push(SlackBlocks.section(gateLines.join('\n')));
    }

    return blocks;
  }

  /**
   * Format task progress as Slack blocks.
   */
  static taskProgress(task: TaskProgressData): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    const statusIcon = {
      pending: ':white_circle:',
      running: ':hourglass_flowing_sand:',
      completed: ':white_check_mark:',
      failed: ':x:',
    }[task.status];

    blocks.push(SlackBlocks.header(`${statusIcon} ${task.title}`));

    // Progress bar
    const filled = Math.round(task.progress / 5);
    const empty = 20 - filled;
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);

    blocks.push(SlackBlocks.section(
      `*Progress:* \`[${bar}]\` ${task.progress}%\n*Status:* ${task.status} | *ID:* \`${task.id}\``,
    ));

    // Subtasks
    if (task.subtasks && task.subtasks.length > 0) {
      blocks.push(SlackBlocks.divider());

      const subtaskLines = task.subtasks.map((st) => {
        const icon = st.status === 'completed' ? ':white_check_mark:' :
          st.status === 'running' ? ':arrow_forward:' :
            st.status === 'failed' ? ':x:' : ':white_circle:';
        return `${icon} ${st.title}`;
      });

      blocks.push(SlackBlocks.section(`*Subtasks:*\n${subtaskLines.join('\n')}`));
    }

    return blocks;
  }

  // ─── Primitive Block Builders ──────────────────────────────

  /**
   * Create a header block.
   */
  static header(text: string): SlackBlock {
    return {
      type: 'header',
      text: {
        type: 'plain_text',
        text: text.slice(0, 150), // Slack header limit
        emoji: true,
      },
    };
  }

  /**
   * Create a section block with markdown text.
   */
  static section(text: string): SlackBlock {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: text.slice(0, 3000), // Slack text limit
      },
    };
  }

  /**
   * Create a divider block.
   */
  static divider(): SlackBlock {
    return {
      type: 'divider',
    };
  }

  /**
   * Create a context block with markdown elements.
   */
  static context(elements: string[]): SlackBlock {
    return {
      type: 'context',
      elements: elements.slice(0, 10).map((text) => ({
        type: 'mrkdwn',
        text: text.slice(0, 3000),
      })),
    };
  }

  // ─── Formatting Helpers ────────────────────────────────────

  private static formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}
