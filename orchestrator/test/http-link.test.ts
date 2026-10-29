import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_MESSAGE_CHARS, type InboundMessage, type OutboundEvent } from "@minecade/minigame-core/protocol";
import { HttpLinkHub } from "../src/links/http-link.ts";

const ready: OutboundEvent = { t: "server_ready", protocol: 1, role: "game", transport: "http", sessionId: "abc" };
const status: InboundMessage = { t: "status", state: "running", sessionId: "abc", players: [] };
const ended: InboundMessage = { t: "game_ended", sessionId: "abc", reason: "finished" };

let hub: HttpLinkHub;
let server: Server;
let base: string;

beforeEach(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  hub = new HttpLinkHub();
  server = createServer((req, res) => {
    if (!hub.handle(req, res)) res.writeHead(404).end("not a link route");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/servers`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  vi.restoreAllMocks();
});

function postEvent(serverId: string, body: string) {
  return fetch(`${base}/${serverId}/events`, { method: "POST", body, headers: { "content-type": "application/json" } });
}

async function poll(serverId: string, wait: number, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${base}/${serverId}/messages?wait=${wait}`, { signal });
  expect(response.status).toBe(200);
  return response.json();
}

describe("HttpLinkHub: events", () => {
  it("delivers a POSTed event and answers 204", async () => {
    const link = hub.open("abc");
    const handler = vi.fn();
    link.onEvent(handler);
    const response = await postEvent("abc", JSON.stringify(ready));
    expect(response.status).toBe(204);
    expect(handler).toHaveBeenCalledWith(ready);
    expect(link.kind).toBe("http");
  });

  it("answers 400, 413, 404 and 405 for bad requests", async () => {
    const link = hub.open("abc");
    const handler = vi.fn();
    link.onEvent(handler);
    expect((await postEvent("abc", "{oops")).status).toBe(400);
    expect((await postEvent("abc", JSON.stringify(status))).status).toBe(400); // inbound type
    expect((await postEvent("abc", "x".repeat(20_000))).status).toBe(413);
    expect((await postEvent("nobody", JSON.stringify(ready))).status).toBe(404);
    expect((await fetch(`${base}/abc/events`)).status).toBe(405);
    expect(handler).not.toHaveBeenCalled();
  });

  it("leaves other paths to the caller", async () => {
    const response = await fetch(`${base.replace("/v1/servers", "")}/v1/status`);
    expect(await response.text()).toBe("not a link route");
  });
});

describe("HttpLinkHub: long-poll", () => {
  it("returns queued messages at once, in order, and only once", async () => {
    const link = hub.open("abc");
    expect(link.send(status)).toBe(true);
    expect(link.send(ended)).toBe(true);
    expect(await poll("abc", 20)).toEqual([status, ended]);
    expect(await poll("abc", 0)).toEqual([]);
  });

  it("answers a waiting poll as soon as a message is sent", async () => {
    const link = hub.open("abc");
    const started = Date.now();
    const pending = poll("abc", 20);
    setTimeout(() => link.send(status), 50);
    expect(await pending).toEqual([status]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("answers an empty array when the wait runs out", async () => {
    hub.open("abc");
    const started = Date.now();
    expect(await poll("abc", 1)).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it("lets a newer poll replace an older one", async () => {
    const link = hub.open("abc");
    const older = poll("abc", 20);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const newer = poll("abc", 20);
    expect(await older).toEqual([]);
    link.send(status);
    expect(await newer).toEqual([status]);
  });

  it("keeps messages for the next poll when a poller disconnects", async () => {
    const link = hub.open("abc");
    const abort = new AbortController();
    const abandoned = poll("abc", 20, abort.signal).catch(() => "aborted");
    await new Promise((resolve) => setTimeout(resolve, 50));
    abort.abort();
    expect(await abandoned).toBe("aborted");
    await new Promise((resolve) => setTimeout(resolve, 50));
    link.send(status);
    expect(await poll("abc", 0)).toEqual([status]);
  });

  it("refuses a message over the size limit", () => {
    const link = hub.open("abc");
    expect(link.send({ t: "game_ended", sessionId: "abc", reason: "x".repeat(MAX_MESSAGE_CHARS) })).toBe(false);
  });
});

describe("HttpLinkHub: lifecycle", () => {
  it("close answers the waiting poll and removes the link", async () => {
    const link = hub.open("abc");
    const pending = poll("abc", 20);
    await new Promise((resolve) => setTimeout(resolve, 50));
    link.close();
    expect(await pending).toEqual([]);
    expect(hub.get("abc")).toBeUndefined();
    expect(link.send(status)).toBe(false);
    expect((await postEvent("abc", JSON.stringify(ready))).status).toBe(404);
  });

  it("reopening a server id closes the earlier link", () => {
    const first = hub.open("lobby");
    const second = hub.open("lobby");
    expect(first.send(status)).toBe(false);
    expect(second.send(status)).toBe(true);
    expect(hub.get("lobby")).toBe(second);
  });
});
