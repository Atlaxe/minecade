// Control panel logic with no I/O, kept apart from panel.ts so it can be unit-tested.

export type StackId = "spike" | "main";

export interface StackDef {
  id: StackId;
  label: string;
  /** Compose file, relative to the repo root. */
  file: string;
  /** The compose project name the file declares. */
  project: string;
  /** Generated files the stack needs before it can start (relative to the repo root). */
  requires: string[];
}

export const STACKS: readonly StackDef[] = [
  {
    id: "spike",
    label: "Spike test servers",
    file: "spike/docker-compose.spike.yml",
    project: "minecade-spike",
    requires: ["spike/world/level.dat", "spike/dist/world_behavior_packs.json"],
  },
  { id: "main", label: "Minecade network", file: "docker-compose.yml", project: "minecade", requires: [] },
];

export interface ContainerLike {
  Names: string[];
  Labels?: Record<string, string>;
}

/** Which stack a container belongs to. Anything else on this Docker engine is ignored. */
export function stackOf(container: ContainerLike): StackId | undefined {
  const project = container.Labels?.["com.docker.compose.project"];
  if (project) return STACKS.find((stack) => stack.project === project)?.id;
  // Game servers are created by the orchestrator, not by compose.
  if (container.Names.some((name) => name.startsWith("/minecade-game-"))) return "main";
  return undefined;
}

export interface PortLike {
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
  IP?: string;
}

/** "19132 tcp+udp, 127.0.0.1:8080 tcp". Docker lists IPv4 and IPv6 bindings separately. */
export function formatPorts(ports: PortLike[]): string {
  const byPort = new Map<string, Set<string>>();
  for (const port of ports) {
    if (!port.PublicPort) continue;
    const key = port.IP === "127.0.0.1" ? `127.0.0.1:${port.PublicPort}` : String(port.PublicPort);
    if (!byPort.has(key)) byPort.set(key, new Set());
    byPort.get(key)!.add(port.Type);
  }
  return [...byPort]
    .sort(([a], [b]) => portNumber(a) - portNumber(b))
    .map(([key, types]) => `${key} ${[...types].sort().join("+")}`)
    .join(", ");
}

function portNumber(key: string): number {
  return Number(key.split(":").at(-1));
}

// BDS 1.26.60 format strings (read from the bedrock_server binary):
//   "Player connected: {}, xuid: {}" and "Player disconnected: {}, xuid: {}, pfid: {}".
// Anchored right after the timestamp bracket, so a pack's "[Scripting] ..." output can't fake one.
const PLAYER_LINE = /^\[[^\]]*\] Player (connected|disconnected): ([^,]+)/;
const PLAYER_LIKE = /^\[[^\]]*\] Player (dis)?connected\b/i;
const SERVER_STARTED = /^\[[^\]]*\] Server started\./;

/** Tracks who is online from a BDS log, read from the first line. */
export class PlayerLog {
  /** True once "Server started." has been seen. */
  started = false;
  /** True if a player line no longer matches the known format. */
  formatChanged = false;
  private readonly online = new Map<string, string>();

  feed(line: string): void {
    const text = line.trimEnd();
    if (SERVER_STARTED.test(text)) {
      // A restarted container replays its earlier runs first.
      this.started = true;
      this.online.clear();
      return;
    }
    const match = PLAYER_LINE.exec(text);
    if (match) {
      const name = match[2].trim();
      if (match[1] === "connected") this.online.set(name.toLowerCase(), name);
      else this.online.delete(name.toLowerCase());
    } else if (PLAYER_LIKE.test(text)) {
      this.formatChanged = true;
    }
  }

  /** Online players, sorted, or null when the log format can no longer be trusted. */
  get players(): string[] | null {
    if (this.formatChanged) return null;
    return [...this.online.values()].sort((a, b) => a.localeCompare(b));
  }
}

// ---- .env --------------------------------------------------------------------------------

const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Reads uncommented KEY=value lines. A later line wins, as in docker compose. */
export function readEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of stripBom(text).split(/\r?\n/)) {
    const match = ENV_LINE.exec(line);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

/**
 * Sets keys in .env text. Only matching uncommented lines change; every other byte, each
 * line's ending and a leading BOM are kept. Missing keys are appended.
 */
export function setEnvValues(text: string, values: Record<string, string>): string {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = text.slice(bom.length);
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const pending = new Set(Object.keys(values));
  const chunks = body.split(/(?<=\n)/).map((chunk) => {
    const ending = /\r?\n$/.exec(chunk)?.[0] ?? "";
    const match = ENV_LINE.exec(chunk.slice(0, chunk.length - ending.length));
    if (!match || !(match[1] in values)) return chunk;
    pending.delete(match[1]);
    return `${match[1]}=${values[match[1]]}${ending}`;
  });
  let result = chunks.join("");
  if (pending.size > 0) {
    if (result.length > 0 && !result.endsWith("\n")) result += eol;
    for (const key of pending) result += `${key}=${values[key]}${eol}`;
  }
  return bom + result;
}

function stripBom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

// $ is compose variable syntax, # starts a comment, and quotes or backslashes change parsing.
const FORBIDDEN_NAME_CHARS = /[$#"'\\=\u0000-\u001f\u007f]/;

export type NormalizeResult = { ok: true; value: string } | { ok: false; error: string };

/** Cleans a comma-separated gamertag list: trims, drops blanks and case-insensitive duplicates. */
export function normalizeNames(raw: string): NormalizeResult {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (!name) continue;
    if (FORBIDDEN_NAME_CHARS.test(name)) return { ok: false, error: `"${name}" contains a character .env can't hold` };
    if (name.length > 64) return { ok: false, error: `"${name.slice(0, 20)}..." is too long for a gamertag` };
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return { ok: true, value: names.join(",") };
}

// ---- Requests and lifetime ---------------------------------------------------------------

export interface RequestInfo {
  method: string;
  host?: string;
  origin?: string;
  panelHeader?: string;
}

/**
 * Returns why a request is refused, or undefined to allow it. The Host check stops DNS
 * rebinding, the Origin check stops other sites, and the custom header on POSTs forces a
 * CORS preflight that this server never approves.
 */
export function checkRequest(request: RequestInfo, port: number): string | undefined {
  const self = `127.0.0.1:${port}`;
  if (request.host !== self) return "unexpected Host header";
  if (request.origin !== undefined && request.origin !== `http://${self}`) return "unexpected Origin header";
  if (request.method !== "GET" && request.panelHeader !== "1") return "missing X-Minecade-Panel header";
  return undefined;
}

export const EXIT_AFTER_LAST_WINDOW_MS = 15_000;
export const EXIT_BEFORE_FIRST_WINDOW_MS = 90_000;

export interface LifetimeInfo {
  now: number;
  startedAt: number;
  /** Open windows (live event streams). */
  windows: number;
  /** When the last window disconnected, or undefined if none has connected yet. */
  lastWindowAt?: number;
  /** A compose action is running. Exiting could break it halfway. */
  busy: boolean;
}

export function shouldExit(info: LifetimeInfo): boolean {
  if (info.windows > 0 || info.busy) return false;
  if (info.lastWindowAt === undefined) return info.now - info.startedAt >= EXIT_BEFORE_FIRST_WINDOW_MS;
  return info.now - info.lastWindowAt >= EXIT_AFTER_LAST_WINDOW_MS;
}
