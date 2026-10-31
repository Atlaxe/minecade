// Extract mode: the throwaway server the host (tools/editor/extract.ts) runs to move one map to the
// middle. On "extract", it captures the box in 64x64 columns (structures can't be bigger), clears
// every chunk the box touches (whatever spills in from neighboring builds goes too), places the
// columns at the offset twice (a block attached to a column not placed yet pops off the first
// time; entities only once), removes dropped items, and answers "extracted". The host saves by
// stopping the server. Proved on the user's world in the spike (docs/spike-results.md, "Map editor").
//
// Chunks are loaded with script ticking areas, a whole phase at once (the source, then the
// destination) when that fits the ticking limit, otherwise one 64x64 region at a time. After
// areas are removed, the next ones wait a moment: an area next to chunks that are still
// unloading never finishes loading (tested on the user's world).
import { BlockVolume, StructureSaveMode, system, world, type Dimension, type Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import type { Box, Vec3 } from "@minecade/minigame-core/config";
import { HostLink } from "./link.ts";

/** The biggest structure createFromWorld takes is 64 x 384 x 64. */
const TILE = 64;
/** fillBlocks takes at most 32768 blocks: 32 cubed. */
const FILL = 32;
const MIN_Y = -64;
const MAX_Y = 319;
/** How long an area's chunks may take to load before the extraction gives up. */
const LOAD_TICKS = 1200;
/** The wait after removing ticking areas, for their chunks to finish unloading. */
const SETTLE_TICKS = 40;

/** An area of blocks, both corners inside. */
interface Region {
  from: Vector3;
  to: Vector3;
}

interface Tile extends Region {
  name: string;
}

export class Extractor {
  private readonly link: HostLink;
  private readonly dimension: Dimension;
  private busy = false;
  private areas = 0;

  constructor(scope: Scope) {
    this.dimension = world.getDimension("overworld");
    this.link = new HostLink(scope, {
      config: () => {},
      message: (message) => {
        if (message.t === "extract") void this.run(message.box, message.offset);
      },
    });
  }

  start(): void {
    this.link.send({ t: "ready" });
  }

  private async run(box: Box, offset: Vec3): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    log.info(`extract: moving ${box.min.join(" ")} to ${box.max.join(" ")} by ${offset.join(" ")}`);
    try {
      const result = await this.move(box, offset);
      this.link.send({ t: "extracted", ok: true, ...result });
    } catch (error) {
      log.error(`extraction failed: ${describeError(error)}`);
      this.link.send({ t: "extracted", ok: false, error: describeError(error) });
    } finally {
      this.busy = false;
    }
  }

  private async move(box: Box, offset: Vec3): Promise<{ tiles: number; drops: number }> {
    const manager = world.structureManager;
    const tiles: Tile[] = [];
    for (let x = box.min[0]; x <= box.max[0]; x += TILE) {
      for (let z = box.min[2]; z <= box.max[2]; z += TILE) {
        const from = { x, y: box.min[1], z };
        const to = { x: Math.min(x + TILE - 1, box.max[0]), y: box.max[1], z: Math.min(z + TILE - 1, box.max[2]) };
        tiles.push({ name: `minecade:extract_${tiles.length}`, from, to });
      }
    }
    // Every chunk the box touches, in 64x64 regions: emptied after the capture, blocks and
    // entities, along with anything a neighboring build left in them.
    const chunkMin = { x: Math.floor(box.min[0] / 16) * 16, z: Math.floor(box.min[2] / 16) * 16 };
    const chunkMax = { x: Math.floor(box.max[0] / 16) * 16 + 15, z: Math.floor(box.max[2] / 16) * 16 + 15 };
    const chunks: Region[] = [];
    for (let x = chunkMin.x; x <= chunkMax.x; x += TILE) {
      for (let z = chunkMin.z; z <= chunkMax.z; z += TILE) {
        chunks.push({ from: { x, y: MIN_Y, z }, to: { x: Math.min(x + TILE - 1, chunkMax.x), y: MAX_Y, z: Math.min(z + TILE - 1, chunkMax.z) } });
      }
    }

    const capture = (tile: Tile) => {
      if (manager.get(tile.name)) manager.delete(tile.name);
      manager.createFromWorld(tile.name, this.dimension, tile.from, tile.to, { includeEntities: true, saveMode: StructureSaveMode.Memory });
    };
    if (await this.whole(chunks, () => {
      for (const tile of tiles) capture(tile);
      for (const region of chunks) this.clear(region);
    })) {
      log.info(`extract: captured ${tiles.length} columns and cleared the box's chunks`);
    } else {
      for (const tile of tiles) await this.inRegion(tile, () => capture(tile));
      for (const region of chunks) await this.inRegion(region, () => this.clear(region));
      log.info(`extract: captured ${tiles.length} columns and cleared the box's chunks, a region at a time`);
    }

    const moved = (region: Region): Region => ({ from: shift(region.from, offset), to: shift(region.to, offset) });
    const place = (tile: Tile, pass: number) => {
      // Entities only once, or they would be doubled.
      manager.place(tile.name, this.dimension, shift(tile.from, offset), { includeEntities: pass === 0 });
    };
    let drops = 0;
    const removeDrops = (tile: Tile) => {
      const { from, to } = moved(tile);
      const volume = { x: to.x - from.x + 1, y: to.y - from.y + 1, z: to.z - from.z + 1 };
      for (const entity of this.dimension.getEntities({ location: from, volume, type: "minecraft:item" })) {
        entity.remove();
        drops++;
      }
    };
    const destination = tiles.map(moved);
    if (!(await this.whole(destination, () => {
      for (const pass of [0, 1]) for (const tile of tiles) place(tile, pass);
      for (const tile of tiles) removeDrops(tile);
    }))) {
      for (const pass of [0, 1]) for (const tile of tiles) await this.inRegion(moved(tile), () => place(tile, pass));
      for (const tile of tiles) await this.inRegion(moved(tile), () => removeDrops(tile));
    }
    for (const tile of tiles) manager.delete(tile.name);
    log.info(`extract: placed ${tiles.length} columns twice, removed ${drops} dropped items`);
    return { tiles: tiles.length, drops };
  }

  /** Empties a loaded region: its entities (never players), then air in 32-block cubes. */
  private clear({ from, to }: Region): void {
    const volume = { x: to.x - from.x + 1, y: to.y - from.y + 1, z: to.z - from.z + 1 };
    for (const entity of this.dimension.getEntities({ location: from, volume })) {
      if (entity.typeId !== "minecraft:player") entity.remove();
    }
    for (let x = from.x; x <= to.x; x += FILL) {
      for (let y = from.y; y <= to.y; y += FILL) {
        for (let z = from.z; z <= to.z; z += FILL) {
          const end = { x: Math.min(x + FILL - 1, to.x), y: Math.min(y + FILL - 1, to.y), z: Math.min(z + FILL - 1, to.z) };
          this.dimension.fillBlocks(new BlockVolume({ x, y, z }, end), "minecraft:air");
        }
      }
    }
  }

  /**
   * Runs `work` with every region loaded at once, when they fit the ticking limit together.
   * False (and nothing run) when they don't.
   */
  private async whole(regions: Region[], work: () => void): Promise<boolean> {
    const ticking = world.tickingAreaManager;
    const count = regions.reduce((sum, region) => sum + chunkCount(region), 0);
    if (count > ticking.maxChunkCount - ticking.chunkCount) return false;
    const ids: string[] = [];
    try {
      for (const region of regions) ids.push(await this.load(region));
      work();
    } finally {
      await this.unload(ids);
    }
    return true;
  }

  /** Runs `work` with one region loaded. */
  private async inRegion(region: Region, work: () => void): Promise<void> {
    const ids: string[] = [];
    try {
      ids.push(await this.load(region));
      work();
    } finally {
      await this.unload(ids);
    }
  }

  /** Adds a ticking area over the region and waits until its chunks are loaded; its id. */
  private async load({ from, to }: Region): Promise<string> {
    const ticking = world.tickingAreaManager;
    const id = `minecade:extract${this.areas++}`;
    let settled = false;
    const timedOut = system.waitTicks(LOAD_TICKS).then(() => {
      if (!settled) throw new Error(`the chunks from ${from.x} ${from.z} to ${to.x} ${to.z} didn't load within ${LOAD_TICKS / 20} s`);
    });
    try {
      await Promise.race([ticking.createTickingArea(id, { dimension: this.dimension, from, to }), timedOut]);
    } catch (error) {
      if (ticking.hasTickingArea(id)) ticking.removeTickingArea(id);
      throw error;
    } finally {
      settled = true;
    }
    return id;
  }

  /** Removes ticking areas, then waits for their chunks to finish unloading. */
  private async unload(ids: string[]): Promise<void> {
    const ticking = world.tickingAreaManager;
    for (const id of ids) if (ticking.hasTickingArea(id)) ticking.removeTickingArea(id);
    if (ids.length > 0) await system.waitTicks(SETTLE_TICKS);
  }
}

function shift(at: Vector3, offset: Vec3): Vector3 {
  return { x: at.x + offset[0], y: at.y + offset[1], z: at.z + offset[2] };
}

/** How many chunks a region touches. */
function chunkCount({ from, to }: Region): number {
  return (Math.floor(to.x / 16) - Math.floor(from.x / 16) + 1) * (Math.floor(to.z / 16) - Math.floor(from.z / 16) + 1);
}
