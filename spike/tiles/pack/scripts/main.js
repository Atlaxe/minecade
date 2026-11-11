// Tiles check: can a script copy an arena (blocks in a box) into far-off void chunks, loaded by
// ticking areas it makes, with structures? Prints TL|{json} lines; spike/tiles/run.ts reads them.
import { BlockVolume, StructureSaveMode, system, world } from "@minecraft/server";

const out = (id, data) => console.log(`TL|${JSON.stringify({ id, ...data })}`);
const wait = (ticks) => new Promise((resolve) => system.runTimeout(resolve, ticks));

async function run() {
  const dim = world.getDimension("overworld");
  const manager = world.tickingAreaManager;
  out("limits", { maxChunkCount: manager.maxChunkCount, chunkCount: manager.chunkCount, areas: manager.getAllTickingAreas().map((a) => a.identifier) });

  // The arena: 40 x 31 x 40 at the origin, a stone floor, a gold block in a corner, glass on top.
  const arena = { min: { x: 0, y: 60, z: 0 }, max: { x: 39, y: 90, z: 39 } };
  let started = system.currentTick;
  await manager.createTickingArea("tl_home", { dimension: dim, from: arena.min, to: arena.max });
  out("home_area", { ticks: system.currentTick - started, chunkCount: manager.chunkCount });
  dim.fillBlocks(new BlockVolume({ x: 0, y: 60, z: 0 }, { x: 39, y: 60, z: 39 }), "minecraft:stone");
  dim.getBlock({ x: 3, y: 61, z: 5 }).setType("minecraft:gold_block");
  dim.getBlock({ x: 39, y: 90, z: 39 }).setType("minecraft:glass");
  dim.getBlock({ x: 20, y: 70, z: 20 }).setType("minecraft:water");

  try {
    world.structureManager.delete("tl:arena");
  } catch {}
  world.structureManager.createFromWorld("tl:arena", dim, arena.min, arena.max, { saveMode: StructureSaveMode.Memory, includeEntities: false, includeBlocks: true });
  out("saved", {});

  // Before any area: is a far chunk loaded?
  const far = { x: 1000, y: 61, z: 1000 };
  let before;
  try {
    before = dim.getBlock(far)?.typeId ?? "undefined";
  } catch (error) {
    before = `threw: ${error}`;
  }
  out("far_before", { block: before });

  // Eight tiles in a 3 by 3 grid (tile 0 is home), then one far away at 1000.
  const offsets = [];
  for (let i = 1; i < 9; i++) offsets.push({ x: (i % 3) * 40, y: 0, z: Math.floor(i / 3) * 40 });
  offsets.push({ x: 1000, y: 0, z: 1000 });
  for (const [i, offset] of offsets.entries()) {
    const from = { x: arena.min.x + offset.x, y: arena.min.y, z: arena.min.z + offset.z };
    const to = { x: arena.max.x + offset.x, y: arena.max.y, z: arena.max.z + offset.z };
    const options = { dimension: dim, from, to };
    const capacity = manager.hasCapacity(options);
    started = system.currentTick;
    let placed = false;
    let error;
    try {
      await manager.createTickingArea(`tl_${i}`, options);
      world.structureManager.place("tl:arena", dim, from, { includeEntities: false });
      placed = true;
    } catch (e) {
      error = String(e);
    }
    const gold = dim.getBlock({ x: 3 + offset.x, y: 61, z: 5 + offset.z })?.typeId;
    const glass = dim.getBlock({ x: 39 + offset.x, y: 90, z: 39 + offset.z })?.typeId;
    const water = dim.getBlock({ x: 20 + offset.x, y: 70, z: 20 + offset.z })?.typeId;
    out("tile", { i, offset, capacity, placed, error, ticks: system.currentTick - started, gold, glass, water, chunkCount: manager.chunkCount });
  }

  // How big a single area can be: 8 arenas of 64 x 64 in a row, and a 4 by 2 grid of them.
  out("capacity", {
    row8x64: manager.hasCapacity({ dimension: dim, from: { x: 2000, y: 0, z: 0 }, to: { x: 2000 + 8 * 64 - 1, y: 10, z: 63 } }),
    grid4x2of64: manager.hasCapacity({ dimension: dim, from: { x: 2000, y: 0, z: 0 }, to: { x: 2000 + 4 * 64 - 1, y: 10, z: 2 * 64 - 1 } }),
    grid3x3of100: manager.hasCapacity({ dimension: dim, from: { x: 2000, y: 0, z: 0 }, to: { x: 2299, y: 10, z: 299 } }),
  });

  // Drop the far one's area: is its chunk still readable a little later?
  manager.removeTickingArea("tl_8");
  await wait(100);
  let after;
  try {
    after = dim.getBlock({ x: 1003, y: 61, z: 1005 })?.typeId ?? "undefined";
  } catch (error) {
    after = `threw: ${error}`;
  }
  out("far_after_removed", { block: after });
  // Saving a far tile again (a snapshot) with its area kept: works?
  try {
    world.structureManager.createFromWorld("tl:snap", dim, { x: 80, y: 60, z: 80 }, { x: 119, y: 90, z: 119 }, { saveMode: StructureSaveMode.Memory, includeEntities: false, includeBlocks: true });
    out("snapshot_tile8", { ok: true });
  } catch (error) {
    out("snapshot_tile8", { ok: false, error: String(error) });
  }
  out("done", { maxChunkCount: manager.maxChunkCount, chunkCount: manager.chunkCount });
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id === "tl:run") run().catch((error) => out("done", { error: String(error) }));
});
