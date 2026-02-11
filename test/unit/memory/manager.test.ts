import { describe, it, expect, afterEach } from 'vitest';
import { CortexMemoryManager } from '../../../src/memory/manager.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync } from 'fs';

describe('CortexMemoryManager', () => {
  let manager: CortexMemoryManager;
  let tempDir: string;

  function createManager() {
    tempDir = mkdtempSync(join(tmpdir(), 'cortexos-test-'));
    manager = CortexMemoryManager.create({
      enabled: true,
      globalDir: tempDir,
      maxMemories: 1000,
      embeddingModel: 'local-tfidf',
      decayEnabled: false,
      decayHalfLifeDays: 30,
      minImportanceThreshold: 0.1,
      consolidationInterval: 24,
    });
  }

  afterEach(async () => {
    if (manager) {
      await manager.close();
    }
  });

  it('should store and recall a memory', async () => {
    createManager();

    await manager.store('TypeScript project uses Express', {
      type: 'semantic',
      importance: 0.8,
      tags: ['tech'],
      source: 'test',
    });

    const results = await manager.recall({
      text: 'TypeScript Express project',
      maxResults: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.content).toContain('TypeScript');
  });

  it('should store multiple memories', async () => {
    createManager();

    await manager.store('Project uses React', { type: 'semantic', tags: ['tech'] });
    await manager.store('Auth uses JWT tokens', { type: 'semantic', tags: ['auth'] });
    await manager.store('Tests use Vitest', { type: 'semantic', tags: ['testing'] });

    const stats = await manager.getStats();
    expect(stats.totalMemories).toBe(3);
  });

  it('should forget a memory', async () => {
    createManager();

    const entry = await manager.store('Temporary memory', {
      type: 'episodic',
      tags: ['temp'],
    });

    await manager.forget(entry.id);

    const stats = await manager.getStats();
    expect(stats.totalMemories).toBe(0);
  });

  it('should handle disabled memory system', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cortexos-test-'));
    manager = CortexMemoryManager.create({
      enabled: false,
      globalDir: tempDir,
      maxMemories: 1000,
      embeddingModel: 'local-tfidf',
      decayEnabled: false,
      decayHalfLifeDays: 30,
      minImportanceThreshold: 0.1,
      consolidationInterval: 24,
    });

    const results = await manager.recall({ text: 'test', maxResults: 5 });
    expect(results).toEqual([]);
  });
});
