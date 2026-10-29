// Scope: owns event subscriptions, scheduled runs and pending waits, and releases them all at
// once. Lobby and game code subscribe and schedule only through a Scope, so nothing outlives
// the game, phase or form that created it.
import { system } from "@minecraft/server";
import { describeError, log } from "./log.ts";

/** Anything shaped like a Script API event signal, such as world.afterEvents.playerSpawn. */
export interface Signal<C, O> {
  subscribe(callback: C, options?: O): unknown;
  unsubscribe(callback: C): void;
}

export class Scope {
  readonly name: string;
  private readonly parent: Scope | undefined;
  private readonly children = new Set<Scope>();
  private readonly disposers = new Set<() => void>();
  private isDisposed = false;

  constructor(name = "root", parent?: Scope) {
    this.name = name;
    this.parent = parent;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /** Subscribes until this scope is disposed. Returns the callback. */
  subscribe<C extends (event: never) => void, O>(signal: Signal<C, O>, callback: C, options?: O): C {
    if (this.refuse("subscribe")) return callback;
    const handle = (options === undefined ? signal.subscribe(callback) : signal.subscribe(callback, options)) as C;
    this.add(() => signal.unsubscribe(handle));
    return handle;
  }

  /** Runs `fn` every `ticks` ticks until this scope is disposed. Errors are logged, not fatal. */
  interval(fn: () => void, ticks: number): number {
    if (this.refuse("interval")) return -1;
    const id = system.runInterval(() => this.safely(fn), ticks);
    this.add(() => system.clearRun(id));
    return id;
  }

  /** Runs `fn` once after `ticks` ticks, unless this scope is disposed first. */
  timeout(fn: () => void, ticks: number): number {
    if (this.refuse("timeout")) return -1;
    let release = () => {};
    const id = system.runTimeout(() => {
      release();
      this.safely(fn);
    }, ticks);
    release = this.add(() => system.clearRun(id));
    return id;
  }

  /** Resolves after `ticks` ticks; never settles if this scope is disposed first. */
  wait(ticks: number): Promise<void> {
    return this.guard(new Promise<void>((resolve) => this.timeout(resolve, ticks)));
  }

  /**
   * Passes the promise's result through while this scope is alive. Once it is disposed the
   * returned promise never settles, so code after an `await` doesn't run for a finished game.
   */
  guard<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      promise.then(
        (value) => {
          if (!this.isDisposed) resolve(value);
        },
        (error: unknown) => {
          if (!this.isDisposed) reject(error);
        },
      );
    });
  }

  /** Runs `disposer` when this scope is disposed (at once if it already is). Returns a remover. */
  add(disposer: () => void): () => void {
    if (this.isDisposed) {
      this.runDisposer(disposer);
      return () => {};
    }
    this.disposers.add(disposer);
    return () => {
      this.disposers.delete(disposer);
    };
  }

  /** A scope that is disposed with this one, or earlier on its own. */
  child(name: string): Scope {
    const child = new Scope(`${this.name}/${name}`, this);
    if (this.isDisposed) child.dispose();
    else this.children.add(child);
    return child;
  }

  /** Releases everything: children first, then this scope's resources, newest first. Idempotent. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const child of [...this.children]) child.dispose();
    for (const disposer of [...this.disposers].reverse()) this.runDisposer(disposer);
    this.disposers.clear();
    this.parent?.children.delete(this);
  }

  private refuse(what: string): boolean {
    if (this.isDisposed) log.warn(`${this.name}: ignored ${what} after the scope was disposed`);
    return this.isDisposed;
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      log.error(`${this.name}: ${describeError(error)}`);
    }
  }

  private runDisposer(disposer: () => void): void {
    try {
      disposer();
    } catch (error) {
      log.warn(`${this.name}: cleanup failed: ${describeError(error)}`);
    }
  }
}
