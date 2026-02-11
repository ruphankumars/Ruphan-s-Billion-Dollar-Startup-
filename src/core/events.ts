import EventEmitter from 'eventemitter3';
import type { CortexEvents } from './types.js';

export class EventBus {
  private emitter = new EventEmitter();

  on<K extends keyof CortexEvents>(event: K, listener: (data: CortexEvents[K]) => void): void {
    this.emitter.on(event as string, listener);
  }

  off<K extends keyof CortexEvents>(event: K, listener: (data: CortexEvents[K]) => void): void {
    this.emitter.off(event as string, listener);
  }

  once<K extends keyof CortexEvents>(event: K, listener: (data: CortexEvents[K]) => void): void {
    this.emitter.once(event as string, listener);
  }

  emit<K extends keyof CortexEvents>(event: K, data: CortexEvents[K]): void {
    this.emitter.emit(event as string, data);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
