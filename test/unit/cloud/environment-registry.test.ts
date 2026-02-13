/**
 * EnvironmentRegistry — Unit Tests
 *
 * Tests environment management: presets, custom registration, lookup, filtering.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EnvironmentRegistry,
  PRESET_ENVIRONMENTS,
} from '../../../src/cloud/environment-registry.js';

describe('EnvironmentRegistry', () => {
  let registry: EnvironmentRegistry;

  beforeEach(() => {
    registry = new EnvironmentRegistry();
  });

  // ── Preset loading ─────────────────────────────────────────

  describe('preset environments', () => {
    it('loads preset environments by default', () => {
      expect(registry.size).toBeGreaterThan(0);
    });

    it('has 6 preset environments (node20, python3, full-stack, go, rust, minimal)', () => {
      expect(registry.size).toBe(6);

      const ids = registry.list().map((e) => e.id);
      expect(ids).toContain('node20');
      expect(ids).toContain('python3');
      expect(ids).toContain('full-stack');
      expect(ids).toContain('go');
      expect(ids).toContain('rust');
      expect(ids).toContain('minimal');
    });
  });

  // ── get ────────────────────────────────────────────────────

  describe('get', () => {
    it('returns environment by ID', () => {
      const env = registry.get('node20');

      expect(env).toBeDefined();
      expect(env!.id).toBe('node20');
      expect(env!.name).toBe('Node.js 20');
      expect(env!.image).toBe('node:20-slim');
    });

    it('returns undefined for unknown ID', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  // ── getByName ──────────────────────────────────────────────

  describe('getByName', () => {
    it('returns environment by name (case insensitive)', () => {
      const env1 = registry.getByName('Node.js 20');
      expect(env1).toBeDefined();
      expect(env1!.id).toBe('node20');

      const env2 = registry.getByName('node.js 20');
      expect(env2).toBeDefined();
      expect(env2!.id).toBe('node20');

      const env3 = registry.getByName('NODE.JS 20');
      expect(env3).toBeDefined();
      expect(env3!.id).toBe('node20');
    });

    it('returns undefined for unknown name', () => {
      expect(registry.getByName('Does Not Exist')).toBeUndefined();
    });
  });

  // ── register ───────────────────────────────────────────────

  describe('register', () => {
    it('adds a custom environment', () => {
      const custom = {
        id: 'custom-env',
        name: 'Custom Env',
        description: 'A custom environment for testing',
        image: 'ubuntu:22.04',
        tags: ['custom'],
      };

      registry.register(custom);

      expect(registry.get('custom-env')).toBeDefined();
      expect(registry.get('custom-env')!.name).toBe('Custom Env');
      expect(registry.size).toBe(7); // 6 presets + 1 custom
    });
  });

  // ── remove ─────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes an environment', () => {
      expect(registry.get('node20')).toBeDefined();

      const result = registry.remove('node20');

      expect(result).toBe(true);
      expect(registry.get('node20')).toBeUndefined();
      expect(registry.size).toBe(5);
    });

    it('returns false when removing a non-existent environment', () => {
      const result = registry.remove('nonexistent');
      expect(result).toBe(false);
    });
  });

  // ── list ───────────────────────────────────────────────────

  describe('list', () => {
    it('returns all environments', () => {
      const envs = registry.list();

      expect(envs).toHaveLength(6);
      expect(envs.every((e) => e.id && e.name && e.image)).toBe(true);
    });

    it('with tag filter returns matching environments', () => {
      const pythonEnvs = registry.list({ tags: ['python'] });

      expect(pythonEnvs.length).toBeGreaterThan(0);
      // node20 should not be in the result, but python3 and full-stack should
      const ids = pythonEnvs.map((e) => e.id);
      expect(ids).toContain('python3');
      expect(ids).toContain('full-stack');
      expect(ids).not.toContain('node20');
      expect(ids).not.toContain('go');
    });

    it('with non-matching tag filter returns empty array', () => {
      const envs = registry.list({ tags: ['nonexistent-tag'] });
      expect(envs).toHaveLength(0);
    });
  });

  // ── create ─────────────────────────────────────────────────

  describe('create', () => {
    it('makes a new environment with defaults', () => {
      const env = registry.create({
        id: 'new-env',
        name: 'New Environment',
        image: 'debian:bookworm',
      });

      expect(env.id).toBe('new-env');
      expect(env.name).toBe('New Environment');
      expect(env.image).toBe('debian:bookworm');
      expect(env.description).toBe('Custom environment: New Environment');
      expect(env.tags).toEqual(['custom']);

      // Should be registered
      expect(registry.get('new-env')).toBeDefined();
      expect(registry.size).toBe(7);
    });

    it('creates an environment with all options', () => {
      const env = registry.create({
        id: 'full-env',
        name: 'Full Options',
        image: 'ubuntu:22.04',
        description: 'Fully configured',
        env: { FOO: 'bar' },
        packages: ['git', 'curl'],
        resourceLimits: { cpus: 4, memoryMb: 8192 },
        tags: ['test', 'full'],
      });

      expect(env.description).toBe('Fully configured');
      expect(env.env).toEqual({ FOO: 'bar' });
      expect(env.packages).toEqual(['git', 'curl']);
      expect(env.resourceLimits).toEqual({ cpus: 4, memoryMb: 8192 });
      expect(env.tags).toEqual(['test', 'full']);
    });
  });

  // ── size ───────────────────────────────────────────────────

  describe('size', () => {
    it('returns the count of registered environments', () => {
      expect(registry.size).toBe(6);

      registry.create({
        id: 'extra',
        name: 'Extra',
        image: 'alpine:latest',
      });
      expect(registry.size).toBe(7);

      registry.remove('extra');
      expect(registry.size).toBe(6);
    });
  });

  // ── constructor with loadPresets: false ────────────────────

  describe('constructor with loadPresets: false', () => {
    it('starts empty when presets are disabled', () => {
      const emptyRegistry = new EnvironmentRegistry({ loadPresets: false });

      expect(emptyRegistry.size).toBe(0);
      expect(emptyRegistry.list()).toHaveLength(0);
      expect(emptyRegistry.get('node20')).toBeUndefined();
    });
  });
});
