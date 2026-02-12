/**
 * Sandbox Module — Git worktree isolation + file locking for parallel agents
 */

export { WorktreeManager, type WorktreeInfo } from './worktree.js';
export { MergeManager, type MergeResult } from './merger.js';
export { FileLockManager } from './lock.js';
