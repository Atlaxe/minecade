// The running editor's control port on this PC (127.0.0.1:8097): GET /status, POST /save and
// POST /stop, for the Panel and `npm run editor -- status | save | stop`. Requests are checked the way the Panel checks its
// own, so a web page can't reach it.
import { createServer, type Server } from "node:http";
import { checkRequest } from "../control-panel/core.ts";
import { CONTROL_PORT, type EditorStatus } from "./editor-core.ts";

const ORIGIN = `http://127.0.0.1:${CONTROL_PORT}`;

/** Serves the control port. Fails when another editor already holds it. */
export function serveControl(handlers: { status(): EditorStatus; save(): void; stop(): void }): Promise<Server> {
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
    req.resume();
    if (refusal) return reply(403, { error: refusal });
    if (method === "GET" && path === "/status") return reply(200, handlers.status());
    if (method === "POST" && path === "/save") {
      handlers.save();
      return reply(202, { ok: true });
    }
    if (method === "POST" && path === "/stop") {
      handlers.stop();
      return reply(202, { ok: true });
    }
    return reply(404, { error: "not found" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      reject(error.code === "EADDRINUSE" ? new Error(`port ${CONTROL_PORT} is in use: is another editor running? (npm run editor -- status)`) : error),
    );
    server.listen(CONTROL_PORT, "127.0.0.1", () => resolve(server));
  });
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
export function stopEditor(): Promise<boolean> {
  return post("/stop");
}

/** Asks the running editor to save its world into the map now. False when none answers. */
export function saveEditor(): Promise<boolean> {
  return post("/save");
}

async function post(path: string): Promise<boolean> {
  try {
    const response = await fetch(`${ORIGIN}${path}`, { method: "POST", headers: { "x-minecade-panel": "1" }, signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}
