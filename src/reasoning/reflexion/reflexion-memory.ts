/**
 * ReflexionMemory — Session-scoped reflection store.
 *
 * Stores reflections generated during Reflexion retry loops. Each reflection
 * captures what went wrong in a previous attempt and suggests improvements.
 * Reflections are session-scoped and not persisted across runs.
 */
export class ReflexionMemory {
  private reflections: Array<{ reflection: string; timestamp: number }> = [];

  /** Add a new reflection to the store. */
  addReflection(reflection: string): void {
    this.reflections.push({ reflection, timestamp: Date.now() });
  }

  /** Get all stored reflections. */
  getReflections(): Array<{ reflection: string; timestamp: number }> {
    return [...this.reflections];
  }

  /** Get the most recent reflection, or null if none exist. */
  getLatest(): string | null {
    if (this.reflections.length === 0) return null;
    return this.reflections[this.reflections.length - 1].reflection;
  }

  /** Serialize all reflections as a numbered list. */
  serialize(): string {
    return this.reflections
      .map((r, i) => `${i + 1}. ${r.reflection}`)
      .join('\n');
  }

  /** Clear all stored reflections. */
  clear(): void {
    this.reflections = [];
  }

  /** Get the number of stored reflections. */
  get count(): number {
    return this.reflections.length;
  }
}
