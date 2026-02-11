# Task Decomposition Prompt

Analyze the following user request and decompose it into independent subtasks that can be executed by specialized agents.

## User Request
{prompt}

## Available Roles
- researcher: Read files, search codebase, gather information
- architect: Design solutions, plan structure
- developer: Write and modify code
- tester: Write and run tests
- validator: Review output quality

## Output Format
Return a JSON array of tasks:
```json
[
  {
    "id": "task-1",
    "description": "Brief description of what this task does",
    "role": "developer",
    "dependencies": [],
    "complexity": 0.5
  }
]
```

## Rules
- Tasks with no dependencies can run in parallel
- Use "dependencies" to specify task IDs that must complete first
- Assign complexity from 0 (trivial) to 1 (very complex)
- Minimize the number of sequential dependencies
- Each task should be self-contained and focused
