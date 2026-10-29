// Points per player or per team: kills, flags, votes, currency. Pure counters; the sidebar
// shows them (sidebar.ts).

export class Score {
  private readonly values = new Map<string, number>();
  private version = 0;

  add(id: string, amount = 1): number {
    const value = (this.values.get(id) ?? 0) + amount;
    this.values.set(id, value);
    this.version++;
    return value;
  }

  set(id: string, value: number): void {
    this.values.set(id, value);
    this.version++;
  }

  get(id: string): number {
    return this.values.get(id) ?? 0;
  }

  entries(): [id: string, value: number][] {
    return [...this.values].sort(([, a], [, b]) => b - a);
  }

  /** Changes whenever a value does, so displays can skip redundant updates. */
  get changes(): number {
    return this.version;
  }

  /** The highest value, and whether someone else has it too. */
  leader(): { id: string; value: number; tied: boolean } | undefined {
    const [first, second] = this.entries();
    if (!first) return undefined;
    return { id: first[0], value: first[1], tied: second !== undefined && second[1] === first[1] };
  }

  /** The first id at or past `target`, if any. */
  reached(target: number): string | undefined {
    return this.entries().find(([, value]) => value >= target)?.[0];
  }
}
