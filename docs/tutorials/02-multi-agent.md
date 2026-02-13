# Tutorial 2: Multi-Agent Tasks

> Harness the power of multi-agent swarm execution

---

## How Agents Work Together

CortexOS automatically decomposes complex tasks into subtasks and assigns them to specialized agents. You don't need to manually orchestrate anything — the engine handles it.

## Example: Full-Stack Feature

```typescript
import { CortexEngine } from 'cortexos';

const engine = new CortexEngine({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
});

const result = await engine.run({
  prompt: `Add a user settings page with:
    - API endpoint: GET/PUT /api/settings
    - Database migration for settings table
    - React component with form validation
    - Unit tests for API and component
    - Update the sidebar navigation`,
});
```

### What CortexOS Does Internally

**DECOMPOSE** creates a task DAG:
```
┌─ Task 1: Database migration (Developer)
│
├─ Task 2: API endpoint (Developer)        ← depends on Task 1
│
├─ Task 3: React component (Developer)     ← depends on Task 2
│
├─ Task 4: Navigation update (Developer)   ← independent
│
└─ Task 5: Unit tests (Tester)            ← depends on Tasks 2, 3
```

**PLAN** creates execution waves:
```
Wave 1: [Task 1, Task 4]    ← parallel (independent)
Wave 2: [Task 2]            ← sequential (needs migration)
Wave 3: [Task 3]            ← sequential (needs API)
Wave 4: [Task 5]            ← sequential (needs implementation)
```

**EXECUTE** runs agents in waves:
- Wave 1: Developer writes migration + Developer updates navigation (parallel)
- Wave 2: Developer builds API endpoint
- Wave 3: Developer creates React component
- Wave 4: Tester writes all unit tests

## Listening to Agent Events

```typescript
import { CortexEngine, EventBus } from 'cortexos';

const engine = new CortexEngine();

engine.on('agent:started', (event) => {
  console.log(`Agent "${event.role}" started on: ${event.task}`);
});

engine.on('agent:completed', (event) => {
  console.log(`Agent "${event.role}" finished: ${event.filesChanged.length} files`);
});

engine.on('wave:completed', (event) => {
  console.log(`Wave ${event.waveIndex} complete (${event.agents.length} agents)`);
});

const result = await engine.run({
  prompt: 'Refactor the authentication module and add OAuth support',
});
```

## Agent Roles

CortexOS uses 9 roles — each has specialized system prompts and capabilities:

| Role | When Used |
|------|----------|
| **Orchestrator** | Complex multi-step tasks requiring coordination |
| **Architect** | System design, database schema, API design |
| **Developer** | Code implementation |
| **Tester** | Test writing and execution |
| **Reviewer** | Code review and quality feedback |
| **Researcher** | Information gathering, documentation reading |
| **Validator** | Output validation against requirements |
| **UX Agent** | UI/UX implementation and review |
| **Doc Writer** | Documentation generation |

The engine automatically selects the best roles based on the task analysis.

## Cost Control for Multi-Agent Tasks

Multi-agent tasks use more LLM calls. Set budgets:

```typescript
const result = await engine.run({
  prompt: 'Build the entire checkout flow',
  budget: 2.00, // Max $2.00 for this run
});

if (result.cost > 1.50) {
  console.warn(`High cost run: $${result.cost.toFixed(2)}`);
}
```

---

## Next: [Tutorial 3 — Custom Plugins](./03-custom-plugins.md)
