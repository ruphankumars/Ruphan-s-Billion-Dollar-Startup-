/**
 * Docker Worker — Entry Point for Container Execution
 *
 * This file runs INSIDE Docker containers. It communicates with
 * the host via stdin/stdout JSON protocol.
 *
 * Protocol:
 *   HOST → CONTAINER (stdin):  { type: 'execute', prompt: string, inputs: Record<string, unknown> }
 *   CONTAINER → HOST (stdout): { type: 'result', status: string, output: string, exitCode: number }
 *   CONTAINER → HOST (stdout): { type: 'log', level: string, message: string }
 *   CONTAINER → HOST (stdout): { type: 'progress', stage: string, percent: number }
 */

// ═══════════════════════════════════════════════════════════════
// PROTOCOL TYPES
// ═══════════════════════════════════════════════════════════════

interface WorkerMessage {
  type: 'execute';
  prompt: string;
  inputs: Record<string, unknown>;
  taskId: string;
  environment: string;
}

interface WorkerResult {
  type: 'result';
  status: 'completed' | 'failed';
  output: string;
  exitCode: number;
  filesChanged?: Array<{ path: string; action: string }>;
  duration: number;
}

interface WorkerLog {
  type: 'log';
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
}

interface WorkerProgress {
  type: 'progress';
  stage: string;
  percent: number;
  message?: string;
}

type WorkerOutput = WorkerResult | WorkerLog | WorkerProgress;

// ═══════════════════════════════════════════════════════════════
// WORKER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

function send(msg: WorkerOutput): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function log(level: WorkerLog['level'], message: string): void {
  send({ type: 'log', level, message, timestamp: Date.now() });
}

function progress(stage: string, percent: number, message?: string): void {
  send({ type: 'progress', stage, percent, message });
}

async function processTask(message: WorkerMessage): Promise<void> {
  const startTime = Date.now();

  try {
    log('info', `Starting task ${message.taskId} in ${message.environment}`);
    progress('initializing', 0, 'Setting up execution environment');

    // Environment info
    log('info', `Node.js ${process.version}`);
    log('info', `Platform: ${process.platform} ${process.arch}`);
    log('info', `Working directory: ${process.cwd()}`);

    progress('executing', 25, 'Processing prompt');

    // Process the task
    const prompt = message.prompt;
    const inputs = message.inputs;

    log('info', `Prompt: ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}`);
    log('info', `Inputs: ${JSON.stringify(inputs).slice(0, 200)}`);

    progress('executing', 50, 'Running task logic');

    // In a full implementation, this would:
    // 1. Load the CortexOS SDK
    // 2. Create an agent with the given prompt
    // 3. Execute using the container's tools (git, npm, etc.)
    // 4. Return results with file changes

    const output = `Task "${prompt}" processed successfully with ${Object.keys(inputs).length} inputs`;

    progress('completing', 90, 'Finalizing results');

    const duration = Date.now() - startTime;
    send({
      type: 'result',
      status: 'completed',
      output,
      exitCode: 0,
      duration,
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    log('error', `Task failed: ${errorMsg}`);
    send({
      type: 'result',
      status: 'failed',
      output: errorMsg,
      exitCode: 1,
      duration,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// STDIN READER
// ═══════════════════════════════════════════════════════════════

function main(): void {
  let data = '';

  process.stdin.setEncoding('utf-8');
  process.stdin.resume();

  process.stdin.on('data', (chunk) => {
    data += chunk;
  });

  process.stdin.on('end', () => {
    try {
      const message = JSON.parse(data) as WorkerMessage;

      if (message.type !== 'execute') {
        log('error', `Unknown message type: ${(message as { type: string }).type}`);
        process.exit(1);
      }

      processTask(message).then(() => {
        process.exit(0);
      }).catch((err) => {
        log('error', `Unhandled error: ${err}`);
        process.exit(1);
      });
    } catch (err) {
      log('error', `Failed to parse input: ${err}`);
      process.exit(1);
    }
  });

  // Handle environment variable input (alternative to stdin)
  const envPrompt = process.env.CORTEXOS_PROMPT;
  const envTaskId = process.env.CORTEXOS_TASK_ID;
  const envInputs = process.env.CORTEXOS_INPUTS;

  if (envPrompt && envTaskId) {
    const message: WorkerMessage = {
      type: 'execute',
      prompt: envPrompt,
      inputs: envInputs ? JSON.parse(envInputs) : {},
      taskId: envTaskId,
      environment: process.env.CORTEXOS_ENVIRONMENT ?? 'unknown',
    };

    // Close stdin and process via env vars
    process.stdin.destroy();
    processTask(message).then(() => {
      process.exit(0);
    }).catch((err) => {
      log('error', `Unhandled error: ${err}`);
      process.exit(1);
    });
  }
}

main();
