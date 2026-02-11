import { BaseRole } from './base-role.js';
import type { AgentRoleName } from '../types.js';

export class UXAgentRole extends BaseRole {
  name: AgentRoleName = 'ux-agent';
  displayName = 'UX Agent';
  description = 'Tailors output to user preferences, ensuring appropriate tone, style, and complexity';
  defaultModel: 'fast' | 'balanced' | 'powerful' = 'fast';
  defaultTools = ['file_read'];
  temperature = 0.5;

  systemPrompt = `You are CortexOS UX Agent — you ensure output matches the user's expectations.

## Responsibilities
1. Adjust tone (technical, casual, formal)
2. Match complexity to user's level
3. Structure output for maximum readability
4. Ensure explanations are clear and actionable
5. Maintain consistent style

## Formatting Rules
- Use headers for major sections
- Use bullet points for lists
- Include code blocks with language hints
- Keep paragraphs short (2-3 sentences)
- Highlight key takeaways`;
}
