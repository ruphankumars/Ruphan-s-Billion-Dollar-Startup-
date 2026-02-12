/**
 * CortexOS Status Bar — Shows pipeline stage, elapsed time, and cost.
 */

import * as vscode from 'vscode';

export class CortexStatusBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private startTime: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentStage: string = '';
  private totalCost: number = 0;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = 'cortexos.showDashboard';
    this.reset();
    this.statusBarItem.show();
  }

  /**
   * Handle events from the CortexOS EventBus.
   */
  handleEvent(event: string, data: unknown): void {
    switch (event) {
      case 'engine:start':
        this.startTime = Date.now();
        this.totalCost = 0;
        this.currentStage = 'Starting...';
        this.startTimer();
        this.update();
        break;

      case 'stage:start': {
        const d = data as { stage?: string } | null;
        this.currentStage = d?.stage || 'Processing';
        this.update();
        break;
      }

      case 'stage:complete': {
        const d = data as { stage?: string } | null;
        this.currentStage = `${d?.stage || 'Stage'} done`;
        this.update();
        break;
      }

      case 'cost:update': {
        const d = data as { totalCost?: number } | null;
        if (d?.totalCost !== undefined) {
          this.totalCost = d.totalCost;
          this.update();
        }
        break;
      }

      case 'engine:complete':
        this.stopTimer();
        this.statusBarItem.text = `$(check) CortexOS: Done ($${this.totalCost.toFixed(4)})`;
        this.statusBarItem.backgroundColor = undefined;
        break;

      case 'engine:error':
        this.stopTimer();
        this.statusBarItem.text = '$(error) CortexOS: Error';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.errorBackground',
        );
        break;
    }
  }

  private update(): void {
    const elapsed = this.startTime ? ((Date.now() - this.startTime) / 1000).toFixed(1) + 's' : '';
    const cost = this.totalCost > 0 ? ` $${this.totalCost.toFixed(4)}` : '';
    this.statusBarItem.text = `$(loading~spin) CortexOS: ${this.currentStage} ${elapsed}${cost}`;
    this.statusBarItem.backgroundColor = undefined;
  }

  private reset(): void {
    this.statusBarItem.text = '$(hubot) CortexOS: Idle';
    this.statusBarItem.tooltip = 'Click to open CortexOS Dashboard';
    this.statusBarItem.backgroundColor = undefined;
    this.startTime = null;
    this.totalCost = 0;
    this.currentStage = '';
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.update(), 500);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.stopTimer();
    this.statusBarItem.dispose();
  }
}
