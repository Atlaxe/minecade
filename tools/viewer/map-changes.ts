// The map viewer's changes to a map: edits, undo and redo, Save and Publish (pass V.5). A map open
// in game Edit is changed through the map editor (its control port's POST /edit, /undo and /redo,
// and its Save and Publish), so markers move in game at once and there's one writer. Any other map
// the Panel changes itself, the way game Edit does: map.json written in the hand-written style
// with the file's own line endings, an undo history per map (a change made elsewhere since is one
// step of it), and versions and publishes through the map store.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { MapEditError, applyEdit, describeEdit, formatMapConfig, mapChecklist, type MapConfig, type MapEdit } from "@minecade/minigame-core/config";
import { editorStatus, outerChange, publishEditor, saveEditor } from "../editor/control.ts";
import { History, withLineEndings, type EditorStatus } from "../editor/editor-core.ts";
import { loadTarget } from "../editor/targets.ts";
import { storeDir } from "../maps/paths.ts";
import { MapStore } from "../maps/store.ts";
import { VIEWER_BY, markupProblem, viewerEdit } from "./edit-check.ts";
import { mapJsonPath, stampOf } from "./map-data.ts";

/** How the Panel reaches the map editor (tests give a fake). */
export interface EditorLink {
  status(): Promise<EditorStatus | undefined>;
  /** POST /edit, /undo or /redo: the HTTP status (0 when no editor answers) and the answer. */
  change(path: "/edit" | "/undo" | "/redo", body: Record<string, unknown>): Promise<{ status: number; answer: Record<string, unknown> }>;
  save(): Promise<{ ok: boolean; error?: string }>;
  publish(): Promise<{ ok: boolean; error?: string }>;
}

const EDITOR: EditorLink = {
  status: () => editorStatus(1000),
  change: outerChange,
  save: saveEditor,
  publish: publishEditor,
};

/** A change's result: the map after it (and through what), or why not (with the map as it is, when there is one). */
export type ChangeAnswer =
  | { status: 200; config: MapConfig; stamp?: string; undo?: string; redo?: string; note?: string; via: "panel" | "editor" }
  | { status: 400 | 404 | 409 | 422; error: string; config?: MapConfig };

export type MessageAnswer = { status: 200 | 202; message: string; config?: MapConfig } | { status: 400 | 404 | 409 | 422 | 500; error: string };

const NOT_OPEN_YET = "the map editor running is older than the viewer: restart it (Restart in the Map editor section of the Panel's Servers page) to change the map open in Edit from here";

export class MapChanges {
  /** Each map's undo history and map.json as last written or read, by its path. */
  private readonly maps = new Map<string, { history: History; text: string }>();
  private readonly root: string;
  private readonly editor: EditorLink;

  constructor(root: string, editor: EditorLink = EDITOR) {
    this.root = root;
    this.editor = editor;
  }

  async edit(target: string, map: string, raw: unknown): Promise<ChangeAnswer> {
    const edit = viewerEdit(raw);
    if (typeof edit === "string") return { status: 400, error: edit };
    const path = this.path(target, map);
    if (typeof path !== "string") return path;
    // The rules game Edit's tools keep (a region's size, the build limit's order), against the map as it is.
    const current = this.read(path);
    if ("error" in current) return current;
    const problem = markupProblem(current.config, edit, (await loadTarget(this.root, target)).rules.requires);
    if (problem) return { status: 422, error: problem, config: current.config };
    const through = await this.throughEditor("/edit", { target, map, edit, by: VIEWER_BY }, target, map, path);
    if (through) return through;
    return this.change(path, (config) => applyEdit(config, edit), describeEdit(edit));
  }

  async step(target: string, map: string, kind: "undo" | "redo"): Promise<ChangeAnswer> {
    const path = this.path(target, map);
    if (typeof path !== "string") return path;
    const through = await this.throughEditor(kind === "undo" ? "/undo" : "/redo", { target, map, by: VIEWER_BY }, target, map, path);
    // Game Edit has nothing to undo, but the Panel may: changes made here before Edit had the map
    // (while it was opening it). Written to map.json, Edit takes them as a change made elsewhere.
    const editorHasNone = through?.status === 422 && through.error === `Nothing to ${kind}.`;
    if (through && !editorHasNone) return through;
    const read = this.read(path);
    if ("error" in read) return read;
    const state = this.state(path, read.text);
    const step = kind === "undo" ? state.history.undo(read.config) : state.history.redo(read.config);
    if (!step) return editorHasNone && through ? through : { status: 409, error: `Nothing to ${kind}.`, config: read.config };
    const text = this.write(path, step.config, read.text);
    return { status: 200, config: step.config, stamp: stampOf(text), ...this.labels(state), note: `${kind === "undo" ? "Undid" : "Redid"}: ${step.label}`, via: "panel" };
  }

  /** Keeps the map as a version in the map store (the world too, through the editor, when game Edit has it open). */
  async save(target: string, map: string): Promise<MessageAnswer> {
    const path = this.path(target, map);
    if (typeof path !== "string") return path;
    if (await this.openInEdit(target, map)) {
      const saved = await this.editor.save();
      return saved.ok ? { status: 202, message: "Saving in game Edit: the world and the map are kept as a version." } : { status: 409, error: saved.error ?? "game Edit couldn't save" };
    }
    const store = MapStore.open(storeDir(this.root));
    try {
      const { version, created } = store.saveVersion(target, map, "save", VIEWER_BY);
      return { status: 200, message: created ? `Saved as version ${version}.` : `No changes since version ${version}.` };
    } finally {
      store.close();
    }
  }

  /**
   * Publishes the map as game Edit's Publish does: refused until its checklist is done, then no
   * longer a draft (an undo step), kept as a version, published, and the store's published\ written.
   */
  async publish(target: string, map: string): Promise<MessageAnswer> {
    const path = this.path(target, map);
    if (typeof path !== "string") return path;
    if (await this.openInEdit(target, map)) {
      const published = await this.editor.publish();
      return published.ok ? { status: 202, message: "Publishing in game Edit: it saves the world first, and its chat and log say when it's done." } : { status: 409, error: published.error ?? "game Edit couldn't publish" };
    }
    const read = this.read(path);
    if ("error" in read) return read;
    const rules = (await loadTarget(this.root, target)).rules;
    const checklist = mapChecklist(read.config, rules);
    if (!checklist.ready) return { status: 409, error: `Not ready to publish: ${checklist.problems.join("; ")}` };
    let config = read.config;
    if (config.draft === true) {
      const undrafted = this.change(path, (current) => applyEdit(current, { op: "draft", draft: false }), describeEdit({ op: "draft", draft: false }));
      if (undrafted.status !== 200) return { status: undrafted.status, error: undrafted.error };
      config = undrafted.config;
    }
    const store = MapStore.open(storeDir(this.root));
    try {
      const result = store.publish(target, map, VIEWER_BY);
      if (result.outcome === "unchanged") return { status: 200, message: `${config.name} has no changes since it was last published (version ${result.version}).`, config };
      let catalog = 1;
      try {
        catalog = store.exportPublished().catalog;
      } catch (error) {
        return { status: 200, message: `${config.name} is published (version ${result.version}), but the store's published folder wasn't written (${error instanceof Error ? error.message : String(error)}): the Panel's Start writes it again.`, config };
      }
      const after =
        target === "lobby"
          ? "The Panel's lobby map picker has it."
          : catalog > 0
            ? "The lobby's map list changes at the network's next Start (a rebuild): the map is new, or its name, picture or blocks are."
            : "The next game on it plays this version: no rebuild needed.";
      return { status: 200, message: `${config.name} is published (version ${result.version}). ${after}`, config };
    } finally {
      store.close();
    }
  }

  /** The map's map.json path, or why there's none. */
  private path(target: string, map: string): string | { status: 400 | 404; error: string } {
    const path = mapJsonPath(this.root, target, map);
    if (!path) return { status: 400, error: "expected {target, map} as ids" };
    if (!existsSync(path)) return { status: 404, error: `there's no map ${target}/${map} in the map store` };
    return path;
  }

  /**
   * Sends a change to the map editor: its answer when game Edit has the map open (or is opening it,
   * or runs older code that has it open), else undefined, and the Panel makes the change itself.
   */
  private async throughEditor(route: "/edit" | "/undo" | "/redo", body: Record<string, unknown>, target: string, map: string, path: string): Promise<ChangeAnswer | undefined> {
    const { status, answer } = await this.editor.change(route, body);
    const error = typeof answer.error === "string" ? answer.error : `the map editor answered HTTP ${status}`;
    if (status === 200) {
      return { status: 200, config: answer.config as MapConfig, ...(typeof answer.undo === "string" ? { undo: answer.undo } : {}), ...(typeof answer.redo === "string" ? { redo: answer.redo } : {}), ...(typeof answer.note === "string" ? { note: answer.note } : {}), via: "editor" };
    }
    if (status === 0 || (status === 409 && answer.notOpen === true)) return undefined;
    if (status === 404) return (await this.openInEdit(target, map)) ? { status: 409, error: NOT_OPEN_YET } : undefined;
    const read = this.read(path);
    return { status: status === 422 ? 422 : status === 400 ? 400 : 409, error, ...("config" in read ? { config: read.config } : {}) };
  }

  private async openInEdit(target: string, map: string): Promise<boolean> {
    const edit = (await this.editor.status())?.edit;
    return edit !== undefined && edit.target === target && edit.map === map;
  }

  /** Applies a change to map.json as it is now, as one undo step. */
  private change(path: string, change: (config: MapConfig) => MapConfig, label: string): ChangeAnswer {
    const read = this.read(path);
    if ("error" in read) return read;
    let next: MapConfig;
    try {
      next = change(read.config);
    } catch (error) {
      if (error instanceof MapEditError) return { status: 422, error: error.message, config: read.config };
      throw error;
    }
    const state = this.state(path, read.text);
    state.history.record(read.config, `${label} (${VIEWER_BY})`);
    const text = this.write(path, next, read.text);
    return { status: 200, config: next, stamp: stampOf(text), ...this.labels(state), via: "panel" };
  }

  private read(path: string): { text: string; config: MapConfig } | { status: 422; error: string } {
    const text = readFileSync(path, "utf8");
    try {
      return { text, config: JSON.parse(text) as MapConfig };
    } catch {
      return { status: 422, error: "map.json isn't valid JSON right now: fix it by hand first" };
    }
  }

  /** The map's history, with a change made elsewhere since (game Edit, a hand edit) as a step of its own. */
  private state(path: string, text: string): { history: History; text: string } {
    let state = this.maps.get(path);
    if (!state) {
      state = { history: new History(), text };
      this.maps.set(path, state);
    } else if (state.text !== text) {
      try {
        state.history.record(JSON.parse(state.text) as MapConfig, "a change made elsewhere");
      } catch {
        // The text before wasn't a map: nothing to go back to.
      }
      state.text = text;
    }
    return state;
  }

  /** Writes map.json as game Edit does; returns the text written. */
  private write(path: string, config: MapConfig, previous: string): string {
    const text = withLineEndings(formatMapConfig(config), previous);
    if (text !== previous) writeFileSync(path, text);
    const state = this.maps.get(path);
    if (state) state.text = text;
    return text;
  }

  private labels(state: { history: History }): { undo?: string; redo?: string } {
    return { ...(state.history.undoLabel ? { undo: state.history.undoLabel } : {}), ...(state.history.redoLabel ? { redo: state.history.redoLabel } : {}) };
  }
}
