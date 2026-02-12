# Contributing to CortexOS

Thank you for your interest in contributing! This guide will help you get set up and productive.

## Prerequisites

- **Node.js** >= 20.0.0
- **Git**
- **npm** (comes with Node.js)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/cortexos/cortexos.git
cd cortexos

# Install dependencies
npm install

# Run the test suite
npm test

# Build the project
npm run build

# Type-check without emitting
npm run typecheck
```

## Project Structure

```
src/
  core/        — Engine pipeline, config, events, error classes
  agents/      — Agent execution, swarm coordination, sandboxing
  providers/   — LLM provider adapters (Anthropic, OpenAI, etc.)
  memory/      — Persistent memory with vector search
  quality/     — Quality gates (syntax, lint, type-check, test, security)
  code/        — Code intelligence (AST, repo mapping, LSP)
  prompt/      — Prompt analysis, enhancement, decomposition
  reasoning/   — Advanced reasoning strategies
  tools/       — Tool registry and built-in tools
  cost/        — Cost tracking and budget management
  observability/ — Tracing and metrics
  plugins/     — Plugin system
  dashboard/   — Real-time monitoring
  benchmark/   — Performance benchmarks
  swebench/    — SWE-bench integration

test/
  unit/        — Unit tests (mirrors src/ structure)
  integration/ — Integration tests
  fixtures/    — Test fixtures and sample data

bin/
  cortexos.ts  — CLI entry point
```

## Development Workflow

### Running Tests

```bash
# Run all tests
npm test

# Run tests once (CI mode)
npm run test:run

# Run tests with coverage
npm run test:coverage

# Run specific test file
npx vitest run test/unit/providers/circuit-breaker.test.ts
```

### Building

```bash
# Full build
npm run build

# Watch mode during development
npm run dev

# Clean build artifacts
npm run clean
```

### Linting

```bash
# Check for lint issues
npm run lint

# Auto-fix lint issues
npm run lint:fix
```

## Writing Tests

- Place unit tests in `test/unit/` mirroring the `src/` directory structure
- Use Vitest (`describe`, `it`, `expect`)
- Mock external dependencies (LLM APIs, file system, child processes)
- Aim for meaningful coverage on business logic, not just line counts

Example:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from '../../../src/providers/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('should transition to OPEN after threshold failures', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });
    const failing = () => Promise.reject(new Error('fail'));

    await expect(breaker.execute(failing)).rejects.toThrow();
    await expect(breaker.execute(failing)).rejects.toThrow();
    // Now circuit should be open
    expect(breaker.getState()).toBe('OPEN');
  });
});
```

## Pull Request Process

1. **Fork** the repository and create a feature branch
2. **Write tests** for any new functionality
3. **Ensure all tests pass**: `npm run test:run`
4. **Ensure clean build**: `npm run build`
5. **Ensure lint passes**: `npm run lint`
6. **Write a clear PR description** explaining what changed and why
7. **Keep PRs focused** — one feature or fix per PR

## Code Style

- TypeScript strict mode
- ESM modules (`.js` extensions in imports)
- Descriptive variable and function names
- JSDoc comments on public APIs
- Consistent error handling with typed errors from `core/errors.ts`

## Commit Messages

Follow conventional format:

```
feat: add circuit breaker to provider resilience
fix: prevent memory leak in vector store
docs: update README with failover configuration
test: add unit tests for rate limiter
refactor: simplify agent pool shutdown logic
```

## Need Help?

- Open an [issue](https://github.com/cortexos/cortexos/issues) for bugs or feature requests
- Check existing issues before creating duplicates
