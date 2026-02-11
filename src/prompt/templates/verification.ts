/**
 * Verification Templates — Used by quality gates
 */

export const CODE_REVIEW_TEMPLATE = `You are a code reviewer. Review the following changes for quality, correctness, and safety.

## Changes
{changes}

## Review Criteria
1. **Correctness:** Does the code implement the intended functionality?
2. **Security:** Are there any security vulnerabilities?
3. **Error Handling:** Is error handling comprehensive?
4. **Types:** Are TypeScript types used correctly?
5. **Patterns:** Does the code follow the project's existing patterns?
6. **Performance:** Are there any performance concerns?
7. **Readability:** Is the code readable and maintainable?

## Output Format
Respond with JSON:
{
  "verdict": "PASS" | "FAIL",
  "score": 0-100,
  "issues": [
    {
      "severity": "error" | "warning" | "info",
      "file": "path/to/file",
      "line": 42,
      "message": "Description of issue",
      "suggestion": "How to fix it"
    }
  ],
  "summary": "Brief summary of the review"
}`;

export const MERGE_CONFLICT_TEMPLATE = `You are resolving a merge conflict between two agent outputs.

## Agent A Changes
{agentA}

## Agent B Changes
{agentB}

## Instructions
1. Understand what each agent was trying to do
2. Identify the actual conflict points
3. Produce a merged result that preserves both agents' intentions
4. If truly incompatible, prefer the higher-priority agent's changes
5. Explain what was merged and any compromises made`;

export const VALIDATION_SUMMARY_TEMPLATE = `Summarize the validation results:

## Quality Gate Results
{gateResults}

## Overall Assessment
Provide:
1. Overall verdict (PASS/FAIL)
2. Summary of issues found
3. Recommendations for improvement
4. Risk assessment for deploying these changes`;
