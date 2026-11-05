// How long each step of a game start took, counted from the start request: the container, the
// entrypoint's steps (its "[minecade] step <name> <ms>" lines), BDS, the pack, and each player's
// arrival. The session logs it as one line once everyone it expects is in, or when it ends.

/** An entrypoint step line: the step's name and the time it was reached, in epoch milliseconds. */
const STEP_LINE = /^\[minecade\] step ([a-z_]+) (\d{13})$/;

export class Timeline {
  private readonly startedAt: number;
  private readonly marks: { name: string; at: number }[] = [];

  constructor(startedAt = Date.now()) {
    this.startedAt = startedAt;
  }

  /** Notes a step, once: a step seen again keeps its first time. */
  mark(name: string, at = Date.now()): void {
    if (!this.has(name)) this.marks.push({ name, at });
  }

  has(name: string): boolean {
    return this.marks.some((mark) => mark.name === name);
  }

  /** Notes an entrypoint step from its console line. False for any other line. */
  markStep(line: string): boolean {
    const step = STEP_LINE.exec(line.trim());
    if (!step) return false;
    this.mark(step[1], Number(step[2]));
    return true;
  }

  /** "created 0.3 s, entrypoint 0.4 s, ...": each step's time since the request, in order. */
  summary(): string {
    return [...this.marks]
      .sort((a, b) => a.at - b.at)
      .map((mark) => `${mark.name} ${((mark.at - this.startedAt) / 1000).toFixed(1)} s`)
      .join(", ");
  }
}
