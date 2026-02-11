/**
 * Enhancement Templates — intent-specific guidance
 */

import type { PromptIntent } from '../types.js';

const ENHANCEMENT_TEMPLATES: Record<PromptIntent, string> = {
  create: `## Implementation Guidance
- Follow existing project patterns and conventions
- Create files in logical locations following the project structure
- Include proper TypeScript types and exports
- Add error handling for edge cases
- Consider adding basic tests`,

  modify: `## Modification Guidance
- Read the existing code carefully before making changes
- Preserve existing functionality while adding new features
- Update related tests if they exist
- Ensure backward compatibility unless explicitly asked to break it`,

  fix: `## Bug Fix Guidance
- First reproduce and understand the bug
- Identify the root cause, not just symptoms
- Make the minimal change needed to fix the issue
- Add a test case that would have caught this bug
- Check for similar bugs in related code`,

  refactor: `## Refactoring Guidance
- Ensure tests pass before AND after refactoring
- Make incremental changes, not sweeping rewrites
- Preserve external behavior (public API)
- Improve code clarity, reduce duplication
- Update documentation if structure changes`,

  test: `## Testing Guidance
- Cover happy paths and edge cases
- Test error conditions and boundary values
- Follow existing test patterns in the project
- Use descriptive test names
- Keep tests focused and independent`,

  document: `## Documentation Guidance
- Use clear, concise language
- Include code examples where helpful
- Document parameters, return values, and exceptions
- Keep documentation close to the code it describes
- Update existing docs rather than creating duplicates`,

  analyze: `## Analysis Guidance
- Be thorough but organized in your analysis
- Provide specific file paths and line numbers
- Quantify findings where possible
- Prioritize findings by severity/impact
- Suggest actionable improvements`,

  deploy: `## Deployment Guidance
- Verify all dependencies are listed
- Check environment-specific configurations
- Ensure secrets are properly managed
- Test in a staging-like environment first
- Document any manual steps required`,

  optimize: `## Optimization Guidance
- Profile first to identify actual bottlenecks
- Measure before and after changes
- Don't optimize prematurely
- Ensure correctness is maintained
- Document any trade-offs made`,

  unknown: `## General Guidance
- Read relevant files before making changes
- Follow existing patterns in the codebase
- Test your changes
- Handle errors appropriately`,
};

export function getEnhancementTemplate(intent: PromptIntent): string {
  return ENHANCEMENT_TEMPLATES[intent] || ENHANCEMENT_TEMPLATES.unknown;
}

export { ENHANCEMENT_TEMPLATES };
