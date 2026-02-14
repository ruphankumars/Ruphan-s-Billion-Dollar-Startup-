/**
 * Surface Manager — Multi-Surface Lifecycle Orchestrator
 *
 * Manages the lifecycle of all CortexOS surface adapters (GitHub, Slack,
 * Discord, etc.). Registers surfaces, starts/stops them in bulk, broadcasts
 * events, and aggregates stats across all active surfaces.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  Surface,
  SurfaceStats,
  SurfaceManagerConfig,
  SurfaceType,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SurfaceManagerStats {
  totalSurfaces: number;
  runningSurfaces: number;
  stoppedSurfaces: number;
  totalEventsReceived: number;
  totalEventsProcessed: number;
  totalErrors: number;
  surfaceStats: SurfaceStats[];
}

// ═══════════════════════════════════════════════════════════════
// SURFACE MANAGER
// ═══════════════════════════════════════════════════════════════

export class SurfaceManager extends EventEmitter {
  readonly id: string;
  private surfaces: Map<string, Surface> = new Map();
  private running = false;
  private startTime = 0;

  constructor(private config?: SurfaceManagerConfig) {
    super();
    this.id = `sm_${randomUUID().slice(0, 8)}`;
  }

  // ─── Surface Registration ──────────────────────────────────

  /**
   * Register a surface adapter with the manager.
   * Forwards all events emitted by the surface to the manager.
   */
  registerSurface(surface: Surface): void {
    if (this.surfaces.has(surface.id)) {
      throw new Error(`Surface "${surface.id}" is already registered`);
    }

    this.surfaces.set(surface.id, surface);

    // Forward child surface events to the manager
    const forwardEvent = (event: string | symbol, ...args: unknown[]) => {
      if (typeof event === 'string') {
        this.emit(event, ...args);
      }
    };

    // Listen for all surface events and forward them
    const originalEmit = surface.emit.bind(surface);
    surface.emit = (event: string | symbol, ...args: unknown[]): boolean => {
      const result = originalEmit(event, ...args);
      forwardEvent(event, ...args);
      return result;
    };

    this.emit('surface:registered', {
      surfaceId: surface.id,
      type: surface.type,
      timestamp: Date.now(),
    });
  }

  /**
   * Unregister a surface adapter. Stops it first if running.
   */
  async unregisterSurface(id: string): Promise<boolean> {
    const surface = this.surfaces.get(id);
    if (!surface) return false;

    if (surface.isRunning()) {
      await surface.stop();
    }

    this.surfaces.delete(id);

    this.emit('surface:unregistered', {
      surfaceId: id,
      type: surface.type,
      timestamp: Date.now(),
    });

    return true;
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  /**
   * Start all registered surfaces.
   * Surfaces that fail to start will emit an error event but
   * will not prevent other surfaces from starting.
   */
  async startAll(): Promise<void> {
    this.running = true;
    this.startTime = Date.now();

    const startPromises = [...this.surfaces.values()].map(async (surface) => {
      try {
        await surface.start();
        this.emit('surface:started', {
          surfaceId: surface.id,
          type: surface.type,
          timestamp: Date.now(),
        });
      } catch (err) {
        this.emit('surface:error', {
          surfaceId: surface.id,
          type: surface.type,
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        });
      }
    });

    await Promise.allSettled(startPromises);

    this.emit('manager:started', {
      managerId: this.id,
      surfaceCount: this.surfaces.size,
      timestamp: Date.now(),
    });
  }

  /**
   * Stop all registered surfaces gracefully.
   */
  async stopAll(): Promise<void> {
    const stopPromises = [...this.surfaces.values()].map(async (surface) => {
      try {
        if (surface.isRunning()) {
          await surface.stop();
          this.emit('surface:stopped', {
            surfaceId: surface.id,
            type: surface.type,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        this.emit('surface:error', {
          surfaceId: surface.id,
          type: surface.type,
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        });
      }
    });

    await Promise.allSettled(stopPromises);

    this.running = false;

    this.emit('manager:stopped', {
      managerId: this.id,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if the manager is running (has been started).
   */
  isRunning(): boolean {
    return this.running;
  }

  // ─── Surface Access ────────────────────────────────────────

  /**
   * Get a surface by its ID.
   */
  getSurface(id: string): Surface | undefined {
    return this.surfaces.get(id);
  }

  /**
   * Get a surface by its type. Returns the first match.
   */
  getSurfaceByType(type: SurfaceType): Surface | undefined {
    for (const surface of this.surfaces.values()) {
      if (surface.type === type) return surface;
    }
    return undefined;
  }

  /**
   * List all registered surfaces with their current status.
   */
  listSurfaces(): Array<{ id: string; type: SurfaceType; running: boolean }> {
    return [...this.surfaces.values()].map((s) => ({
      id: s.id,
      type: s.type,
      running: s.isRunning(),
    }));
  }

  // ─── Broadcasting ──────────────────────────────────────────

  /**
   * Broadcast an event to all registered surfaces.
   * Each surface receives the event via its EventEmitter.
   */
  broadcast(event: string, data?: unknown): void {
    for (const surface of this.surfaces.values()) {
      try {
        surface.emit(event, data);
      } catch {
        // Ignore errors from individual surfaces during broadcast
      }
    }

    this.emit('manager:broadcast', {
      event,
      surfaceCount: this.surfaces.size,
      timestamp: Date.now(),
    });
  }

  // ─── Stats ─────────────────────────────────────────────────

  /**
   * Get aggregate stats across all surfaces.
   */
  getStats(): SurfaceManagerStats {
    const surfaceStats: SurfaceStats[] = [];
    let totalEventsReceived = 0;
    let totalEventsProcessed = 0;
    let totalErrors = 0;
    let runningSurfaces = 0;

    for (const surface of this.surfaces.values()) {
      const stats = surface.getStats();
      surfaceStats.push(stats);

      totalEventsReceived += stats.eventsReceived;
      totalEventsProcessed += stats.eventsProcessed;
      totalErrors += stats.errors;

      if (stats.isRunning) {
        runningSurfaces++;
      }
    }

    return {
      totalSurfaces: this.surfaces.size,
      runningSurfaces,
      stoppedSurfaces: this.surfaces.size - runningSurfaces,
      totalEventsReceived,
      totalEventsProcessed,
      totalErrors,
      surfaceStats,
    };
  }
}
