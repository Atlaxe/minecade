// Select from above (pass V.10), the Panel's side: the worlds Select can open, each world's picture
// from above (overview.ts), a view of a box's blocks for its height and its 3D look, the maps cut
// from a world, and exporting a box as a new map. Exports run in the Panel (selections.ts and
// extract.ts, as in-game Select's do in the editor): Chunker and a throwaway server with no ports,
// so the network keeps running. The Panel's extraction server has a name of its own, so in-game
// Select can cut maps out at the same time.
//   GET  /viewer/select?world=<id>                the page (select.html)
//   GET  /api/viewer/worlds                       the client's worlds and folders opened before
//   GET  /api/viewer/world-icon?world=<id>        a world's icon (world_icon.jpeg), if it has one
//   GET  /api/viewer/overview?world=<id>          its picture from above (overview-format.ts), gzipped
//   GET  /api/viewer/select/view?world=&box=      the view file of the blocks in a box, gzipped
//   GET  /api/viewer/select/shapes?world=&box=    the custom blocks' shapes in it
//   GET  /api/viewer/select/maps?world=<id>       the maps cut from the world, and how each is going
//   POST /api/viewer/select/export                {world, box, target, map, name}: queue a new map
//   POST /api/viewer/select/retry, /forget        {world, target, map}
// A world is a client world's folder name, or a world folder or .mcworld file's path.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SelectionInfo } from "@minecade/minigame-core/config";
import { requestedWorld, worldId } from "../editor/catalog.ts";
import { centerOffset, mapIdProblem, parseSelectFile } from "../editor/select-core.ts";
import { Selections } from "../editor/selections.ts";
import { listTargets } from "../editor/targets.ts";
import { clientWorlds, type World } from "../editor/worlds.ts";
import type { CustomShape } from "../control-panel/viewer/shapes.ts";
import { viewShapes } from "./custom-shapes.ts";
import { boxView, cachedOverview, selectBoxProblem, worldCacheDir, type SelectBox } from "./overview.ts";
import { ViewError } from "./view-file.ts";

/** The Panel's extraction server, beside in-game Select's minecade-extract. */
export const PANEL_EXTRACT_CONTAINER = "minecade-extract-panel";

export interface WorldEntry {
  /** What the page asks for it by: a client world's folder name, else its path. */
  id: string;
  name: string;
  /** Where it is. */
  path: string;
  /** How many maps came from it. */
  maps: number;
  icon: boolean;
  /** A client world (else a folder or .mcworld opened before). */
  client: boolean;
}

export type Answer<T> = ({ status: 200 } & T) | { status: 400 | 404 | 409 | 422 | 500; error: string };

export class SelectFromAbove {
  private readonly root: string;
  private readonly selections: Selections;
  /** Worlds by what the page asked for, so a .mcworld is unzipped once. */
  private readonly worlds = new Map<string, Promise<World>>();
  /** Worlds whose list is open in `selections` (opening one again reads every game's maps). */
  private readonly opened = new Set<string>();

  constructor(root: string, note: (text: string) => void, selections?: Selections) {
    this.root = root;
    this.selections = selections ?? new Selections(root, { verbose: false, note, container: PANEL_EXTRACT_CONTAINER });
  }

  /** How many exports are queued or running (the Panel stays up and won't restart meanwhile). */
  get busy(): number {
    return this.selections.busy;
  }

  /** The client's worlds, then folders and .mcworld files opened before, with how many maps came from each. */
  async worldList(appData?: string): Promise<WorldEntry[]> {
    const client = await clientWorlds(appData);
    const files = await this.selectFiles();
    // A world's maps: those on its list, and those in the store whose map.json says they came from it.
    const from = new Map<string, Set<string>>();
    const add = (world: string, key: string) => (from.get(world) ?? from.set(world, new Set()).get(world)!).add(key);
    for (const file of files) for (const selection of file.selections) add(file.world, `${selection.target}/${selection.map}`);
    for (const target of await listTargets(this.root)) {
      for (const map of target.maps) {
        const config = await readFile(join(target.mapsDir, map, "map.json"), "utf8").then((text) => JSON.parse(text) as { source?: { world?: unknown } }).catch(() => undefined);
        if (typeof config?.source?.world === "string") add(config.source.world, `${target.id}/${map}`);
      }
    }
    const mapsFrom = (name: string) => from.get(name)?.size ?? 0;
    const list: WorldEntry[] = client.map((world) => ({ id: worldId(world), name: world.name, path: world.path, maps: mapsFrom(world.name), icon: existsSync(join(world.path, "world_icon.jpeg")), client: true }));
    for (const file of files) {
      if (client.some((world) => world.path.toLowerCase() === file.path.toLowerCase()) || !existsSync(join(file.path, "level.dat"))) continue;
      list.push({ id: file.path, name: file.world, path: file.path, maps: file.selections.length, icon: existsSync(join(file.path, "world_icon.jpeg")), client: false });
    }
    return list;
  }

  /** The world the page means, or why there's none. */
  async world(id: string): Promise<World> {
    if (!id.trim()) throw new ViewError("expected ?world=<world>");
    let world = this.worlds.get(id);
    if (!world) {
      world = requestedWorld(id, this.selections.unzipDir);
      this.worlds.set(id, world);
      world.catch(() => this.worlds.delete(id));
    }
    try {
      return await world;
    } catch (error) {
      throw new ViewError(error instanceof Error ? error.message : String(error));
    }
  }

  /** A world's icon file, if it has one. */
  async iconPath(id: string): Promise<string | undefined> {
    try {
      const path = join((await this.world(id)).path, "world_icon.jpeg");
      return existsSync(path) ? path : undefined;
    } catch {
      return undefined;
    }
  }

  async overview(id: string): Promise<Answer<{ gzipped: Buffer; name: string }>> {
    return this.answer(async () => {
      const world = await this.world(id);
      const { gzipped } = cachedOverview(world.path, worldCacheDir(this.root, world.path));
      return { gzipped, name: world.name };
    });
  }

  async view(id: string, boxText: string): Promise<Answer<{ gzipped: Buffer }>> {
    return this.answer(async () => {
      const box = parseBox(boxText);
      const world = await this.world(id);
      try {
        return { gzipped: boxView(world.path, box).gzipped };
      } catch (error) {
        if (error instanceof ViewError && error.message === "the world has no blocks") throw new ViewError("there are no blocks in the box");
        throw error;
      }
    });
  }

  async shapes(id: string, boxText: string): Promise<Answer<{ shapes: Record<string, CustomShape> }>> {
    return this.answer(async () => {
      const box = parseBox(boxText);
      const world = await this.world(id);
      return { shapes: viewShapes(boxView(world.path, box).gzipped, join(this.root, "packs", "blocks")) };
    });
  }

  /** The maps cut from a world (in-game Select's and the Panel's), and how each export is going. */
  async maps(id: string): Promise<Answer<{ world: string; selections: SelectionInfo[] }>> {
    return this.answer(async () => {
      const world = await this.open(id);
      return { world: world.name, selections: await this.selections.infos(world.name) };
    });
  }

  /** Queues a box as a new map, as in-game Select's Export to Map does. */
  async export(body: Record<string, unknown>): Promise<Answer<{ message: string }>> {
    return this.answer(async () => {
      const box = parseBox(body.box);
      const world = await this.open(String(body.world ?? ""));
      const target = (await listTargets(this.root)).find((candidate) => candidate.id === body.target);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const map = typeof body.map === "string" ? body.map.trim() : "";
      const file = await this.selections.open(world);
      const problem = !target ? `there is no game "${String(body.target)}"` : !name ? "the map needs a name" : name.length > 48 ? "a map's name is at most 48 letters" : mapIdProblem(map, target.maps, file.selections, target.id);
      if (problem || !target) throw new ViewError(problem ?? "no game");
      await this.selections.add(world.name, { target: target.id, map, name, box, offset: centerOffset(box) });
      return { message: `${target.name}, ${name} (${map}) is being cut out of ${world.name} and moved to the middle, in the background.` };
    });
  }

  /** Retry a failed export, or take one off the world's list (its map, if any, stays). */
  async act(action: "retry" | "forget", body: Record<string, unknown>): Promise<Answer<{ message: string }>> {
    return this.answer(async () => {
      const world = await this.open(String(body.world ?? ""));
      const target = String(body.target ?? "");
      const map = String(body.map ?? "");
      const problem = await this.selections.act(world.name, action, target, map);
      if (problem) throw new ViewError(problem);
      return { message: action === "retry" ? `${map}: trying again.` : `${map} is off ${world.name}'s list.` };
    });
  }

  /** A world with its list open (read once, then kept up to date by the exports). */
  private async open(id: string): Promise<World> {
    const world = await this.world(id);
    if (!this.opened.has(world.path)) {
      await this.selections.open(world);
      this.opened.add(world.path);
    }
    return world;
  }

  private async answer<T>(work: () => Promise<T>): Promise<Answer<T>> {
    try {
      return { status: 200, ...(await work()) };
    } catch (error) {
      if (error instanceof ViewError) return { status: /^there's no world|^there is no world|isn't in/.test(error.message) ? 404 : 422, error: error.message };
      return { status: 500, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async selectFiles() {
    const dir = join(this.root, "work", "select");
    if (!existsSync(dir)) return [];
    const files = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".json")) continue;
      const file = parseSelectFile(await readFile(join(dir, name), "utf8"));
      if (file) files.push(file);
    }
    return files;
  }
}

/** A box from the page: "x0,y0,z0,x1,y1,z1" in a query, or { min, max } in a body; refused when it isn't Select's. */
export function parseBox(value: unknown): SelectBox {
  let numbers: number[] | undefined;
  if (typeof value === "string") numbers = value.split(",").map(Number);
  else if (value && typeof value === "object" && Array.isArray((value as SelectBox).min) && Array.isArray((value as SelectBox).max)) numbers = [...(value as SelectBox).min, ...(value as SelectBox).max];
  if (!numbers || numbers.length !== 6) throw new ViewError("expected a box: x0,y0,z0,x1,y1,z1");
  const box: SelectBox = { min: [numbers[0], numbers[1], numbers[2]], max: [numbers[3], numbers[4], numbers[5]] };
  const problem = selectBoxProblem(box);
  if (problem) throw new ViewError(problem);
  return box;
}
