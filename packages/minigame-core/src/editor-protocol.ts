// Messages between the map editor's pack (editor/) and its host tool (tools/editor/), over the
// server console the way the log transport works: the pack writes "[EDIT] {json}" lines to the
// server log, and the host answers with "scriptevent minecade:edit {json}" typed into the console.
// A whole map.json can be longer than one scriptevent carries, so it travels in parts.
import type { MapConfig } from "./map-config.ts";
import type { MapEdit } from "./map-edit.ts";
import type { MapRules } from "./map-validate.ts";
import { MAX_MESSAGE_CHARS } from "./protocol/messages.ts";

export const EDIT_SCRIPT_EVENT_ID = "minecade:edit";
export const EDIT_LOG_MARKER = "[EDIT] ";

/** The rules a map is checked against, with each team's § color for its markers. */
export type EditorRules = Omit<MapRules, "teams"> & { teams?: { id: string; name: string; color: string }[] };

/** What the host tells the pack at start: editor.json, passed in as the "editor" server variable. */
export interface EditorInfo {
  mode: "edit";
  /** "lobby", or a game id. */
  target: string;
  /** "Lobby", or the game's name. */
  targetName: string;
  map: string;
  /** Gamertags of the map editors (MAP_EDITORS, or LAN_PLAYERS when that's empty). Everyone else builds. */
  editors: string[];
  rules: EditorRules;
  /** A new world: the pack lays a glass pad under the first spawn. */
  fresh: boolean;
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
  /** Whether the world is saved when the editor stops: blocks changed, or a map editor chose it. */
  | { t: "saveWorld"; by: string; save: boolean }
  /** The answer to "cleanup": how many markers are still in the world (the world is saved only at 0). */
  | { t: "clean"; id: number; left: number; error?: string };

/** What the host tells the pack. */
export type HostMessage =
  /** One part of the whole map.json, after the host applied the pack's edits up to `seq`. */
  | { t: "config"; id: number; seq: number; part: number; parts: number; data: string }
  /** The host applied edit `seq`; `hash` is mapHash() of its copy afterwards. */
  | { t: "ack"; seq: number; hash: string }
  /** Undo and redo (what each would change), and whether the world is saved at stop. */
  | { t: "status"; undo?: string; redo?: string; saveWorld: boolean }
  /** A chat line for one player, or for everyone when `to` is absent. */
  | { t: "say"; to?: string; text: string }
  /** Remove every marker (the world is about to be saved), then answer with "clean". */
  | { t: "cleanup"; id: number };

const EVENT_TYPES = new Set(["ready", "edit", "undo", "redo", "resync", "saveWorld", "clean"]);
const MESSAGE_TYPES = new Set(["config", "ack", "status", "say", "cleanup"]);

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
  const text = JSON.stringify(config);
  const pieces: string[] = [];
  for (let start = 0; start < text.length || pieces.length === 0; ) {
    // Quotes and backslashes grow when the piece is quoted again, so shrink until it fits.
    let size = Math.min(text.length - start, MAX_MESSAGE_CHARS - 100);
    while (size > 1 && JSON.stringify({ t: "config", id, seq, part: 9999, parts: 9999, data: text.slice(start, start + size) }).length > MAX_MESSAGE_CHARS) {
      size = Math.floor(size * 0.8);
    }
    pieces.push(text.slice(start, start + size));
    start += size;
  }
  return pieces.map((data, part) => ({ t: "config", id, seq, part, parts: pieces.length, data }));
}

/** Puts "config" parts back together. A newer transfer replaces an unfinished older one. */
export class ConfigAssembler {
  private id = -1;
  private parts: string[] = [];

  /** The whole map.json and its seq once the last part of a transfer arrives, else undefined. */
  add(message: Extract<HostMessage, { t: "config" }>): { config: MapConfig; seq: number } | undefined {
    if (message.id !== this.id) {
      this.id = message.id;
      this.parts = [];
    }
    this.parts[message.part] = message.data;
    for (let part = 0; part < message.parts; part++) if (this.parts[part] === undefined) return undefined;
    const text = this.parts.slice(0, message.parts).join("");
    this.parts = [];
    this.id = -1;
    try {
      return { config: JSON.parse(text) as MapConfig, seq: message.seq };
    } catch {
      return undefined;
    }
  }
}
