/**
 * CortexOS Sidebar — TreeDataProvider for agents, memories, and traces.
 */

import * as vscode from 'vscode';
import type { EngineBridge } from '../engine-bridge';

export interface CortexTreeItem extends vscode.TreeItem {
  children?: CortexTreeItem[];
}

interface AgentInfo {
  taskId: string;
  role: string;
  status: 'running' | 'complete' | 'error';
  startTime: number;
}

interface MemoryInfo {
  type: string;
  content: string;
  timestamp: number;
}

interface TraceInfo {
  traceId: string;
  name: string;
  status: string;
  duration?: number;
}

export class CortexSidebar implements vscode.TreeDataProvider<CortexTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CortexTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private agents: AgentInfo[] = [];
  private memories: MemoryInfo[] = [];
  private traces: TraceInfo[] = [];
  private bridge: EngineBridge;

  constructor(bridge: EngineBridge) {
    this.bridge = bridge;
  }

  /**
   * Handle events from the CortexOS EventBus.
   */
  handleEvent(event: string, data: unknown): void {
    const d = data as Record<string, unknown> | null;

    switch (event) {
      case 'agent:start':
        this.agents.push({
          taskId: String(d?.taskId || 'unknown'),
          role: String(d?.role || 'agent'),
          status: 'running',
          startTime: Date.now(),
        });
        break;

      case 'agent:complete': {
        const agent = this.agents.find(a => a.taskId === d?.taskId);
        if (agent) agent.status = 'complete';
        break;
      }

      case 'agent:error': {
        const agent = this.agents.find(a => a.taskId === d?.taskId);
        if (agent) agent.status = 'error';
        break;
      }

      case 'memory:recall':
      case 'memory:store':
        this.memories.unshift({
          type: event === 'memory:recall' ? 'recall' : 'store',
          content: String(d?.query || d?.content || '').slice(0, 80),
          timestamp: Date.now(),
        });
        if (this.memories.length > 20) this.memories.length = 20;
        break;

      case 'engine:start':
        // Reset for new execution
        this.agents = [];
        break;

      case 'engine:complete':
      case 'engine:error':
        this.traces.unshift({
          traceId: String(d?.traceId || 'unknown'),
          name: String(d?.prompt || 'execution').slice(0, 50),
          status: event === 'engine:complete' ? 'success' : 'error',
          duration: d?.duration as number | undefined,
        });
        if (this.traces.length > 20) this.traces.length = 20;
        break;
    }

    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: CortexTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CortexTreeItem): CortexTreeItem[] {
    if (!element) {
      // Root level: categories
      return [
        this.createCategory('Agents', `${this.agents.length} agents`, this.agents.length > 0),
        this.createCategory('Memories', `${this.memories.length} entries`, this.memories.length > 0),
        this.createCategory('Traces', `${this.traces.length} traces`, this.traces.length > 0),
      ];
    }

    // Children based on category
    if (element.label === 'Agents') {
      return this.agents.map(a => this.createAgentItem(a));
    }
    if (element.label === 'Memories') {
      return this.memories.map(m => this.createMemoryItem(m));
    }
    if (element.label === 'Traces') {
      return this.traces.map(t => this.createTraceItem(t));
    }

    return [];
  }

  private createCategory(label: string, description: string, hasChildren: boolean): CortexTreeItem {
    const item: CortexTreeItem = new vscode.TreeItem(
      label,
      hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.description = description;
    return item;
  }

  private createAgentItem(agent: AgentInfo): CortexTreeItem {
    const icon = agent.status === 'running' ? '$(loading~spin)'
      : agent.status === 'complete' ? '$(check)' : '$(error)';
    const item = new vscode.TreeItem(`${icon} ${agent.role}`, vscode.TreeItemCollapsibleState.None);
    item.description = agent.taskId;
    item.tooltip = `${agent.role} — ${agent.status} — ${agent.taskId}`;
    return item;
  }

  private createMemoryItem(mem: MemoryInfo): CortexTreeItem {
    const icon = mem.type === 'recall' ? '$(search)' : '$(save)';
    const item = new vscode.TreeItem(`${icon} ${mem.content}`, vscode.TreeItemCollapsibleState.None);
    item.description = new Date(mem.timestamp).toLocaleTimeString();
    return item;
  }

  private createTraceItem(trace: TraceInfo): CortexTreeItem {
    const icon = trace.status === 'success' ? '$(check)' : '$(error)';
    const duration = trace.duration ? ` (${(trace.duration / 1000).toFixed(1)}s)` : '';
    const item = new vscode.TreeItem(`${icon} ${trace.name}${duration}`, vscode.TreeItemCollapsibleState.None);
    item.description = trace.traceId;
    return item;
  }
}
