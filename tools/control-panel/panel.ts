// Minecade Control Panel: a small helper on this PC that serves a page at http://127.0.0.1:8099
// and opens it in a chromeless Edge window. Started by the desktop shortcut (launch.vbs) or
// `npm run panel`. It exits shortly after the last window closes.
//   --stay       never exit on its own (development)
//   --no-window  don't open a window (testing with curl)
//   --port N     serve on port N instead of 8099 (testing beside a running Panel)
//   --restarting started by Restart Panel: wait for the old one to free the port, open no window
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, statSync, writeFileSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type Docker from "dockerode";
import { editorStatus, endPreviewEditor, previewEditor, publishEditor, saveEditor, stopEditor } from "../editor/control.ts";
import type { EditorStatus } from "../editor/editor-core.ts";
import {
  BroadcastLog,
  checkLobbyMap,
  checkRequest,
  formatPorts,
  isStale,
  lobbyMapChoices,
  normalizeNames,
  PlayerLog,
  readEnv,
  setEnvValues,
  shouldExit,
  stackOf,
  STACKS,
  type StackDef,
  type StackId,
} from "./core.ts";

const portArg = process.argv.indexOf("--port");
const PORT = portArg >= 0 ? Number(process.argv[portArg + 1]) : 8099;
const ORIGIN = `http://127.0.0.1:${PORT}`;
/** The orchestrator's debug API, published on this PC only. */
const ORCHESTRATOR_URL = "http://127.0.0.1:8080";
const JOIN_PORT = 19132;
const LOG_LINES_KEPT = 300;
const ACTIVITY_KEPT = 200;
const DOCKER_START_GRACE_MS = 3 * 60_000;

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const envPath = join(repoRoot, ".env");
/** The map editor's output when the Panel starts it (it runs on after the Panel closes). */
const editorLogPath = join(repoRoot, "work", "editor", "editor.log");
const EDITOR_LOG_LINES = 150;
/** How long a starting editor may take to answer on its control port before the Panel gives up waiting. */
const EDITOR_LAUNCH_MS = 30_000;
/** How long a restarting editor may take to shut down (Edit saves first) before the Panel stops waiting. */
const EDITOR_STOP_MS = 5 * 60_000;
/** The Panel's own code: when one of these changes, the page offers Restart Panel. */
const PANEL_SOURCES = ["tools/control-panel/panel.ts", "tools/control-panel/core.ts", "tools/editor/control.ts", "tools/editor/editor-core.ts"];
/** The map editor's code (the host tool, its packs, the shared core and the server entrypoint). */
const EDITOR_SOURCES = ["tools/editor", "tools/build", "editor", "packages/minigame-core/src", "docker/bds/entrypoint.sh"];
/** Source times are read again at most this often. */
const SOURCE_TIMES_MS = 5000;
const dataDir = join(process.env.LOCALAPPDATA ?? tmpdir(), "minecade-panel");
// A helper on another port (testing) keeps its own log, so it never clears the running Panel's.
const logPath = join(dataDir, PORT === 8099 ? "panel.log" : `panel-${PORT}.log`);
const stay = process.argv.includes("--stay");
const restarting = process.argv.includes("--restarting");
// A restarted Panel's windows reload on their own.
const noWindow = process.argv.includes("--no-window") || restarting;

mkdirSync(dataDir, { recursive: true });
writeFileSync(logPath, "");

function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  appendFileSync(logPath, `${line}\n`);
}

// ---- Docker ------------------------------------------------------------------------------

type DockerUtil = typeof import("../build/docker-util.ts");
let dockerUtil: DockerUtil | undefined;
let docker: Docker | undefined;
let dockerStartRequestedAt = 0;

interface Follower {
  stop: () => void;
  lines: string[];
  players: PlayerLog;
  /** The friends broadcast's state, for its container only. */
  broadcast?: BroadcastLog;
}

/** One log follower per running container in our stacks, keyed by container id. */
const followers = new Map<string, Follower>();
let containers: Docker.ContainerInfo[] = [];

async function dockerStatus(): Promise<"running" | "stopped" | "starting" | "not-responding"> {
  dockerUtil ??= await import("../build/docker-util.ts");
  docker ??= dockerUtil.connectDocker();
  // dockerode's own timeout option would also cut the long-lived log streams, so race a timer.
  const ping = docker.ping().then(
    () => "ok" as const,
    () => "down" as const,
  );
  const timer = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1500));
  const result = await Promise.race([ping, timer]);
  if (result === "ok") return "running";
  if (Date.now() - dockerStartRequestedAt < DOCKER_START_GRACE_MS) return "starting";
  return result === "timeout" ? "not-responding" : "stopped";
}

async function syncContainers(): Promise<void> {
  const all = await docker!.listContainers({ all: true });
  containers = all.filter((info) => stackOf(info) !== undefined);
  const running = new Set(containers.filter((info) => info.State === "running").map((info) => info.Id));
  for (const [id, follower] of followers) {
    if (running.has(id)) continue;
    follower.stop();
    followers.delete(id);
  }
  for (const id of running) {
    if (!followers.has(id)) void follow(id);
  }
}

async function follow(id: string): Promise<void> {
  const role = containers.find((info) => info.Id === id)?.Labels["minecade.role"];
  const follower: Follower = { stop: () => {}, lines: [], players: new PlayerLog() };
  if (role === "broadcaster") follower.broadcast = new BroadcastLog();
  followers.set(id, follower);
  try {
    follower.stop = await dockerUtil!.followLogs(
      docker!.getContainer(id),
      (line) => {
        follower.lines.push(line);
        if (follower.lines.length > LOG_LINES_KEPT) follower.lines.shift();
        follower.players.feed(line);
        follower.broadcast?.feed(line);
      },
      () => {
        if (followers.get(id) === follower) followers.delete(id);
      },
    );
  } catch (error) {
    followers.delete(id);
    log(`could not follow logs of ${id.slice(0, 12)}: ${String(error)}`);
  }
}

function dockerExe(): string {
  const bundled = join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "resources", "bin", "docker.exe");
  return process.platform === "win32" && existsSync(bundled) ? bundled : "docker";
}

// ---- State -------------------------------------------------------------------------------

let busy: string | null = null;
let dockerState: Awaited<ReturnType<typeof dockerStatus>> = "stopped";
let publicIp: { value: string | null; at: number } = { value: null, at: 0 };

async function lookupPublicIp(): Promise<string | null> {
  const age = Date.now() - publicIp.at;
  if (age < (publicIp.value ? 10 * 60_000 : 60_000)) return publicIp.value;
  try {
    const response = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(3000) });
    publicIp = { value: response.ok ? (await response.text()).trim() : null, at: Date.now() };
  } catch {
    publicIp = { value: null, at: Date.now() };
  }
  return publicIp.value;
}

function containerView(info: Docker.ContainerInfo) {
  const role = info.Labels["minecade.role"];
  const follower = followers.get(info.Id);
  const isBds = role !== undefined && role !== "orchestrator" && role !== "watcher" && role !== "broadcaster";
  let players: string[] | null = null;
  let playersNote = "";
  if (isBds && info.State === "running") {
    if (!follower || !follower.players.started) playersNote = "starting";
    else if (follower.players.players === null) playersNote = "unknown (log format changed)";
    else players = follower.players.players;
  }
  return {
    id: info.Id,
    name: info.Names[0]?.replace(/^\//, "") ?? info.Id.slice(0, 12),
    role: role ?? "",
    state: info.State,
    status: info.Status,
    ports: formatPorts(info.Ports),
    isBds,
    players,
    playersNote,
  };
}

/** Whether the main stack's orchestrator container is running. */
function orchestratorRunning(): boolean {
  return containers.some(
    (info) => stackOf(info) === "main" && info.State === "running" && info.Labels["minecade.role"] === "orchestrator",
  );
}

/** The main stack's game status from the orchestrator, or null when it isn't running. */
async function orchestratorStatus(): Promise<unknown> {
  if (!orchestratorRunning()) return null;
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/v1/status`, { signal: AbortSignal.timeout(1000) });
    return response.ok ? await response.json() : { error: `HTTP ${response.status}` };
  } catch {
    return { error: "not answering yet" };
  }
}

/** The finished lobby maps, for the LOBBY_MAP picker. */
async function lobbyMaps() {
  const dir = join(repoRoot, "lobby", "maps");
  if (!existsSync(dir)) return [];
  const entries: { id: string; json: string }[] = [];
  for (const id of (await readdir(dir)).sort()) {
    const path = join(dir, id, "map.json");
    if (existsSync(path)) entries.push({ id, json: await readFile(path, "utf8") });
  }
  return lobbyMapChoices(entries);
}

/** A boot the Panel asked for, until the editor answers on its control port (or gives up). */
let editorLaunch: { at: number } | null = null;
/** A restart under way: the old editor is shutting down, and the new one boots once it has. */
let editorRestart = false;

/**
 * The running editor's status, a boot in progress, or the last run's log when none is running.
 * `old` is an editor from before the editor lobby (its status has another shape), and `stale` one
 * started before its code last changed: either should be restarted.
 */
async function editorState(): Promise<{ status: EditorStatus | null; old: boolean; stale: boolean; launching: boolean; restarting: boolean; log: string[] }> {
  const status = (await editorStatus(500)) ?? null;
  if (status || (editorLaunch && Date.now() - editorLaunch.at > EDITOR_LAUNCH_MS)) editorLaunch = null;
  if (status) {
    const old = status.booted !== true;
    const stale = old || isStale(Date.parse(status.startedAt), await sourceTimes(EDITOR_SOURCES));
    return { status, old, stale, launching: false, restarting: editorRestart, log: Array.isArray(status.log) ? status.log : [] };
  }
  const text = existsSync(editorLogPath) ? await readFile(editorLogPath, "utf8") : "";
  const log = text.split(/\r?\n/).filter(Boolean).slice(-EDITOR_LOG_LINES);
  return { status: null, old: false, stale: false, launching: editorLaunch !== null || editorRestart, restarting: editorRestart, log };
}

const sourceTimeCache = new Map<string, { at: number; times: number[] }>();

/** The modification times of these files, and of every file under these folders (tests and node_modules aside). */
async function sourceTimes(paths: string[]): Promise<number[]> {
  const key = paths.join("|");
  const cached = sourceTimeCache.get(key);
  if (cached && Date.now() - cached.at < SOURCE_TIMES_MS) return cached.times;
  const times: number[] = [];
  const visit = async (path: string): Promise<void> => {
    const info = await stat(path).catch(() => undefined);
    if (!info) return;
    if (!info.isDirectory()) {
      times.push(info.mtimeMs);
      return;
    }
    for (const entry of await readdir(path)) {
      if (entry !== "node_modules" && entry !== "test" && !entry.startsWith(".")) await visit(join(path, entry));
    }
  };
  for (const path of paths) await visit(join(repoRoot, path));
  sourceTimeCache.set(key, { at: Date.now(), times });
  return times;
}

/** Whether the network (the lobby, the orchestrator or a game) is running: the map editor needs its ports. */
function networkRunning(): boolean {
  return containers.some((info) => info.State === "running" && stackOf(info) === "main" && info.Labels["minecade.role"] !== "editor");
}

/** The main stack's container with this role, if it has one. */
function mainContainer(role: string): Docker.ContainerInfo | undefined {
  return containers.find((info) => stackOf(info) === "main" && info.Labels["minecade.role"] === role);
}

/**
 * The last .env write that only turned the friends broadcast on or off, and when the settings last
 * changed before it. That write applies at once, so it doesn't call for a restart.
 */
let broadcastWrite: { mtime: number; settingsAt: number } | null = null;

/** When .env last changed in a way that only a restart applies (containers read it when created). */
function settingsChangedAt(): number {
  if (!existsSync(envPath)) return 0;
  const mtime = statSync(envPath).mtimeMs;
  return broadcastWrite && mtime === broadcastWrite.mtime ? broadcastWrite.settingsAt : mtime;
}

/** The friends broadcast: whether BROADCAST is on, its container's state, and what its log says. */
function broadcastState(env: Record<string, string> | undefined) {
  const info = mainContainer("broadcaster");
  const log = info ? followers.get(info.Id)?.broadcast : undefined;
  return {
    on: env?.BROADCAST === "1",
    container: info?.State ?? null,
    phase: log?.phase ?? null,
    account: log?.account ?? "",
    signIn: log?.signIn ?? null,
    lastJoin: log?.lastJoin ?? "",
    lastError: log?.lastError ?? "",
  };
}

async function buildState() {
  const envText = existsSync(envPath) ? await readFile(envPath, "utf8") : undefined;
  const env = envText === undefined ? undefined : readEnv(envText);
  const orchestrator = await orchestratorStatus();
  // Containers read .env only when they are created.
  const envChangedAt = envText === undefined ? 0 : settingsChangedAt();
  const stacks = STACKS.map((stack) => {
    const members = containers.filter((info) => stackOf(info) === stack.id);
    // The map editor's servers are listed with the network but aren't it (they run while it's stopped).
    const servers = members.filter((info) => info.Labels["minecade.role"] !== "editor");
    const settingsStale = servers.some((info) => info.State === "running" && info.Created * 1000 < envChangedAt);
    const missing = [stack.file, ...stack.requires].filter((file) => !existsSync(join(repoRoot, file)));
    return {
      id: stack.id,
      label: stack.label,
      available: missing.length === 0,
      missing,
      running: servers.some((info) => info.State === "running"),
      settingsStale,
      containers: members.map(containerView).sort((a, b) => a.name.localeCompare(b.name)),
      orchestrator: stack.id === "main" ? orchestrator : null,
    };
  });
  const lanHost = env?.LAN_HOST ?? "";
  const addresses = Object.values(networkInterfaces()).flatMap((list) => list ?? []);
  const publicHost = env?.PUBLIC_HOST || "auto";
  return {
    busy,
    docker: dockerState,
    stacks,
    connection: {
      lanHost,
      lanHostOk: addresses.some((address) => address.address === lanHost),
      publicHost,
      publicIp: publicHost === "auto" ? await lookupPublicIp() : publicHost,
      joinPort: JOIN_PORT,
    },
    env: env
      ? {
          missing: false,
          ALLOW_LIST: env.ALLOW_LIST ?? "",
          LAN_PLAYERS: env.LAN_PLAYERS ?? "",
          WATCHER_GAMERTAG: env.WATCHER_GAMERTAG ?? "",
          LOBBY_MAP: env.LOBBY_MAP ?? "",
          TRANSPORT: env.TRANSPORT ?? "",
          BDS_VERSION: env.BDS_VERSION ?? "",
        }
      : { missing: true },
    broadcast: broadcastState(env),
    lobbyMaps: await lobbyMaps(),
    editor: await editorState(),
    networkRunning: networkRunning(),
    /** The Panel's own code changed since it started: Restart Panel picks it up. */
    panelStale: isStale(startedAt, await sourceTimes(PANEL_SOURCES)),
  };
}

let refreshing = false;

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    dockerState = await dockerStatus();
    if (dockerState === "running") {
      await syncContainers();
    } else {
      containers = [];
      for (const follower of followers.values()) follower.stop();
      followers.clear();
    }
    broadcast("state", await buildState());
  } catch (error) {
    log(`refresh failed: ${String(error)}`);
  } finally {
    refreshing = false;
  }
}

// ---- Live updates (server-sent events) ---------------------------------------------------

const windows = new Set<ServerResponse>();
let lastWindowAt: number | undefined;
const activity: { at: string; text: string }[] = [];

function broadcast(event: string, data: unknown): void {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of windows) res.write(frame);
}

function note(text: string): void {
  const entry = { at: new Date().toISOString(), text };
  activity.push(entry);
  if (activity.length > ACTIVITY_KEPT) activity.shift();
  broadcast("activity", entry);
}

async function openEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  res.write("retry: 2000\n\n");
  windows.add(res);
  lastWindowAt = Date.now();
  res.on("close", () => {
    windows.delete(res);
    lastWindowAt = Date.now();
  });
  for (const entry of activity) res.write(`event: activity\ndata: ${JSON.stringify(entry)}\n\n`);
  res.write(`event: state\ndata: ${JSON.stringify(await buildState())}\n\n`);
}

// ---- Actions -----------------------------------------------------------------------------

const COMPOSE_ACTIONS: Record<string, string[]> = {
  up: ["up", "-d", "--build"],
  down: ["down"],
  // Recreates the containers so .env edits apply; plain `compose restart` would keep them.
  restart: ["up", "-d", "--build", "--force-recreate"],
  // Recreates only the friends broadcast with the new BROADCAST, leaving the servers alone.
  broadcast: ["up", "-d", "--build", "--no-deps", "broadcaster"],
};

function runCompose(stack: StackDef, action: string, done?: (ok: boolean) => void): void {
  busy = `${stack.label}: ${action}`;
  const args = ["compose", "--ansi", "never", "--progress", "plain", "-f", join(repoRoot, stack.file), "--env-file", envPath];
  note(`${stack.label}: ${action}...`);
  const child = spawn(dockerExe(), [...args, ...COMPOSE_ACTIONS[action]], { cwd: repoRoot, windowsHide: true });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => {
      if (line.trim()) note(line);
    });
  }
  let finished = false;
  const finish = (message: string, ok: boolean) => {
    if (finished) return;
    finished = true;
    note(message);
    busy = null;
    void refresh().then(() => done?.(ok));
  };
  child.on("error", (error) => finish(`${stack.label}: ${action} could not run docker: ${error.message}`, false));
  child.on("close", (code) =>
    finish(code === 0 ? `${stack.label}: ${action} done.` : `${stack.label}: ${action} failed (exit code ${code}).`, code === 0),
  );
}

function startDockerDesktop(): void {
  const exe = join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe");
  if (!existsSync(exe)) {
    note(`Docker Desktop not found at ${exe}. Start it yourself.`);
    return;
  }
  spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
  dockerStartRequestedAt = Date.now();
  note("Starting Docker Desktop. This can take a minute.");
}

async function saveEnv(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  if (!existsSync(envPath)) return { status: 409, body: { error: "No .env file. Copy .env.example to .env first." } };
  const values: Record<string, string> = {};
  for (const key of ["ALLOW_LIST", "LAN_PLAYERS"]) {
    if (body[key] === undefined) continue;
    const result = normalizeNames(String(body[key]));
    if (!result.ok) return { status: 400, body: { error: `${key}: ${result.error}` } };
    values[key] = result.value;
  }
  if (body.LOBBY_MAP !== undefined) {
    const result = checkLobbyMap(String(body.LOBBY_MAP), await lobbyMaps());
    if (!result.ok) return { status: 400, body: { error: `LOBBY_MAP: ${result.error}` } };
    values.LOBBY_MAP = result.value;
  }
  const before = await readFile(envPath, "utf8");
  const after = setEnvValues(before, values);
  if (after !== before) {
    await writeFile(envPath, after);
    note(`Saved ${Object.keys(values).join(" and ")} to .env. Restart the stack to apply.`);
  }
  void refresh();
  return { status: 200, body: { changed: after !== before, restartNeeded: after !== before } };
}

/**
 * Turns the friends broadcast on or off (BROADCAST in .env). With the lobby running, only the
 * broadcast's container is recreated, so nobody is disconnected; otherwise it applies at the next
 * Start.
 */
async function setBroadcast(on: boolean): Promise<{ status: number; body: unknown }> {
  if (!existsSync(envPath)) return { status: 409, body: { error: "No .env file. Copy .env.example to .env first." } };
  if (busy) return { status: 409, body: { error: `busy: ${busy}` } };
  const before = await readFile(envPath, "utf8");
  const after = setEnvValues(before, { BROADCAST: on ? "1" : "" });
  if (after !== before) {
    const settingsAt = settingsChangedAt();
    await writeFile(envPath, after);
    broadcastWrite = { mtime: statSync(envPath).mtimeMs, settingsAt };
  }
  const apply = dockerState === "running" && mainContainer("lobby")?.State === "running";
  if (apply) runCompose(STACKS.find((stack) => stack.id === "main")!, "broadcast");
  else note(`Friends broadcast ${on ? "on: it starts" : "off: it stays off"} with the network.`);
  void refresh();
  return { status: 200, body: { changed: after !== before, applied: apply } };
}

// ---- HTTP --------------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > limit) {
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

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const refusal = checkRequest(
    { method, host: req.headers.host, origin: req.headers.origin, panelHeader: req.headers["x-minecade-panel"] as string | undefined },
    PORT,
  );
  if (refusal) return sendJson(res, 403, { error: refusal });
  const url = new URL(req.url ?? "/", ORIGIN);
  const path = url.pathname;

  if (method === "GET") {
    if (path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(await readFile(new URL("./index.html", import.meta.url)));
      return;
    }
    if (path === "/api/ping") return sendJson(res, 200, { app: "minecade-panel", pid: process.pid });
    if (path === "/api/events") return openEvents(req, res);
    if (path === "/api/state") return sendJson(res, 200, await buildState());
    if (path === "/api/logs") {
      const id = url.searchParams.get("id") ?? "";
      if (!containers.some((info) => info.Id === id)) return sendJson(res, 404, { error: "unknown container" });
      return sendJson(res, 200, { lines: followers.get(id)?.lines ?? [] });
    }
    if (path === "/api/stats") {
      const result = await fetchStats();
      return sendJson(res, result.status, result.body);
    }
    return sendJson(res, 404, { error: "not found" });
  }

  if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  const body = await readJson(req, 4096);
  if (!body) return sendJson(res, 400, { error: "expected a JSON object of at most 4 KB" });

  if (path === "/api/docker/start") {
    startDockerDesktop();
    void refresh();
    return sendJson(res, 202, { ok: true });
  }
  const stackRoute = /^\/api\/stacks\/([a-z]+)\/(up|down|restart)$/.exec(path);
  if (stackRoute) {
    const stack = STACKS.find((candidate) => candidate.id === stackRoute[1]);
    if (!stack) return sendJson(res, 404, { error: "unknown stack" });
    if (busy) return sendJson(res, 409, { error: `busy: ${busy}` });
    if (dockerState !== "running") return sendJson(res, 409, { error: "Docker is not running" });
    if (stackRoute[2] !== "down") {
      if (stack.id === "main" && (await editorStatus(500))) return sendJson(res, 409, { error: "shut the map editor down first: it uses the network's ports" });
      const blocker = otherRunningStack(stack.id);
      if (blocker) return sendJson(res, 409, { error: `stop "${blocker}" first: both use the same ports` });
      if (!existsSync(envPath)) return sendJson(res, 409, { error: "No .env file. Copy .env.example to .env first." });
    }
    runCompose(stack, stackRoute[2]);
    void refresh();
    return sendJson(res, 202, { ok: true });
  }
  if (path === "/api/env") {
    const result = await saveEnv(body);
    return sendJson(res, result.status, result.body);
  }
  if (path === "/api/broadcast") {
    if (typeof body.on !== "boolean") return sendJson(res, 400, { error: "expected {on: true|false}" });
    const result = await setBroadcast(body.on);
    return sendJson(res, result.status, result.body);
  }
  if (path === "/api/editor/boot") {
    const result = await bootEditor(body.stopNetwork === true);
    void refresh();
    return sendJson(res, result.status, result.body);
  }
  if (path === "/api/editor/restart") {
    const result = await restartEditor(body.stopNetwork === true);
    void refresh();
    return sendJson(res, result.status, result.body);
  }
  if (path === "/api/editor/save") {
    const result = await saveEditor();
    if (!result.ok) return sendJson(res, 409, { error: result.error ?? "no map is open in Edit" });
    note("Map editor: saving the map open in Edit...");
    void refresh();
    return sendJson(res, 202, { ok: true });
  }
  if (path === "/api/editor/publish") {
    const result = await publishEditor();
    if (!result.ok) return sendJson(res, 409, { error: result.error ?? "no map is open in Edit" });
    note("Map editor: publishing the map open in Edit (save, then commit and push)...");
    void refresh();
    return sendJson(res, 202, { ok: true });
  }
  if (path === "/api/editor/preview" || path === "/api/editor/preview/end") {
    const start = path === "/api/editor/preview";
    const result = start ? await previewEditor() : await endPreviewEditor();
    if (!result.ok) return sendJson(res, 409, { error: result.error ?? "no map editor is running" });
    note(start ? "Map editor: starting a preview of the map open in Edit..." : "Map editor: ending the preview...");
    void refresh();
    return sendJson(res, 202, { ok: true });
  }
  if (path === "/api/editor/stop") {
    if (!(await stopEditor())) return sendJson(res, 409, { error: "no map editor is running" });
    note("Map editor: shutting down (Edit saves first)...");
    void refresh();
    return sendJson(res, 202, { ok: true });
  }
  if (path === "/api/panel/restart") {
    sendJson(res, 202, { ok: true, pid: process.pid });
    setTimeout(restartPanel, 100);
    return;
  }
  if (path === "/api/game/start" || path === "/api/game/end") {
    const result = await relayToOrchestrator(path === "/api/game/start", body);
    return sendJson(res, result.status, result.body);
  }
  return sendJson(res, 404, { error: "not found" });
}

/**
 * Boots the map editor (tools/editor/editor.ts) as its own process, which keeps running after the
 * Panel closes. It takes the network's ports, so a running network is stopped first, once the page
 * has confirmed it (`stopNetwork`).
 */
async function bootEditor(stopNetwork: boolean): Promise<{ status: number; body: unknown }> {
  if (dockerState !== "running") return { status: 409, body: { error: "Docker is not running" } };
  if (editorLaunch) return { status: 409, body: { error: "the map editor is booting already" } };
  if (await editorStatus(500)) return { status: 409, body: { error: "the map editor is running already" } };
  if (busy) return { status: 409, body: { error: `busy: ${busy}` } };
  if (!networkRunning()) return launchEditor();
  if (!stopNetwork) return { status: 409, body: { error: "the network is running, and the map editor needs its ports", network: true } };
  const network = STACKS.find((stack) => stack.id === "main")!;
  note("Map editor: stopping the network first (the editor takes its ports)...");
  runCompose(network, "down", (ok) => {
    if (ok) launchEditor();
    else note("Map editor: not booted, because the network didn't stop.");
  });
  return { status: 202, body: { ok: true } };
}

/** Shuts the running editor down (Edit saves first), then boots it again on this checkout's code. */
async function restartEditor(stopNetwork: boolean): Promise<{ status: number; body: unknown }> {
  if (editorRestart) return { status: 409, body: { error: "the map editor is restarting already" } };
  if (!(await stopEditor())) return { status: 409, body: { error: "no map editor is running" } };
  editorRestart = true;
  note("Map editor: restarting on this checkout's code (Edit saves first)...");
  void (async () => {
    try {
      const until = Date.now() + EDITOR_STOP_MS;
      while (Date.now() < until && (await editorStatus(500))) await new Promise((resolve) => setTimeout(resolve, 1000));
      if (await editorStatus(500)) {
        note("Map editor: it didn't shut down in time. Boot it again once it has.");
        return;
      }
      await refresh();
      const result = await bootEditor(stopNetwork);
      if (result.status >= 400) note(`Map editor: could not boot it again: ${(result.body as { error?: string }).error}`);
    } finally {
      editorRestart = false;
      void refresh();
    }
  })();
  return { status: 202, body: { ok: true } };
}

/** Starts the editor process; it keeps running after the Panel closes. */
function launchEditor(): { status: number; body: unknown } {
  if (dockerState !== "running") return { status: 409, body: { error: "Docker is not running" } };
  mkdirSync(dirname(editorLogPath), { recursive: true });
  const out = openSync(editorLogPath, "w");
  try {
    const child = spawn(process.execPath, ["--import", "tsx", join("tools", "editor", "editor.ts")], {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", out, out],
      windowsHide: true,
    });
    child.on("exit", (code) => {
      if (code !== 0) note(`Map editor: stopped with exit code ${code}. Its log is on the Map editor page.`);
    });
    child.unref();
  } finally {
    closeSync(out);
  }
  editorLaunch = { at: Date.now() };
  note("Map editor: booting (the editor lobby first)...");
  return { status: 202, body: { ok: true } };
}

/** Starts or ends a game through the orchestrator's debug API. */
async function relayToOrchestrator(start: boolean, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const payload = start ? { game: String(body.game ?? ""), map: String(body.map || "random") } : {};
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}${start ? "/v1/start" : "/v1/end"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.ok) note(start ? `Starting ${payload.game}...` : "Ending the game...");
    else note(`Orchestrator: ${result.error ?? `HTTP ${response.status}`}`);
    void refresh();
    return { status: response.status, body: result };
  } catch {
    return { status: 502, body: { error: "the orchestrator is not answering" } };
  }
}

/** Everyone's stats from the orchestrator, or an error the page shows as is. */
async function fetchStats(): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/v1/stats`, { signal: AbortSignal.timeout(3000) });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.ok) return { status: 200, body: result };
    // An orchestrator built before stats only knows POST there and answers 405.
    if (response.status === 404 || response.status === 405) {
      return { status: 502, body: { error: "The running orchestrator has no stats yet. Restart the Minecade network to update it." } };
    }
    return { status: 502, body: { error: `Orchestrator: ${result.error ?? `HTTP ${response.status}`}` } };
  } catch {
    const error = orchestratorRunning()
      ? "The orchestrator is not answering yet."
      : "The orchestrator isn't running. Start the Minecade network to see stats.";
    return { status: 502, body: { error } };
  }
}

function otherRunningStack(id: StackId): string | undefined {
  const other = containers.find((info) => info.State === "running" && stackOf(info) !== id);
  return other ? STACKS.find((stack) => stack.id === stackOf(other))?.label : undefined;
}

// ---- Window and lifetime -----------------------------------------------------------------

/** Starts a fresh Panel on this checkout's code, which takes over this one's port (its windows reload), then quits. */
function restartPanel(): void {
  log("restarting on this checkout's code");
  server.close();
  for (const res of windows) res.end();
  for (const follower of followers.values()) follower.stop();
  const args = [...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2).filter((arg) => arg !== "--restarting"), "--restarting"];
  spawn(process.execPath, args, { cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: true }).unref();
  setTimeout(() => process.exit(0), 100);
}

function openWindow(): void {
  if (noWindow) return;
  const url = `${ORIGIN}/`;
  if (process.platform !== "win32") {
    spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const edge = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter((dir): dir is string => Boolean(dir))
    .map((dir) => join(dir, "Microsoft", "Edge", "Application", "msedge.exe"))
    .find((exe) => existsSync(exe));
  if (!edge) {
    spawn("explorer.exe", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const args = [
    `--app=${url}`,
    `--user-data-dir=${join(dataDir, "edge")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1000,780",
  ];
  spawn(edge, args, { detached: true, stdio: "ignore" }).unref();
}

/** "ours" if a panel already answers on the port, "other" if something else does. */
async function probePort(): Promise<"ours" | "other" | "free"> {
  try {
    const response = await fetch(`${ORIGIN}/api/ping`, { signal: AbortSignal.timeout(500) });
    const body = (await response.json().catch(() => ({}))) as { app?: string };
    return body.app === "minecade-panel" ? "ours" : "other";
  } catch {
    return "free";
  }
}

async function handOff(): Promise<void> {
  let probe = await probePort();
  // Restarted: the old Panel is on its way out.
  for (let tries = 0; restarting && probe === "ours" && tries < 50; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    probe = await probePort();
  }
  if (probe === "ours") {
    log("a panel is already running; opening a window for it");
    openWindow();
    process.exit(0);
  }
  if (probe === "other") {
    log(`port ${PORT} is used by another program`);
    process.exit(2);
  }
}

const startedAt = Date.now();
await handOff();

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    log(`request ${req.method} ${req.url} failed: ${String(error)}`);
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    else res.end();
  });
});

let listenTries = 0;
server.on("error", async (error: NodeJS.ErrnoException) => {
  // Restarted: the old Panel may still hold the port for a moment.
  if (error.code === "EADDRINUSE" && restarting && ++listenTries < 20) {
    setTimeout(() => server.listen(PORT, "127.0.0.1"), 250);
    return;
  }
  if (error.code === "EADDRINUSE") {
    await handOff();
    log(`port ${PORT} is in use`);
  } else if (error.code === "EACCES") {
    log(`Windows reserves port ${PORT}. See: netsh interface ipv4 show excludedportrange protocol=tcp`);
  } else {
    log(`server error: ${error.message}`);
  }
  process.exit(2);
});

server.listen(PORT, "127.0.0.1", () => {
  log(`Minecade Panel at ${ORIGIN}/ (log: ${logPath})`);
  openWindow();
  void refresh();
  setInterval(() => void refresh(), 2000);
  setInterval(() => {
    if (stay) return;
    if (shouldExit({ now: Date.now(), startedAt, windows: windows.size, lastWindowAt, busy: busy !== null })) {
      log("no windows open; exiting");
      for (const follower of followers.values()) follower.stop();
      process.exit(0);
    }
  }, 5000);
});

process.on("uncaughtException", (error) => {
  log(`crashed: ${error.stack ?? String(error)}`);
  process.exit(1);
});
