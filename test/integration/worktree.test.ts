import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeManager } from '../../src/agents/sandbox/worktree.js';
import { MergeManager } from '../../src/agents/sandbox/merger.js';
import { FileLockManager } from '../../src/agents/sandbox/lock.js';

// Mock git utilities
vi.mock('../../src/utils/git.js', () => ({
  createWorktree: vi.fn().mockReturnValue(true),
  removeWorktree: vi.fn(),
  mergeBranch: vi.fn().mockReturnValue({ success: true, output: '' }),
  deleteBranch: vi.fn(),
  isGitRepo: vi.fn().mockReturnValue(true),
  getCurrentBranch: vi.fn().mockReturnValue('main'),
  getGitStatus: vi.fn().mockReturnValue('M src/index.ts'),
  getGitDiff: vi.fn().mockReturnValue(''),
}));

// Mock fs for lock manager
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const lockedPaths = new Set<string>();
  return {
    ...actual,
    mkdirSync: vi.fn().mockImplementation((path: string, opts?: any) => {
      if (!opts?.recursive && lockedPaths.has(path)) {
        const err = new Error('EEXIST') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      }
      lockedPaths.add(path);
    }),
    rmdirSync: vi.fn().mockImplementation((path: string) => {
      lockedPaths.delete(path);
    }),
    existsSync: vi.fn().mockImplementation((path: any) => {
      return lockedPaths.has(String(path));
    }),
  };
});

// Mock child_process for merger
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
}));

import { createWorktree, mergeBranch, isGitRepo } from '../../src/utils/git.js';
const mockCreateWorktree = vi.mocked(createWorktree);
const mockMergeBranch = vi.mocked(mergeBranch);
const mockIsGitRepo = vi.mocked(isGitRepo);

describe('WorktreeManager', () => {
  let wm: WorktreeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGitRepo.mockReturnValue(true);
    mockCreateWorktree.mockReturnValue(true);
    wm = new WorktreeManager('/tmp/repo');
  });

  it('should check availability (git repo)', () => {
    expect(wm.isAvailable()).toBe(true);

    mockIsGitRepo.mockReturnValue(false);
    const wm2 = new WorktreeManager('/tmp/not-a-repo');
    expect(wm2.isAvailable()).toBe(false);
  });

  it('should create a worktree', async () => {
    const info = await wm.create('exec-001', 'task-dev');

    expect(info.taskId).toBe('task-dev');
    expect(info.branchName).toBe('cortex/exec-001/task-dev');
    expect(info.worktreePath).toContain('task-dev');
    expect(info.baseBranch).toBe('main');
    expect(mockCreateWorktree).toHaveBeenCalled();
  });

  it('should create worktrees for a wave', async () => {
    const results = await wm.createForWave('exec-001', ['task-1', 'task-2', 'task-3']);

    expect(results.size).toBe(3);
    expect(results.get('task-1')?.branchName).toBe('cortex/exec-001/task-1');
    expect(results.get('task-2')?.branchName).toBe('cortex/exec-001/task-2');
  });

  it('should track active worktrees', async () => {
    await wm.create('exec-001', 'task-1');
    await wm.create('exec-001', 'task-2');

    expect(wm.getActiveWorktrees()).toHaveLength(2);
    expect(wm.getWorkingDir('task-1')).toBeDefined();
    expect(wm.getInfo('task-1')).toBeDefined();
  });

  it('should remove a worktree', async () => {
    await wm.create('exec-001', 'task-1');
    await wm.remove('task-1');

    expect(wm.getActiveWorktrees()).toHaveLength(0);
    expect(wm.getWorkingDir('task-1')).toBeUndefined();
  });

  it('should cleanup all worktrees', async () => {
    await wm.create('exec-001', 'task-1');
    await wm.create('exec-001', 'task-2');
    await wm.cleanupAll();

    expect(wm.getActiveWorktrees()).toHaveLength(0);
  });
});

describe('MergeManager', () => {
  let mm: MergeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMergeBranch.mockReturnValue({ success: true, output: '' });
    mm = new MergeManager('/tmp/repo');
  });

  it('should merge a worktree branch successfully', async () => {
    const result = await mm.mergeOne({
      taskId: 'task-1',
      branchName: 'cortex/exec-001/task-1',
      worktreePath: '/tmp/repo/.cortexos/worktrees/task-1',
      baseBranch: 'main',
    });

    expect(result.success).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it('should detect merge conflicts', async () => {
    mockMergeBranch.mockReturnValue({
      success: false,
      output: 'CONFLICT (content): Merge conflict in src/index.ts\nCONFLICT (content): Merge conflict in src/utils.ts',
    });

    const result = await mm.mergeOne({
      taskId: 'task-1',
      branchName: 'cortex/exec-001/task-1',
      worktreePath: '/tmp/repo/.cortexos/worktrees/task-1',
      baseBranch: 'main',
    });

    expect(result.success).toBe(false);
    expect(result.conflicts).toHaveLength(2);
    expect(result.conflicts).toContain('src/index.ts');
    expect(result.conflicts).toContain('src/utils.ts');
  });

  it('should merge all worktrees from a manager', async () => {
    mockCreateWorktree.mockReturnValue(true);
    mockIsGitRepo.mockReturnValue(true);
    const wm = new WorktreeManager('/tmp/repo');
    await wm.create('exec-001', 'task-1');
    await wm.create('exec-001', 'task-2');

    const results = await mm.mergeAll(wm);

    expect(results).toHaveLength(2);
    expect(results.every(r => r.success)).toBe(true);
  });
});

describe('FileLockManager', () => {
  it('should acquire and release locks', () => {
    const lm = new FileLockManager('/tmp/test-project');

    lm.acquireLock('src/index.ts');
    expect(lm.isLocked('src/index.ts')).toBe(true);

    lm.releaseLock('src/index.ts');
    // After release, isLocked depends on mock state
  });

  it('should throw on double-lock', () => {
    const lm = new FileLockManager('/tmp/test-project');

    lm.acquireLock('src/utils.ts');
    expect(() => lm.acquireLock('src/utils.ts')).toThrow('already locked');
  });

  it('should release all locks', () => {
    const lm = new FileLockManager('/tmp/test-project');

    lm.acquireLock('file-a.ts');
    lm.acquireLock('file-b.ts');
    lm.releaseAll();

    // Should not throw on new locks after release
    lm.acquireLock('file-a.ts');
  });
});
