import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_MESSAGE_CHARS, type InboundMessage, type OutboundEvent } from "@minecade/minigame-core/protocol";
import { extractNetPayload, LogStdinServerLink, type LineConsole } from "../src/links/logstdin-link.ts";

// Captured from a spike BDS 1.26.60.6 container: script console.warn/log/info/error output.
const realLines = readFileSync(new URL("./fixtures/bds-net-lines.txt", import.meta.url), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);
const realWarnLine = realLines.find((line) => line.includes(" WARN] [Scripting] [NET] "))!;

/** A real BDS log line with its [NET] payload swapped for `json`. */
function netLine(json: string): string {
  return realWarnLine.replace(/\[NET\] .*$/, `[NET] ${json}`);
}

class FakeConsole implements LineConsole {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Set<(line: string) => void>();

  send(line: string): void {
    this.sent.push(line);
  }

  onLine(cb: (line: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.closed = true;
  }

  emit(line: string): void {
    for (const cb of this.listeners) cb(line);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

const ready: OutboundEvent = { t: "server_ready", protocol: 1, role: "lobby", transport: "log" };
const status: InboundMessage = { t: "status", state: "idle", players: [] };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractNetPayload", () => {
  it("finds the payload in real BDS lines at every console level", () => {
    const payloads = realLines.map(extractNetPayload).filter((payload) => payload !== undefined);
    expect(payloads.map((payload) => JSON.parse(payload).via)).toEqual(["warn", "log", "info", "error"]);
  });

  it("ignores every other line", () => {
    expect(extractNetPayload(realLines.find((line) => line.includes("Server started."))!)).toBeUndefined();
    expect(extractNetPayload('[NET] {"t":"status_request"}')).toBeUndefined();
    expect(
      extractNetPayload('[2026-10-28 22:35:31:309 INFO] Player connected: [NET] {"t":"status_request"}'),
    ).toBeUndefined();
  });

  it("tolerates a trailing carriage return", () => {
    expect(extractNetPayload(`${netLine('{"t":"status_request"}')}\r`)).toBe('{"t":"status_request"}');
  });
});

describe("LogStdinServerLink", () => {
  it("emits events read from [NET] lines", () => {
    const serverConsole = new FakeConsole();
    const link = new LogStdinServerLink("lobby", serverConsole);
    const handler = vi.fn();
    link.onEvent(handler);
    serverConsole.emit(realLines[0]); // "Server started."
    serverConsole.emit(netLine(JSON.stringify(ready)));
    expect(handler.mock.calls).toEqual([[ready]]);
    expect(link.kind).toBe("log");
  });

  it("ignores malformed payloads and unknown event types", () => {
    const serverConsole = new FakeConsole();
    const link = new LogStdinServerLink("lobby", serverConsole);
    const handler = vi.fn();
    link.onEvent(handler);
    serverConsole.emit(netLine("{oops"));
    serverConsole.emit(netLine(JSON.stringify({ t: "game_ready" }))); // inbound type, wrong direction
    for (const line of realLines) serverConsole.emit(line); // spike payloads have no protocol type
    expect(handler).not.toHaveBeenCalled();
  });

  it("writes each message to stdin as a single scriptevent command", () => {
    const serverConsole = new FakeConsole();
    const link = new LogStdinServerLink("lobby", serverConsole);
    const sneaky: InboundMessage = { t: "status", state: "idle", players: ["Steve\nop Steve"] };
    expect(link.send(status)).toBe(true);
    expect(link.send(sneaky)).toBe(true);
    expect(serverConsole.sent).toEqual([
      `scriptevent minecade:net ${JSON.stringify(status)}`,
      `scriptevent minecade:net ${JSON.stringify(sneaky)}`,
    ]);
    expect(serverConsole.sent.every((line) => !line.includes("\n"))).toBe(true);
  });

  it("refuses a message over the size limit", () => {
    const serverConsole = new FakeConsole();
    const link = new LogStdinServerLink("lobby", serverConsole);
    expect(link.send({ t: "game_ended", sessionId: "s1", reason: "x".repeat(MAX_MESSAGE_CHARS) })).toBe(false);
    expect(serverConsole.sent).toEqual([]);
  });

  it("closes the console and stops on close", () => {
    const serverConsole = new FakeConsole();
    const link = new LogStdinServerLink("lobby", serverConsole);
    const handler = vi.fn();
    link.onEvent(handler);
    link.close();
    expect(serverConsole.closed).toBe(true);
    expect(serverConsole.listenerCount).toBe(0);
    expect(link.send(status)).toBe(false);
    serverConsole.emit(netLine(JSON.stringify(ready)));
    expect(handler).not.toHaveBeenCalled();
  });
});
