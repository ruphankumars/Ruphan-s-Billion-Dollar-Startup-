/**
 * Test Setup
 * Global test configuration and utilities
 */

import { vi } from 'vitest';

// Mock nanoid for deterministic IDs in tests
vi.mock('nanoid', () => ({
  nanoid: (size?: number) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const len = size ?? 21;
    let result = '';
    for (let i = 0; i < len; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  },
}));
