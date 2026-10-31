// Map editor host logic with no I/O, kept apart from the session so it can be unit-tested.
import type { MapConfig, SelectionInfo } from "@minecade/minigame-core/config";

/** The editor server's port (TCP and UDP), the network's spare one. */
export const EDITOR_PORT = 19134;
/** The host's control port on this PC: status, save, switch and stop, for the Panel and `npm run editor`. */
export const CONTROL_PORT = 8097;
export const CONTAINER_NAME = "minecade-editor";
/** A map id is a folder name in maps/: lower case letters, digits, _ and -. */
const MAP_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** What the running editor reports on its control port: the Panel shows it, and `npm run editor -- status` prints it. */
export type EditorStatus = EditStatus | SelectStatus;

interface StatusBase {
  state: "starting" | "ready" | "stopping" | "stopped" | "failed";
  error?: string;
  /** The address to join from this network: "<LAN_HOST>:19134". */
  join: string;
  players: string[];
  editors: string[];
  /** The session's recent log lines, oldest first. */
  log: string[];
  startedAt: string;
}

export interface EditStatus extends StatusBase {
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

export interface SelectStatus extends StatusBase {
  mode: "select";
  /** The world's name, and the folder it was opened from. */
  world: string;
  worldPath: string;
  /** The maps boxed in this world, and how their extractions are going. */
  selections: SelectionInfo[];
}

/** What the runner (editor.ts) starts next, after a switch. */
export type NextSession = { mode: "edit"; target: string; map: string } | { mode: "select"; world: string };

export type EditorArgs =
  | { command: "edit"; target: string; map: string; fresh: boolean; verbose: boolean }
  | { command: "select"; world: string; verbose: boolean }
  | { command: "status" | "save" | "stop" }
  | { command: "help"; error?: string };

export const USAGE = `Usage:
  npm run editor -- <target> <map>          edit a map (target: lobby or a game id), for example: sumo arena_1
  npm run editor -- <target> <map> --new    a new draft map: a void world with a glass pad
  npm run editor -- select "<world>"        Select mode: box maps in a converted world (its name in
                                            Minecraft, its folder, or a .mcworld file)
  npm run editor -- status                  what the running editor is doing
  npm run editor -- save                    save the running editor's world into the map now
  npm run editor -- stop                    stop the running editor (it saves first)
Add --verbose to echo the server console.`;

export function parseArgs(argv: string[]): EditorArgs {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const words = argv.filter((arg) => !arg.startsWith("--"));
  const unknown = [...flags].filter((flag) => !["--new", "--verbose", "--help"].includes(flag));
  if (unknown.length > 0) return { command: "help", error: `unknown option ${unknown.join(", ")}` };
  if (flags.has("--help") || words.length === 0) return { command: "help" };
  if (words[0] === "select") {
    const world = words.slice(1).join(" ").trim();
    return world ? { command: "select", world, verbose: flags.has("--verbose") } : { command: "help", error: "select needs a world: its name, its folder or a .mcworld file" };
  }
  if (words.length === 1 && (words[0] === "status" || words[0] === "save" || words[0] === "stop")) return { command: words[0] };
  if (words.length !== 2) return { command: "help", error: "expected a target and a map" };
  const [target, map] = words;
  if (!isMapId(map)) return { command: "help", error: `"${map}" is not a map id: use lower case letters, digits, _ and -` };
  return { command: "edit", target, map, fresh: flags.has("--new"), verbose: flags.has("--verbose") };
}

/** A map id: lower case letters, digits, _ and -, as a folder in maps/. */
export function isMapId(map: string): boolean {
  return MAP_ID.test(map);
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

/** A new map's map.json: a draft named after its id, with one spawn above the glass pad. */
export function newMapConfig(mapId: string): MapConfig {
  const name = mapId.split(/[_-]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
  return { name: name || mapId, draft: true, spawns: [[0, 65, 0]] };
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
