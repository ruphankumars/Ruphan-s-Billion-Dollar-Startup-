/**
 * `cortexos dashboard` — Real-time observability dashboard.
 *
 * Starts an HTTP + WebSocket server that serves a live dashboard
 * for monitoring CortexOS pipeline execution, traces, metrics, and costs.
 */

import { Command } from 'commander';
import { DashboardServer } from '../../dashboard/server.js';
import { EventBus } from '../../core/events.js';
import { Tracer } from '../../observability/tracer.js';
import { MetricsCollector } from '../../observability/metrics.js';

export function createDashboardCommand(): Command {
  const cmd = new Command('dashboard');

  cmd
    .description('Start the CortexOS observability dashboard')
    .option('-p, --port <port>', 'Port to listen on', parseInt, 3100)
    .option('--no-open', 'Do not auto-open browser')
    .action(async (options: DashboardCommandOptions) => {
      await startDashboard(options);
    });

  return cmd;
}

interface DashboardCommandOptions {
  port: number;
  open: boolean;
}

async function startDashboard(options: DashboardCommandOptions): Promise<void> {
  console.log('\n  CortexOS Dashboard');
  console.log('  ==================\n');

  // Create observability subsystems
  const eventBus = new EventBus();
  const tracer = new Tracer();
  const metrics = new MetricsCollector();

  const dashboard = new DashboardServer({
    port: options.port,
    eventBus,
    tracer,
    metrics,
  });

  try {
    const url = await dashboard.start();
    console.log(`  Dashboard running at: ${url}`);
    console.log('  Press Ctrl+C to stop\n');

    // Auto-open in browser
    if (options.open !== false) {
      try {
        const { exec } = await import('child_process');
        const platform = process.platform;
        const openCmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} ${url}`);
      } catch {
        // Ignore browser open errors
      }
    }

    // Keep process alive until SIGINT
    await new Promise<void>((resolve) => {
      process.on('SIGINT', async () => {
        console.log('\n  Stopping dashboard...');
        await dashboard.stop();
        console.log('  Dashboard stopped.\n');
        resolve();
      });
    });
  } catch (error) {
    console.error(`\n  Failed to start dashboard: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
