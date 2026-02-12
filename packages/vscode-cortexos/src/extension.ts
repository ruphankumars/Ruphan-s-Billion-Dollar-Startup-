/**
 * CortexOS VS Code Extension — Entry point.
 *
 * Activates the extension, creates the engine bridge,
 * registers commands, and wires up UI components.
 */

import * as vscode from 'vscode';
import { EngineBridge } from './engine-bridge';
import { registerCommands } from './commands';
import { CortexStatusBar } from './views/status-bar';
import { CortexSidebar } from './views/sidebar';
import { CortexOutputChannel } from './views/output-channel';

let bridge: EngineBridge | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // Create the engine bridge
  bridge = new EngineBridge(workspaceDir);

  // Create UI components
  const config = vscode.workspace.getConfiguration('cortexos');
  const showStatusBar = config.get<boolean>('showStatusBar', true);

  const statusBar = new CortexStatusBar();
  const sidebar = new CortexSidebar(bridge);
  const output = new CortexOutputChannel();

  // Wire EventBus events to UI
  bridge.onEvent((event: string, data: unknown) => {
    statusBar.handleEvent(event, data);
    sidebar.handleEvent(event, data);
    output.handleEvent(event, data);
  });

  // Register commands
  registerCommands(context, bridge, statusBar);

  // Register sidebar tree provider
  vscode.window.registerTreeDataProvider('cortexos-agents', sidebar);

  // Add disposables
  context.subscriptions.push(statusBar, output);

  // Show status bar based on setting
  if (!showStatusBar) {
    statusBar.dispose();
  }

  // Log activation
  output.handleEvent('engine:start', { message: 'CortexOS extension activated' });
}

export function deactivate(): void {
  if (bridge) {
    bridge.shutdown().catch(() => {
      // Ignore shutdown errors
    });
    bridge = undefined;
  }
}
