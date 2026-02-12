import { describe, it, expect } from 'vitest';
import { PatchExtractor } from '../../../src/swebench/patch-extractor.js';
import type { FileChange } from '../../../src/core/types.js';

describe('PatchExtractor', () => {
  const extractor = new PatchExtractor();

  describe('extract', () => {
    it('should handle empty file changes', () => {
      const patch = extractor.extract([], '/nonexistent');
      expect(patch).toBe('');
    });

    it('should synthesize from create file changes', () => {
      const changes: FileChange[] = [
        { path: 'src/new.ts', type: 'create', content: 'export const foo = 1;' },
      ];
      const patch = extractor.extract(changes, '/nonexistent-dir');
      expect(patch.length).toBeGreaterThan(0);
      expect(patch).toContain('src/new.ts');
    });

    it('should synthesize from modify file changes', () => {
      const changes: FileChange[] = [
        { path: 'src/existing.ts', type: 'modify', content: 'export const bar = 2;' },
      ];
      const patch = extractor.extract(changes, '/nonexistent-dir');
      // Will produce a diff (from empty since file doesn't exist at that path)
      expect(patch.length).toBeGreaterThan(0);
    });

    it('should synthesize from delete file changes', () => {
      const changes: FileChange[] = [
        { path: 'src/old.ts', type: 'delete', content: '' },
      ];
      const patch = extractor.extract(changes, '/nonexistent-dir');
      // Delete of non-existent file produces minimal output
      expect(typeof patch).toBe('string');
    });

    it('should handle multiple file changes', () => {
      const changes: FileChange[] = [
        { path: 'src/a.ts', type: 'create', content: 'const a = 1;' },
        { path: 'src/b.ts', type: 'create', content: 'const b = 2;' },
      ];
      const patch = extractor.extract(changes, '/nonexistent-dir');
      expect(patch).toContain('src/a.ts');
      expect(patch).toContain('src/b.ts');
    });
  });

  describe('isValidUnifiedDiff', () => {
    it('should accept valid unified diff', () => {
      const validDiff = `--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 3;`;
      expect(extractor.isValidUnifiedDiff(validDiff)).toBe(true);
    });

    it('should reject empty string', () => {
      expect(extractor.isValidUnifiedDiff('')).toBe(false);
    });

    it('should reject plain text', () => {
      expect(extractor.isValidUnifiedDiff('This is not a diff')).toBe(false);
    });

    it('should reject partial diff (missing @@ header)', () => {
      const partial = `--- a/file.ts
+++ b/file.ts
some content`;
      expect(extractor.isValidUnifiedDiff(partial)).toBe(false);
    });

    it('should reject null/undefined', () => {
      expect(extractor.isValidUnifiedDiff(null as any)).toBe(false);
      expect(extractor.isValidUnifiedDiff(undefined as any)).toBe(false);
    });
  });
});
