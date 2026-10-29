// Handler list shared by both ends of the transport. A handler that throws is reported and
// does not stop delivery to the others.
export class HandlerSet<T> {
  private readonly handlers = new Set<(value: T) => void>();

  /** Returns a function that removes the handler. */
  add(handler: (value: T) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(value: T, onError: (error: unknown) => void): void {
    for (const handler of [...this.handlers]) {
      try {
        handler(value);
      } catch (error) {
        onError(error);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }

  get size(): number {
    return this.handlers.size;
  }
}
