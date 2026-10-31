// Messages between the map editor's pack (editor/) and its host tool (tools/editor/), over the
// server console the way the log transport works: the pack writes "[EDIT] {json}" lines to the
// server log, and the host answers with "scriptevent minecade:edit {json}" typed into the console.
// A whole map.json (or the editor lobby's state) can be longer than one scriptevent carries, so it
// travels in parts. The same pack runs in four modes: the editor lobby (home: the form that opens
// maps and worlds), Edit (one map), Select (boxing maps in a converted world) and Extract (a server
// with no players that moves a box to the middle, for the host's extraction).
import type { Box, MapConfig, Vec3 } from "./map-config.ts";
import type { MapEdit } from "./map-edit.ts";
import type { MapRules } from "./map-validate.ts";
import { MAX_MESSAGE_CHARS } from "./protocol/messages.ts";

export const EDIT_SCRIPT_EVENT_ID = "minecade:edit";
export const EDIT_LOG_MARKER = "[EDIT] ";

/** The rules a map is checked against, with each team's § color for its markers. */
export type EditorRules = Omit<MapRules, "teams"> & { teams?: { id: string; name: string; color: string }[] };

/** What the host tells the pack at start: editor.json, passed in as the "editor" server variable. */
export type EditorInfo = HomeInfo | EditInfo | SelectInfo | ExtractInfo;

/** The editor lobby: a black screen and a form that opens maps and worlds on the other servers. */
export interface HomeInfo {
  mode: "home";
  home: HomeState;
}

/** Edit mode: one map. */
export interface EditInfo {
  mode: "edit";
  /** "lobby", or a game id. */
  target: string;
  /** "Lobby", or the game's name. */
  targetName: string;
  map: string;
  rules: EditorRules;
  /** A new world: the pack lays a glass pad under the first spawn. */
  fresh: boolean;
  /** The converted world the map came from, when Select mode can open it again (Back to Select). */
  from?: string;
}

/** Select mode: a converted world, to box maps in. */
export interface SelectInfo {
  mode: "select";
  /** The world's name. */
  world: string;
  /** What a map can be saved for: the lobby and each game, with the map ids each has already. */
  targets: { id: string; name: string; maps: string[] }[];
  /** The maps boxed in this world so far. */
  selections: SelectionInfo[];
}

/** Extract mode: a server with no players that moves one box for the host's extraction. */
export interface ExtractInfo {
  mode: "extract";
}

/** A map boxed in Select mode, and how its extraction is going. */
export interface SelectionInfo {
  target: string;
  targetName: string;
  map: string;
  name: string;
  /** In the world's own coordinates. */
  box: Box;
  /** "ready" once its world and map.json are written; "updating" while Update redoes its world. */
  status: "queued" | "extracting" | "ready" | "failed" | "updating";
  error?: string;
}

/**
 * Something to open: a map in Edit (a new one, in an empty world, with `fresh`), a world in Select
 * (a world from the catalog by its id; none means the world the map in Edit came from), or the
 * editor lobby.
 */
export type OpenRequest =
  | { to: "edit"; target: string; map: string; fresh?: { name: string } }
  | { to: "select"; world?: string }
  | { to: "home" };

/** The editor lobby's form: what can be opened, and what's open now. */
export interface HomeState {
  catalog: Catalog;
  servers: ServersInfo;
}

export interface Catalog {
  /** The lobby and each game, with their maps. */
  targets: { id: string; name: string; maps: { id: string; name: string; draft: boolean }[] }[];
  /** The client's worlds: `id` is the world's folder name, and `maps` how many maps came from it. */
  worlds: { id: string; name: string; maps: number }[];
  /** What was opened lately, newest first. */
  recent: RecentEntry[];
}

export type RecentEntry = { request: Extract<OpenRequest, { to: "edit" | "select" }>; label: string };

/** The Select and Edit servers, when one is open, and who waits for one to be ready. */
export interface ServersInfo {
  select?: ServerInfo;
  edit?: ServerInfo;
  waiting: { name: string; label: string }[];
}

export interface ServerInfo {
  /** What opens it (its openKey() tells a pick of the same thing from another). */
  request: Extract<OpenRequest, { to: "edit" | "select" }>;
  /** "Datapacking (imported)", or "Sumo: Arena (arena_1)". */
  label: string;
  state: "starting" | "ready" | "stopping";
  players: string[];
}

/** What the pack tells the host. */
export type EditorEvent =
  /** The pack has loaded and swept up markers an earlier run left behind. */
  | { t: "ready" }
  /** A change to map.json, already shown in game. `seq` counts the pack's edits from 1. */
  | { t: "edit"; seq: number; by: string; edit: MapEdit }
  | { t: "undo"; by: string }
  | { t: "redo"; by: string }
  /** The pack's copy differs from the host's: send the whole map.json again. */
  | { t: "resync" }
  /** Save the world now (the Save button). map.json is written on every change already. */
  | { t: "save"; by: string }
  /** Publish the map: no longer a draft, saved, then its folder committed and pushed (the checklist's Publish). */
  | { t: "publish"; by: string }
  /** Play the map as the real game on Select's port, then come back (the map menu's Preview). */
  | { t: "preview"; by: string }
  /** Blocks changed, so the world has changes to save. Sent at most every few seconds. */
  | { t: "changed"; by: string }
  /** The answer to "cleanup": how many markers are still in the world (the world is saved only at 0). */
  | { t: "clean"; id: number; left: number; error?: string }
  /** Select mode: extract this box as a new map. `spawn` (where the player stood) becomes its first spawn. */
  | { t: "saveMap"; by: string; box: Box; target: string; map: string; name: string; spawn: Vec3 }
  /** Select mode: try a failed extraction again, forget a map in the list, or redo a map's world from this world. */
  | { t: "mapAction"; by: string; action: "retry" | "forget" | "update"; target: string; map: string }
  /** Open a map or a world (on its server), or go to the editor lobby. */
  | { t: "open"; by: string; request: OpenRequest }
  /** Extract mode: the box was moved (or why not). */
  | { t: "extracted"; ok: boolean; error?: string; tiles?: number; drops?: number };

/** What the host tells the pack. */
export type HostMessage =
  /** One part of the whole map.json, after the host applied the pack's edits up to `seq`. */
  | { t: "config"; id: number; seq: number; part: number; parts: number; data: string }
  /** One part of the editor lobby's whole HomeState. */
  | { t: "home"; id: number; part: number; parts: number; data: string }
  /** The host applied edit `seq`; `hash` is mapHash() of its copy afterwards. */
  | { t: "ack"; seq: number; hash: string }
  /** Undo and redo (what each would change), whether blocks changed since the last save, and whether a save or a publish is running. */
  | { t: "status"; undo?: string; redo?: string; unsaved: boolean; saving: boolean; publishing?: boolean }
  /** A chat line for one player, or for everyone when `to` is absent. */
  | { t: "say"; to?: string; text: string }
  /** A line above the hotbar for everyone here, with a chime: news such as a map that's ready. */
  | { t: "notice"; text: string }
  /** Remove every marker (the world is about to be saved), then answer with "clean". */
  | { t: "cleanup"; id: number }
  /** A save while running is done: show the markers again. */
  | { t: "resume" }
  /** Select mode: a map in the list is new or changed (one at a time, so a long list never outgrows a message). */
  | { t: "selection"; item: SelectionInfo }
  /** Select mode: a map left the list. */
  | { t: "forgotten"; target: string; map: string }
  /** Send these players to the editor server on `port` (`label` says what's there). */
  | { t: "goto"; players: string[]; port: number; label: string }
  /** Extract mode: move `box` by `offset`, clearing the box's chunks around it, then answer with "extracted". */
  | { t: "extract"; box: Box; offset: Vec3 };

const EVENT_TYPES = new Set(["ready", "edit", "undo", "redo", "resync", "save", "publish", "preview", "changed", "clean", "saveMap", "mapAction", "open", "extracted"]);
const MESSAGE_TYPES = new Set(["config", "home", "ack", "status", "say", "notice", "cleanup", "resume", "selection", "forgotten", "goto", "extract"]);

// BDS prints script console output as "[<time> <LEVEL>] [Scripting] <text>". Requiring that prefix
// means "[EDIT]" anywhere else in the log (a player's chat, a command) is never taken for an event.
const EDIT_LINE = /^\[[^\]]*\] \[Scripting\] \[EDIT\] (.*)$/;

/** The JSON of an "[EDIT]" line, or undefined for any other log line. */
export function extractEditPayload(line: string): string | undefined {
  return EDIT_LINE.exec(line.trimEnd())?.[1];
}

export function parseEditorEvent(json: string): EditorEvent | undefined {
  return parseTyped(json, EVENT_TYPES) as EditorEvent | undefined;
}

export function parseHostMessage(json: string): HostMessage | undefined {
  return parseTyped(json, MESSAGE_TYPES) as HostMessage | undefined;
}

function parseTyped(json: string, types: Set<string>): { t: string } | undefined {
  try {
    const value = JSON.parse(json) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const t = (value as { t?: unknown }).t;
    return typeof t === "string" && types.has(t) ? (value as { t: string }) : undefined;
  } catch {
    return undefined;
  }
}

/** What a request opens, as one string: the same map or world gives the same key. */
export function openKey(request: OpenRequest): string {
  if (request.to === "edit") return `edit:${request.target}/${request.map}`;
  return request.to === "select" ? `select:${request.world ?? ""}` : "home";
}

/** A short fingerprint of a map.json (FNV-1a of its JSON), so both sides can tell they agree. */
export function mapHash(config: MapConfig): string {
  const text = JSON.stringify(config);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The whole map.json as "config" messages, each within the scriptevent size limit. */
export function splitConfig(config: MapConfig, seq: number, id: number): HostMessage[] {
  const pieces = splitText(JSON.stringify(config), (data) => ({ t: "config", id, seq, part: 9999, parts: 9999, data }));
  return pieces.map((data, part) => ({ t: "config", id, seq, part, parts: pieces.length, data }));
}

/** The editor lobby's whole state as "home" messages, each within the scriptevent size limit. */
export function splitHome(state: HomeState, id: number): HostMessage[] {
  const pieces = splitText(JSON.stringify(state), (data) => ({ t: "home", id, part: 9999, parts: 9999, data }));
  return pieces.map((data, part) => ({ t: "home", id, part, parts: pieces.length, data }));
}

/** `text` in pieces that each fit one message once `wrap` puts them in one. */
function splitText(text: string, wrap: (data: string) => HostMessage): string[] {
  const pieces: string[] = [];
  for (let start = 0; start < text.length || pieces.length === 0; ) {
    // Quotes and backslashes grow when the piece is quoted again, so shrink until it fits.
    let size = Math.min(text.length - start, MAX_MESSAGE_CHARS - 100);
    while (size > 1 && JSON.stringify(wrap(text.slice(start, start + size))).length > MAX_MESSAGE_CHARS) size = Math.floor(size * 0.8);
    pieces.push(text.slice(start, start + size));
    start += size;
  }
  return pieces;
}

/** Puts the parts of one kind of message back together. A newer transfer replaces an unfinished older one. */
export class PartsAssembler {
  private id = -1;
  private parts: string[] = [];

  /** The whole text once the last part of a transfer arrives, else undefined. */
  add(message: { id: number; part: number; parts: number; data: string }): string | undefined {
    if (message.id !== this.id) {
      this.id = message.id;
      this.parts = [];
    }
    this.parts[message.part] = message.data;
    for (let part = 0; part < message.parts; part++) if (this.parts[part] === undefined) return undefined;
    const text = this.parts.slice(0, message.parts).join("");
    this.parts = [];
    this.id = -1;
    return text;
  }
}

/** Puts "config" parts back together. */
export class ConfigAssembler {
  private readonly parts = new PartsAssembler();

  /** The whole map.json and its seq once the last part of a transfer arrives, else undefined. */
  add(message: Extract<HostMessage, { t: "config" }>): { config: MapConfig; seq: number } | undefined {
    const text = this.parts.add(message);
    if (text === undefined) return undefined;
    try {
      return { config: JSON.parse(text) as MapConfig, seq: message.seq };
    } catch {
      return undefined;
    }
  }
}
