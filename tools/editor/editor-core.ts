// Map editor host logic with no I/O, kept apart from the sessions so it can be unit-tested.
import { openKey, type MapConfig, type OpenRequest, type RecentEntry, type SelectionInfo, type ServersInfo } from "@minecade/minigame-core/config";

/** The host's control port on this PC: status, save, open and stop, for the Panel and `npm run editor`. */
export const CONTROL_PORT = 8097;
/** A map id is a folder name in maps/: lower case letters, digits, _ and -. */
const MAP_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/** How many recently opened maps and worlds are kept (the editor lobby shows a few). */
const RECENT_KEPT = 5;

export type SlotId = "home" | "select" | "edit";

/**
 * One of the editor's three servers. They take the network's three ports (the network is stopped
 * while the editor runs), each with the identity players already trust on that port, so joining
 * them never asks again.
 */
export interface Slot {
  id: SlotId;
  port: number;
  container: string;
  identity: string;
  /** In the log: "Lobby", "Select" or "Edit". */
  label: string;
}

export const SLOTS: Record<SlotId, Slot> = {
  home: { id: "home", port: 19132, container: "minecade-editor-lobby", identity: "lobby", label: "Lobby" },
  select: { id: "select", port: 19133, container: "minecade-editor-select", identity: "game", label: "Select" },
  edit: { id: "edit", port: 19134, container: "minecade-editor-edit", identity: "editor", label: "Edit" },
};

/** One server's state. */
export type ServerState = "starting" | "ready" | "stopping" | "stopped" | "failed";

/** What one of the editor's servers reports. */
export interface ServerStatus {
  state: ServerState;
  error?: string;
  /** The address to join it from this network: "<LAN_HOST>:<port>". */
  join: string;
  players: string[];
  editors: string[];
  startedAt: string;
}

export interface EditStatus extends ServerStatus {
  mode: "edit";
  target: string;
  targetName: string;
  map: string;
  mapName: string;
  draft: boolean;
  /** Blocks changed since the world was last saved: Save, or stopping, saves them into the map. */
  unsaved: boolean;
  /** A Save is running. */
  saving: boolean;
  undo?: string;
  redo?: string;
  checklist: { rows: { label: string; have: number; need: number; done: boolean }[]; problems: string[]; warnings: string[]; ready: boolean };
  /** The world the map came from (its name and folder), when Back to Select can open it. */
  from?: string;
  fromPath?: string;
}

export interface SelectStatus extends ServerStatus {
  mode: "select";
  /** The world's name, and the folder it was opened from. */
  world: string;
  worldPath: string;
  /** The maps boxed in this world, and how their extractions are going. */
  selections: SelectionInfo[];
}

export interface HomeStatus extends ServerStatus {
  mode: "home";
}

/** What the running editor reports on its control port: the Panel shows it, and `npm run editor -- status` prints it. */
export interface EditorStatus {
  /** Always true. A status without it comes from an editor older than the editor lobby. */
  booted: true;
  /** The editor as a whole: starting until the lobby is ready, stopping once it shuts down. */
  state: "starting" | "ready" | "stopping";
  error?: string;
  /** Where everyone joins: the editor lobby, "<LAN_HOST>:19132". */
  join: string;
  startedAt: string;
  /** Every server's log lines, oldest first. */
  log: string[];
  home: HomeStatus;
  select?: SelectStatus;
  edit?: EditStatus;
  /** Players waiting for a server, and what for. */
  waiting: ServersInfo["waiting"];
}

export type EditorArgs =
  | { command: "boot"; open?: Exclude<OpenRequest, { to: "home" }>; verbose: boolean }
  | { command: "status" | "save" | "stop" }
  | { command: "help"; error?: string };

export const USAGE = `Usage:
  npm run editor                            boot the map editor, then join LAN_HOST:19132: the editor
                                            lobby asks what to open
  npm run editor -- <target> <map>          boot it if it isn't running, and open a map in Edit
                                            (target: lobby or a game id), for example: sumo arena_1
  npm run editor -- <target> <map> --new    the same with a new draft map: a void world with a glass pad
  npm run editor -- select "<world>"        the same with a world in Select: its name in Minecraft,
                                            its folder, or a .mcworld file
  npm run editor -- status                  what the running editor is doing
  npm run editor -- save                    save the map open in Edit now
  npm run editor -- stop                    shut the editor down (Edit saves first)
Add --verbose to echo the servers' consoles. The editor takes the network's ports (19132-19134),
so stop the network first.`;

export function parseArgs(argv: string[]): EditorArgs {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const words = argv.filter((arg) => !arg.startsWith("--"));
  const unknown = [...flags].filter((flag) => !["--new", "--verbose", "--help"].includes(flag));
  if (unknown.length > 0) return { command: "help", error: `unknown option ${unknown.join(", ")}` };
  if (flags.has("--help")) return { command: "help" };
  const verbose = flags.has("--verbose");
  if (words.length === 0) return { command: "boot", verbose };
  if (words[0] === "select") {
    const world = words.slice(1).join(" ").trim();
    return world ? { command: "boot", open: { to: "select", world }, verbose } : { command: "help", error: "select needs a world: its name, its folder or a .mcworld file" };
  }
  if (words.length === 1 && (words[0] === "status" || words[0] === "save" || words[0] === "stop")) return { command: words[0] };
  if (words.length !== 2) return { command: "help", error: "expected a target and a map" };
  const [target, map] = words;
  if (!isMapId(map)) return { command: "help", error: `"${map}" is not a map id: use lower case letters, digits, _ and -` };
  return { command: "boot", open: { to: "edit", target, map, ...(flags.has("--new") ? { fresh: { name: nameFromId(map) } } : {}) }, verbose };
}

/** A map id: lower case letters, digits, _ and -, as a folder in maps/. */
export function isMapId(map: string): boolean {
  return MAP_ID.test(map);
}

/** What opening something does on the server it goes to. */
export interface OpenPlan {
  slot: "select" | "edit";
  /** The server starts on it (stopping what it had open first); false when it has it open already. */
  restart: boolean;
  /** Players on that server now: they wait in the editor lobby while it restarts. */
  evict: string[];
}

/**
 * Opening `key` (openKey() of a request for Edit or Select) on its server, which has `current` open
 * now (or nothing): the same thing open (or still starting) is just a move; anything else restarts
 * the server, and whoever is on it waits in the editor lobby meanwhile.
 */
export function planOpen(slot: "select" | "edit", key: string, current: { key: string; state: ServerState; players: string[] } | undefined): OpenPlan {
  const same = current !== undefined && current.key === key && (current.state === "starting" || current.state === "ready");
  return { slot, restart: !same, evict: same || !current ? [] : [...current.players] };
}

/** The recent list with `entry` first: no duplicates, at most a few. */
export function addRecent(list: RecentEntry[], entry: RecentEntry): RecentEntry[] {
  const key = openKey(entry.request);
  return [entry, ...list.filter((other) => openKey(other.request) !== key)].slice(0, RECENT_KEPT);
}

/** The recent list from work/editor/recent.json, keeping only entries that read right. */
export function parseRecent(text: string): RecentEntry[] {
  try {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is RecentEntry => {
      const request = (entry as Partial<RecentEntry>)?.request;
      if (typeof (entry as Partial<RecentEntry>)?.label !== "string" || !request) return false;
      if (request.to === "edit") return typeof request.target === "string" && typeof request.map === "string";
      return request.to === "select" && typeof request.world === "string";
    });
  } catch {
    return [];
  }
}

/** A running container as Docker lists it: its names and published ports. */
export interface ListedContainer {
  Names: string[];
  State: string;
  /** Null for a container with no network of its own. */
  Ports?: { PublicPort?: number }[] | null;
}

/** The running containers that publish any of `ports`, as "name (port)": the editor can't start while one does. */
export function portHolders(containers: ListedContainer[], ports: number[]): string[] {
  const holders: string[] = [];
  for (const container of containers) {
    if (container.State !== "running") continue;
    const held = [...new Set((container.Ports ?? []).map((port) => port.PublicPort).filter((port): port is number => port !== undefined && ports.includes(port)))];
    if (held.length > 0) holders.push(`${container.Names[0]?.replace(/^\//, "") ?? "a container"} (${held.sort().join(", ")})`);
  }
  return holders;
}

/** Comma-separated gamertags as one list: trimmed, without blanks or case-insensitive duplicates. */
export function nameList(...lists: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of lists.flatMap((list) => (list ?? "").split(",")).map((part) => part.trim())) {
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

/** The map editors: MAP_EDITORS, or everyone in LAN_PLAYERS when it's empty. */
export function mapEditors(env: Record<string, string>): string[] {
  const named = nameList(env.MAP_EDITORS);
  return named.length > 0 ? named : nameList(env.LAN_PLAYERS);
}

/** Who may join the editor: LAN_PLAYERS and EDITOR_ALLOW_LIST. */
export function editorAllowList(env: Record<string, string>): string[] {
  return nameList(env.LAN_PLAYERS, env.EDITOR_ALLOW_LIST);
}

/** A new map's map.json: a draft (named after its id unless it has a name), with one spawn above the glass pad. */
export function newMapConfig(mapId: string, name?: string): MapConfig {
  return { name: name?.trim() || nameFromId(mapId), draft: true, spawns: [[0, 65, 0]] };
}

/** A name from a map id: castle_keep is "Castle Keep". */
export function nameFromId(mapId: string): string {
  const name = mapId.split(/[_-]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
  return name || mapId;
}

/** `text` (written with \n) in the line endings the file had: Windows checkouts keep map.json in CRLF. */
export function withLineEndings(text: string, previous: string | undefined): string {
  return previous?.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text;
}

interface Step {
  config: MapConfig;
  /** What the step changes: "add spawns (by get a waffle)". */
  label: string;
}

/** Undo and redo for map.json: the whole map before each change, with what the change was. */
export class History {
  private readonly undos: Step[] = [];
  private redos: Step[] = [];
  private readonly limit: number;

  constructor(limit = 200) {
    this.limit = limit;
  }

  /** A change was made: `before` is the map it started from. Clears redo. */
  record(before: MapConfig, label: string): void {
    this.undos.push({ config: before, label });
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos = [];
  }

  /** The map before the last change, or undefined when there's nothing to undo. */
  undo(current: MapConfig): Step | undefined {
    const step = this.undos.pop();
    if (step) this.redos.push({ config: current, label: step.label });
    return step;
  }

  redo(current: MapConfig): Step | undefined {
    const step = this.redos.pop();
    if (step) this.undos.push({ config: current, label: step.label });
    return step;
  }

  get undoLabel(): string | undefined {
    return this.undos.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.redos.at(-1)?.label;
  }
}
