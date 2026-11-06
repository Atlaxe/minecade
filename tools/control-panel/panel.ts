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
import type { GuestInfo } from "@minecade/minigame-core/config";
import { broadcastEditor, editorStatus, endPreviewEditor, guestEditor, openInEditor, pictureEditor, previewEditor, publishEditor, saveEditor, stopEditor, warmEditor } from "../editor/control.ts";
import { editorPlayers, type EditorStatus } from "../editor/editor-core.ts";
import { addGuest, readGuests, removeGuest, writeGuests } from "../editor/guests.ts";
import { cacheVanillaTextures } from "../build/vanilla-textures.ts";
import { catalogDir, storeDir } from "../maps/paths.ts";
import { MapStore } from "../maps/store.ts";
import { MapChanges } from "../viewer/map-changes.ts";
import { mapJsonPath, viewerMap, viewerMapConfig, watchMap, watchWorld } from "../viewer/map-data.ts";
import { SELECT_PAGE, VIEWER_PAGE, viewerColors, viewerMaps, viewerScripts, viewerShapes, viewerTextures, viewerThumbPath, viewerView } from "../viewer/routes.ts";
import { SelectFromAbove } from "../viewer/select.ts";
import {
  BroadcastLog,
  checkLobbyMap,
  checkRequest,
  formatPorts,
  isEditorContainer,
  isStale,
  lobbyMapChoices,
  normalizeNames,
  PlayerLog,
  readEnv,
  setAllowListOn,
  setEnvValues,
  setPlayerSwitch,
  shouldExit,
  stackOf,
  STACKS,
  type PlayerLists,
  type StackDef,
  type StackId,
} from "./core.ts";
import { WANTED_MS, warmStep, type EditorPhase } from "./warm.ts";

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
/** Select from above: the worlds' pictures, and maps cut out of them in the background. */
const selectFromAbove = new SelectFromAbove(repoRoot, (text) => note(`Select from above: ${text}`));
/** The map viewer's edits, undo histories, Save and Publish. */
const mapChanges = new MapChanges(repoRoot);
/** Files both pages load, by URL path (paths from the repo root). */
const PANEL_ASSETS: Record<string, { file: string; type: string }> = {
  "/theme.css": { file: join("tools", "control-panel", "theme.css"), type: "text/css; charset=utf-8" },
  "/tips.js": { file: join("tools", "control-panel", "tips.js"), type: "text/javascript; charset=utf-8" },
  "/brand/logo.png": { file: join("packages", "minigame-core", "resource_pack", "textures", "minecade", "ui", "logo.png"), type: "image/png" },
};
const FONT_FILE = /^\/fonts\/[a-z0-9-]+\.woff2$/;
/** The map editor's output when the Panel starts it (it runs on after the Panel closes). */
const editorLogPath = join(repoRoot, "work", "editor", "editor.log");
const EDITOR_LOG_LINES = 150;
/** How long a starting editor may take to answer on its control port before the Panel gives up waiting. */
const EDITOR_LAUNCH_MS = 30_000;
/** How long a restarting editor may take to shut down (Edit saves first) before the Panel stops waiting. */
const EDITOR_STOP_MS = 5 * 60_000;
/** The Panel's own code: when one of these changes, the page offers Restart Panel. */
const PANEL_SOURCES = [
  "tools/control-panel/panel.ts",
  "tools/control-panel/core.ts",
  "tools/control-panel/warm.ts",
  "tools/editor/control.ts",
  "tools/editor/editor-core.ts",
  "tools/editor/guests.ts",
  "tools/maps",
  // The map viewer's routes, and the editor's catalog and checklist code they use.
  "tools/viewer",
  "tools/editor/catalog.ts",
  "tools/editor/targets.ts",
  "tools/editor/worlds.ts",
  "tools/editor/select-core.ts",
  "tools/editor/marker-models.ts",
  "tools/editor/world-log.ts",
  "tools/build/vanilla-textures.ts",
  "packages/minigame-core/src/map-checklist.ts",
  "packages/minigame-core/src/map-validate.ts",
  "packages/minigame-core/src/map-requirements.ts",
  "packages/minigame-core/src/map-config.ts",
];
/** The map editor's code (the host tool, its packs, the map store, the shared core and the server entrypoint). */
const EDITOR_SOURCES = ["tools/editor", "tools/build", "tools/maps", "editor", "packages/minigame-core/src", "docker/bds/entrypoint.sh"];
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
    /** One of the map editor's: listed in the Servers page's Map editor section. */
    editor: isEditorContainer(info),
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

/** The published lobby maps (their cards in the map store's published catalog), for the LOBBY_MAP picker. */
async function lobbyMaps() {
  const dir = join(catalogDir(repoRoot), "lobby");
  if (!existsSync(dir)) return [];
  const entries: { id: string; json: string }[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
    entries.push({ id: file.slice(0, -".json".length), json: await readFile(join(dir, file), "utf8") });
  }
  return lobbyMapChoices(entries);
}

/** A boot the Panel asked for, until the editor answers on its control port (or gives up). */
let editorLaunch: { at: number } | null = null;
/** A restart under way: the old editor is shutting down, and the new one boots once it has. */
let editorRestart = false;

/**
 * The warm-up (warm.ts): when a Maps page or a viewer last said it's open, the map to have open in
 * Edit (the newest picked or opened), whether the editor was shut down by hand, when a boot last
 * failed, when anyone last used the editor, the last map asked for, and why it isn't warming now.
 */
const warmUp: { wantedAt?: number; map?: string; paused: boolean; failedAt?: number; usedAt: number; sentMap?: string; sentAt?: number; note: string } = {
  paused: false,
  usedAt: Date.now(),
  note: "",
};
/** Open in game asked for while the editor was off or starting: it opens once the editor is ready. */
let openWhenReady: { target: string; map: string } | undefined;

/**
 * The running editor's status, a boot in progress, or the last run's log when none is running.
 * `old` is an editor from before the editor lobby (its status has another shape), and `stale` one
 * started before its code last changed: either should be restarted. `guests` are the running
 * editor's (with where each one is), or work/editor/guests.json's while it's off.
 */
async function editorState(): Promise<{ status: EditorStatus | null; old: boolean; stale: boolean; launching: boolean; restarting: boolean; log: string[]; guests: GuestInfo[] }> {
  const status = (await editorStatus(500)) ?? null;
  if (status || (editorLaunch && Date.now() - editorLaunch.at > EDITOR_LAUNCH_MS)) editorLaunch = null;
  if (status) {
    const old = status.booted !== true;
    const stale = old || isStale(Date.parse(status.startedAt), await sourceTimes(EDITOR_SOURCES));
    return { status, old, stale, launching: false, restarting: editorRestart, log: Array.isArray(status.log) ? status.log : [], guests: status.guests ?? [] };
  }
  const text = existsSync(editorLogPath) ? await readFile(editorLogPath, "utf8") : "";
  const log = text.split(/\r?\n/).filter(Boolean).slice(-EDITOR_LOG_LINES);
  const guests = (await readGuests(repoRoot)).map((name) => ({ name }));
  return { status: null, old: false, stale: false, launching: editorLaunch !== null || editorRestart, restarting: editorRestart, log, guests };
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
  return containers.some((info) => info.State === "running" && stackOf(info) === "main" && !isEditorContainer(info));
}

/** The main stack's container with this role, if it has one (never one of the map editor's). */
function mainContainer(role: string): Docker.ContainerInfo | undefined {
  return containers.find((info) => stackOf(info) === "main" && !isEditorContainer(info) && info.Labels["minecade.role"] === role);
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
    // The map editor's containers are listed with the network but aren't it (they run while it's stopped).
    const servers = members.filter((info) => !isEditorContainer(info));
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
          ALLOW_LIST_PAUSED: env.ALLOW_LIST_PAUSED ?? "",
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
    warm: {
      note: warmUp.note,
      map: warmUp.map ?? null,
      wanted: warmUp.wantedAt !== undefined && Date.now() - warmUp.wantedAt < WANTED_MS,
      openWhenReady: openWhenReady ? `${openWhenReady.target}/${openWhenReady.map}` : null,
    },
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
    const state = await buildState();
    broadcast("state", state);
    void warmTick(state).catch((error: unknown) => log(`warm-up failed: ${String(error)}`));
  } catch (error) {
    log(`refresh failed: ${String(error)}`);
  } finally {
    refreshing = false;
  }
}

type PanelState = Awaited<ReturnType<typeof buildState>>;

/** The editor as warm.ts sees it. */
function editorPhase(editor: PanelState["editor"]): EditorPhase {
  if (editor.status) return editor.old ? "old" : editor.status.state === "ready" ? "ready" : editor.status.state === "stopping" ? "stopping" : "starting";
  return editor.launching ? "booting" : "off";
}

/** Players on the editor's servers, waiting for one, or in a preview. */
function editorPeople(status: EditorStatus): number {
  return status.home.players.length + (status.select?.players.length ?? 0) + (status.edit?.players.length ?? 0) + (status.preview?.players.length ?? 0) + status.waiting.length;
}

let warmTicking = false;

/** One step of the warm-up (warm.ts), after each refresh; and Open in game once the editor is ready. */
async function warmTick(state: PanelState): Promise<void> {
  if (warmTicking) return;
  warmTicking = true;
  try {
    const status = state.editor.status && !state.editor.old ? state.editor.status : undefined;
    const phase = editorPhase(state.editor);
    const now = Date.now();
    if (status && editorPeople(status) > 0) warmUp.usedAt = now;
    if (status) warmUp.failedAt = undefined;
    if (openWhenReady && phase === "ready") {
      const { target, map } = openWhenReady;
      openWhenReady = undefined;
      const result = await openInEditor({ to: "edit", target, map }, true);
      note(result.ok ? `Map editor: opening ${target}/${map} in game Edit.` : `Map editor: could not open ${target}/${map} in game Edit: ${result.error}`);
      return;
    }
    const edit = status?.edit;
    const step = warmStep({
      now,
      wantedAt: warmUp.wantedAt,
      paused: warmUp.paused,
      docker: state.docker === "running",
      busy: state.busy !== null || editorRestart,
      network: state.networkRunning,
      editor: phase,
      fromPanel: status?.fromPanel === true,
      people: status ? editorPeople(status) : 0,
      extracting: status?.select?.selections.some((item) => item.status !== "ready" && item.status !== "failed") ?? false,
      usedAt: Math.max(warmUp.usedAt, warmUp.wantedAt ?? 0, status ? Date.parse(status.startedAt) : 0),
      failedAt: warmUp.failedAt,
      map: warmUp.map,
      editMap: edit && (edit.state === "starting" || edit.state === "ready") ? `${edit.target}/${edit.map}` : undefined,
      sentMap: warmUp.sentMap,
      sentAt: warmUp.sentAt,
    });
    if (step.action === "none") {
      if (step.why !== undefined || phase !== "ready") warmUp.note = step.why ?? "";
      return;
    }
    warmUp.note = "";
    if (step.action === "boot") {
      note("Map editor: booting in the background, so maps open in game quickly.");
      launchEditor();
    } else if (step.action === "stop") {
      note("Map editor: shutting down, as nobody has used it for 15 minutes (Edit saves first).");
      await stopEditor();
    } else {
      const [target, map] = step.map.split("/");
      warmUp.sentMap = step.map;
      warmUp.sentAt = now;
      const answer = await warmEditor(target, map);
      warmUp.note = answer && !answer.opening && answer.why ? `${step.map} isn't opening in Edit: ${answer.why}` : "";
    }
  } finally {
    warmTicking = false;
  }
}

/**
 * Open in game, from the map viewer: the map in game Edit, with map editors in the editor lobby
 * (and joining it in the next minutes) sent straight there. A map editor that's off boots first,
 * stopping the network once the page has asked (`stopNetwork`).
 */
async function openInGame(target: string, map: string, stopNetwork: boolean): Promise<{ status: number; body: unknown }> {
  warmUp.paused = false;
  warmUp.map = `${target}/${map}`;
  warmUp.wantedAt = Date.now();
  const status = await editorStatus(500);
  if (status) {
    if (status.booted !== true) return { status: 409, body: { error: "an older map editor is running: restart it on the Servers page first" } };
    if (status.state === "stopping") return { status: 409, body: { error: "the map editor is shutting down: try again once it has" } };
    if (status.state === "ready") {
      const result = await openInEditor({ to: "edit", target, map }, true);
      if (!result.ok) return { status: 409, body: { error: result.error ?? "the map editor didn't answer" } };
      note(`Map editor: opening ${target}/${map} in game Edit, for the map viewer.`);
      return { status: 202, body: { ok: true } };
    }
    openWhenReady = { target, map };
    return { status: 202, body: { ok: true } };
  }
  if (!editorLaunch && !editorRestart) {
    const booted = await bootEditor(stopNetwork);
    if (booted.status >= 400) return booted;
  }
  openWhenReady = { target, map };
  return { status: 202, body: { ok: true } };
}

/** Starts the network once the map editor (which has its ports) has shut down; Edit saves first. */
async function startAfterEditor(stack: StackDef, action: string): Promise<void> {
  busy = `${stack.label}: ${action}`;
  note("Map editor: shutting down first, as the network takes its ports (Edit saves first)...");
  void refresh();
  await stopEditor();
  const until = Date.now() + EDITOR_STOP_MS;
  while (Date.now() < until && (await editorStatus(500))) await new Promise((resolve) => setTimeout(resolve, 1000));
  if (await editorStatus(500)) {
    busy = null;
    note(`${stack.label}: not started, because the map editor didn't shut down in time.`);
    void refresh();
    return;
  }
  runCompose(stack, action);
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

/**
 * A window's event stream: the Panel's state and activity. A map viewer's window names its map
 * (?target=&map=), and its stream also carries "map" events when that map's map.json changes, so
 * each window keeps one stream (Edge allows six connections to the Panel at once).
 */
async function openEvents(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  res.write("retry: 2000\n\n");
  windows.add(res);
  lastWindowAt = Date.now();
  const target = url.searchParams.get("target");
  const map = url.searchParams.get("map");
  const unwatch = target && map ? watchMap(repoRoot, target, map, (change) => res.write(`event: map\ndata: ${JSON.stringify(change)}\n\n`)) : undefined;
  // Its world, too: game Edit saving it, the viewer draws the blocks again.
  const unwatchWorld = target && map ? watchWorld(repoRoot, target, map, (stamp) => res.write(`event: world\ndata: ${JSON.stringify({ stamp })}\n\n`)) : undefined;
  res.on("close", () => {
    windows.delete(res);
    unwatch?.();
    unwatchWorld?.();
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
  // The Docker build draws kit pictures and the dyed leather armor pack from Minecraft's textures,
  // which it can only get from this checkout's copy of them (tools/build/vanilla-textures.ts).
  if (action === "up" || action === "restart") {
    try {
      if (!cacheVanillaTextures()) note("Minecraft's textures aren't on this PC: kit forms will list items as text, and the dyed leather armor pack can't be written.");
    } catch (error) {
      note(`Could not copy Minecraft's textures: ${error instanceof Error ? error.message : String(error)}`);
    }
    // The build takes the maps' cards and pictures from the map store's published catalog, and the
    // servers their worlds from its published worlds: written again here from its database so it's
    // what was published, whatever happened to the folder since (only what changed is written).
    try {
      const store = MapStore.open(storeDir(repoRoot));
      try {
        store.exportPublished();
      } finally {
        store.close();
      }
    } catch (error) {
      note(`Could not write the published maps: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
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
 * Turns the friends broadcast on or off (BROADCAST in .env), for the network and the map editor
 * alike. With the lobby running, only the broadcast's container is recreated, so nobody is
 * disconnected; with the map editor running, it starts or stops its own; otherwise it applies at
 * the next start of either.
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
  let apply = dockerState === "running" && mainContainer("lobby")?.State === "running";
  if (apply) runCompose(STACKS.find((stack) => stack.id === "main")!, "broadcast");
  else if (await editorStatus(500)) {
    const result = await broadcastEditor(on);
    apply = result.ok;
    note(result.ok ? `Map editor: Friends tab ${on ? "starting" : "off"}.` : `Map editor: could not turn the Friends tab ${on ? "on" : "off"}: ${result.error}.`);
  } else note(`Friends broadcast ${on ? "on: it starts" : "off: it stays off"} with the network or the map editor.`);
  void refresh();
  return { status: 200, body: { changed: after !== before, applied: apply } };
}

/**
 * Adds a map editor guest (on), or removes one: through the running editor, which lets them in or
 * disconnects them at once, or straight in work/editor/guests.json while it's off.
 */
async function setEditorGuest(name: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  if (await editorStatus(500)) return guestEditor(name, on);
  // A booting editor reads the file once, and would miss the change.
  if (editorLaunch || editorRestart) return { ok: false, error: "the map editor is booting: try again once it's ready" };
  const env = existsSync(envPath) ? readEnv(await readFile(envPath, "utf8")) : {};
  const guests = await readGuests(repoRoot);
  const result = on ? addGuest(guests, name, editorPlayers(env)) : removeGuest(guests, name);
  if (typeof result === "string") return { ok: false, error: result };
  await writeGuests(repoRoot, result);
  return { ok: true };
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
    // The look both pages share: the theme, its fonts, the wordmark and the tooltips.
    const asset = PANEL_ASSETS[path] ?? (FONT_FILE.test(path) ? { file: join("tools", "control-panel", path), type: "font/woff2" } : undefined);
    if (asset) {
      const data = await readFile(join(repoRoot, asset.file)).catch(() => undefined);
      if (!data) return sendJson(res, 404, { error: "not found" });
      res.writeHead(200, { "content-type": asset.type, "cache-control": "no-store" });
      res.end(data);
      return;
    }
    if (path === "/api/ping") return sendJson(res, 200, { app: "minecade-panel", pid: process.pid });
    if (path === "/api/events") return openEvents(req, res, url);
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
    if (path === "/viewer") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(await readFile(VIEWER_PAGE));
      return;
    }
    if (path === "/viewer/select") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(await readFile(SELECT_PAGE));
      return;
    }
    if (path === "/viewer/app.js" || path === "/viewer/worker.js" || path === "/viewer/select.js") {
      try {
        const script = (await viewerScripts()).get(path.slice("/viewer/".length));
        if (!script) return sendJson(res, 404, { error: "not found" });
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        res.end(script);
      } catch (error) {
        sendJson(res, 500, { error: `the viewer's scripts didn't build: ${error instanceof Error ? error.message : String(error)}` });
      }
      return;
    }
    if (path === "/api/viewer/colors") {
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "cache-control": "no-store" });
      res.end(viewerColors(repoRoot));
      return;
    }
    if (path === "/api/viewer/textures") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-encoding": "gzip", "cache-control": "no-store" });
      res.end(viewerTextures(repoRoot));
      return;
    }
    if (path === "/api/viewer/maps") return sendJson(res, 200, await viewerMaps(repoRoot));
    if (path === "/api/viewer/thumb") {
      const file = viewerThumbPath(repoRoot, url.searchParams.get("target") ?? "", url.searchParams.get("map") ?? "");
      if (!file) return sendJson(res, 404, { error: "no picture" });
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      res.end(await readFile(file));
      return;
    }
    if (path === "/api/viewer/map" && url.searchParams.has("configOnly")) {
      const answer = await viewerMapConfig(repoRoot, url.searchParams.get("target") ?? "", url.searchParams.get("map") ?? "");
      return answer.status === 200 ? sendJson(res, 200, { config: answer.config, stamp: answer.stamp }) : sendJson(res, answer.status, { error: answer.error });
    }
    if (path === "/api/viewer/map") {
      const answer = await viewerMap(repoRoot, url.searchParams.get("target") ?? "", url.searchParams.get("map") ?? "");
      return answer.status === 200 ? sendJson(res, 200, answer.map) : sendJson(res, answer.status, { error: answer.error });
    }
    if (path === "/api/viewer/shapes") {
      const answer = viewerShapes(repoRoot, url.searchParams.get("target") ?? "", url.searchParams.get("map") ?? "");
      return answer.status === 200 ? sendJson(res, 200, { shapes: answer.shapes }) : sendJson(res, answer.status, { error: answer.error });
    }
    if (path === "/api/viewer/view") {
      const answer = viewerView(repoRoot, url.searchParams.get("target") ?? "", url.searchParams.get("map") ?? "");
      if (answer.status !== 200) return sendJson(res, answer.status, { error: answer.error });
      res.writeHead(200, { "content-type": "application/octet-stream", "content-encoding": "gzip", "cache-control": "no-store", "x-view-stamp": answer.stamp });
      res.end(answer.gzipped);
      return;
    }
    // Select from above (tools/viewer/select.ts).
    const world = url.searchParams.get("world") ?? "";
    if (path === "/api/viewer/worlds") return sendJson(res, 200, { worlds: await selectFromAbove.worldList() });
    if (path === "/api/viewer/world-icon") {
      const file = await selectFromAbove.iconPath(world);
      if (!file) return sendJson(res, 404, { error: "no icon" });
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
      res.end(await readFile(file));
      return;
    }
    if (path === "/api/viewer/overview" || path === "/api/viewer/select/view") {
      const answer = path === "/api/viewer/overview" ? await selectFromAbove.overview(world) : await selectFromAbove.view(world, url.searchParams.get("box") ?? "");
      if (answer.status !== 200) return sendJson(res, answer.status, { error: answer.error });
      res.writeHead(200, { "content-type": "application/octet-stream", "content-encoding": "gzip", "cache-control": "no-store" });
      res.end(answer.gzipped);
      return;
    }
    if (path === "/api/viewer/select/shapes") {
      const answer = await selectFromAbove.shapes(world, url.searchParams.get("box") ?? "");
      return answer.status === 200 ? sendJson(res, 200, { shapes: answer.shapes }) : sendJson(res, answer.status, { error: answer.error });
    }
    if (path === "/api/viewer/select/maps") {
      const answer = await selectFromAbove.maps(world);
      return answer.status === 200 ? sendJson(res, 200, { world: answer.world, selections: answer.selections }) : sendJson(res, answer.status, { error: answer.error });
    }
    return sendJson(res, 404, { error: "not found" });
  }

  if (method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  const body = await readJson(req, 4096);
  if (!body) return sendJson(res, 400, { error: "expected a JSON object of at most 4 KB" });

  // Select from above's exports (tools/viewer/select.ts).
  const selectRoute = /^\/api\/viewer\/select\/(export|retry|forget)$/.exec(path);
  if (selectRoute) {
    const action = selectRoute[1];
    const answer = action === "export" ? await selectFromAbove.export(body) : await selectFromAbove.act(action as "retry" | "forget", body);
    return answer.status === 200 ? sendJson(res, 200, { ok: true, message: answer.message }) : sendJson(res, answer.status, { error: answer.error });
  }

  // The map viewer's changes (map-changes.ts): through the map editor when game Edit has the map open.
  const viewerRoute = /^\/api\/viewer\/(edit|undo|redo|save|publish)$/.exec(path);
  if (viewerRoute) {
    const target = typeof body.target === "string" ? body.target : "";
    const map = typeof body.map === "string" ? body.map : "";
    const action = viewerRoute[1];
    try {
      if (action === "edit" || action === "undo" || action === "redo") {
        const answer = action === "edit" ? await mapChanges.edit(target, map, body.edit) : await mapChanges.step(target, map, action);
        return sendJson(res, answer.status, answer);
      }
      const answer = action === "save" ? await mapChanges.save(target, map) : await mapChanges.publish(target, map);
      note(`Map viewer, ${target}/${map}: ${"message" in answer ? answer.message : answer.error}`);
      return sendJson(res, answer.status, answer);
    } catch (error) {
      return sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }

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
      const blocker = otherRunningStack(stack.id);
      if (blocker) return sendJson(res, 409, { error: `stop "${blocker}" first: both use the same ports` });
      if (!existsSync(envPath)) return sendJson(res, 409, { error: "No .env file. Copy .env.example to .env first." });
      // The map editor has the network's ports: it shuts down first, once the page has asked (or nobody is on it).
      if (stack.id === "main" && (await editorStatus(500))) {
        if (body.stopEditor !== true) return sendJson(res, 409, { error: "the map editor is running, and the network needs its ports", editor: true });
        void startAfterEditor(stack, stackRoute[2]);
        return sendJson(res, 202, { ok: true });
      }
    }
    runCompose(stack, stackRoute[2]);
    void refresh();
    return sendJson(res, 202, { ok: true });
  }
  // The Players page's switches: one player's Allowed or Map editor, and the allow list itself.
  if (path === "/api/players" || path === "/api/allow-list") {
    if (!existsSync(envPath)) return sendJson(res, 409, { error: "No .env file. Copy .env.example to .env first." });
    const before = await readFile(envPath, "utf8");
    const env = readEnv(before);
    const lists: PlayerLists = { ALLOW_LIST: env.ALLOW_LIST ?? "", ALLOW_LIST_PAUSED: env.ALLOW_LIST_PAUSED ?? "", LAN_PLAYERS: env.LAN_PLAYERS ?? "" };
    let next: PlayerLists | { error: string } = lists;
    if (path === "/api/allow-list") {
      if (typeof body.on !== "boolean") return sendJson(res, 400, { error: "expected {on: true|false}" });
      next = setAllowListOn(lists, body.on);
    } else {
      if (typeof body.name !== "string") return sendJson(res, 400, { error: "expected {name, allowed?: true|false, editor?: true|false}" });
      for (const which of ["allowed", "editor"] as const) {
        if (typeof body[which] === "boolean" && !("error" in next)) next = setPlayerSwitch(next, body.name, which, body[which] as boolean);
      }
    }
    if ("error" in next) return sendJson(res, 409, { error: next.error });
    const after = setEnvValues(before, { ...next });
    if (after !== before) {
      await writeFile(envPath, after);
      note(path === "/api/allow-list" ? `Allow list switched ${body.on ? "on" : "off"} in .env. Restart the network to apply.` : `Saved ${String(body.name)}'s switches to .env. Restart the network to apply.`);
    }
    void refresh();
    return sendJson(res, 200, { changed: after !== before });
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
  if (path === "/api/editor/picture") {
    if (body.kind !== "map" && body.kind !== "game") return sendJson(res, 400, { error: 'expected {kind: "map" | "game"}' });
    const result = await pictureEditor(body.kind);
    if (!result.ok) return sendJson(res, 409, { error: result.error ?? "no map editor is running" });
    note(`Map editor: saved the newest screenshot as ${body.kind === "map" ? "the map's preview" : "the game's picture"}.`);
    void refresh();
    return sendJson(res, 200, { ok: true });
  }
  if (path === "/api/editor/guests") {
    if (typeof body.name !== "string" || typeof body.on !== "boolean") return sendJson(res, 400, { error: "expected {name, on: true|false}" });
    const result = await setEditorGuest(body.name, body.on);
    if (!result.ok) return sendJson(res, 409, { error: result.error ?? "no map editor is running" });
    note(body.on ? `Map editor: ${body.name.trim()} is a guest now.` : `Map editor: ${body.name.trim()} is no longer a guest.`);
    void refresh();
    return sendJson(res, 200, { ok: true });
  }
  // A Maps page or a map viewer is open (each says so every half minute): the editor warms up.
  // A map picked there, or opened in a viewer, is the one to have open in Edit.
  if (path === "/api/editor/warm") {
    warmUp.wantedAt = Date.now();
    const target = typeof body.target === "string" ? body.target : "";
    const map = typeof body.map === "string" ? body.map : "";
    if (body.pick === true && mapJsonPath(repoRoot, target, map)) {
      warmUp.map = `${target}/${map}`;
      warmUp.paused = false;
    }
    void refresh();
    return sendJson(res, 200, { ok: true });
  }
  if (path === "/api/viewer/in-game") {
    const target = typeof body.target === "string" ? body.target : "";
    const map = typeof body.map === "string" ? body.map : "";
    const json = mapJsonPath(repoRoot, target, map);
    if (!json || !existsSync(json)) return sendJson(res, 404, { error: `there's no map ${target}/${map} in the map store` });
    if (dockerState !== "running") return sendJson(res, 409, { error: "Docker is not running" });
    const result = await openInGame(target, map, body.stopNetwork === true);
    void refresh();
    return sendJson(res, result.status, result.body);
  }
  if (path === "/api/editor/stop") {
    if (!(await stopEditor())) return sendJson(res, 409, { error: "no map editor is running" });
    // Shut down by hand: the warm-up leaves it off until a map is picked again.
    warmUp.paused = true;
    note("Map editor: shutting down (Edit saves first)...");
    void refresh();
    return sendJson(res, 202, { ok: true });
  }
  if (path === "/api/panel/restart") {
    if (selectFromAbove.busy > 0) return sendJson(res, 409, { error: "a map is being cut out of a world (Select from above): restart once it's done" });
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
    // node:sqlite (the map store) is stable enough for us but still prints an experimental warning.
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", join("tools", "editor", "editor.ts")], {
      cwd: repoRoot,
      // Its status says the Panel booted it, so the warm-up shuts it down once nobody uses it.
      env: { ...process.env, MINECADE_EDITOR_FROM: "panel" },
      detached: true,
      stdio: ["ignore", out, out],
      windowsHide: true,
    });
    child.on("exit", (code) => {
      if (code === 0) return;
      warmUp.failedAt = Date.now();
      note(`Map editor: stopped with exit code ${code}. Its log is on the Logs page.`);
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
/** The last stats the orchestrator gave, kept so the Players page lists everyone while the network is stopped. */
const statsCachePath = join(dataDir, "stats.json");

async function fetchStats(): Promise<{ status: number; body: unknown }> {
  const answer = await fetchLiveStats();
  if (answer.status === 200) {
    await writeFile(statsCachePath, JSON.stringify({ at: new Date().toISOString(), stats: answer.body })).catch(() => undefined);
    return answer;
  }
  // The network is down: the stats as they were, saying when, and why they aren't live.
  const cached = await readFile(statsCachePath, "utf8").then((text) => JSON.parse(text) as { at: string; stats: Record<string, unknown> }).catch(() => undefined);
  if (cached) return { status: 200, body: { ...cached.stats, cachedAt: cached.at, liveError: (answer.body as { error?: string }).error } };
  return answer;
}

async function fetchLiveStats(): Promise<{ status: number; body: unknown }> {
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
/** On its way out: no windows for a while. */
let exiting = false;
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
    // A map being cut out of a world keeps the Panel up until it's done.
    if (!exiting && shouldExit({ now: Date.now(), startedAt, windows: windows.size, lastWindowAt, busy: busy !== null || selectFromAbove.busy > 0 })) {
      exiting = true;
      void (async () => {
        // A map editor the Panel booted goes with it, unless someone is on it (Edit saves first).
        const status = await editorStatus(500);
        if (status?.booted && status.fromPanel && editorPeople(status) === 0) {
          log("shutting down the map editor it booted: nobody is on it");
          await stopEditor();
        }
        log("no windows open; exiting");
        for (const follower of followers.values()) follower.stop();
        process.exit(0);
      })();
    }
  }, 5000);
});

process.on("uncaughtException", (error) => {
  log(`crashed: ${error.stack ?? String(error)}`);
  process.exit(1);
});
