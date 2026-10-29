import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scope } from "../src/scope.ts";
import { FakeSignal, system } from "./fake-mc-server.ts";
import { flushPromises } from "./util.ts";

beforeEach(() => {
  system.reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Scope", () => {
  it("unsubscribes and cancels everything on dispose", () => {
    const signal = new FakeSignal<string>();
    const scope = new Scope();
    const seen: string[] = [];
    scope.subscribe(signal, (event: string) => seen.push(event));
    scope.interval(() => seen.push("tick"), 5);
    scope.timeout(() => seen.push("later"), 50);
    expect(signal.listenerCount).toBe(1);
    expect(system.pendingRuns).toBe(2);

    signal.emit("a");
    system.advanceTicks(5);
    scope.dispose();
    expect(signal.listenerCount).toBe(0);
    expect(system.pendingRuns).toBe(0);
    signal.emit("b");
    system.advanceTicks(100);
    expect(seen).toEqual(["a", "tick"]);
  });

  it("passes subscribe options through", () => {
    const scope = new Scope();
    const handler = vi.fn();
    scope.subscribe(system.afterEvents.scriptEventReceive, handler, { namespaces: ["minecade"] });
    system.emitScriptEvent("other:x", "");
    system.emitScriptEvent("minecade:x", "");
    expect(handler).toHaveBeenCalledOnce();
    scope.dispose();
    expect(system.afterEvents.scriptEventReceive.listenerCount).toBe(0);
  });

  it("forgets a timeout once it has run", () => {
    const scope = new Scope();
    const clearRun = vi.spyOn(system, "clearRun");
    scope.timeout(() => {}, 1);
    system.advanceTicks(1);
    scope.dispose();
    expect(clearRun).not.toHaveBeenCalled();
  });

  it("disposes children with their parent, and detaches a child disposed on its own", () => {
    const signal = new FakeSignal<string>();
    const root = new Scope();
    const early = root.child("early");
    const late = root.child("late");
    early.subscribe(signal, () => {});
    late.subscribe(signal, () => {});
    early.dispose();
    expect(signal.listenerCount).toBe(1);
    root.dispose();
    expect(late.disposed).toBe(true);
    expect(signal.listenerCount).toBe(0);
    expect(root.child("after").disposed).toBe(true);
  });

  it("never settles wait() or guard() once disposed", async () => {
    const scope = new Scope();
    const settled = vi.fn();
    void scope.wait(10).then(settled);
    let resolve!: (value: string) => void;
    void scope.guard(new Promise<string>((r) => (resolve = r))).then(settled, settled);
    scope.dispose();
    system.advanceTicks(20);
    resolve("late");
    await flushPromises();
    expect(settled).not.toHaveBeenCalled();
    expect(system.pendingRuns).toBe(0);
  });

  it("resolves wait() and passes guard() results through while alive", async () => {
    const scope = new Scope();
    const waited = vi.fn();
    void scope.wait(10).then(waited);
    system.advanceTicks(10);
    await flushPromises();
    expect(waited).toHaveBeenCalledOnce();
    await expect(scope.guard(Promise.resolve(7))).resolves.toBe(7);
    await expect(scope.guard(Promise.reject(new Error("no")))).rejects.toThrow("no");
  });

  it("is idempotent, keeps going when a disposer throws, and runs late disposers at once", () => {
    const scope = new Scope();
    const calls: string[] = [];
    scope.add(() => calls.push("first"));
    scope.add(() => {
      throw new Error("boom");
    });
    scope.add(() => calls.push("last"));
    scope.dispose();
    scope.dispose();
    expect(calls).toEqual(["last", "first"]); // newest first
    scope.add(() => calls.push("late"));
    expect(calls).toEqual(["last", "first", "late"]);
    expect(scope.interval(() => {}, 1)).toBe(-1);
    expect(system.pendingRuns).toBe(0);
  });

  it("logs an interval's error and keeps the interval running", () => {
    const scope = new Scope("game");
    let runs = 0;
    scope.interval(() => {
      runs++;
      throw new Error("bad tick");
    }, 1);
    system.advanceTicks(3);
    expect(runs).toBe(3);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("game: Error: bad tick"));
    scope.dispose();
  });
});
