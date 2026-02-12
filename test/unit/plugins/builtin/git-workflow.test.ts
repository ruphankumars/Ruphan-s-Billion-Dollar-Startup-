/**
 * Tests for GitWorkflowPlugin
 */

import { describe, it, expect } from 'vitest';
import {
  GitWorkflowPlugin,
  classifyChanges,
  detectSensitiveFiles,
} from '../../../../src/plugins/builtin/git-workflow-plugin.js';
import { PluginRegistry } from '../../../../src/plugins/registry.js';

describe('GitWorkflowPlugin', () => {
  describe('classifyChanges', () => {
    it('should classify feature additions', () => {
      const { type } = classifyChanges('+export function newFeature', ['src/core/feature.ts']);
      expect(type).toBe('feat');
    });

    it('should classify test-only changes', () => {
      const { type } = classifyChanges('add test cases', ['test/unit/core.test.ts']);
      expect(type).toBe('test');
    });

    it('should classify doc-only changes', () => {
      const { type } = classifyChanges('update docs', ['README.md', 'docs/guide.md']);
      expect(type).toBe('docs');
    });

    it('should classify CI changes', () => {
      const { type } = classifyChanges('update pipeline', ['.github/workflows/ci.yml']);
      expect(type).toBe('ci');
    });

    it('should classify bug fixes', () => {
      const { type } = classifyChanges('fix: handle null pointer crash', ['src/core/engine.ts']);
      expect(type).toBe('fix');
    });

    it('should detect scope from single directory', () => {
      const { scope } = classifyChanges('+code', ['src/memory/store.ts', 'src/memory/types.ts']);
      expect(scope).toBe('memory');
    });

    it('should return null scope for multiple directories', () => {
      const { scope } = classifyChanges('+code', ['src/memory/store.ts', 'src/core/engine.ts']);
      expect(scope).toBeNull();
    });
  });

  describe('detectSensitiveFiles', () => {
    it('should detect .env files', () => {
      const result = detectSensitiveFiles(['.env', '.env.production', '.env.local']);
      expect(result).toContain('.env');
      expect(result).toContain('.env.production');
      expect(result).toContain('.env.local');
    });

    it('should detect credential files', () => {
      const result = detectSensitiveFiles([
        'credentials.json',
        'serviceAccountKey.json',
        'id_rsa',
        'id_ed25519',
      ]);
      expect(result).toHaveLength(4);
    });

    it('should detect key files', () => {
      const result = detectSensitiveFiles(['server.pem', 'private.key', 'api.secret']);
      expect(result).toHaveLength(3);
    });

    it('should not flag normal files', () => {
      const result = detectSensitiveFiles([
        'src/app.ts',
        'package.json',
        'README.md',
        'test/utils.test.ts',
      ]);
      expect(result).toHaveLength(0);
    });

    it('should detect npmrc and pypirc', () => {
      const result = detectSensitiveFiles(['.npmrc', '.pypirc']);
      expect(result).toHaveLength(2);
    });
  });

  describe('Plugin Registration', () => {
    it('should register 3 tools and middleware', async () => {
      const registry = new PluginRegistry();
      await registry.load(GitWorkflowPlugin);

      expect(registry.isLoaded('cortexos-git-workflow')).toBe(true);

      const tools = registry.getTools();
      const names = tools.map(t => t.name);
      expect(names).toContain('git_smart_commit');
      expect(names).toContain('git_branch_summary');
      expect(names).toContain('git_changelog');
    });
  });
});
