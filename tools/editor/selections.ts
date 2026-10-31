// The maps boxed in each world, and their extractions. Each world's list is kept in
// work/select/<world>.json (ignored by git), so opening the world again shows it. Extractions run
// one at a time in this process (extract.ts) and carry on across mode switches; the runner waits
// for them before it exits.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MapConfig, SelectionInfo, Vec3 } from "@minecade/minigame-core/config";
import { connectDocker } from "../build/docker-util.ts";
import { readEnv } from "../control-panel/core.ts";
import { buildChunkerImage } from "./chunker.ts";
import { extract } from "./extract.ts";
import { add, draftMap, parseSelectFile, worldSlug, type SelectFile, type Selection } from "./select-core.ts";
import { listTargets, loadTarget, targetDir } from "./targets.ts";
import { clientWorlds, pickWorld, type World } from "./worlds.ts";

/** A selection changed (or, with `gone`, left the list), in the world called `world`. */
export type SelectionListener = (world: string, info: SelectionInfo, gone?: boolean) => void;

export class Selections {
  private readonly root: string;
  private readonly dir: string;
  private readonly verbose: boolean;
  private readonly note: (text: string) => void;
  private readonly files = new Map<string, SelectFile>();
  private readonly listeners = new Set<SelectionListener>();
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private chunkerReady = false;

  constructor(root: string, options: { verbose: boolean; note(text: string): void }) {
    this.root = root;
    this.dir = join(root, "work", "select");
    this.verbose = options.verbose;
    this.note = options.note;
  }

  /** Where a .mcworld is unzipped. */
  get unzipDir(): string {
    return join(this.dir, "worlds");
  }

  onChange(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** How many extractions are queued or running. */
  get busy(): number {
    return this.pending;
  }

  /** Whether a map's world is being cut out (or redone) now, so Edit can't open it yet. */
  extracting(target: string, map: string): boolean {
    const busy = new Set(["queued", "extracting", "updating"]);
    for (const file of this.files.values()) {
      if (file.selections.some((selection) => selection.target === target && selection.map === map && busy.has(selection.status))) return true;
    }
    return false;
  }

  /** Resolves once every queued extraction has finished. */
  idle(): Promise<void> {
    return this.queue;
  }

  /**
   * A world's list, read from its file. Extractions a stopped editor left unfinished read as failed,
   * and maps in the repo that came from a world of this name join the list, ready.
   */
  async open(world: World): Promise<SelectFile> {
    let file = this.files.get(world.name);
    if (!file) {
      const path = this.fileOf(world.name);
      file = (existsSync(path) && parseSelectFile(await readFile(path, "utf8"))) || { world: world.name, path: world.path, selections: [] };
      for (const selection of file.selections) {
        if (selection.status === "queued" || selection.status === "extracting" || selection.status === "updating") {
          selection.status = "failed";
          selection.error = "the editor stopped before it finished";
        }
      }
      this.files.set(world.name, file);
    }
    file.path = world.path;
    await this.adoptMaps(file);
    await this.save(file);
    return file;
  }

  /** The world's maps for the pack and the Panel, with each target's name. */
  async infos(world: string): Promise<SelectionInfo[]> {
    const file = this.files.get(world);
    if (!file) return [];
    const infos: SelectionInfo[] = [];
    for (const selection of file.selections) infos.push(await this.info(selection));
    return infos;
  }

  /** Queues a new map's extraction. */
  async add(world: string, selection: Omit<Selection, "status" | "error">): Promise<void> {
    const file = this.mustFile(world);
    file.selections.push({ ...selection, status: "queued" });
    await this.changed(file, file.selections.at(-1)!);
    this.enqueue(file, file.selections.at(-1)!, "extract");
  }

  /** Retry a failed extraction, forget a map in the list (its map stays in the repo), or redo a map's world. */
  async act(world: string, action: "retry" | "forget" | "update", target: string, map: string): Promise<string | undefined> {
    const file = this.mustFile(world);
    const selection = file.selections.find((candidate) => candidate.target === target && candidate.map === map);
    if (!selection) return `${map} isn't in ${world}'s list`;
    if (action === "forget") {
      if (selection.status === "queued" || selection.status === "extracting" || selection.status === "updating") return `${map} is being extracted: wait for it to finish`;
      file.selections.splice(file.selections.indexOf(selection), 1);
      await this.save(file);
      const info = await this.info(selection);
      for (const listener of this.listeners) listener(file.world, info, true);
      return undefined;
    }
    if (action === "retry") {
      if (selection.status !== "failed") return `${map} hasn't failed`;
      const exists = existsSync(join(targetDir(this.root, target), "maps", map, "map.json"));
      selection.status = exists ? "updating" : "queued";
      selection.error = undefined;
      await this.changed(file, selection);
      this.enqueue(file, selection, exists ? "update" : "extract");
      return undefined;
    }
    if (selection.status !== "ready") return `${map} isn't ready: it can be updated once it is`;
    selection.status = "updating";
    await this.changed(file, selection);
    this.enqueue(file, selection, "update");
    return undefined;
  }

  private enqueue(file: SelectFile, selection: Selection, kind: "extract" | "update"): void {
    this.pending++;
    this.queue = this.queue
      .then(() => this.run(file, selection, kind))
      .finally(() => {
        this.pending--;
      });
  }

  private async run(file: SelectFile, selection: Selection, kind: "extract" | "update"): Promise<void> {
    if (!file.selections.includes(selection)) return;
    const mapDir = join(targetDir(this.root, selection.target), "maps", selection.map);
    const label = `${selection.target}/${selection.map}`;
    try {
      if (kind === "extract") {
        if (existsSync(join(mapDir, "map.json"))) throw new Error(`there is a map ${label} already`);
        selection.status = "extracting";
      }
      await this.changed(file, selection);
      if (!this.chunkerReady) {
        buildChunkerImage(this.root, this.verbose);
        this.chunkerReady = true;
      }
      const env = readEnv(await readFile(join(this.root, ".env"), "utf8"));
      this.note(`Extracting ${label} from ${file.world}...`);
      // Update keeps map.json: its stored box and offset say where the world goes.
      const config = kind === "update" ? (JSON.parse(await readFile(join(mapDir, "map.json"), "utf8")) as MapConfig) : draftMap(selection, file.world);
      const source = config.source ?? { box: selection.box, offset: selection.offset };
      const spawn = (config.spawns?.[0]?.slice(0, 3) as Vec3 | undefined) ?? add(selection.spawn, selection.offset);
      await extract(
        { world: file.path, box: source.box, offset: source.offset, mapDir, config: kind === "extract" ? config : undefined, name: config.name, spawn },
        { docker: connectDocker(), env, verbose: this.verbose, note: (text) => this.note(`${label}: ${text}`) },
      );
      selection.status = "ready";
      selection.error = undefined;
      this.note(`${label} is ready: ${kind === "extract" ? "a draft map, centered at x 0, z 0" : "its world was redone from " + file.world}.`);
    } catch (error) {
      selection.status = "failed";
      selection.error = error instanceof Error ? error.message : String(error);
      this.note(`${label} failed: ${selection.error}`);
    }
    await this.changed(file, selection);
  }

  /** Maps in the repo whose source is a world of this name join its list (after a fresh clone, say). */
  private async adoptMaps(file: SelectFile): Promise<void> {
    for (const target of await listTargets(this.root)) {
      for (const map of target.maps) {
        if (file.selections.some((selection) => selection.target === target.id && selection.map === map)) continue;
        let config: MapConfig;
        try {
          config = JSON.parse(await readFile(join(target.dir, "maps", map, "map.json"), "utf8")) as MapConfig;
        } catch {
          continue;
        }
        const source = config.source;
        if (!source || source.world !== file.world) continue;
        const spawn = (config.spawns?.[0]?.slice(0, 3) as Vec3 | undefined) ?? [0, 0, 0];
        file.selections.push({
          target: target.id,
          map,
          name: config.name,
          box: source.box,
          offset: source.offset,
          spawn: [spawn[0] - source.offset[0], spawn[1] - source.offset[1], spawn[2] - source.offset[2]],
          status: "ready",
        });
      }
    }
  }

  private async info(selection: Selection): Promise<SelectionInfo> {
    let targetName = selection.target;
    try {
      targetName = (await loadTarget(this.root, selection.target)).name;
    } catch {
      // A game removed since: its id will do.
    }
    return {
      target: selection.target,
      targetName,
      map: selection.map,
      name: selection.name,
      box: selection.box,
      status: selection.status,
      ...(selection.error ? { error: selection.error } : {}),
    };
  }

  private async changed(file: SelectFile, selection: Selection): Promise<void> {
    await this.save(file);
    const info = await this.info(selection);
    for (const listener of this.listeners) listener(file.world, info);
  }

  private async save(file: SelectFile): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.fileOf(file.world), `${JSON.stringify(file, null, 2)}\n`);
  }

  private fileOf(world: string): string {
    return join(this.dir, `${worldSlug(world)}.json`);
  }

  private mustFile(world: string): SelectFile {
    const file = this.files.get(world);
    if (!file) throw new Error(`${world} isn't open`);
    return file;
  }
}

/** Where a world of this name was opened from before (its work/select file), or a client world of that name. */
export async function findWorld(root: string, name: string): Promise<World | undefined> {
  const path = join(root, "work", "select", `${worldSlug(name)}.json`);
  const file = existsSync(path) ? parseSelectFile(await readFile(path, "utf8")) : undefined;
  if (file && file.world === name && existsSync(join(file.path, "level.dat"))) return { name, path: file.path };
  const picked = pickWorld(await clientWorlds(), name);
  return typeof picked === "string" ? undefined : picked;
}
