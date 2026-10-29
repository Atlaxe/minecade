// Both ends of each transport together: the pack-side implementation from minigame-core
// against the orchestrator's link, so the two sides cannot drift apart.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundMessage, OutboundEvent } from "@minecade/minigame-core/protocol";
import { createTransport as createHttpTransport } from "@minecade/minigame-core/transport/http";
import { createTransport as createLogTransport } from "@minecade/minigame-core/transport/log-stdin";
import { ScriptEventSource, system } from "../../packages/minigame-core/test/fake-mc-server.ts";
import { bridgeToFetch, resetHttp } from "../../packages/minigame-core/test/fake-mc-server-net.ts";
import { HttpLinkHub } from "../src/links/http-link.ts";
import { LogStdinServerLink, type LineConsole } from "../src/links/logstdin-link.ts";

const ready: OutboundEvent = { t: "server_ready", protocol: 1, role: "lobby", transport: "http" };
const start: OutboundEvent = { t: "start_game", requestId: "r1", game: "sumo", map: "arena_1", players: ["Steve"] };
const gameReady: InboundMessage = {
  t: "game_ready",
  requestId: "r1",
  sessionId: "abc",
  game: "sumo",
  map: "arena_1",
  port: 19133,
  hosts: { public: "203.0.113.7", lan: "192.168.40.98" },
};

beforeEach(() => {
  system.reset();
  resetHttp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HTTP round trip", () => {
  let server: Server;
  let orchestratorUrl: string;
  const hub = new HttpLinkHub();

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (!hub.handle(req, res)) res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    orchestratorUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("carries events to the orchestrator and messages back", async () => {
    bridgeToFetch();
    const link = hub.open("lobby");
    const events: OutboundEvent[] = [];
    link.onEvent((event) => events.push(event));

    const transport = createHttpTransport({ serverId: "lobby", orchestratorUrl });
    const messages: InboundMessage[] = [];
    transport.onMessage((message) => messages.push(message));

    transport.send(ready);
    transport.send(start);
    await vi.waitFor(() => expect(events).toEqual([ready, start]));

    link.send(gameReady);
    await vi.waitFor(() => expect(messages).toEqual([gameReady]));

    transport.dispose();
    link.close(); // answers the open poll so the loop can see it was disposed
  });
});

describe("log/stdin round trip", () => {
  /** Stands in for the BDS process: pack console.warn becomes a log line, stdin becomes a script event. */
  class LoopbackConsole implements LineConsole {
    private readonly listeners = new Set<(line: string) => void>();

    send(line: string): void {
      const command = /^scriptevent (\S+) (.*)$/.exec(line);
      if (command) system.emitScriptEvent(command[1], command[2], ScriptEventSource.Server);
    }

    onLine(cb: (line: string) => void): () => void {
      this.listeners.add(cb);
      return () => this.listeners.delete(cb);
    }

    close(): void {}

    log(level: string, text: string): void {
      for (const cb of this.listeners) cb(`[2026-10-28 22:35:31:309 ${level}] [Scripting] ${text}`);
    }
  }

  it("carries events to the orchestrator and messages back", () => {
    const serverConsole = new LoopbackConsole();
    vi.spyOn(console, "warn").mockImplementation((text: unknown) => serverConsole.log("WARN", String(text)));

    const link = new LogStdinServerLink("lobby", serverConsole);
    const events: OutboundEvent[] = [];
    link.onEvent((event) => events.push(event));

    const transport = createLogTransport({ serverId: "lobby", orchestratorUrl: "unused" });
    const messages: InboundMessage[] = [];
    transport.onMessage((message) => messages.push(message));

    transport.send({ ...ready, transport: "log" });
    transport.send(start);
    expect(events).toEqual([{ ...ready, transport: "log" }, start]);

    link.send(gameReady);
    expect(messages).toEqual([gameReady]);

    transport.dispose();
    link.close();
  });
});
