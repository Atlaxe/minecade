// The Edit server: one map. Stages the map in its server container, keeps map.json in step with the
// game (it applies the pack's edits with the same code, writes the file, keeps undo and redo, and
// sends hand edits of map.json into the game), saves the world back into the map on Save (while it
// runs, with save hold), and on stop when blocks changed since the last save. The server itself
// (starting, the console, opping map editors) is ServerSession's.
import { existsSync, unwatchFile, watchFile } from "node:fs";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  applyEdit,
  describeEdit,
  formatMapConfig,
  mapChecklist,
  mapHash,
  splitConfig,
  type EditInfo,
  type EditorEvent,
  type MapConfig,
} from "@minecade/minigame-core/config";
import { bakeSettings } from "../build/bake-core.ts";
import { copyDirFromContainer } from "../build/docker-util.ts";
import { enableBetaApis, patchLevelDat, readLevelDat, writeLevelDat } from "../build/leveldat.ts";
import { History, newMapConfig, withLineEndings, type EditStatus } from "./editor-core.ts";
import { findWorld } from "./selections.ts";
import { RUNTIME_FILES, ServerSession, delay, message, root, type SessionBase } from "./server-session.ts";
import type { EditorTarget } from "./targets.ts";
import type { World } from "./worlds.ts";

/** A level.dat written by BDS (bake's): a new map's void world starts from it. */
const BASE_LEVEL_DAT = join(root, "tools", "build", "fixtures", "base-level.dat");
/** How many times a held save is asked whether its files are ready, half a second apart. */
const SAVE_QUERY_ATTEMPTS = 20;

export interface SessionOptions extends SessionBase {
  target: EditorTarget;
  mapId: string;
  /** Make a new draft map (map.json and a void world with a glass pad), with this name. */
  fresh?: { name: string };
}

export class EditorSession extends ServerSession {
  private readonly target: EditorTarget;
  private readonly mapId: string;
  private readonly fresh: { name: string } | undefined;
  private readonly mapDir: string;
  private readonly mapPath: string;
  private config: MapConfig = { name: "", spawns: [] };
  /** map.json as last written or read, so the file watcher can tell a hand edit from our own write. */
  private text = "";
  private badText = "";
  private readonly history = new History();
  /** Blocks changed since the world was last saved (a new map's world has never been saved). */
  private unsaved = false;
  /** The Save that is running, if one is. */
  private saving: Promise<void> | undefined;
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
    this.mapDir = join(options.target.dir, "maps", options.mapId);
    this.mapPath = join(this.mapDir, "map.json");
  }

  /** Saves the world into the map now, while the server runs. A second call while one runs joins it. */
  save(by: string): Promise<void> {
    this.saving ??= this.hotSave(by).finally(() => {
      this.saving = undefined;
      void this.sendStatus();
    });
    return this.saving;
  }

  /** Stops at once without saving the world (map.json already has every change). */
  override async forceStop(): Promise<void> {
    this.note("Quitting without saving the world.");
    this.unsaved = false;
    await super.forceStop();
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
    const path = relative(root, this.mapPath);
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
      editors: this.editors,
      rules: this.target.rules,
      fresh: newWorld,
      ...(this.from ? { from: this.from.name } : {}),
    };
    await writeFile(join(dir, "editor.json"), JSON.stringify(info));
  }

  protected async afterReady(): Promise<void> {
    await this.sendConfig();
    await this.sendStatus();
    watchFile(this.mapPath, { interval: 500 }, () => void this.reloadMap());
    this.noteChecklist();
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
      case "changed":
        this.blocksChanged(event.by);
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

  private step(kind: "undo" | "redo", by: string): void {
    const step = kind === "undo" ? this.history.undo(this.config) : this.history.redo(this.config);
    if (!step) {
      void this.say(`Nothing to ${kind}.`, by);
      return;
    }
    this.config = step.config;
    this.writeMap();
    this.note(`${by}: ${kind} ${step.label}`);
    void this.sendConfig();
    void this.sendStatus();
    void this.say(`${by} ${kind === "undo" ? "undid" : "redid"}: ${step.label}`);
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
  private async reloadMap(): Promise<void> {
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
    this.history.record(this.config, "hand edit of map.json");
    this.config = config;
    this.note("map.json was changed by hand: sent to the game.");
    this.noteChecklist();
    void this.sendConfig();
    void this.sendStatus();
    void this.say("map.json was changed by hand, and the map is updated.");
  }

  private async sendConfig(): Promise<void> {
    for (const part of splitConfig(this.config, this.seq, ++this.configId)) await this.send(part);
  }

  private sendStatus(): Promise<unknown> {
    return this.send({ t: "status", undo: this.history.undoLabel, redo: this.history.redoLabel, unsaved: this.unsaved, saving: this.saving !== undefined });
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
    } catch (error) {
      this.note(`Stopping went wrong: ${message(error)}`);
    } finally {
      await this.endSession(failed, () => {
        this.noteChecklist();
        this.note(`Stopped. See the changes with: git status ${relative(root, this.mapDir).replaceAll("\\", "/")}`);
      });
    }
  }

  /**
   * Save while the server runs: map.json is already written, so this saves the world. The markers
   * come out, `save hold` makes BDS write the world and keep its files still, the world is copied
   * once `save query` says it's ready, and `save resume` lets it carry on.
   */
  private async hotSave(by: string): Promise<void> {
    // Waiting first also lets save() note this run, so the status below says a save is running.
    await this.writing;
    if (this.state !== "ready" || !this.container) {
      void this.say("The editor isn't ready to save.", by);
      return;
    }
    this.note(`${by}: saving the world...`);
    this.changedWhileSaving = false;
    void this.sendStatus();
    let saved = false;
    try {
      const clean = await this.removeMarkers();
      try {
        if (clean) saved = await this.saveWorldFiles((dest) => this.copyHeldWorld(dest));
      } finally {
        await this.send({ t: "resume" });
      }
    } catch (error) {
      this.note(`Saving went wrong: ${message(error)}`);
    }
    if (!saved) {
      void this.say("§cThe world was NOT saved: see the editor's log. map.json has every change.", by);
      return;
    }
    this.unsaved = this.changedWhileSaving;
    void this.say(`Saved the map and the world (${by}).`);
  }

  /**
   * Copies the running world into `dest` under `save hold`, then resumes. The files are copied
   * whole: `save query` also lists a length for each, but on BDS 1.26 a log's listed length is from
   * before the save wrote the chunks (tested: a copy cut to it lost the blocks placed before the
   * save). Held, the server deletes nothing, and LevelDB drops a half-written record at a log's end.
   */
  private async copyHeldWorld(dest: string): Promise<void> {
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
      await copyDirFromContainer(this.container!, "/bds/worlds/active", dest);
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
    this.note(`Saved the world to ${relative(root, worldDir)}.`);
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

/** bakeSettings puts the world spawn at the first spawn; a map without one gets the pad's. */
function withSpawn(config: MapConfig): MapConfig {
  return config.spawns?.length > 0 ? config : { ...config, spawns: [[0, 65, 0]] };
}
