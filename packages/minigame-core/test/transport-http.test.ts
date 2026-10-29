import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { InboundMessage, OutboundEvent } from "../src/protocol/index.ts";
import { createTransport, kind } from "../src/transport/http.ts";
import { system } from "./fake-mc-server.ts";
import {
  HttpRequestMethod,
  resetHttp,
  sentRequests,
  setHttpHandler,
  type FakeHttpResponse,
  type HttpRequest,
} from "./fake-mc-server-net.ts";
import { flushPromises } from "./util.ts";

const options = { serverId: "game-abc", orchestratorUrl: "http://orchestrator:8080/" };
const BASE = "http://orchestrator:8080/v1/servers/game-abc";
const status: InboundMessage = { t: "status", state: "running", sessionId: "abc", players: ["Steve"] };
const ended: InboundMessage = { t: "game_ended", sessionId: "abc", reason: "finished" };

interface HeldRequest {
  request: HttpRequest;
  respond(response: FakeHttpResponse): void;
  fail(error: Error): void;
}

/** Holds every request until the test answers it. */
function holdRequests(): HeldRequest[] {
  const held: HeldRequest[] = [];
  setHttpHandler(
    (request) => new Promise((respond, fail) => held.push({ request, respond, fail })),
  );
  return held;
}

function playerCount(i: number): OutboundEvent {
  return { t: "player_count", sessionId: "abc", players: [`p${i}`] };
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  system.reset();
  resetHttp();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HTTP transport: sending", () => {
  it("posts events in order, one at a time", async () => {
    const held = holdRequests();
    const transport = createTransport(options);
    expect(transport.kind).toBe("http");
    expect(kind).toBe("http");
    transport.send(playerCount(1));
    transport.send(playerCount(2));
    await flushPromises();
    expect(held).toHaveLength(1);
    const first = held[0].request;
    expect(first.uri).toBe(`${BASE}/events`);
    expect(first.method).toBe(HttpRequestMethod.Post);
    expect(first.headers.map((h) => [h.key, h.value])).toEqual([["Content-Type", "application/json"]]);
    expect(JSON.parse(first.body)).toEqual(playerCount(1));
    held[0].respond({ status: 204, body: "" });
    await flushPromises();
    expect(held).toHaveLength(2);
    expect(JSON.parse(held[1].request.body)).toEqual(playerCount(2));
  });

  it("retries a failed send with growing backoff", async () => {
    const held = holdRequests();
    const transport = createTransport(options);
    transport.send(playerCount(1));
    await flushPromises();
    held[0].respond({ status: 503, body: "" });
    await flushPromises();
    system.advanceTicks(19);
    await flushPromises();
    expect(held).toHaveLength(1);
    system.advanceTicks(1);
    await flushPromises();
    expect(held).toHaveLength(2);
    held[1].fail(new Error("connection refused"));
    await flushPromises();
    system.advanceTicks(39);
    await flushPromises();
    expect(held).toHaveLength(2);
    system.advanceTicks(1);
    await flushPromises();
    expect(held).toHaveLength(3);
    expect(held.map((h) => h.request.body)).toEqual(Array(3).fill(JSON.stringify(playerCount(1))));
    expect(warn).toHaveBeenCalledTimes(1); // only the first failure of a run is logged
  });

  it("drops an event the orchestrator rejects and moves on", async () => {
    const held = holdRequests();
    const transport = createTransport(options);
    transport.send(playerCount(1));
    transport.send(playerCount(2));
    await flushPromises();
    held[0].respond({ status: 400, body: "" });
    await flushPromises();
    expect(held).toHaveLength(2);
    expect(JSON.parse(held[1].request.body)).toEqual(playerCount(2));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rejected "player_count"'));
  });

  it("drops the oldest waiting event when the queue is full, never the one in flight", async () => {
    const held = holdRequests();
    const transport = createTransport(options);
    for (let i = 0; i <= 100; i++) transport.send(playerCount(i));
    await flushPromises();
    // p0 was in flight when the queue overflowed. It fails and must be retried, not dropped.
    held[0].respond({ status: 503, body: "" });
    await flushPromises();
    system.advanceTicks(20);
    await flushPromises();
    // Answer each send as it arrives until the queue drains.
    for (let answered = 1; answered < held.length; answered++) {
      held[answered].respond({ status: 204, body: "" });
      await flushPromises();
    }
    const delivered = held.slice(1).map((h) => JSON.parse(h.request.body).players[0]);
    expect(delivered).toHaveLength(100);
    expect(delivered[0]).toBe("p0");
    expect(delivered).not.toContain("p1");
    expect(delivered.at(-1)).toBe("p100");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped the oldest waiting event "player_count"'));
  });

  it("keeps sending after dispose, so a final end_game still goes out", async () => {
    const held = holdRequests();
    const transport = createTransport(options);
    transport.dispose();
    transport.send({ t: "end_game", sessionId: "abc", reason: "finished" });
    await flushPromises();
    expect(held).toHaveLength(1);
  });
});

describe("HTTP transport: receiving", () => {
  it("long-polls and delivers each valid message", async () => {
    const held = holdRequests();
    const transport = createTransport(options);
    const handler = vi.fn();
    transport.onMessage(handler);
    transport.onMessage(() => {});
    await flushPromises();
    expect(held).toHaveLength(1); // one poll loop, however many handlers
    const poll = held[0].request;
    expect(poll.uri).toBe(`${BASE}/messages?wait=20`);
    expect(poll.method).toBe(HttpRequestMethod.Get);
    expect(poll.timeout).toBe(25);
    held[0].respond({ status: 200, body: JSON.stringify([status, { t: "not_a_message" }, ended]) });
    await flushPromises();
    expect(handler.mock.calls).toEqual([[status], [ended]]);
    expect(held).toHaveLength(2); // the next poll started right away
  });

  it("backs off when a poll fails, then recovers", async () => {
    const held = holdRequests();
    const transport = createTransport(options);
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushPromises();
    held[0].respond({ status: 502, body: "" });
    await flushPromises();
    system.advanceTicks(19);
    await flushPromises();
    expect(held).toHaveLength(1);
    system.advanceTicks(1);
    await flushPromises();
    expect(held).toHaveLength(2);
    held[1].respond({ status: 200, body: JSON.stringify([status]) });
    await flushPromises();
    expect(handler).toHaveBeenCalledWith(status);
  });

  it("ignores a poll response that is not a JSON array", async () => {
    const held = holdRequests();
    const transport = createTransport(options);
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushPromises();
    held[0].respond({ status: 200, body: JSON.stringify(status) });
    await flushPromises();
    held[1].respond({ status: 200, body: "<html>" });
    await flushPromises();
    expect(handler).not.toHaveBeenCalled();
    expect(held).toHaveLength(3);
  });

  it("stops polling after dispose and ignores the poll still in flight", async () => {
    const held = holdRequests();
    const transport = createTransport(options);
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushPromises();
    transport.dispose();
    held[0].respond({ status: 200, body: JSON.stringify([status]) });
    await flushPromises();
    system.advanceTicks(1000);
    await flushPromises();
    expect(handler).not.toHaveBeenCalled();
    expect(sentRequests).toHaveLength(1);
  });
});
