/**
 * Simple performance timer for measuring operation durations
 */
export class Timer {
  private startTime: number;
  private endTime?: number;
  private laps: Map<string, number> = new Map();

  constructor() {
    this.startTime = performance.now();
  }

  /**
   * Record a lap time with a label
   */
  lap(label: string): number {
    const now = performance.now();
    const elapsed = now - this.startTime;
    this.laps.set(label, elapsed);
    return elapsed;
  }

  /**
   * Stop the timer and return total elapsed time
   */
  stop(): number {
    this.endTime = performance.now();
    return this.elapsed;
  }

  /**
   * Get elapsed time in milliseconds
   */
  get elapsed(): number {
    const end = this.endTime ?? performance.now();
    return end - this.startTime;
  }

  /**
   * Get elapsed time formatted as a human-readable string
   */
  get formatted(): string {
    return formatDuration(this.elapsed);
  }

  /**
   * Get all lap times
   */
  getLaps(): Record<string, number> {
    return Object.fromEntries(this.laps);
  }
}

/**
 * Format a duration in milliseconds to a human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/**
 * Measure the execution time of an async function
 */
export async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const timer = new Timer();
  const result = await fn();
  return { result, duration: timer.stop() };
}

/**
 * Create a simple stopwatch
 */
export function stopwatch(): { elapsed: () => number; formatted: () => string } {
  const start = performance.now();
  return {
    elapsed: () => performance.now() - start,
    formatted: () => formatDuration(performance.now() - start),
  };
}
