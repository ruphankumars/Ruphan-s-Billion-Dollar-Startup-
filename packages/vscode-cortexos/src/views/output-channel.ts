/**
 * CortexOS Output Channel — Structured logging of pipeline events.
 */

import * as vscode from 'vscode';

export class CortexOutputChannel implements vscode.Disposable {
  private channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel('CortexOS');
  }

  /**
   * Handle events from the CortexOS EventBus.
   */
  handleEvent(event: string, data: unknown): void {
    const timestamp = new Date().toLocaleTimeString();
    const d = data as Record<string, unknown> | null;

    switch (event) {
      case 'engine:start':
        this.channel.appendLine(`\n${'='.repeat(60)}`);
        this.channel.appendLine(`[${timestamp}] [engine:start] Pipeline execution started`);
        this.channel.appendLine(`${'='.repeat(60)}`);
        break;

      case 'engine:complete':
        this.channel.appendLine(`[${timestamp}] [engine:complete] Pipeline finished`);
        if (d?.duration) {
          this.channel.appendLine(`  Duration: ${((d.duration as number) / 1000).toFixed(2)}s`);
        }
        break;

      case 'engine:error':
        this.channel.appendLine(`[${timestamp}] [engine:error] Pipeline failed: ${d?.message || 'Unknown error'}`);
        break;

      case 'stage:start':
        this.channel.appendLine(`[${timestamp}] [stage:start] ${d?.stage || 'Unknown stage'}...`);
        break;

      case 'stage:complete':
        this.channel.appendLine(`[${timestamp}] [stage:complete] ${d?.stage || 'Unknown stage'} done`);
        break;

      case 'agent:start':
        this.channel.appendLine(`[${timestamp}] [agent:start] [${d?.role || 'agent'}] ${d?.taskId || ''}`);
        break;

      case 'agent:complete': {
        const duration = d?.duration ? ` (${((d.duration as number) / 1000).toFixed(1)}s)` : '';
        this.channel.appendLine(`[${timestamp}] [agent:complete] [${d?.role || 'agent'}] ${d?.taskId || ''}${duration}`);
        break;
      }

      case 'agent:error':
        this.channel.appendLine(`[${timestamp}] [agent:error] [${d?.role || 'agent'}] ${d?.error || 'Unknown error'}`);
        break;

      case 'agent:tool':
        this.channel.appendLine(`[${timestamp}] [agent:tool] ${d?.tool || 'unknown'}: ${d?.action || ''}`);
        break;

      case 'cost:update':
        this.channel.appendLine(`[${timestamp}] [cost:update] $${(d?.totalCost as number || 0).toFixed(4)} cumulative`);
        break;

      case 'memory:recall':
        this.channel.appendLine(`[${timestamp}] [memory:recall] Query: ${String(d?.query || '').slice(0, 80)}`);
        break;

      case 'memory:store':
        this.channel.appendLine(`[${timestamp}] [memory:store] Stored ${d?.type || 'memory'}`);
        break;

      case 'quality:gate':
        this.channel.appendLine(`[${timestamp}] [quality:gate] ${d?.gate || 'gate'}: ${d?.passed ? 'PASS' : 'FAIL'}`);
        break;

      case 'plan:created':
        this.channel.appendLine(`[${timestamp}] [plan:created] Execution plan created`);
        break;

      default:
        this.channel.appendLine(`[${timestamp}] [${event}] ${JSON.stringify(d || {}).slice(0, 120)}`);
    }
  }

  /**
   * Show the output channel.
   */
  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
