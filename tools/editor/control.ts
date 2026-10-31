// The running editor's control port on this PC (127.0.0.1:8097), for the Panel and
// `npm run editor -- status | save | stop | <target> <map> | select "<world>"`:
//   GET /status              what each of its servers is doing
//   POST /save               save the map open in Edit now
//   POST /open {request}     open a map in Edit or a world in Select (an OpenRequest)
//   POST /stop               shut it down (Edit saves first)
// Requests are checked the way the Panel checks its own, so a web page can't reach it.
import { createServer, type Server } from "node:http";
import type { OpenRequest } from "@minecade/minigame-core/config";
import { checkRequest } from "../control-panel/core.ts";
import { CONTROL_PORT, type EditorStatus } from "./editor-core.ts";

const ORIGIN = `http://127.0.0.1:${CONTROL_PORT}`;
const MAX_BODY = 10_000;

export interface ControlHandlers {
  status(): EditorStatus;
  /** False when no map is open in Edit. */
  save(): boolean;
  stop(): void;
  /** Undefined when it's under way, or why not. */
  open(request: OpenRequest): Promise<string | undefined>;
}

/** Serves the control port. Fails when another editor already holds it. */
export function serveControl(handlers: ControlHandlers): Promise<Server> {
  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const refusal = checkRequest(
      { method, host: req.headers.host, origin: req.headers.origin, panelHeader: req.headers["x-minecade-panel"] as string | undefined },
      CONTROL_PORT,
    );
    const path = new URL(req.url ?? "/", ORIGIN).pathname;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on("end", () => {
      void (async () => {
        if (refusal) return reply(403, { error: refusal });
        if (size > MAX_BODY) return reply(413, { error: "too big" });
        let body: Record<string, unknown> = {};
        try {
          body = chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
        } catch {
          return reply(400, { error: "not JSON" });
        }
        if (method === "GET" && path === "/status") return reply(200, handlers.status());
        if (method === "POST" && path === "/save") return handlers.save() ? reply(202, { ok: true }) : reply(409, { error: "no map is open in Edit" });
        if (method === "POST" && path === "/stop") {
          handlers.stop();
          return reply(202, { ok: true });
        }
        if (method === "POST" && path === "/open") {
          const request = requestOf(body.request);
          if (!request) return reply(400, { error: "open needs a request: {to: 'edit', target, map} or {to: 'select', world}" });
          const problem = await handlers.open(request);
          return problem ? reply(409, { error: problem }) : reply(202, { ok: true });
        }
        return reply(404, { error: "not found" });
      })();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      reject(error.code === "EADDRINUSE" ? new Error(`port ${CONTROL_PORT} is in use: is another editor running? (npm run editor -- status)`) : error),
    );
    server.listen(CONTROL_PORT, "127.0.0.1", () => resolve(server));
  });
}

function requestOf(value: unknown): OpenRequest | undefined {
  const body = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (body.to === "select" && typeof body.world === "string" && body.world.trim()) return { to: "select", world: body.world };
  if (body.to === "edit" && typeof body.target === "string" && typeof body.map === "string") {
    const fresh = body.fresh as { name?: unknown } | undefined;
    return { to: "edit", target: body.target, map: body.map, ...(fresh && typeof fresh.name === "string" ? { fresh: { name: fresh.name } } : {}) };
  }
  return undefined;
}

/** The running editor's status, or undefined when none answers. An editor older than the editor lobby answers without `booted`. */
export async function editorStatus(timeoutMs = 1000): Promise<EditorStatus | undefined> {
  try {
    const response = await fetch(`${ORIGIN}/status`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? ((await response.json()) as EditorStatus) : undefined;
  } catch {
    return undefined;
  }
}

/** Asks the running editor to shut down (Edit saves first). False when none answers. */
export async function stopEditor(): Promise<boolean> {
  return (await post("/stop")).ok;
}

/** Asks the running editor to save the map open in Edit now; the error when it can't (or none answers). */
export function saveEditor(): Promise<{ ok: boolean; error?: string }> {
  return post("/save");
}

/** Asks the running editor to open a map or a world; the error when it can't (or none answers). */
export function openInEditor(request: OpenRequest): Promise<{ ok: boolean; error?: string }> {
  return post("/open", { request });
}

async function post(path: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { "x-minecade-panel": "1", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) return { ok: true };
    const answer = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: answer.error ?? `HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "no map editor is running" };
  }
}
