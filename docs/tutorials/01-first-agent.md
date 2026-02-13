# Tutorial 1: Your First AI Agent

> Build and run your first CortexOS agent in 5 minutes

---

## Prerequisites

- Node.js 20+
- An Anthropic API key (or any supported provider)

## Step 1: Create a Project

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install cortexos typescript tsx
```

## Step 2: Set Your API Key

```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
```

## Step 3: Write Your Agent

Create `agent.ts`:

```typescript
import { CortexEngine } from 'cortexos';

async function main() {
  const engine = new CortexEngine({
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  });

  console.log('Running CortexOS pipeline...\n');

  const result = await engine.run({
    prompt: 'Create a TypeScript function that validates email addresses using regex, with unit tests',
  });

  console.log('Files changed:', result.filesChanged);
  console.log('Quality:', result.qualityReport?.passed ? 'PASSED' : 'FAILED');
  console.log('Cost:', `$${result.cost.toFixed(4)}`);
}

main().catch(console.error);
```

## Step 4: Run It

```bash
npx tsx agent.ts
```

You'll see the 8-stage pipeline execute:

```
Running CortexOS pipeline...

◆ RECALL    0 memories found (first run)
◆ ANALYZE   intent=generate, complexity=low, entities=[email, regex, tests]
◆ ENHANCE   context injected
◆ DECOMPOSE 2 subtasks: [implement, test]
◆ PLAN      agents=[developer, tester], wave=1
◆ EXECUTE   wave 1/1 complete
◆ VERIFY    6/6 gates passed ✓
◆ MEMORIZE  1 learning stored

Files changed: ['src/validate-email.ts', 'test/validate-email.test.ts']
Quality: PASSED
Cost: $0.0123
```

## Step 5: Run Again — Memory Kicks In

Run the same agent again with a related task:

```typescript
const result = await engine.run({
  prompt: 'Add phone number validation to the validator module',
});
```

This time, CortexOS **recalls** the email validator pattern from the first run and applies it consistently.

## What Just Happened?

1. **RECALL** searched the vector store for relevant past experiences
2. **ANALYZE** determined this is a code generation task with low complexity
3. **ENHANCE** built a rich prompt with code patterns from memory
4. **DECOMPOSE** split it into implementation + testing subtasks
5. **PLAN** assigned a developer agent and tester agent
6. **EXECUTE** ran both agents (developer writes code, tester writes tests)
7. **VERIFY** checked syntax, linting, types, tests, security, and did an AI review
8. **MEMORIZE** stored the pattern for future recall

---

## Next: [Tutorial 2 — Multi-Agent Tasks](./02-multi-agent.md)
