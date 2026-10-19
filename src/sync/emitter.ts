export type Listener<E> = (event: E) => void;

/** Minimal typed event emitter. Listener errors are isolated from each other. */
export class Emitter<E> {
  private readonly listeners = new Set<Listener<E>>();

  on(listener: Listener<E>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: E): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('[settings-sync] listener failed', error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
