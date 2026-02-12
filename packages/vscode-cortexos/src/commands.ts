/**
 * CortexOS Commands — VS Code command implementations.
 */

import * as vscode from 'vscode';
import type { EngineBridge } from './engine-bridge';
import type { CortexStatusBar } from './views/status-bar';

export function registerCommands(
  context: vscode.ExtensionContext,
  bridge: EngineBridge,
  statusBar: CortexStatusBar,
): void {
  // ===== cortexos.run =====
  context.subscriptions.push(
    vscode.commands.registerCommand('cortexos.run', async () => {
      const prompt = await vscode.window.showInputBox({
        prompt: 'What would you like CortexOS to do?',
        placeHolder: 'e.g., "add JWT authentication with tests"',
      });

      if (!prompt) return;

      const outputChannel = vscode.window.createOutputChannel('CortexOS Run');
      outputChannel.show(true);
      outputChannel.appendLine(`Running: ${prompt}\n`);

      try {
        const result = await bridge.run(prompt);

        outputChannel.appendLine(`\nResult: ${result.success ? 'SUCCESS' : 'FAILED'}`);

        if (result.filesChanged) {
          outputChannel.appendLine(`\nFiles changed: ${result.filesChanged.length}`);
          for (const change of result.filesChanged) {
            outputChannel.appendLine(`  ${change.type}: ${change.path}`);
          }
        }

        if (result.cost) {
          outputChannel.appendLine(`\nCost: $${result.cost.totalCost.toFixed(4)}`);
        }

        if (result.success) {
          vscode.window.showInformationMessage(`CortexOS: Task completed successfully`);
        } else {
          vscode.window.showWarningMessage(`CortexOS: Task completed with issues`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`\nError: ${msg}`);
        vscode.window.showErrorMessage(`CortexOS: ${msg}`);
      }
    }),
  );

  // ===== cortexos.chat =====
  context.subscriptions.push(
    vscode.commands.registerCommand('cortexos.chat', () => {
      const panel = vscode.window.createWebviewPanel(
        'cortexosChat',
        'CortexOS Chat',
        vscode.ViewColumn.Beside,
        { enableScripts: true },
      );

      panel.webview.html = getChatHTML();

      panel.webview.onDidReceiveMessage(async (message: { type: string; prompt?: string }) => {
        if (message.type === 'run' && message.prompt) {
          try {
            panel.webview.postMessage({ type: 'status', text: 'Running...' });
            const result = await bridge.run(message.prompt);
            panel.webview.postMessage({
              type: 'result',
              success: result.success,
              text: result.success ? 'Task completed!' : 'Task had issues',
              files: result.filesChanged?.length || 0,
            });
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              text: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });
    }),
  );

  // ===== cortexos.selectProvider =====
  context.subscriptions.push(
    vscode.commands.registerCommand('cortexos.selectProvider', async () => {
      try {
        const providers = await bridge.getAvailableProviders();

        if (providers.length === 0) {
          vscode.window.showWarningMessage('No providers available. Set API keys in environment or .cortexos.yaml');
          return;
        }

        const selected = await vscode.window.showQuickPick(providers, {
          placeHolder: 'Select a provider',
          title: 'CortexOS: Select Provider',
        });

        if (selected) {
          const config = vscode.workspace.getConfiguration('cortexos');
          await config.update('defaultProvider', selected, vscode.ConfigurationTarget.Workspace);
          vscode.window.showInformationMessage(`CortexOS: Provider set to ${selected}`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to list providers: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );

  // ===== cortexos.benchmark =====
  context.subscriptions.push(
    vscode.commands.registerCommand('cortexos.benchmark', async () => {
      const outputChannel = vscode.window.createOutputChannel('CortexOS Benchmark');
      outputChannel.show(true);
      outputChannel.appendLine('Starting CortexOS Benchmark...\n');

      try {
        const { BenchmarkRunner, BenchmarkReporter } = await import('cortexos');
        const runner = new BenchmarkRunner();
        const reporter = new BenchmarkReporter();

        outputChannel.appendLine(`Running ${runner.taskCount} tasks...\n`);

        const engine = {
          execute: async (_prompt: string) => ({
            success: false,
            error: 'VS Code benchmark: Use CLI for full benchmark execution',
            tokenUsage: { input: 0, output: 0 },
            costUsd: 0,
          }),
        };

        const report = await runner.run(engine);
        outputChannel.appendLine(reporter.formatTable(report));
      } catch (error) {
        outputChannel.appendLine(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );

  // ===== cortexos.showDashboard =====
  context.subscriptions.push(
    vscode.commands.registerCommand('cortexos.showDashboard', async () => {
      const config = vscode.workspace.getConfiguration('cortexos');
      const port = config.get<number>('dashboardPort', 3100);
      const url = vscode.Uri.parse(`http://localhost:${port}`);

      try {
        const { DashboardServer } = await import('cortexos');
        const eventBus = bridge.getEventBus();
        const tracer = bridge.getTracer();
        const metrics = bridge.getMetrics();

        if (eventBus && tracer && metrics) {
          const dashboard = new DashboardServer({ port, eventBus, tracer, metrics });
          const dashboardUrl = await dashboard.start();
          vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
        } else {
          // Open URL directly — dashboard may already be running
          vscode.env.openExternal(url);
        }
      } catch {
        // Fallback: just try to open the URL
        vscode.env.openExternal(url);
      }
    }),
  );
}

function getChatHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: var(--vscode-font-family); padding: 1rem; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  #messages { max-height: 60vh; overflow-y: auto; margin-bottom: 1rem; }
  .message { margin: 0.5rem 0; padding: 0.5rem; border-radius: 4px; }
  .user { background: var(--vscode-input-background); }
  .assistant { background: var(--vscode-textBlockQuote-background); }
  .error { background: var(--vscode-inputValidation-errorBackground); }
  #input { display: flex; gap: 0.5rem; }
  #prompt { flex: 1; padding: 0.5rem; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
  button { padding: 0.5rem 1rem; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
<h2>CortexOS Chat</h2>
<div id="messages"></div>
<div id="input">
  <input id="prompt" type="text" placeholder="Ask CortexOS..." />
  <button onclick="send()">Run</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const messages = document.getElementById('messages');
  const promptInput = document.getElementById('prompt');

  function send() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    addMessage('user', prompt);
    vscode.postMessage({ type: 'run', prompt });
    promptInput.value = '';
  }

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'status') addMessage('assistant', msg.text);
    if (msg.type === 'result') addMessage('assistant', msg.text + (msg.files ? ' (' + msg.files + ' files)' : ''));
    if (msg.type === 'error') addMessage('error', 'Error: ' + msg.text);
  });

  function addMessage(type, text) {
    const div = document.createElement('div');
    div.className = 'message ' + type;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }
</script>
</body>
</html>`;
}
