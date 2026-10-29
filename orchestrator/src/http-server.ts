// The orchestrator's HTTP server. Transport links (/v1/servers/...) serve the lobby and game
// servers on the compose network. The debug API (/v1/status, /v1/start, /v1/end, /v1/stats) is for the
// control panel and curl on this PC: compose publishes the port on 127.0.0.1 only, and the
// checks below refuse requests addressed to "orchestrator:8080" or sent by a web page.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Config } from "./config.ts";
import type { HttpLinkHub } from "./links/http-link.ts";
import { describeError, log } from "./log.ts";
import type { Registry } from "./registry.ts";
import { cleanSettings, type SessionManager } from "./session-manager.ts";
import type { StatsStore } from "./stats/store.ts";

export interface ServerDeps {
  config: Config;
  hub: HttpLinkHub;
  sessions: SessionManager;
  registry: Registry;
  /** Undefined when stats storage is off. */
  stats?: StatsStore;
}

export function createOrchestratorServer(deps: ServerDeps): Server {
  let debugRequests = 0;

  async function handleDebug(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const allowedHosts = [`127.0.0.1:${deps.config.httpPort}`, `localhost:${deps.config.httpPort}`];
    if (!allowedHosts.includes(req.headers.host ?? "") || req.headers.origin !== undefined) {
      return sendJson(res, 403, { error: "the debug API only answers requests from this PC" });
    }
    if (req.method === "GET" && path === "/v1/status") {
      return sendJson(res, 200, { ...deps.sessions.status(), transport: deps.config.transport, games: deps.registry.games });
    }
    const statsRoute = /^\/v1\/stats(?:\/([^/]+))?$/.exec(path);
    if (req.method === "GET" && statsRoute) {
      if (!deps.stats) return sendJson(res, 503, { error: "stats storage is off (see the orchestrator log)" });
      if (statsRoute[1] === undefined) return sendJson(res, 200, deps.stats.overview());
      let name: string;
      try {
        name = decodeURIComponent(statsRoute[1]);
      } catch {
        return sendJson(res, 400, { error: "bad player name" });
      }
      const player = deps.stats.player(name);
      return player ? sendJson(res, 200, player) : sendJson(res, 404, { error: `no stats for "${name}"` });
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: "expected a JSON object of at most 4 KB" });
    if (path === "/v1/start") {
      if (typeof body.game !== "string") return sendJson(res, 400, { error: '"game" is required' });
      const result = await deps.sessions.start({
        requestId: `debug-${++debugRequests}`,
        game: body.game,
        map: typeof body.map === "string" && body.map ? body.map : "random",
        players: Array.isArray(body.players) ? body.players.map(String) : [],
        settings: cleanSettings(body.settings),
      });
      return result.ok ? sendJson(res, 202, result) : sendJson(res, 409, { error: result.reason });
    }
    if (path === "/v1/end") {
      return deps.sessions.end("ended from the debug API")
        ? sendJson(res, 202, { ok: true })
        : sendJson(res, 409, { error: "no game is running" });
    }
    return sendJson(res, 404, { error: "not found" });
  }

  return createServer((req, res) => {
    if (deps.hub.handle(req, res)) return;
    const path = new URL(req.url ?? "/", "http://orchestrator").pathname;
    handleDebug(req, res, path).catch((error: unknown) => {
      log.error(`${req.method} ${path} failed: ${describeError(error)}`);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else res.end();
    });
  });
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 4096) {
        resolve(undefined);
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const value = body ? JSON.parse(body) : {};
        resolve(typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined);
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", reject);
  });
}
