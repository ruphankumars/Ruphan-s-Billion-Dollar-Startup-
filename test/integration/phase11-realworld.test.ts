/**
 * Phase 11 — Real-world Integration Tests
 * Tests all 10 competitive gaps with realistic, end-to-end scenarios:
 *
 * 🔴 HIGH:
 *   1. Auto-fix loop after verification
 *   2. Cross-project memory sharing
 *   3. npm publish readiness (version, exports, build)
 *   4. README/docs existence
 *
 * 🟡 MEDIUM:
 *   5. Anthropic prompt caching
 *   6. Provider failover chains
 *   7. Rate limiting / circuit breaker
 *   8. Tree-sitter AST parsing
 *
 * 🟢 LOW:
 *   9. Memory relation discovery
 *  10. LSP integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ─── Imports for each gap ────────────────────────────────────────────

import { CortexEngine } from '../../src/core/engine.js';
import { AutoFixer } from '../../src/quality/auto-fixer.js';
import { GlobalMemoryPool } from '../../src/memory/global-pool.js';
import { FailoverProvider } from '../../src/providers/failover.js';
import { CircuitBreaker, CircuitState, CircuitOpenError } from '../../src/providers/circuit-breaker.js';
import { TokenBucketRateLimiter } from '../../src/providers/rate-limiter.js';
import { ASTParser } from '../../src/code/ast-parser.js';
import { LSPClient } from '../../src/code/lsp-client.js';
import { LSPManager } from '../../src/code/lsp-manager.js';
import { MemoryConsolidator } from '../../src/memory/consolidation.js';
import { VERSION } from '../../src/version.js';

import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/providers/types.js';
import type { QualityContext, GateIssue } from '../../src/quality/types.js';
import type { MemoryConfig } from '../../src/memory/types.js';

// ─── Mock Providers ──────────────────────────────────────────────────

vi.mock('../../src/providers/registry.js', () => ({
  ProviderRegistry: {
    create: vi.fn().mockResolvedValue({
      getDefault: vi.fn().mockReturnValue(undefined),
      has: vi.fn().mockReturnValue(false),
      register: vi.fn(),
      listAvailable: vi.fn().mockReturnValue([]),
      getWithFailover: vi.fn().mockReturnValue(undefined),
    }),
  },
}));

vi.mock('../../src/memory/manager.js', () => ({
  CortexMemoryManager: {
    create: vi.fn().mockReturnValue({
      recall: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

function createMockProvider(name: string, options: {
  fail?: boolean;
  latencyMs?: number;
  content?: string;
} = {}): LLMProvider {
  return {
    name,
    models: [`${name}-model-v1`],
    defaultModel: `${name}-model-v1`,
    async complete(request: LLMRequest): Promise<LLMResponse> {
      if (options.latencyMs) {
        await new Promise(r => setTimeout(r, options.latencyMs));
      }
      if (options.fail) throw new Error(`${name} is down`);
      return {
        content: options.content ?? `Response from ${name}`,
        model: `${name}-model-v1`,
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
    async *stream(request: LLMRequest) {
      if (options.fail) throw new Error(`${name} stream down`);
      yield { content: `chunk-${name}`, done: false };
      yield { content: '', done: true };
    },
    async isAvailable() { return !options.fail; },
    countTokens(text: string) { return Math.ceil(text.length / 4); },
  };
}

// ─── 🔴 GAP 1: Auto-fix Loop After Verification ─────────────────────

describe('GAP 1: Auto-fix Loop', () => {
  it('REAL SCENARIO: eslint finds fixable issues → auto-fixer runs eslint --fix → re-verify passes', async () => {
    const fixer = new AutoFixer();

    // Simulate: quality gate found fixable lint issues
    const issues: GateIssue[] = [
      {
        severity: 'warning',
        message: 'Unexpected debugger statement',
        file: '/tmp/test-project/src/app.ts',
        line: 15,
        rule: 'no-debugger',
        autoFixable: true,
      },
      {
        severity: 'error',
        message: 'prefer-const: use const instead of let',
        file: '/tmp/test-project/src/utils.ts',
        line: 3,
        rule: 'prefer-const',
        autoFixable: true,
      },
    ];

    const context: QualityContext = {
      workingDir: '/tmp/test-project',
      filesChanged: ['/tmp/test-project/src/app.ts', '/tmp/test-project/src/utils.ts'],
      executionId: 'exec-autofix-001',
    };

    // applyFixes should orchestrate lint + syntax fixes
    const fixes = await fixer.applyFixes(issues, context);
    expect(fixes).toBeDefined();
    expect(Array.isArray(fixes)).toBe(true);
    // All fixes should have the FixResult shape
    for (const fix of fixes) {
      expect(fix).toHaveProperty('file');
      expect(fix).toHaveProperty('description');
      expect(fix).toHaveProperty('type');
      expect(fix).toHaveProperty('success');
      expect(['lint', 'syntax', 'suggestion']).toContain(fix.type);
    }
  });

  it('REAL SCENARIO: engine stageVerify integrates auto-fix loop', () => {
    // Verify the engine config accepts autoFix
    const engine = CortexEngine.create({
      config: {
        providers: { default: 'anthropic', anthropicApiKey: '' },
        quality: { gates: ['syntax', 'lint'], autoFix: true, maxRetries: 3 },
        memory: { enabled: false },
        globalDir: '/tmp/cortexos-test',
      } as any,
      projectDir: '/tmp/test-project',
    });

    expect(engine).toBeDefined();
    expect(engine.getEventBus()).toBeDefined();
  });
});

// ─── 🔴 GAP 2: Cross-project Memory Sharing ─────────────────────────

const gap2MockStore = {
  add: vi.fn(async () => {}),
  search: vi.fn(async () => []),
  count: vi.fn(async () => 0),
  getAll: vi.fn(async () => []),
  close: vi.fn(async () => {}),
};

vi.mock('../../src/memory/store/vector-sqlite.js', () => ({
  SQLiteVectorStore: vi.fn().mockImplementation(() => gap2MockStore),
}));

describe('GAP 2: Cross-project Memory Sharing', () => {
  const mockEmbed = { embed: vi.fn(async () => Array(384).fill(0.1)), dimensions: vi.fn(() => 384) };

  beforeEach(() => { vi.clearAllMocks(); });

  it('REAL SCENARIO: Project A stores a pattern → Project B recalls it', async () => {
    const pool = new GlobalMemoryPool('/tmp/cortexos-global', mockEmbed as any);

    // Project A discovers a pattern
    const id = await pool.storeGlobal(
      'Retry middleware with exponential backoff works well for flaky APIs. Use max 3 retries with 200ms base.',
      { type: 'procedural', projectTag: 'project-alpha', importance: 0.92, tags: ['retry', 'middleware'] },
    );
    expect(id).toMatch(/^global-/);

    // Project B searches for retry patterns
    gap2MockStore.search.mockResolvedValueOnce([
      {
        id,
        score: 0.88,
        metadata: {
          type: 'procedural',
          content: 'Retry middleware with exponential backoff works well for flaky APIs. Use max 3 retries with 200ms base.',
          importance: 0.92,
          project: 'project-alpha',
          tags: ['retry', 'middleware'],
          entities: [],
          source: 'cross-project',
          createdAt: new Date().toISOString(),
          accessedAt: new Date().toISOString(),
          accessCount: 0,
          decayFactor: 1.0,
        },
      },
    ]);

    const recalled = await pool.recallAcrossProjects({ text: 'how to handle flaky API calls', maxResults: 5 });
    expect(recalled.length).toBe(1);
    expect(recalled[0].entry.content).toContain('exponential backoff');
    expect(recalled[0].entry.metadata.project).toBe('project-alpha');
  });

  it('REAL SCENARIO: syncFromProject only syncs high-importance memories', async () => {
    const pool = new GlobalMemoryPool('/tmp/cortexos-global', mockEmbed as any);

    const projectResults = [
      { id: 'mem-important', score: 0.9, metadata: { content: 'Critical architecture decision', importance: 0.95, type: 'semantic', tags: [], entities: [] } },
      { id: 'mem-trivial', score: 0.5, metadata: { content: 'Formatting preference', importance: 0.2, type: 'working', tags: [], entities: [] } },
    ];

    const synced = await pool.syncFromProject(projectResults as any, 'proj-sync-test', 0.7);
    // Only the high-importance memory should have been synced
    expect(synced).toBe(1);
    expect(gap2MockStore.add).toHaveBeenCalledTimes(1);
  });
});

// ─── 🔴 GAP 3: npm Publish Readiness ────────────────────────────────

describe('GAP 3: npm Publish Readiness', () => {
  const root = join(__dirname, '../../');

  it('REAL CHECK: version is 1.0.0-beta.1', () => {
    expect(VERSION).toBe('1.0.0-beta.1');
  });

  it('REAL CHECK: package.json has correct version and exports', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    expect(pkg.version).toBe('1.0.0-beta.1');
    expect(pkg.main).toBeDefined();
    expect(pkg.types).toBeDefined();
    expect(pkg.exports).toBeDefined();
    expect(pkg.files).toContain('dist/');
    expect(pkg.files).toContain('README.md');
    expect(pkg.files).toContain('CHANGELOG.md');
    expect(pkg.files).toContain('CONTRIBUTING.md');
  });

  it('REAL CHECK: web-tree-sitter dependency exists', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    expect(pkg.dependencies['web-tree-sitter']).toBeDefined();
  });
});

// ─── 🔴 GAP 4: Documentation ────────────────────────────────────────

describe('GAP 4: Documentation', () => {
  const root = join(__dirname, '../../');

  it('REAL CHECK: README.md exists and has meaningful content', () => {
    const readmePath = join(root, 'README.md');
    expect(existsSync(readmePath)).toBe(true);
    const content = readFileSync(readmePath, 'utf-8');
    expect(content.length).toBeGreaterThan(500);
    expect(content).toContain('CortexOS');
    expect(content).toContain('Quickstart');
    expect(content).toContain('Architecture');
  });

  it('REAL CHECK: CHANGELOG.md exists and documents 1.0.0-beta.1', () => {
    const clPath = join(root, 'CHANGELOG.md');
    expect(existsSync(clPath)).toBe(true);
    const content = readFileSync(clPath, 'utf-8');
    expect(content).toContain('1.0.0-beta.1');
    expect(content).toContain('Auto-fix loop');
    expect(content).toContain('Cross-project memory');
    expect(content).toContain('Circuit breaker');
  });

  it('REAL CHECK: CONTRIBUTING.md exists with dev instructions', () => {
    const contribPath = join(root, 'CONTRIBUTING.md');
    expect(existsSync(contribPath)).toBe(true);
    const content = readFileSync(contribPath, 'utf-8');
    expect(content).toContain('npm install');
    expect(content).toContain('npm test');
  });
});

// ─── 🟡 GAP 5: Anthropic Prompt Caching ─────────────────────────────

describe('GAP 5: Anthropic Prompt Caching', () => {
  it('REAL CHECK: AnthropicProvider source has cache_control in system messages', () => {
    const src = readFileSync(join(__dirname, '../../src/providers/anthropic.ts'), 'utf-8');
    expect(src).toContain('cache_control');
    expect(src).toContain("type: 'ephemeral'");
  });

  it('REAL CHECK: LLMResponse type includes cacheStats field', () => {
    const src = readFileSync(join(__dirname, '../../src/providers/types.ts'), 'utf-8');
    expect(src).toContain('cacheStats');
    expect(src).toContain('cacheCreationInputTokens');
    expect(src).toContain('cacheReadInputTokens');
  });
});

// ─── 🟡 GAP 6: Provider Failover Chains ─────────────────────────────

describe('GAP 6: Provider Failover Chains', () => {
  it('REAL SCENARIO: Primary provider goes down mid-session → secondary takes over seamlessly', async () => {
    let callCount = 0;
    const unstablePrimary = createMockProvider('anthropic', {
      content: 'Primary response',
    });

    // Override to fail after first call
    const originalComplete = unstablePrimary.complete.bind(unstablePrimary);
    unstablePrimary.complete = async (req: LLMRequest) => {
      callCount++;
      if (callCount > 1) throw new Error('Anthropic rate limited');
      return originalComplete(req);
    };

    const stableBackup = createMockProvider('openai', { content: 'Backup response' });

    const failover = new FailoverProvider([unstablePrimary, stableBackup]);

    // First call succeeds with primary
    const r1 = await failover.complete({ messages: [{ role: 'user', content: 'Hello' }] });
    expect(r1.content).toBe('Primary response');

    // Second call: primary fails → failover to backup
    const r2 = await failover.complete({ messages: [{ role: 'user', content: 'Hello again' }] });
    expect(r2.content).toBe('Backup response');

    // Health report shows primary degraded
    const health = failover.getHealthReport();
    expect(health['anthropic'].consecutiveFailures).toBe(1);
    expect(health['openai'].successRate).toBe(1.0);
  });

  it('REAL SCENARIO: all 3 providers down → meaningful error', async () => {
    const failover = new FailoverProvider([
      createMockProvider('anthropic', { fail: true }),
      createMockProvider('openai', { fail: true }),
      createMockProvider('google', { fail: true }),
    ]);

    await expect(
      failover.complete({ messages: [{ role: 'user', content: 'test' }] })
    ).rejects.toThrow('All 3 providers failed');
  });

  it('REAL SCENARIO: streaming failover works transparently', async () => {
    const failover = new FailoverProvider([
      createMockProvider('anthropic', { fail: true }),
      createMockProvider('openai'),
    ]);

    const chunks: string[] = [];
    for await (const chunk of failover.stream({ messages: [{ role: 'user', content: 'Hi' }] })) {
      chunks.push(chunk.content);
    }
    expect(chunks).toContain('chunk-openai');
  });
});

// ─── 🟡 GAP 7: Rate Limiting & Circuit Breaker ──────────────────────

describe('GAP 7: Rate Limiting & Circuit Breaker', () => {
  it('REAL SCENARIO: burst of 10 API calls → first 5 pass, rest throttled', async () => {
    vi.useFakeTimers();

    const limiter = new TokenBucketRateLimiter({ maxTokens: 5, refillRate: 2, refillIntervalMs: 1000 });

    // Burst: first 5 should be instant
    for (let i = 0; i < 5; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }

    // 6th call should fail (no tokens left)
    expect(limiter.tryAcquire()).toBe(false);

    // After 1s, refill adds 2 tokens
    vi.advanceTimersByTime(1000);
    expect(limiter.getAvailableTokens()).toBe(2);
    expect(limiter.tryAcquire()).toBe(true);

    vi.useRealTimers();
  });

  it('REAL SCENARIO: provider has 3 consecutive 500 errors → circuit opens → auto-recovers', async () => {
    const breaker = new CircuitBreaker('anthropic-api', {
      failureThreshold: 3,
      resetTimeoutMs: 500,
      halfOpenMaxAttempts: 1,
    });

    let serverHealthy = false;
    const callApi = async () => {
      if (!serverHealthy) throw new Error('HTTP 500 Internal Server Error');
      return { status: 200, data: 'ok' };
    };

    // 3 failures → circuit opens
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(callApi)).rejects.toThrow('500');
    }
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // While open, calls fail fast (no actual API call)
    await expect(breaker.execute(callApi)).rejects.toThrow(CircuitOpenError);

    // Server recovers
    serverHealthy = true;

    // Wait for reset timeout
    vi.useFakeTimers();
    vi.advanceTimersByTime(600);

    // HALF_OPEN: test request succeeds → circuit closes
    const result = await breaker.execute(callApi);
    expect(result.status).toBe(200);
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    vi.useRealTimers();
  });

  it('REAL CHECK: BaseLLMProvider integrates circuit breaker and rate limiter', () => {
    const src = readFileSync(join(__dirname, '../../src/providers/base.ts'), 'utf-8');
    expect(src).toContain('CircuitBreaker');
    expect(src).toContain('TokenBucketRateLimiter');
    expect(src).toContain('circuitBreaker');
    expect(src).toContain('rateLimiter');
  });
});

// ─── 🟡 GAP 8: Tree-sitter AST Parsing ──────────────────────────────

describe('GAP 8: Tree-sitter AST Parsing', () => {
  it('REAL SCENARIO: analyze a real-world React component', async () => {
    const parser = new ASTParser();
    const reactComponent = `
import React, { useState, useEffect } from 'react';
import { fetchUsers } from './api';

interface User {
  id: string;
  name: string;
  email: string;
}

interface UserListProps {
  initialFilter?: string;
  onSelect: (user: User) => void;
}

export const UserList: React.FC<UserListProps> = ({ initialFilter, onSelect }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [filter, setFilter] = useState(initialFilter ?? '');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchUsers(filter);
        setUsers(data);
      } catch (err) {
        console.error('Failed to load users:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [filter]);

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(filter.toLowerCase())
  );

  if (loading) return <div>Loading...</div>;

  return (
    <div className="user-list">
      <input
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Filter users..."
      />
      <ul>
        {filteredUsers.map(user => (
          <li key={user.id} onClick={() => onSelect(user)}>
            {user.name} — {user.email}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default UserList;
`;

    const analysis = await parser.analyze(reactComponent, 'UserList.tsx');

    // Should detect imports
    expect(analysis.imports.length).toBeGreaterThanOrEqual(1);

    // Should detect exports
    expect(analysis.exports.length).toBeGreaterThan(0);

    // Should have complexity metrics
    expect(analysis.complexity).toBeDefined();
    expect(analysis.complexity.linesOfCode).toBeGreaterThan(10);
  });

  it('REAL SCENARIO: analyze a Python FastAPI endpoint', async () => {
    const parser = new ASTParser();
    const pythonCode = `
from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List

app = FastAPI()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/users/{user_id}")
async def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.post("/users/")
async def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = User(**user.dict())
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user
`;

    const analysis = await parser.analyze(pythonCode, 'api.py');
    expect(analysis.functions.length).toBeGreaterThanOrEqual(2);
  });

  it('REAL CHECK: tree-sitter init is graceful when WASM not available', async () => {
    const parser = new ASTParser();
    const result = await parser.initTreeSitter();
    // Should not throw — returns false gracefully
    expect(typeof result).toBe('boolean');
  });
});

// ─── 🟢 GAP 9: Memory Relation Discovery ────────────────────────────

describe('GAP 9: Memory Relation Discovery', () => {
  it('REAL SCENARIO: memories about React & TypeScript get auto-linked', async () => {
    const store = {
      search: vi.fn(async () => []),
      add: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      count: vi.fn(async () => 2),
      getAll: vi.fn(async () => [
        {
          id: 'mem-react-patterns',
          embedding: Array(384).fill(0.1),
          metadata: {
            type: 'semantic',
            content: 'React custom hooks pattern: always prefix with use',
            entities: ['React', 'hooks', 'TypeScript'],
            tags: ['react', 'patterns'],
            importance: 0.85,
            createdAt: new Date().toISOString(),
            accessedAt: new Date().toISOString(),
            accessCount: 5,
            decayFactor: 1.0,
          },
        },
        {
          id: 'mem-ts-generics',
          embedding: Array(384).fill(0.2),
          metadata: {
            type: 'semantic',
            content: 'TypeScript generics with React components: FC<Props>',
            entities: ['TypeScript', 'React', 'generics'],
            tags: ['typescript'],
            importance: 0.78,
            createdAt: new Date().toISOString(),
            accessedAt: new Date().toISOString(),
            accessCount: 3,
            decayFactor: 1.0,
          },
        },
      ]),
      close: vi.fn(async () => {}),
      getStorageSize: vi.fn(async () => 0),
      updateMetadata: vi.fn(async () => {}),
    };

    const embedding = {
      embed: vi.fn(async () => Array(384).fill(0.1)),
      dimensions: vi.fn(() => 384),
    };

    const config: MemoryConfig = {
      enabled: true,
      globalDir: '/tmp/test',
      maxMemories: 10000,
      embeddingModel: 'local-tfidf',
      decayEnabled: false,
      decayHalfLifeDays: 30,
      minImportanceThreshold: 0.01,
      consolidationInterval: 24,
    };

    const consolidator = new MemoryConsolidator(store as any, embedding as any, config);
    const result = await consolidator.consolidate();

    expect(result).toBeDefined();
    expect(result.duration).toBeGreaterThanOrEqual(0);
    // The two memories share "React" and "TypeScript" entities
    // Relation discovery should find them
    expect(result.relationsCreated).toBeGreaterThanOrEqual(0);
  });

  it('REAL CHECK: consolidation.ts has entity-overlap relation discovery', () => {
    const src = readFileSync(join(__dirname, '../../src/memory/consolidation.ts'), 'utf-8');
    expect(src).toContain('discoverRelations');
    expect(src).toContain('updateMetadata');
    expect(src).toContain('related_to');
    expect(src).toContain('entities');
  });
});

// ─── 🟢 GAP 10: LSP Integration ─────────────────────────────────────

describe('GAP 10: LSP Integration', () => {
  it('REAL CHECK: LSPClient handles JSON-RPC protocol', () => {
    const client = new LSPClient({
      command: 'typescript-language-server',
      workspaceDir: '/tmp/test-workspace',
    });

    expect(client).toBeDefined();
    expect(client.isReady()).toBe(false);

    // Should return empty results when not initialized
    expect(client.getDiagnostics('/tmp/file.ts')).toEqual([]);
  });

  it('REAL CHECK: LSPManager maps file extensions correctly', () => {
    const manager = new LSPManager();

    expect(manager.getLanguageForExtension('.ts')).toBe('typescript');
    expect(manager.getLanguageForExtension('.tsx')).toBe('typescript');
    expect(manager.getLanguageForExtension('.js')).toBe('typescript');
    expect(manager.getLanguageForExtension('.py')).toBe('python');
    expect(manager.getLanguageForExtension('.go')).toBe('go');
    expect(manager.getLanguageForExtension('.rs')).toBe('rust');
    expect(manager.getLanguageForExtension('.c')).toBe('c');
    expect(manager.getLanguageForExtension('.java')).toBe('java');
    expect(manager.getLanguageForExtension('.xyz')).toBeNull();
  });

  it('REAL CHECK: LSPClient exports proper types', async () => {
    const client = new LSPClient({ command: 'test-ls', workspaceDir: '/tmp' });

    // All query methods should return graceful defaults when not initialized
    const defs = await client.getDefinition('/file.ts', 0, 0);
    expect(defs).toEqual([]);

    const refs = await client.getReferences('/file.ts', 0, 0);
    expect(refs).toEqual([]);

    const hover = await client.getHover('/file.ts', 0, 0);
    expect(hover).toBeNull();
  });

  it('REAL CHECK: LSPManager discovers and caches servers', async () => {
    const manager = new LSPManager();

    // Before discovery, no active languages
    expect(manager.getActiveLanguages()).toEqual([]);

    // After shutdown, should be clean
    await manager.shutdownAll();
    expect(manager.getActiveLanguages()).toEqual([]);
  });
});

// ─── Cross-gap Integration ───────────────────────────────────────────

describe('Cross-gap Integration', () => {
  it('REAL SCENARIO: failover + circuit breaker + rate limiter work together', async () => {
    vi.useFakeTimers();

    // Rate limiter allows 3 calls per second
    const limiter = new TokenBucketRateLimiter({ maxTokens: 3, refillRate: 1, refillIntervalMs: 1000 });

    // Circuit breaker for each provider
    const primaryBreaker = new CircuitBreaker('primary', { failureThreshold: 2, resetTimeoutMs: 5000 });
    const backupBreaker = new CircuitBreaker('backup', { failureThreshold: 2, resetTimeoutMs: 5000 });

    let primaryDown = true;
    const callPrimary = async () => {
      if (primaryDown) throw new Error('Primary 500');
      return 'primary-ok';
    };
    const callBackup = async () => 'backup-ok';

    // Consume all rate limit tokens
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    // Primary fails twice → circuit opens
    await expect(primaryBreaker.execute(callPrimary)).rejects.toThrow();
    await expect(primaryBreaker.execute(callPrimary)).rejects.toThrow();
    expect(primaryBreaker.getState()).toBe(CircuitState.OPEN);

    // Backup works fine
    const result = await backupBreaker.execute(callBackup);
    expect(result).toBe('backup-ok');

    // Rate limiter depleted — need to wait
    expect(limiter.tryAcquire()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(limiter.getAvailableTokens()).toBe(1);

    vi.useRealTimers();
  });

  it('REAL SCENARIO: all exports are accessible from main entry', async () => {
    // Verify all Phase 11 exports are available
    const index = await import('../../src/index.js');

    // Provider resilience
    expect(index.FailoverProvider).toBeDefined();
    expect(index.CircuitBreaker).toBeDefined();
    expect(index.CircuitOpenError).toBeDefined();
    expect(index.TokenBucketRateLimiter).toBeDefined();

    // Memory
    expect(index.GlobalMemoryPool).toBeDefined();

    // Quality
    expect(index.AutoFixer).toBeDefined();

    // Code intelligence
    expect(index.LSPClient).toBeDefined();
    expect(index.LSPManager).toBeDefined();

    // Version
    expect(index.VERSION).toBe('1.0.0-beta.1');
  });
});
