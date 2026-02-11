/**
 * Estimate token count from text (rough heuristic: ~4 chars per token)
 * This is used for budget estimation, not exact billing
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // GPT-style tokenization approximation
  // ~4 characters per token for English text
  // ~3.5 characters per token for code (more symbols)
  const isCode = /[{}\[\]();=><!&|]/.test(text);
  const charsPerToken = isCode ? 3.5 : 4;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Format token count for display
 */
export function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1000000).toFixed(2)}M`;
}

/**
 * Format cost for display
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Truncate text to fit within a token budget
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;

  const ratio = maxTokens / estimated;
  const maxChars = Math.floor(text.length * ratio * 0.95); // 5% safety margin
  return text.substring(0, maxChars) + '\n\n[... truncated to fit token budget ...]';
}

/**
 * Calculate cost for a model based on token usage
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: { inputPer1M: number; outputPer1M: number },
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return inputCost + outputCost;
}
