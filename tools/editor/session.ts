// The Edit server: one map. Stages the map in its server container, keeps map.json in step with the
// game (it applies the pack's edits with the same code, writes the file, keeps undo and redo, and
// sends hand edits of map.json into the game), saves the world back into the map on Save (while it
// runs, with save hold), and on stop when blocks changed since the last save. The map's folder is
// in the map store (tools/maps): each world save and each stop keeps it as a version there, and
// Publish saves, then publishes it (and the game's picture) and writes the store's published\ for
// the next network build. The server itself (starting, the console, opping map editors) is
// ServerSession's.
import { randomUUID } from "node:crypto";
import { existsSync, unwatchFile, watchFile } from "node:fs";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import {
  applyEdit,
  chatMapName,
  describeEdit,
  formatMapConfig,
  mapChecklist,
  mapHash,
  splitConfig,
  type EditInfo,
  type EditorEvent,
  type MapConfig,
  type MapEdit,
} from "@minecade/minigame-core/config";
import { bakeSettings } from "../build/bake-core.ts";
import { copyDirFromContainer } from "../build/docker-util.ts";
import { enableBetaApis, patchLevelDat, readLevelDat, writeLevelDat } from "../build/leveldat.ts";
import { History, isMapId, newMapConfig, withLineEndings, type EditStatus } from "./editor-core.ts";
import type { MapStore, PublishResult } from "../maps/store.ts";
import type { PreviewMap } from "./preview-template.ts";
import { findWorld } from "./selections.ts";
import { savedWith } from "./world-log.ts";
import { RUNTIME_FILES, ServerSession, delay, message, root, type SessionBase } from "./server-session.ts";
import type { EditorTarget } from "./targets.ts";
import { pictureInfo } from "./pictures.ts";
import { keepNewestScreenshot, useShot, type ShotKind } from "./shots.ts";
import { readViews, saveView } from "./views.ts";
import type { World } from "./worlds.ts";

/** A level.dat written by BDS (bake's): a new map's void world starts from it. */
const BASE_LEVEL_DAT = join(root, "tools", "build", "fixtures", "base-level.dat");
/** How many times a held save is asked whether its files are ready, half a second apart. */
const SAVE_QUERY_ATTEMPTS = 20;
/** How many times the held world is copied, half a second apart, until the save's own write is in it. */
const SAVE_WRITE_ATTEMPTS = 40;

export interface SessionOptions extends SessionBase {
  target: EditorTarget;
  mapId: string;
  /** Make a new draft map (map.json and a void world with a glass pad), with this name. */
  fresh?: { name: string };
  /** The map store the map's folder is in. */
  store: MapStore;
}

export class EditorSession extends ServerSession {
  /** Preview in the map menu (set by the runner, which runs it). */
  onPreview: ((by: string, fakes: number, as?: string) => void) | undefined;
  /** A map editor asked to delete this map (the gear's Delete map): the runner closes Edit and deletes it. */
  onDelete: ((by: string) => void) | undefined;
  /** A map editor gave this map another id (Map settings, or a thumbnail imported with its name): the runner reopens it under that id. */
  onRename: ((by: string, map: string) => void) | undefined;
  private readonly target: EditorTarget;
  private readonly mapId: string;
  private readonly fresh: { name: string } | undefined;
  private readonly store: MapStore;
  private readonly mapDir: string;
  private readonly mapPath: string;
  private config: MapConfig = { name: "", spawns: [] };
  /** map.json as last written or read, so the file watcher can tell a hand edit from our own write. */
  private text = "";
  private badText = "";
  private readonly history = new History();
  /** Blocks changed since the world was last saved (a new map's world has never been saved). */
  private unsaved = false;
  /** The Save that is running, if one is: true once the world is saved. */
  private saving: Promise<boolean> | undefined;
  /** The Publish that is running, if one is. */
  private publishing: Promise<void> | undefined;
  /** Blocks changed while the running Save was under way, so they may not be in it. */
  private changedWhileSaving = false;
  /** The world the map came from, when it can be found: Back to Select opens it. */
  private from: World | undefined;
  /** The pack's last edit applied here. */
  private seq = 0;
  private configId = 0;
  private writing: Promise<unknown> = Promise.resolve();

  constructor(options: SessionOptions) {
    super(options);
    this.target = options.target;
    this.mapId = options.mapId;
    this.fresh = options.fresh;
    this.store = options.store;
    this.mapDir = options.store.folder(options.target.id, options.mapId);
    this.mapPath = join(this.mapDir, "map.json");
  }

  /** Saves the world into the map now, while the server runs. A second call while one runs joins it. */
  save(by: string): Promise<boolean> {
    this.saving ??= this.hotSave(by).finally(() => {
      this.saving = undefined;
      void this.sendStatus();
    });
    return this.saving;
  }

  /**
   * Publishes the map once its checklist is done: it stops being a draft, the world is saved, and the
   * map's folder is committed and pushed. A second call while one runs joins it.
   */
  publish(by: string): Promise<void> {
    this.publishing ??= this.runPublish(by).finally(() => {
      this.publishing = undefined;
      void this.sendStatus();
    });
    return this.publishing;
  }

  /** Stops at once without saving the world (map.json already has every change). */
  override async forceStop(): Promise<void> {
    this.note("Quitting without saving the world.");
    this.unsaved = false;
    await super.forceStop();
  }

  /** What a Preview builds: the game, the map (its folder and map.json as it is now), and its label. */
  /** What a preview of this map plays: its own game, or `as`, a game that borrows its maps (Gunfight, for a Siege map). */
  previewSource(as?: string): { map: PreviewMap; label: string; maxPlayers: number } {
    const borrower = this.target.borrowers?.find((game) => game.id === as);
    const game = borrower ?? { id: this.target.id, name: this.target.name, maxPlayers: this.target.rules.maxPlayers ?? 1 };
    return {
      map: { game: game.id, mapId: this.mapId, mapDir: this.mapDir, config: this.config },
      label: `${game.name}: ${this.config.name}`,
      maxPlayers: game.maxPlayers,
    };
  }

  /** Whether this is the map open: the lobby's or a game's, by id. */
  isMap(target: string, map: string): boolean {
    return this.target.id === target && this.mapId === map;
  }

  /**
   * An edit from outside the game (the Panel's map viewer, POST /edit): one undo step like a
   * player's, written to map.json and sent to the pack, so markers move in game at once. Throws a
   * MapEditError when it doesn't fit the map.
   */
  outerEdit(edit: MapEdit, by: string): { config: MapConfig; undo?: string; redo?: string } {
    const what = describeEdit(edit);
    const next = applyEdit(this.config, edit);
    this.history.record(this.config, `${what} (${by})`);
    this.config = next;
    this.writeMap();
    this.note(`${by}: ${what}`);
    void this.sendConfig();
    void this.sendStatus();
    return { config: next, undo: this.history.undoLabel, redo: this.history.redoLabel };
  }

  /** Undo or redo from outside the game (POST /undo, /redo): the map after it, or undefined when there's nothing to do. */
  outerStep(kind: "undo" | "redo", by: string): { config: MapConfig; undo?: string; redo?: string; note: string } | undefined {
    const label = this.step(kind, by);
    if (label === undefined) return undefined;
    return { config: this.config, undo: this.history.undoLabel, redo: this.history.redoLabel, note: `${kind === "undo" ? "Undid" : "Redid"}: ${label}` };
  }

  /** The world for Back to Select, or why there's none. */
  backToSelect(): World | string {
    if (this.from) return this.from;
    return this.config.source ? `the world this map came from ("${this.config.source.world}") isn't on this PC` : "this map didn't come from a world";
  }

  status(): EditStatus {
    const checklist = mapChecklist(this.config, this.target.rules);
    return {
      ...this.common(),
      mode: "edit",
      target: this.target.id,
      targetName: this.target.name,
      map: this.mapId,
      mapName: this.config.name,
      draft: this.config.draft === true,
      unsaved: this.unsaved,
      saving: this.saving !== undefined,
      publishing: this.publishing !== undefined,
      undo: this.history.undoLabel,
      redo: this.history.redoLabel,
      checklist: {
        rows: checklist.rows.map(({ label, have, need, done }) => ({ label, have, need, done })),
        problems: checklist.problems,
        warnings: checklist.warnings,
        ready: checklist.ready,
      },
      ...(this.from ? { from: this.from.name, fromPath: this.from.path } : {}),
    };
  }

  // ---- Starting ---------------------------------------------------------------------------

  protected label(): string {
    return `${this.target.name}, ${this.config.name} (${this.mapId})`;
  }

  protected async prepare(): Promise<void> {
    const path = this.mapPath;
    if (this.fresh) {
      if (existsSync(this.mapPath)) throw new Error(`${path} already exists: leave out --new to edit it`);
      await mkdir(this.mapDir, { recursive: true });
      await writeFile(this.mapPath, formatMapConfig(newMapConfig(this.mapId, this.fresh.name)));
      this.note(`Created ${path} (a draft).`);
    } else if (!existsSync(this.mapPath)) {
      throw new Error(`there is no map at ${path}: add --new to make one`);
    }
    this.text = await readFile(this.mapPath, "utf8");
    try {
      this.config = JSON.parse(this.text) as MapConfig;
    } catch (error) {
      throw new Error(`${path} is not valid JSON (${message(error)})`);
    }
    if (this.config.build) {
      this.note("This map has build commands: npm run bake rebuilds its world from them, replacing block changes. The map menu can drop them.");
    }
    if (this.config.source) this.from = await findWorld(root, this.config.source.world);
  }

  /** world/, map.json and editor.json, for /editor in the container. */
  protected async stage(dir: string): Promise<void> {
    const world = join(dir, "world");
    const source = join(this.mapDir, "world");
    const newWorld = !existsSync(join(source, "level.dat"));
    if (newWorld) {
      // A level.dat without db/ makes BDS generate every chunk from it: with the bake settings, void.
      await mkdir(world, { recursive: true });
      const dat = await readLevelDat(BASE_LEVEL_DAT);
      bakeSettings(dat, withSpawn(this.config));
      enableBetaApis(dat);
      await writeLevelDat(join(world, "level.dat"), dat);
      this.unsaved = true;
      this.note("The map has no world yet: it starts as a void world with a glass pad.");
    } else {
      await cp(source, world, { recursive: true });
      // The editor's pack reads its settings through @minecraft/server-admin, a Beta API.
      await patchLevelDat(join(world, "level.dat"), enableBetaApis);
    }
    for (const file of RUNTIME_FILES) await rm(join(world, file), { force: true });
    await writeFile(join(dir, "map.json"), JSON.stringify(this.config));
    const info: EditInfo = {
      mode: "edit",
      target: this.target.id,
      targetName: this.target.name,
      map: this.mapId,
      rules: this.target.rules,
      fresh: newWorld,
      ...(this.from ? { from: this.from.name } : {}),
      view: await readViews(root),
      pictures: await pictureInfo(root, this.target.id, this.mapId),
      ...(this.target.borrowers ? { playAs: this.target.borrowers } : {}),
    };
    await writeFile(join(dir, "editor.json"), JSON.stringify(info));
  }

  protected async afterReady(): Promise<void> {
    await this.sendConfig();
    await this.sendStatus();
    watchFile(this.mapPath, { interval: 500 }, () => void this.reloadMap());
    this.noteChecklist();
  }

  /** Changes made while it was starting (the Panel's map viewer writes map.json itself until Edit is ready) come in now. */
  protected onReady(): void {
    void this.reloadMap("changed while Edit was opening it");
  }

  // ---- Talking to the pack ----------------------------------------------------------------

  protected onEvent(event: EditorEvent): void {
    switch (event.t) {
      case "edit":
        this.applyPackEdit(event);
        return;
      case "undo":
      case "redo":
        this.step(event.t, event.by);
        return;
      case "resync":
        void this.sendConfig();
        return;
      case "save":
        void this.save(event.by);
        return;
      case "publish":
        void this.publish(event.by);
        return;
      case "preview":
        this.onPreview?.(event.by, Math.max(0, Math.trunc(event.fakes ?? 0)), typeof event.as === "string" ? event.as : undefined);
        return;
      case "deleteMap":
        this.onDelete?.(event.by);
        return;
      case "changed":
        if (event.leftovers) {
          this.note("The world had markers, mannequins or boundary planes in it that an earlier save missed. They're gone now: Save, or stopping, saves the world without them.");
          this.unsaved = true;
          void this.sendStatus();
        } else this.blocksChanged(event.by);
        return;
      case "view":
        void saveView(root, event.by, event.shown).catch((error: unknown) => this.note(`Could not keep ${event.by}'s Boundaries switches: ${message(error)}`));
        return;
      case "picture":
        void this.picture(event.by, event.kind);
        return;
      case "thumbnail":
        void this.thumbnail(event.by, event.kind, event.shot);
        return;
      case "importPicture":
        void this.importPicture(event.by, event.target, event.map);
        return;
      case "renameMap":
        this.onRename?.(event.by, event.map);
        return;
    }
  }

  private blocksChanged(by: string): void {
    if (this.saving) this.changedWhileSaving = true;
    if (this.unsaved) return;
    this.unsaved = true;
    this.note(`${by} changed blocks: Save, or stopping, saves the world into the map.`);
    void this.sendStatus();
  }

  private applyPackEdit(event: Extract<EditorEvent, { t: "edit" }>): void {
    const what = describeEdit(event.edit);
    let next: MapConfig;
    try {
      next = applyEdit(this.config, event.edit);
    } catch (error) {
      // The copies differ: the whole map puts the pack right.
      this.seq = event.seq;
      this.note(`Refused ${event.by}'s change (${what}): ${message(error)}`);
      void this.say(`That change didn't fit the map: ${message(error)}`, event.by);
      void this.sendConfig();
      return;
    }
    this.history.record(this.config, `${what} (${event.by})`);
    this.config = next;
    this.seq = event.seq;
    this.writeMap();
    this.note(`${event.by}: ${what}`);
    void this.send({ t: "ack", seq: event.seq, hash: mapHash(next) });
    void this.sendStatus();
  }

  /** Undoes or redoes the last change; its label, or undefined when there was nothing to do. */
  private step(kind: "undo" | "redo", by: string): string | undefined {
    const step = kind === "undo" ? this.history.undo(this.config) : this.history.redo(this.config);
    if (!step) {
      void this.say(`Nothing to ${kind}.`, by);
      return undefined;
    }
    this.config = step.config;
    this.writeMap();
    this.note(`${by}: ${kind} ${step.label}`);
    void this.sendConfig();
    void this.sendStatus();
    void this.say(`${by} ${kind === "undo" ? "undid" : "redid"}: ${step.label}`);
    return step.label;
  }

  /** Writes map.json in the hand-written style and the file's own line endings, one write at a time. */
  private writeMap(): void {
    this.writing = this.writing
      .then(async () => {
        const text = withLineEndings(formatMapConfig(this.config), this.text);
        if (text === this.text) return;
        this.text = text;
        await writeFile(this.mapPath, text);
      })
      .catch((error: unknown) => this.note(`Could not write map.json: ${message(error)}`));
  }

  /** map.json changed on disk: a hand edit (in VS Code, say) goes into the game as one undo step. */
  private async reloadMap(why = "changed by hand"): Promise<void> {
    if (this.state !== "ready") return;
    let text: string;
    try {
      text = await readFile(this.mapPath, "utf8");
    } catch {
      return;
    }
    if (text === this.text) return;
    let config: MapConfig;
    try {
      config = JSON.parse(text) as MapConfig;
    } catch {
      if (text !== this.badText) this.note("map.json was changed by hand but isn't valid JSON: the game keeps the last good version until it is.");
      this.badText = text;
      return;
    }
    this.text = text;
    this.history.record(this.config, why === "changed by hand" ? "hand edit of map.json" : "changes made while Edit was opening");
    this.config = config;
    this.note(`map.json was ${why}: sent to the game.`);
    this.noteChecklist();
    void this.sendConfig();
    void this.sendStatus();
    void this.say(`map.json was ${why}, and the map is updated.`);
  }

  private async sendConfig(): Promise<void> {
    for (const part of splitConfig(this.config, this.seq, ++this.configId)) await this.send(part);
  }

  private sendStatus(): Promise<unknown> {
    return this.send({
      t: "status",
      undo: this.history.undoLabel,
      redo: this.history.redoLabel,
      unsaved: this.unsaved,
      saving: this.saving !== undefined,
      publishing: this.publishing !== undefined,
    });
  }

  // ---- Saving and stopping ----------------------------------------------------------------

  protected async shutdown(save: boolean): Promise<void> {
    // A Save under way finishes first; its world copy is taken while the server still runs.
    await this.saving;
    const failed = this.state === "failed";
    if (!failed) this.state = "stopping";
    unwatchFile(this.mapPath);
    await this.writing;
    try {
      const running = await this.running();
      const clean = save && this.unsaved && running && (await this.removeMarkers());
      if (running) await this.stopServer();
      if (clean) await this.saveWorldFiles((dest) => copyDirFromContainer(this.container!, "/bds/worlds/active", dest));
      else if (!this.unsaved) this.note("No blocks changed since the last save, so the world was kept as it was.");
      // map.json may have changed without the world.
      if (existsSync(this.mapPath)) this.keepVersion();
    } catch (error) {
      this.note(`Stopping went wrong: ${message(error)}`);
    } finally {
      await this.endSession(failed, () => {
        this.noteChecklist();
        this.note(`Stopped. The map is in ${this.mapDir}.`);
      });
    }
  }

  /** Keeps the map's folder as its next version in the map store, when it changed since the newest. */
  private keepVersion(by?: string): void {
    try {
      const { version, created } = this.store.saveVersion(this.target.id, this.mapId, "save", by);
      if (created) this.note(`Kept the map as version ${version}.`);
    } catch (error) {
      this.note(`The map wasn't kept as a version: ${message(error)}`);
    }
  }

  /**
   * Save while the server runs: map.json is already written, so this saves the world. The markers
   * come out (and a new token goes in a world property), `save hold` makes BDS write the world and
   * keep its files still, the world is copied once that write (with the token) is in its files, and
   * `save resume` lets it carry on.
   */
  private async hotSave(by: string): Promise<boolean> {
    // Waiting first also lets save() note this run, so the status below says a save is running.
    await this.writing;
    if (this.state !== "ready" || !this.container) {
      void this.say("The editor isn't ready to save.", by);
      return false;
    }
    this.note(`${by}: saving the world...`);
    this.changedWhileSaving = false;
    void this.sendStatus();
    let saved = false;
    try {
      const token = randomUUID();
      const clean = await this.removeMarkers(token);
      try {
        if (clean) saved = await this.saveWorldFiles((dest) => this.copyHeldWorld(dest, token));
      } finally {
        await this.send({ t: "resume" });
      }
    } catch (error) {
      this.note(`Saving went wrong: ${message(error)}`);
    }
    if (!saved) {
      void this.say("§cThe world was NOT saved: see the editor's log. map.json has every change.", by);
      return false;
    }
    this.unsaved = this.changedWhileSaving;
    this.keepVersion(by);
    void this.say(`Saved the map and the world (${by}).`);
    return true;
  }

  private async runPublish(by: string): Promise<void> {
    await this.writing;
    if (this.state !== "ready") {
      void this.say("The editor isn't ready to publish.", by);
      return;
    }
    const checklist = mapChecklist(this.config, this.target.rules);
    if (!checklist.ready) {
      void this.say(`§cNot ready to publish:§r ${checklist.problems.join("; ")}`, by);
      return;
    }
    const name = this.config.name;
    const path = `${this.target.id}/${this.mapId}`;
    this.note(`${by}: publishing ${path}...`);
    void this.sendStatus();
    void this.say(`${by} is publishing ${chatMapName(this.target.name, name)}: saving, then publishing...`);
    if (this.config.draft === true) {
      const edit = { op: "draft", draft: false } as const;
      this.history.record(this.config, `${describeEdit(edit)} (${by})`);
      this.config = applyEdit(this.config, edit);
      this.writeMap();
      void this.sendConfig();
    }
    await this.saving;
    if (this.unsaved && !(await this.save(by))) {
      void this.say(`${chatMapName(this.target.name, name)} §cwas NOT published: the world didn't save.`);
      return;
    }
    await this.writing;
    // The game's picture (the camera's Game picture) goes along when it changed. A map given
    // another id stops being published under its old one here.
    let result: PublishResult;
    try {
      result = this.store.publish(this.target.id, this.mapId, by);
    } catch (error) {
      this.note(`Publishing ${path} failed: ${message(error)}`);
      void this.say(`§c${name} was NOT published: ${message(error)}.`);
      return;
    }
    if (result.outcome === "unchanged") {
      this.note(`${path} has no changes since it was last published (version ${result.version}).`);
      void this.say(`${chatMapName(this.target.name, name)} has no changes since it was last published.`, by);
      return;
    }
    try {
      this.store.exportPublished();
    } catch (error) {
      // The Panel writes it again when it starts the network.
      this.note(`The store's published folder wasn't written (${message(error)}): the Panel's Start writes it again.`);
    }
    const where = this.target.id === "lobby" ? "the Panel's lobby map picker has it" : `it's in ${this.target.name}'s map list in the lobby`;
    this.note(`Published ${path} as version ${result.version}.`);
    void this.say(`${chatMapName(this.target.name, name)} §ais published (version ${result.version}): ${where} from the network's next start.`);
    void this.send({ t: "notice", text: `§a${name} is published` });
  }

  /**
   * Keeps the newest screenshot on this PC (taken in the last few minutes) with the pictures used
   * before (shots.ts), cropped to 16:9 at 320x180, and uses it as the map's preview.png ("map") or
   * the game's icon.png ("game"): the Snapshot's picture. Publish puts a map's in the lobby; a game's
   * needs none (the store's export takes it). Undefined when it's saved, or why not.
   */
  async picture(by: string, kind: ShotKind): Promise<string | undefined> {
    const problem = this.pictureProblem(by);
    if (problem) return problem;
    const shot = await keepNewestScreenshot(root, by);
    if (typeof shot === "string") {
      this.note(`${by}: no picture saved: ${shot}.`);
      this.tellOne(by, `§cNo picture saved: ${shot}.`);
      return shot;
    }
    const ago = Math.max(1, Math.round((Date.now() - shot.takenAt) / 1000));
    return this.thumbnail(by, kind, shot.id, `from your screenshot of ${ago} s ago (${basename(shot.from)})`);
  }

  /** Uses a picture used before (a shot's id) as the map's preview or the game's picture. Undefined when it's saved, or why not. */
  async thumbnail(by: string, kind: ShotKind, id: string, from = "from the pictures used before"): Promise<string | undefined> {
    const problem = this.pictureProblem(by);
    if (problem) return problem;
    const out = kind === "map" ? join(this.mapDir, "preview.png") : this.target.icon;
    const use = { target: this.target.id, targetName: this.target.name, map: this.mapId, mapName: this.config.name, kind, at: Date.now() };
    const failed = await useShot(root, id, out, use).catch((error: unknown) => message(error));
    if (failed) {
      this.tellOne(by, `§cNo picture saved: ${failed}.`);
      return failed;
    }
    const what = kind === "map" ? `${this.config.name}'s thumbnail` : `${this.target.name}'s thumbnail`;
    this.note(`${by}: saved ${out} (320x180) ${from}.`);
    this.tellOne(by, `§aSaved ${what} ${from}. ${kind === "map" ? "Publish puts it in the lobby." : "The lobby shows it from the network's next start."}`);
    return undefined;
  }

  /** Uses another map's preview picture as this map's (the thumbnail menu's import). */
  private async importPicture(by: string, targetId: string, mapId: string): Promise<void> {
    if (this.pictureProblem(by)) return;
    const picture = join(this.store.folder(targetId, mapId), "preview.png");
    if (!isMapId(mapId) || !existsSync(picture)) {
      this.tellOne(by, "§cThat map has no picture any more.");
      return;
    }
    await cp(picture, join(this.mapDir, "preview.png"));
    this.note(`${by}: copied ${targetId}/${mapId}'s preview.png to ${this.target.id}/${this.mapId}.`);
    this.tellOne(by, `§aSaved ${this.config.name}'s thumbnail from ${mapId}'s. Publish puts it in the lobby.`);
  }

  /** Why no picture can be saved here: a lobby map shows none. */
  private pictureProblem(by: string): string | undefined {
    if (this.target.id !== "lobby") return undefined;
    this.tellOne(by, "§cThe lobby shows no picture of its own map: pictures are for games' maps.");
    return "the lobby shows no picture of its own map";
  }

  /** A chat line for the player who asked (everyone, when it was this PC). */
  private tellOne(by: string, text: string): void {
    void (by === "this PC" ? this.say(text) : this.say(text, by));
  }

  /**
   * Copies the running world into `dest` under `save hold`, then resumes. The files are copied
   * whole: `save query` also lists a length for each, but on BDS 1.26 a log's listed length is from
   * before the save wrote the chunks (tested: a copy cut to it lost the blocks placed before the
   * save). Held, the server deletes nothing, and LevelDB drops a half-written record at a log's end.
   * `save query` can also say the files are ready before the save's write is in them at all (seen:
   * Temples saved with the boundary planes and a mannequin the cleanup had just taken out), so the
   * world is copied again until its logs have that write, with `token` (world-log.ts).
   */
  private async copyHeldWorld(dest: string, token: string): Promise<void> {
    const held = await this.command("save hold", /Saving|already|not been completed/i);
    if (held === undefined) throw new Error("the server didn't answer save hold");
    try {
      let ready = false;
      for (let attempt = 0; attempt < SAVE_QUERY_ATTEMPTS && !ready; attempt++) {
        const answer = await this.command("save query", /Files are now ready to be copied|not been completed|save hold/i);
        ready = answer !== undefined && /ready to be copied/.test(answer);
        if (!ready) await delay(500);
      }
      if (!ready) throw new Error("the server didn't get its files ready to copy (save query)");
      for (let attempt = 1; ; attempt++) {
        await rm(dest, { recursive: true, force: true });
        await copyDirFromContainer(this.container!, "/bds/worlds/active", dest);
        if (await savedWith(join(dest, "db"), token)) break;
        if (attempt >= SAVE_WRITE_ATTEMPTS) throw new Error("the server's save never reached its files");
        await delay(500);
      }
    } finally {
      await this.command("save resume", /resumed|not been|Changes to the (level|world)/i);
    }
  }

  /**
   * Copies the world into the map: `copy` fills a new folder, which gets the bake settings and the
   * map's own name file and is swapped in whole. False (and a note) when it didn't work.
   */
  private async saveWorldFiles(copy: (dest: string) => Promise<void>): Promise<boolean> {
    const worldDir = join(this.mapDir, "world");
    const fresh = `${worldDir}.new`;
    try {
      await rm(fresh, { recursive: true, force: true });
      await copy(fresh);
      for (const file of RUNTIME_FILES) await rm(join(fresh, file), { force: true });
      await patchLevelDat(join(fresh, "level.dat"), (dat) => bakeSettings(dat, withSpawn(this.config)));
      const nameFile = join(worldDir, "levelname.txt");
      if (existsSync(nameFile)) await cp(nameFile, join(fresh, "levelname.txt"));
      else await writeFile(join(fresh, "levelname.txt"), this.config.name);
      // Retries cover Windows file watchers (VS Code) briefly holding files in the old world.
      await rm(worldDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      await rename(fresh, worldDir);
    } catch (error) {
      this.note(`The world was NOT saved (${message(error)}). map.json has every change.`);
      await rm(fresh, { recursive: true, force: true }).catch(() => {});
      return false;
    }
    this.note(`Saved the world to ${worldDir}.`);
    if (this.config.build) this.note("Note: npm run bake would replace these block changes. Drop the build commands in the map menu to keep them.");
    return true;
  }

  private noteChecklist(): void {
    const { rows, problems } = mapChecklist(this.config, this.target.rules);
    const done = rows.filter((row) => row.done).length;
    const summary = rows.map((row) => `${row.done ? "ok" : "missing"} ${row.label} ${row.have}/${row.need}`).join(", ");
    this.note(`Checklist ${done} of ${rows.length}${this.config.draft ? " (draft)" : ""}: ${summary}${problems.length > 0 ? `\n  ${problems.join("\n  ")}` : ""}`);
  }
}

/**
 * bakeSettings puts the world spawn at the first spawn; a map without one (a new export) gets its
 * spectator spawn, above the build, or else the pad's.
 */
function withSpawn(config: MapConfig): MapConfig {
  if (config.spawns?.length > 0) return config;
  const spectator = config.spectatorSpawn;
  return { ...config, spawns: [spectator ? [spectator[0], spectator[1], spectator[2]] : [0, 65, 0]] };
}
