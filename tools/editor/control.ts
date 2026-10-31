// The running editor's control port on this PC (127.0.0.1:8097), for the Panel and
// `npm run editor -- status | save | stop`:
//   GET /status              what it's doing (Edit or Select)
//   POST /save               Edit: save the world into the map now
//   POST /stop               stop (Edit saves first)
//   POST /switch {next}      restart in Select on a world, or in Edit on a map
//   POST /selection {...}    Select: retry, forget or update a map in the world's list
// Requests are checked the way the Panel checks its own, so a web page can't reach it.
import { createServer, type Server } from "node:http";
import { checkRequest } from "../control-panel/core.ts";
import { CONTROL_PORT, type EditorStatus, type NextSession } from "./editor-core.ts";

const ORIGIN = `http://127.0.0.1:${CONTROL_PORT}`;
const MAX_BODY = 10_000;

export interface SelectionRequest {
  action: "retry" | "forget" | "update";
  target: string;
  map: string;
}

export interface ControlHandlers {
  status(): EditorStatus;
  save(): void;
  stop(): void;
  /** Undefined when it's under way, or why not. */
  switchTo(next: NextSession): Promise<string | undefined>;
  selection(request: SelectionRequest): Promise<string | undefined>;
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
        if (method === "POST" && path === "/save") {
          handlers.save();
          return reply(202, { ok: true });
        }
        if (method === "POST" && path === "/stop") {
          handlers.stop();
          return reply(202, { ok: true });
        }
        if (method === "POST" && path === "/switch") {
          const next = nextOf(body);
          if (!next) return reply(400, { error: "switch to {mode: 'select', world} or {mode: 'edit', target, map}" });
          const problem = await handlers.switchTo(next);
          return problem ? reply(409, { error: problem }) : reply(202, { ok: true });
        }
        if (method === "POST" && path === "/selection") {
          const action = body.action;
          if ((action !== "retry" && action !== "forget" && action !== "update") || typeof body.target !== "string" || typeof body.map !== "string") {
            return reply(400, { error: "selection needs action (retry, forget or update), target and map" });
          }
          const problem = await handlers.selection({ action, target: body.target, map: body.map });
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

function nextOf(body: Record<string, unknown>): NextSession | undefined {
  if (body.mode === "select" && typeof body.world === "string" && body.world.trim()) return { mode: "select", world: body.world };
  if (body.mode === "edit" && typeof body.target === "string" && typeof body.map === "string") return { mode: "edit", target: body.target, map: body.map };
  return undefined;
}

/** The running editor's status, or undefined when none answers. */
export async function editorStatus(timeoutMs = 1000): Promise<EditorStatus | undefined> {
  try {
    const response = await fetch(`${ORIGIN}/status`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? ((await response.json()) as EditorStatus) : undefined;
  } catch {
    return undefined;
  }
}

/** Asks the running editor to stop (it saves first). False when none answers. */
export async function stopEditor(): Promise<boolean> {
  return (await post("/stop")).ok;
}

/** Asks the running editor to save its world into the map now. False when none answers. */
export async function saveEditor(): Promise<boolean> {
  return (await post("/save")).ok;
}

/** Asks the running editor to switch; the error when it can't (or none answers). */
export function switchEditor(next: NextSession): Promise<{ ok: boolean; error?: string }> {
  return post("/switch", next);
}

/** Asks the running editor (in Select mode) to retry, forget or update a map. */
export function selectionAction(request: SelectionRequest): Promise<{ ok: boolean; error?: string }> {
  return post("/selection", request);
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
