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

/**
 * The rules a map is checked against, with each team's § color for its markers, the marker style
 * number (the editor's resource pack) of each of the game's own marker models, and what its
 * mannequins can hold (every item in the game's kits).
 */
export type EditorRules = Omit<MapRules, "teams"> & {
  teams?: { id: string; name: string; color: string }[];
  markerModels?: Record<string, number>;
  items?: { item: string; label: string }[];
};

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
  /** Each map editor's Boundaries switches (outline groups, or "all"), by lower-case gamertag. */
  view?: Record<string, string[]>;
  /** The pictures in the editor's pack, for the thumbnail menus. */
  pictures?: PictureInfo;
  /** Other games that play this game's maps (Gunfight, for a Siege map): Preview can play the map as one of them. */
  playAs?: { id: string; name: string; maxPlayers: number }[];
}

/**
 * The pictures Edit can show (they're in the editor's pack, as of when this map opened): the
 * screenshots used before (work/editor/shots, textures/minecade/shots/<id>), which of them this map
 * and its game use now, and every map with a picture (textures/minecade/maps/<target>/<map>), for
 * importing one from another game.
 */
export interface PictureInfo {
  /**
   * Newest first, with where each was used last: `map`, the map whose thumbnail it was ("Sewer"),
   * and `game`, the game whose picture it was ("Sumo"); neither when it hasn't been used yet. A
   * map's thumbnail menu offers the maps' ones, a game's the games'.
   */
  shots: { id: string; map?: string; game?: string }[];
  /** The shot this map's preview and its game's picture are, or "own" for a picture that isn't one of them; none without a picture. */
  current: { map?: string; game?: string };
  maps: { target: string; targetName: string; map: string; name: string }[];
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
 * (a world from the catalog by its id; none means the world the map in Edit came from), a preview
 * of a map from its folder (the editor lobby's Recent), or the editor lobby.
 */
export type OpenRequest =
  | { to: "edit"; target: string; map: string; fresh?: { name: string } }
  | { to: "select"; world?: string }
  | { to: "preview"; target: string; map: string; fakes?: number }
  | { to: "home" };

/** The editor lobby's form: what can be opened, and what's open now. */
export interface HomeState {
  catalog: Catalog;
  servers: ServersInfo;
}

export interface Catalog {
  /**
   * The lobby and each game, with their maps: whether a map's checklist is done (it can be
   * previewed), the client world it came from (its id in `worlds`, when that world is there),
   * whether it has a picture, and whether its folder has changes not on GitHub yet. A game says how
   * many players it takes.
   */
  targets: { id: string; name: string; maxPlayers?: number; maps: CatalogMap[] }[];
  /** The client's worlds: `id` is the world's folder name, and `maps` how many maps came from it. */
  worlds: { id: string; name: string; maps: number }[];
  /** What was opened lately, newest first. */
  recent: RecentEntry[];
}

export interface CatalogMap {
  id: string;
  name: string;
  draft: boolean;
  ready: boolean;
  world?: string;
  picture?: boolean;
  /** A minigame thumbnail map (map.json's gameThumbnail): its picture is the game's (`picture` says whether the game has one). */
  gameThumbnail?: boolean;
  /** Its folder has changes that weren't published (pushed) yet. */
  unpublished?: boolean;
}

/** Something opened or previewed lately: the lobby's Recent shows it with an icon for its kind. */
export type RecentEntry = { request: Extract<OpenRequest, { to: "edit" | "select" | "preview" }>; label: string };

/** The Select and Edit servers, when one is open, a preview on Select's port, and who waits for one to be ready. */
export interface ServersInfo {
  select?: ServerInfo;
  edit?: ServerInfo;
  preview?: { label: string; state: "starting" | "ready" | "stopping" };
  waiting: { name: string; label: string }[];
}

/**
 * A guest (set by the Panel's Players page, its Guest switch): guests may join the editor lobby and whatever runs
 * on Select's port (Select, or a preview), never Edit. `on` is where they are now, if anywhere.
 */
export interface GuestInfo {
  name: string;
  on?: "home" | "select" | "preview";
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
  /** Play the map as the real game on Select's port, then come back (the map menu's Preview), with this many fake players. */
  | { t: "preview"; by: string; fakes?: number; as?: string }
  /**
   * Blocks changed, so the world has changes to save. Sent at most every few seconds; with
   * `leftovers`, at start: markers, mannequins or boundary planes an earlier save missed were taken out.
   */
  | { t: "changed"; by: string; leftovers?: boolean }
  /** A map editor's Boundaries switches changed (kept for their next map). */
  | { t: "view"; by: string; shown: string[] }
  /** Save the newest screenshot on the host's PC as the map's preview ("map") or the game's picture ("game"), keeping it with the others used before. */
  | { t: "picture"; by: string; kind: "map" | "game" }
  /** Use a screenshot used before (PictureInfo.shots) as the map's preview or the game's picture. */
  | { t: "thumbnail"; by: string; kind: "map" | "game"; shot: string }
  /** Use another map's preview picture as this map's. */
  | { t: "importPicture"; by: string; target: string; map: string }
  /** Give the map open in Edit another map id: Edit saves and opens again under it. */
  | { t: "renameMap"; by: string; map: string }
  /** The answer to "cleanup": how many markers are still in the world (the world is saved only at 0). */
  | { t: "clean"; id: number; left: number; error?: string }
  /**
   * Select mode: export this box as a new map (its spectator spawn goes above it; spawns are placed
   * in Edit). With `edit`, the host opens it in Edit once it's cut out, and moves `by` there.
   */
  | { t: "saveMap"; by: string; box: Box; target: string; map: string; name: string; edit?: boolean }
  /** Select mode: try a failed extraction again, or take a failed one off the list. */
  | { t: "mapAction"; by: string; action: "retry" | "forget"; target: string; map: string }
  /** Edit: delete the map open here (its folder, its place in Select's list, and its removal pushed when it was published). */
  | { t: "deleteMap"; by: string }
  /** Open a map or a world (on its server), or go to the editor lobby. */
  | { t: "open"; by: string; request: OpenRequest }
  /** The editor lobby's Leave: disconnect this player. */
  | { t: "leave"; by: string }
  /** Extract mode: the box was moved (or why not), and the height of its highest block (none when it held nothing). */
  | { t: "extracted"; ok: boolean; error?: string; tiles?: number; drops?: number; top?: number };

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
  /**
   * Remove every marker (the world is about to be saved), then answer with "clean". With `token`
   * (a save while the server runs), put it in a world property first: the host copies the world
   * once the save's write has it (tools/editor/world-log.ts).
   */
  | { t: "cleanup"; id: number; token?: string }
  /** A save while running is done: show the markers again. */
  | { t: "resume" }
  /** Select mode: a map in the list is new or changed (one at a time, so a long list never outgrows a message). */
  | { t: "selection"; item: SelectionInfo }
  /** Select mode: a map left the list. */
  | { t: "forgotten"; target: string; map: string }
  /** Send these players to the editor server on `port` (`label` says what's there). */
  | { t: "goto"; players: string[]; port: number; label: string }
  /** These players wait here for another server (`label` says what): the pack shows the loading screen until they're moved. */
  | { t: "loading"; players: string[]; label: string }
  /** What these players waited for didn't start: the loading screen closes. */
  | { t: "loaded"; players: string[] }
  /** Extract mode: move `box` by `offset`, clearing the box's chunks around it, then answer with "extracted". */
  | { t: "extract"; box: Box; offset: Vec3 };

const EVENT_TYPES = new Set(["ready", "edit", "undo", "redo", "resync", "save", "publish", "preview", "changed", "view", "picture", "thumbnail", "importPicture", "renameMap", "clean", "saveMap", "mapAction", "deleteMap", "open", "leave", "extracted"]);
const MESSAGE_TYPES = new Set(["config", "home", "ack", "status", "say", "notice", "cleanup", "resume", "selection", "forgotten", "goto", "loading", "loaded", "extract"]);

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

/**
 * A map named in the editor's chat: "[Sumo : Arena]", the game in gold and the map in orange, then
 * the text's color reset. Only chat uses it; menus name maps as "Sumo: Arena (arena_1)".
 */
export function chatMapName(game: string, map: string): string {
  return `§f[§g${game}§f : §6${map}§f]§r`;
}

/** What a request opens, as one string: the same map or world gives the same key. */
export function openKey(request: OpenRequest): string {
  if (request.to === "edit") return `edit:${request.target}/${request.map}`;
  if (request.to === "preview") return `preview:${request.target}/${request.map}`;
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
