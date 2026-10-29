// Minimal fake of @minecraft/server for unit tests, swapped in by vitest.config.ts. Time moves
// only when a test calls system.advanceTicks(), and signals count their listeners so tests can
// catch leaks. It grows as core uses more of the API.

export const ScriptEventSource = {
  Block: "Block",
  Entity: "Entity",
  NPCDialogue: "NPCDialogue",
  Server: "Server",
} as const;
export type ScriptEventSource = (typeof ScriptEventSource)[keyof typeof ScriptEventSource];

export interface FakeScriptEvent {
  id: string;
  message: string;
  sourceType: ScriptEventSource;
}

export class FakeSignal<E, O = undefined> {
  private readonly listeners = new Map<(event: E) => void, O | undefined>();

  subscribe(callback: (event: E) => void, options?: O): (event: E) => void {
    this.listeners.set(callback, options);
    return callback;
  }

  unsubscribe(callback: (event: E) => void): void {
    this.listeners.delete(callback);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Test helper: calls each listener whose subscribe options accept the event. */
  emit(event: E, accepts: (options: O | undefined) => boolean = () => true): void {
    for (const [callback, options] of [...this.listeners]) {
      if (accepts(options)) callback(event);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

interface ScheduledRun {
  at: number;
  callback: () => void;
  every?: number;
}

class FakeSystem {
  currentTick = 0;
  readonly afterEvents = {
    scriptEventReceive: new FakeSignal<FakeScriptEvent, { namespaces?: string[] }>(),
  };
  private nextRunId = 1;
  private readonly runs = new Map<number, ScheduledRun>();

  runTimeout(callback: () => void, tickDelay = 1): number {
    return this.schedule({ at: this.currentTick + tickDelay, callback });
  }

  runInterval(callback: () => void, tickInterval = 1): number {
    return this.schedule({ at: this.currentTick + tickInterval, callback, every: tickInterval });
  }

  clearRun(runId: number): void {
    this.runs.delete(runId);
  }

  waitTicks(ticks: number): Promise<void> {
    return new Promise((resolve) => this.runTimeout(resolve, ticks));
  }

  /** Test helper: moves time forward one tick at a time, running whatever falls due. */
  advanceTicks(ticks = 1): void {
    for (let i = 0; i < ticks; i++) {
      this.currentTick++;
      for (const [id, run] of [...this.runs]) {
        if (run.at > this.currentTick || !this.runs.has(id)) continue;
        if (run.every) run.at += run.every;
        else this.runs.delete(id);
        run.callback();
      }
    }
  }

  /** Test helper: delivers a script event, filtered by namespace as BDS does. */
  emitScriptEvent(id: string, message: string, sourceType: ScriptEventSource = ScriptEventSource.Server): void {
    const namespace = id.split(":")[0];
    this.afterEvents.scriptEventReceive.emit(
      { id, message, sourceType },
      (options) => !options?.namespaces || options.namespaces.includes(namespace),
    );
  }

  get pendingRuns(): number {
    return this.runs.size;
  }

  /** Test helper: clears every run and listener and resets the clock. */
  reset(): void {
    this.currentTick = 0;
    this.runs.clear();
    this.afterEvents.scriptEventReceive.clear();
  }

  private schedule(run: ScheduledRun): number {
    const id = this.nextRunId++;
    this.runs.set(id, run);
    return id;
  }
}

export const system = new FakeSystem();
