import { createHash, randomBytes } from 'crypto';

/**
 * Generate a SHA-256 hash of a string
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate a short hash (8 characters) for deduplication
 */
export function shortHash(input: string): string {
  return sha256(input).substring(0, 8);
}

/**
 * Generate a random hex string
 */
export function randomHex(length: number = 16): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .substring(0, length);
}

/**
 * Create a deterministic cache key from a set of inputs
 */
export function cacheKey(...parts: string[]): string {
  return sha256(parts.join('::'));
}

/**
 * Hash content for similarity comparison (simhash-like approach)
 */
export function contentFingerprint(text: string): string {
  // Normalize text for comparison
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
  return sha256(normalized).substring(0, 16);
}
