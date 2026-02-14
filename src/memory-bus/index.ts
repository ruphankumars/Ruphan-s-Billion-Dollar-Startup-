/**
 * Shared Memory Bus — CortexOS
 *
 * Barrel exports for the shared memory bus subsystem.
 */

export { SharedMemoryBus } from './shared-memory-bus.js';
export type {
  MemoryEntry,
  MemoryChannel,
  ChannelMessage,
  StateProjection,
  ConflictStrategy,
  ConflictEvent,
  ChangeType,
  ChangeEvent,
  MemoryBusConfig,
  MemoryBusStats,
} from './types.js';
