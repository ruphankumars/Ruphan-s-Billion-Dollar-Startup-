/**
 * Sync Module — CortexOS Cross-Device Session Sync
 *
 * Provides real-time session synchronization across multiple devices with
 * conflict detection, configurable resolution strategies, and delta updates.
 *
 * @example
 * ```typescript
 * import { SessionSync } from 'cortexos/sync';
 *
 * const sync = new SessionSync({ conflictStrategy: 'latest-wins' });
 * sync.start();
 *
 * sync.registerDevice({ id: 'laptop-1', name: 'Work Laptop', type: 'desktop', capabilities: ['full'] });
 * const session = sync.createSession('user-1', 'laptop-1', { theme: 'dark' });
 * sync.updateState(session.id, { cursor: { line: 42 } }, 'laptop-1');
 * ```
 */

export { SessionSync } from './session-sync.js';
export type {
  SyncSession,
  SyncMessage,
  SyncConflict,
  DeviceInfo,
  SyncConfig,
  SyncStats,
} from './types.js';
