# Tutorial 3: Building Custom Plugins

> Extend CortexOS with your own tools, gates, and middleware

---

## What You'll Build

A **Performance Monitor** plugin that:
1. Provides a `perf_benchmark` tool to measure code execution time
2. Adds a `performance` quality gate that fails if benchmarks regress
3. Includes middleware that logs timing for every pipeline execution

## Step 1: Create the Plugin File

Create `perf-monitor-plugin.ts`:

```typescript
import { CortexPlugin, PluginContext } from 'cortexos';

interface PerfConfig {
  maxDurationMs: number;
  trackHistory: boolean;
}

export class PerfMonitorPlugin implements CortexPlugin {
  name = 'perf-monitor';
  version = '1.0.0';

  private history: Array<{ timestamp: number; durationMs: number }> = [];

  register(ctx: PluginContext): void {
    const config: PerfConfig = {
      maxDurationMs: ctx.getConfig('maxDurationMs') ?? 5000,
      trackHistory: ctx.getConfig('trackHistory') ?? true,
    };

    // Tool: Run performance benchmarks
    ctx.registerTool({
      name: 'perf_benchmark',
      description: 'Measure execution time of a shell command',
      parameters: {
        command: { type: 'string', description: 'Command to benchmark', required: true },
        iterations: { type: 'number', description: 'Number of iterations', required: false },
      },
      execute: async (args) => {
        const iterations = args.iterations ?? 3;
        const times: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const start = performance.now();
          // Execute the command (simplified)
          await new Promise(resolve => setTimeout(resolve, 10));
          times.push(performance.now() - start);
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);

        return {
          success: true,
          output: JSON.stringify({
            command: args.command,
            iterations,
            avgMs: avg.toFixed(2),
            minMs: min.toFixed(2),
            maxMs: max.toFixed(2),
          }),
        };
      },
    });

    // Gate: Performance regression check
    ctx.registerGate({
      name: 'performance',
      description: `Fail if execution exceeds ${config.maxDurationMs}ms`,
      run: async (context) => {
        // Check if any recent run exceeded the threshold
        const recentDurations = this.history.slice(-5);
        const avgDuration = recentDurations.length > 0
          ? recentDurations.reduce((a, b) => a + b.durationMs, 0) / recentDurations.length
          : 0;

        const passed = avgDuration < config.maxDurationMs || recentDurations.length === 0;

        return {
          passed,
          score: passed ? 1 : config.maxDurationMs / avgDuration,
          issues: passed ? [] : [{
            message: `Average duration ${avgDuration.toFixed(0)}ms exceeds ${config.maxDurationMs}ms`,
            severity: 'warning',
          }],
        };
      },
    });

    // Middleware: Track execution time
    ctx.registerMiddleware('post-execute', async (result, next) => {
      if (config.trackHistory) {
        this.history.push({
          timestamp: Date.now(),
          durationMs: result.duration ?? 0,
        });

        // Keep only last 100 entries
        if (this.history.length > 100) {
          this.history = this.history.slice(-100);
        }
      }

      return next(result);
    });
  }
}
```

## Step 2: Register the Plugin

```typescript
import { CortexEngine } from 'cortexos';
import { PerfMonitorPlugin } from './perf-monitor-plugin';

const engine = new CortexEngine({
  plugins: {
    'perf-monitor': {
      maxDurationMs: 3000,
      trackHistory: true,
    },
  },
});

engine.registerPlugin(new PerfMonitorPlugin());

// Now perf_benchmark tool and performance gate are available
const result = await engine.run({
  prompt: 'Optimize the database query in user-service.ts',
});
```

## Step 3: Use the Tool in Prompts

Agents can now use `perf_benchmark` automatically:

```typescript
const result = await engine.run({
  prompt: 'Benchmark the API response times and optimize any endpoint over 200ms',
});
```

The engine will:
1. Discover the `perf_benchmark` tool is available
2. Use it to measure API endpoints
3. Optimize slow ones
4. The `performance` gate checks the result
5. Middleware logs the execution time

---

## Plugin Best Practices

1. **Declare capabilities** — Only request what you need
2. **Handle errors gracefully** — Don't crash the pipeline
3. **Keep tools focused** — One tool, one purpose
4. **Gate scores** — Return 0-1 scores, not just pass/fail
5. **Middleware** — Don't mutate results unless necessary; always call `next()`

---

## Next Steps

- See the [5 built-in plugins](../plugin-guide.md) for reference implementations
- Read the [Architecture Guide](../architecture.md) for deeper understanding
- Check the [API Reference](../api-reference.md) for complete type definitions
