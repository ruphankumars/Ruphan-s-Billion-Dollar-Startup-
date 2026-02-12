/**
 * SWE-bench Prompt Builder — Constructs CortexOS prompts from
 * SWE-bench problem instances.
 *
 * Builds structured prompts containing the issue description,
 * test expectations, hints, and instructions for minimal changes.
 */

import type { SWEBenchInstance } from './types.js';

export class SWEBenchPromptBuilder {
  /**
   * Build a prompt from a SWE-bench instance.
   */
  build(instance: SWEBenchInstance, workDir: string): string {
    const parts: string[] = [];

    // Header
    parts.push(`Fix the following issue in the repository "${instance.repo}".`);
    parts.push('');

    // Problem statement
    parts.push('## Issue Description');
    parts.push('');
    parts.push(instance.problem_statement.trim());
    parts.push('');

    // Tests that should pass
    const failToPass = this.parseTestList(instance.FAIL_TO_PASS);
    if (failToPass.length > 0) {
      parts.push('## Tests That Should Pass After Fix');
      parts.push('');
      for (const test of failToPass) {
        parts.push(`- ${test}`);
      }
      parts.push('');
    }

    // Hints
    if (instance.hints_text && instance.hints_text.trim().length > 0) {
      parts.push('## Hints');
      parts.push('');
      parts.push(instance.hints_text.trim());
      parts.push('');
    }

    // Instructions
    parts.push('## Instructions');
    parts.push('');
    parts.push('- Make minimal changes to fix the issue.');
    parts.push('- Only modify existing files; do not create new files unless absolutely necessary.');
    parts.push('- Do not modify test files.');
    parts.push('- Ensure all existing tests continue to pass.');
    parts.push(`- Working directory: ${workDir}`);
    parts.push('');

    return parts.join('\n');
  }

  /**
   * Build an enhanced prompt with repository context.
   */
  buildWithContext(
    instance: SWEBenchInstance,
    workDir: string,
    repoContext: string,
  ): string {
    const base = this.build(instance, workDir);
    const contextSection = [
      '## Repository Context',
      '',
      repoContext.trim(),
      '',
    ].join('\n');

    // Insert context before Instructions section
    const instructionIdx = base.indexOf('## Instructions');
    if (instructionIdx >= 0) {
      return base.slice(0, instructionIdx) + contextSection + base.slice(instructionIdx);
    }
    return base + '\n' + contextSection;
  }

  /**
   * Parse a JSON array string of test identifiers.
   */
  parseTestList(jsonStr: string): string[] {
    if (!jsonStr || jsonStr.trim().length === 0) return [];
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) return parsed.map(String);
      return [];
    } catch {
      // Try to extract test names from comma-separated format
      return jsonStr
        .split(',')
        .map(s => s.trim().replace(/[[\]"']/g, ''))
        .filter(s => s.length > 0);
    }
  }
}
