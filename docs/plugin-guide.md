# Plugin Development Guide

> Build custom plugins for CortexOS

---

## Plugin Anatomy

Every CortexOS plugin implements the `CortexPlugin` interface:

```typescript
import { CortexPlugin, PluginContext } from 'cortexos';

export class MyPlugin implements CortexPlugin {
  name = 'my-plugin';
  version = '1.0.0';

  register(ctx: PluginContext): void {
    // Register tools, gates, roles, middleware here
  }
}
```

## Registration API

The `PluginContext` provides 5 registration methods:

### registerTool — Add custom tools

```typescript
ctx.registerTool({
  name: 'my_tool',
  description: 'Does something useful',
  parameters: {
    input: { type: 'string', description: 'The input', required: true },
  },
  execute: async (args, context) => {
    const result = doSomething(args.input);
    return { success: true, output: result };
  },
});
```

### registerGate — Add quality gates

```typescript
ctx.registerGate({
  name: 'my-gate',
  description: 'Checks something important',
  run: async (context) => {
    const issues = await checkSomething(context.files);
    return {
      passed: issues.length === 0,
      score: 1 - issues.length / 10,
      issues,
    };
  },
});
```

### registerMiddleware — Hook into pipeline stages

```typescript
// Run after EXECUTE stage
ctx.registerMiddleware('post-execute', async (result, next) => {
  console.log(`Execution completed: ${result.filesChanged.length} files`);
  return next(result);
});

// Run before VERIFY stage
ctx.registerMiddleware('pre-verify', async (result, next) => {
  // Modify or inspect before verification
  return next(result);
});
```

### registerRole — Define custom agent roles

```typescript
ctx.registerRole({
  name: 'security-auditor',
  description: 'Specialized in security analysis',
  systemPrompt: 'You are a security expert. Analyze code for vulnerabilities...',
  capabilities: ['file_read', 'shell_execute'],
});
```

### registerProvider — Add LLM providers

```typescript
ctx.registerProvider({
  name: 'my-llm',
  complete: async (messages, options) => {
    const response = await callMyLLM(messages);
    return { content: response.text, usage: response.tokens };
  },
});
```

## Configuration

Plugins can read configuration:

```typescript
register(ctx: PluginContext) {
  const threshold = ctx.getConfig<number>('maxComplexity') ?? 15;
}
```

Users configure plugins in their CortexOS config:

```typescript
// cortexos.config.ts
export default {
  plugins: {
    'my-plugin': {
      maxComplexity: 20,
      enabled: true,
    },
  },
};
```

## Sandboxing

All plugins run in a sandboxed environment with capability-based permissions:

```typescript
// Plugin declares required capabilities
export class MyPlugin implements CortexPlugin {
  capabilities = ['file:read', 'shell:execute', 'network:fetch'];
}
```

Available capabilities:
- `file:read` — Read files from the workspace
- `file:write` — Write/modify files
- `shell:execute` — Run shell commands
- `network:fetch` — Make HTTP requests
- `memory:read` — Access memory store
- `memory:write` — Store memories
- `provider:call` — Make LLM calls

Plugins without declared capabilities run in restricted mode.

## Lifecycle Hooks

```typescript
export class MyPlugin implements CortexPlugin {
  name = 'my-plugin';
  version = '1.0.0';

  register(ctx: PluginContext) { /* setup */ }

  // Optional lifecycle methods
  async onActivate?(): Promise<void>;    // Called when plugin is loaded
  async onDeactivate?(): Promise<void>;  // Called on shutdown
  async onError?(error: Error): Promise<void>; // Called on plugin errors
}
```

## Example: Complete Plugin

```typescript
import { CortexPlugin, PluginContext, QualityContext, GateResult } from 'cortexos';

export class TodoCheckerPlugin implements CortexPlugin {
  name = 'todo-checker';
  version = '1.0.0';

  register(ctx: PluginContext): void {
    const maxTodos = ctx.getConfig<number>('maxTodos') ?? 10;

    // Tool: scan for TODOs
    ctx.registerTool({
      name: 'todo_scan',
      description: 'Scan files for TODO comments',
      parameters: {
        path: { type: 'string', description: 'Directory to scan', required: true },
      },
      execute: async (args) => {
        const todos = await scanForTodos(args.path);
        return {
          success: true,
          output: JSON.stringify({ count: todos.length, items: todos }),
        };
      },
    });

    // Gate: fail if too many TODOs
    ctx.registerGate({
      name: 'todo-limit',
      description: `Fail if more than ${maxTodos} TODOs in changed files`,
      run: async (context: QualityContext): Promise<GateResult> => {
        let todoCount = 0;
        for (const file of context.filesChanged || []) {
          const content = await readFile(file);
          const matches = content.match(/\/\/\s*TODO/gi);
          todoCount += matches?.length ?? 0;
        }

        return {
          passed: todoCount <= maxTodos,
          score: Math.max(0, 1 - todoCount / (maxTodos * 2)),
          issues: todoCount > maxTodos
            ? [{ message: `Found ${todoCount} TODOs (max: ${maxTodos})`, severity: 'warning' }]
            : [],
        };
      },
    });

    // Middleware: log TODO count after execution
    ctx.registerMiddleware('post-execute', async (result, next) => {
      console.log(`[todo-checker] Scanning ${result.filesChanged?.length ?? 0} changed files...`);
      return next(result);
    });
  }
}
```

## Publishing Your Plugin

1. Create an npm package:
```bash
npm init -y
npm install cortexos --save-peer
```

2. Export your plugin:
```typescript
// index.ts
export { TodoCheckerPlugin } from './todo-checker-plugin';
```

3. Users install and register:
```typescript
import { CortexEngine } from 'cortexos';
import { TodoCheckerPlugin } from 'cortexos-plugin-todo-checker';

const engine = new CortexEngine();
engine.registerPlugin(new TodoCheckerPlugin());
```
