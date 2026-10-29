import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { MAX_MESSAGE_CHARS, type InboundMessage } from "../src/protocol/index.ts";
import { createTransport, kind } from "../src/transport/log-stdin.ts";
import { ScriptEventSource, system } from "./fake-mc-server.ts";

const options = { serverId: "lobby", orchestratorUrl: "http://orchestrator:8080" };
const status: InboundMessage = { t: "status", state: "idle", players: [] };
const ended: InboundMessage = { t: "game_ended", sessionId: "s1", reason: "finished" };

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  system.reset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function netLines(): string[] {
  return warn.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("[NET] "));
}

describe("log/stdin transport", () => {
  it("writes each event as one [NET] line", () => {
    const transport = createTransport(options);
    transport.send({ t: "status_request" });
    transport.send({ t: "end_game", sessionId: "s1", reason: "finished" });
    expect(netLines()).toEqual([
      '[NET] {"t":"status_request"}',
      '[NET] {"t":"end_game","sessionId":"s1","reason":"finished"}',
    ]);
    expect(transport.kind).toBe("log");
    expect(kind).toBe("log");
  });

  it("drops an oversized event with a warning instead of writing it", () => {
    const transport = createTransport(options);
    transport.send({ t: "start_game", requestId: "r1", game: "sumo", map: "x".repeat(MAX_MESSAGE_CHARS), players: [] });
    expect(netLines()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Dropped "start_game"'));
  });

  it("delivers server-console messages to every handler", () => {
    const transport = createTransport(options);
    const first = vi.fn();
    const second = vi.fn();
    transport.onMessage(first);
    transport.onMessage(second);
    system.emitScriptEvent("minecade:net", JSON.stringify(status));
    system.emitScriptEvent("minecade:net", JSON.stringify(ended));
    expect(first.mock.calls).toEqual([[status], [ended]]);
    expect(second.mock.calls).toEqual([[status], [ended]]);
  });

  it("subscribes once, to the minecade namespace only", () => {
    const transport = createTransport(options);
    const handler = vi.fn();
    transport.onMessage(handler);
    transport.onMessage(() => {});
    expect(system.afterEvents.scriptEventReceive.listenerCount).toBe(1);
    system.emitScriptEvent("other:net", JSON.stringify(status));
    system.emitScriptEvent("minecade:debug", JSON.stringify(status));
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores messages that do not come from the server console", () => {
    const transport = createTransport(options);
    const handler = vi.fn();
    transport.onMessage(handler);
    for (const source of [ScriptEventSource.Entity, ScriptEventSource.Block, ScriptEventSource.NPCDialogue]) {
      system.emitScriptEvent("minecade:net", JSON.stringify(status), source);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores malformed JSON and unknown message types", () => {
    const transport = createTransport(options);
    const handler = vi.fn();
    transport.onMessage(handler);
    system.emitScriptEvent("minecade:net", "{not json");
    system.emitScriptEvent("minecade:net", JSON.stringify({ t: "not_a_message" }));
    system.emitScriptEvent("minecade:net", JSON.stringify([status]));
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps delivering when one handler throws", () => {
    const transport = createTransport(options);
    const after = vi.fn();
    transport.onMessage(() => {
      throw new Error("boom");
    });
    transport.onMessage(after);
    system.emitScriptEvent("minecade:net", JSON.stringify(status));
    expect(after).toHaveBeenCalledWith(status);
  });

  it("removes one handler with the function onMessage returns", () => {
    const transport = createTransport(options);
    const kept = vi.fn();
    const removed = vi.fn();
    transport.onMessage(kept);
    const off = transport.onMessage(removed);
    off();
    system.emitScriptEvent("minecade:net", JSON.stringify(status));
    expect(kept).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
  });

  it("unsubscribes on dispose but still sends", () => {
    const transport = createTransport(options);
    const handler = vi.fn();
    transport.onMessage(handler);
    transport.dispose();
    expect(system.afterEvents.scriptEventReceive.listenerCount).toBe(0);
    system.emitScriptEvent("minecade:net", JSON.stringify(status));
    transport.onMessage(handler);
    expect(system.afterEvents.scriptEventReceive.listenerCount).toBe(0);
    expect(handler).not.toHaveBeenCalled();
    transport.send({ t: "end_game", sessionId: "s1", reason: "finished" });
    expect(netLines()).toHaveLength(1);
  });
});
