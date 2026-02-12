/**
 * Streaming Pipeline — Full SSE/streaming support through engine stages.
 *
 * Provides a StreamingEngine wrapper that emits granular progress events
 * for each pipeline stage, enabling real-time UI updates via EventSource/WebSocket.
 */

import type { ExecutionResult, ExecutionStage } from './types.js';
import { EventBus } from './events.js';

export interface StreamEvent {
  type: StreamEventType;
  stage?: ExecutionStage;
  data: unknown;
  timestamp: number;
  sequence: number;
}

export type StreamEventType =
  | 'pipeline:start'
  | 'pipeline:complete'
  | 'pipeline:error'
  | 'stage:enter'
  | 'stage:progress'
  | 'stage:exit'
  | 'agent:chunk'
  | 'agent:tool_call'
  | 'agent:thinking'
  | 'quality:gate_start'
  | 'quality:gate_result'
  | 'memory:recall_result'
  | 'cost:update'
  | 'heartbeat';

export type StreamCallback = (event: StreamEvent) => void;

/**
 * StreamController manages event streaming for a single pipeline execution.
 * Provides both push (callback) and pull (async iterator) interfaces.
 */
export class StreamController {
  private callbacks: StreamCallback[] = [];
  private buffer: StreamEvent[] = [];
  private sequence = 0;
  private closed = false;
  private waiters: Array<{
    resolve: (value: IteratorResult<StreamEvent>) => void;
  }> = [];

  /**
   * Subscribe to stream events via callback
   */
  subscribe(callback: StreamCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx !== -1) this.callbacks.splice(idx, 1);
    };
  }

  /**
   * Emit a stream event
   */
  emit(type: StreamEventType, data: unknown, stage?: ExecutionStage): void {
    if (this.closed) return;

    const event: StreamEvent = {
      type,
      stage,
      data,
      timestamp: Date.now(),
      sequence: this.sequence++,
    };

    // Push to callbacks
    for (const cb of this.callbacks) {
      try { cb(event); } catch { /* ignore callback errors */ }
    }

    // Push to async iterator waiters
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve({ value: event, done: false });
    } else {
      this.buffer.push(event);
    }
  }

  /**
   * Close the stream (no more events)
   */
  close(): void {
    this.closed = true;
    // Resolve all waiting iterators
    for (const waiter of this.waiters) {
      waiter.resolve({ value: undefined as any, done: true });
    }
    this.waiters = [];
  }

  /**
   * Get the stream as an async iterable
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<StreamEvent> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!;
      } else if (this.closed) {
        return;
      } else {
        // Wait for next event
        const event = await new Promise<IteratorResult<StreamEvent>>((resolve) => {
          this.waiters.push({ resolve });
        });
        if (event.done) return;
        yield event.value;
      }
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get eventCount(): number {
    return this.sequence;
  }
}

/**
 * EventBus adapter that bridges CortexEngine events to StreamController.
 * Wires up all engine events and converts them to stream events.
 */
export class StreamBridge {
  private listeners: Array<{ event: string; handler: (data: unknown) => void }> = [];

  constructor(
    private eventBus: EventBus,
    private stream: StreamController,
  ) {}

  /**
   * Wire all engine events to the stream controller
   */
  connect(): void {
    const mappings: Array<{
      engineEvent: string;
      streamType: StreamEventType;
      stage?: ExecutionStage;
    }> = [
      { engineEvent: 'engine:start', streamType: 'pipeline:start' },
      { engineEvent: 'engine:complete', streamType: 'pipeline:complete' },
      { engineEvent: 'engine:error', streamType: 'pipeline:error' },
      { engineEvent: 'stage:start', streamType: 'stage:enter' },
      { engineEvent: 'stage:complete', streamType: 'stage:exit' },
      { engineEvent: 'agent:start', streamType: 'agent:chunk' },
      { engineEvent: 'agent:tool', streamType: 'agent:tool_call' },
      { engineEvent: 'agent:progress', streamType: 'agent:thinking' },
      { engineEvent: 'agent:complete', streamType: 'agent:chunk' },
      { engineEvent: 'quality:gate', streamType: 'quality:gate_result' },
      { engineEvent: 'quality:autofix', streamType: 'quality:gate_result' },
      { engineEvent: 'memory:recall', streamType: 'memory:recall_result' },
      { engineEvent: 'cost:update', streamType: 'cost:update' },
    ];

    for (const mapping of mappings) {
      const handler = (data: unknown) => {
        const stage = extractStage(data) ?? mapping.stage;
        this.stream.emit(mapping.streamType, data, stage);
      };
      this.eventBus.on(mapping.engineEvent as any, handler);
      this.listeners.push({ event: mapping.engineEvent, handler });
    }
  }

  /**
   * Start heartbeat interval
   */
  startHeartbeat(intervalMs = 5000): () => void {
    const timer = setInterval(() => {
      this.stream.emit('heartbeat', { alive: true });
    }, intervalMs);

    return () => clearInterval(timer);
  }

  /**
   * Disconnect all event wiring
   */
  disconnect(): void {
    for (const { event, handler } of this.listeners) {
      this.eventBus.off(event as any, handler);
    }
    this.listeners = [];
  }
}

/**
 * Format a StreamEvent to SSE format (text/event-stream)
 */
export function formatSSE(event: StreamEvent): string {
  const lines: string[] = [];
  lines.push(`event: ${event.type}`);
  lines.push(`id: ${event.sequence}`);
  lines.push(`data: ${JSON.stringify({
    stage: event.stage,
    data: event.data,
    timestamp: event.timestamp,
  })}`);
  lines.push(''); // Empty line terminates the event
  return lines.join('\n') + '\n';
}

/**
 * Create a stream controller with bridge wired to an event bus
 */
export function createStreamPipeline(eventBus: EventBus): {
  stream: StreamController;
  bridge: StreamBridge;
} {
  const stream = new StreamController();
  const bridge = new StreamBridge(eventBus, stream);
  bridge.connect();
  return { stream, bridge };
}

function extractStage(data: unknown): ExecutionStage | undefined {
  if (data && typeof data === 'object' && 'stage' in data) {
    return (data as { stage: ExecutionStage }).stage;
  }
  return undefined;
}
