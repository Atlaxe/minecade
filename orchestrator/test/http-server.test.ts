import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOrchestratorServer } from "../src/http-server.ts";
import { HttpLinkHub } from "../src/links/http-link.ts";
import { registry, setupSessions } from "./fakes.ts";

let server: Server;
let port: number;
let t: ReturnType<typeof setupSessions>;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = setupSessions();
  server = createOrchestratorServer({ config: t.config, hub: new HttpLinkHub(), sessions: t.sessions, registry });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  t.config.httpPort = port; // the debug API accepts Host: 127.0.0.1:<its port>
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  vi.restoreAllMocks();
});

/** node:http rather than fetch, so tests can set the Host header. */
function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : {} }));
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe("debug API", () => {
  it("reports status with the transport and the game list", async () => {
    const response = await call("GET", "/v1/status");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ state: "idle", players: [], transport: "http", games: registry.games });
  });

  it("starts and ends a game", async () => {
    const started = await call("POST", "/v1/start", { game: "probe", map: "default" });
    expect(started).toEqual({ status: 202, body: { ok: true, sessionId: "s1" } });
    expect((await call("GET", "/v1/status")).body).toMatchObject({ state: "starting", game: "probe" });
    expect((await call("POST", "/v1/start", { game: "probe" })).status).toBe(409);
    expect((await call("POST", "/v1/end")).status).toBe(202);
    await vi.waitFor(() => expect(t.sessions.status().state).toBe("idle"));
    expect((await call("POST", "/v1/end")).status).toBe(409);
  });

  it("validates the start request", async () => {
    expect((await call("POST", "/v1/start", {})).status).toBe(400);
    expect((await call("POST", "/v1/start", { game: "nope" })).body).toEqual({ error: 'unknown game "nope"' });
  });

  it("refuses requests from the compose network and from web pages", async () => {
    expect((await call("GET", "/v1/status", undefined, { host: "orchestrator:8080" })).status).toBe(403);
    expect((await call("POST", "/v1/start", { game: "probe" }, { origin: "https://evil.example" })).status).toBe(403);
    expect(t.docker.specs).toHaveLength(0);
  });

  it("still serves the transport links", async () => {
    const response = await call("POST", "/v1/servers/nobody/events", { t: "status_request" }, { host: "orchestrator:8080" });
    expect(response).toEqual({ status: 404, body: { error: "unknown server" } });
  });
});
