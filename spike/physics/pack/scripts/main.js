// Block physics check pack: does a gravity block (concrete powder, an anvil) fall when a script
// puts it in the air, and can a script keep one a player placed in the air from falling? Driven
// from spike/physics/run.ts: "scriptevent ph:run" runs every case and prints "PH|" lines, then
// "PH|{"id":"done"}". Each case works in its own column over the stone floor at y 99.
import { BlockPermutation, BlockVolume, Direction, GameMode, ItemStack, StructureSaveMode, system, world } from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";

const Y = 105;
const out = (obj) => console.log(`PH|${JSON.stringify(obj)}`);
const dimension = () => world.getDimension("overworld");
const key = (at) => `${Math.floor(at.x)},${Math.floor(at.y)},${Math.floor(at.z)}`;

/** What's in a column from y 99 up to 107: the non-air blocks, bottom first. */
function column(x, z) {
  const found = [];
  for (let y = 99; y <= 107; y++) {
    const block = dimension().getBlock({ x, y, z });
    if (block && !block.isAir) found.push(`${y}:${block.typeId.replace("minecraft:", "")}`);
  }
  return found;
}

/** Falling block entities alive now, and every one that spawned since `since` (by the spawn log). */
let spawns = [];
world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
  try {
    spawns.push({ t: system.currentTick, type: entity.typeId, at: key(entity.location), cause });
    if (entity.typeId === "minecraft:falling_block" && restoring) restoring(entity);
  } catch (error) {
    spawns.push({ error: String(error) });
  }
});

/** The case's handler for a falling block entity, when it keeps blocks up. */
let restoring;
/** Placements a player made, by "x,y,z": the permutation. */
const placed = new Map();
let onPlace;
world.afterEvents.playerPlaceBlock.subscribe(({ block, player }) => {
  try {
    placed.set(key(block.location), block.permutation);
    out({ id: "event", ev: "playerPlaceBlock", t: system.currentTick, by: player.name, at: key(block.location), type: block.typeId });
    if (onPlace) onPlace(block);
  } catch (error) {
    out({ id: "event", ev: "playerPlaceBlock", error: String(error) });
  }
});

const wait = (ticks) => system.waitTicks(ticks);

async function scripted(id, x, put) {
  spawns = [];
  const at = { x, y: Y, z: 0 };
  try {
    put(at);
  } catch (error) {
    out({ id, error: String(error) });
    return;
  }
  const right = column(x, 0);
  await wait(10);
  out({ id, right, after10: column(x, 0), falling: spawns.filter((s) => s.type === "minecraft:falling_block").length });
  // A neighbor update: a stone set beside it.
  dimension().getBlock({ x: x + 1, y: Y, z: 0 }).setType("minecraft:stone");
  await wait(10);
  out({ id: `${id}+neighbor`, after: column(x, 0), falling: spawns.filter((s) => s.type === "minecraft:falling_block").length });
}

async function byPlayer(id, x, item, mode) {
  spawns = [];
  placed.clear();
  // A stone pillar one block north of the column; the player places against its south face.
  for (let y = 100; y <= Y; y++) dimension().getBlock({ x, y, z: -1 }).setType("minecraft:stone");
  const player = spawnSimulatedPlayer({ dimension: dimension(), x: x + 0.5, y: 100, z: 3.5 }, `P${x}`, GameMode.Creative);
  await wait(10);
  player.getComponent("minecraft:inventory").container.setItem(0, new ItemStack(item, 16));
  player.selectedSlotIndex = 0;
  player.lookAtBlock({ x, y: Y, z: -1 });
  await wait(2);
  restoring = undefined;
  onPlace = undefined;
  if (mode === "restore") {
    restoring = (entity) => {
      const where = key(entity.location);
      const permutation = placed.get(where);
      entity.remove();
      if (permutation) dimension().getBlock({ x: Math.floor(entity.location.x), y: Math.floor(entity.location.y), z: Math.floor(entity.location.z) }).setPermutation(permutation);
      out({ id: "event", ev: "restored", t: system.currentTick, at: where, had: Boolean(permutation) });
    };
  } else if (mode === "twin") {
    onPlace = (block) => {
      const states = block.permutation.getAllStates();
      const twin = { "minecraft:red_concrete_powder": "minecade:still_red_concrete_powder", "minecraft:anvil": "minecade:still_anvil" }[block.typeId];
      out({ id: "event", ev: "placedStates", type: block.typeId, states });
      if (!twin) return;
      const facing = states["minecraft:cardinal_direction"];
      block.setPermutation(BlockPermutation.resolve(twin, facing ? { "minecraft:cardinal_direction": facing } : {}));
    };
  } else if (mode === "replace") {
    onPlace = (block) => {
      const permutation = block.permutation;
      block.setType("minecraft:air");
      block.setPermutation(permutation);
    };
  }
  let ok;
  try {
    ok = player.useItemInSlotOnBlock(0, { x, y: Y, z: -1 }, Direction.South, { x: 0.5, y: 0.5, z: 1 });
  } catch (error) {
    out({ id, error: `useItemInSlotOnBlock: ${error}` });
  }
  const right = column(x, 0);
  await wait(20);
  out({ id, ok, right, after20: column(x, 0), falling: spawns.filter((s) => s.type === "minecraft:falling_block").length, spawns: spawns.slice(0, 6) });
  dimension().getBlock({ x: x + 1, y: Y, z: 0 }).setType("minecraft:stone");
  await wait(20);
  out({ id: `${id}+neighbor`, after: column(x, 0), falling: spawns.filter((s) => s.type === "minecraft:falling_block").length });
  restoring = undefined;
  onPlace = undefined;
  player.remove?.();
}

async function run() {
  const powder = "minecraft:red_concrete_powder";
  await scripted("script-setType", 2, (at) => dimension().getBlock(at).setType(powder));
  await scripted("script-setPermutation", 6, (at) => dimension().getBlock(at).setPermutation(BlockPermutation.resolve(powder)));
  await scripted("command-setblock", 10, (at) => dimension().runCommand(`setblock ${at.x} ${at.y} ${at.z} red_concrete_powder`));
  await scripted("fillBlocks", 14, (at) => dimension().fillBlocks(new BlockVolume(at, at), powder));
  await scripted("structure", 18, (at) => {
    dimension().getBlock({ x: 18, y: 100, z: 4 }).setType(powder);
    const structure = world.structureManager.createFromWorld("ph:powder", dimension(), { x: 18, y: 100, z: 4 }, { x: 18, y: 100, z: 4 }, { saveMode: StructureSaveMode.Memory, includeEntities: false });
    world.structureManager.place(structure, dimension(), at);
  });
  await byPlayer("player", 22, powder, "none");
  await byPlayer("player-restore", 26, powder, "restore");
  await byPlayer("player-replace", 30, powder, "replace");
  await byPlayer("player-anvil-restore", 34, "minecraft:anvil", "restore");
  await byPlayer("player-sand-restore", 38, "minecraft:sand", "restore");
  // Build Swap's twins (copied in from games/buildswap/behavior_pack/blocks by the runner).
  await scripted("twin-setType", 42, (at) => dimension().getBlock(at).setType("minecade:still_red_concrete_powder"));
  await byPlayer("player-twin-swap", 46, powder, "twin");
  await byPlayer("player-anvil-twin-swap", 50, "minecraft:anvil", "twin");
  for (const id of ["minecraft:anvil", "minecraft:chipped_anvil", "minecraft:damaged_anvil", "minecraft:dragon_egg", "minecraft:light_gray_concrete_powder"]) {
    try {
      out({ id: "states", block: id, states: BlockPermutation.resolve(id).getAllStates() });
    } catch (error) {
      out({ id: "states", block: id, error: String(error) });
    }
  }
  const twins = [];
  for (const id of ["sand", "red_sand", "gravel", "anvil", "chipped_anvil", "damaged_anvil", "dragon_egg", "white_concrete_powder", "light_gray_concrete_powder"]) {
    try {
      twins.push(`${id}: ${JSON.stringify(BlockPermutation.resolve(`minecade:still_${id}`).getAllStates())}`);
    } catch (error) {
      twins.push(`${id}: ${error}`);
    }
  }
  out({ id: "twins", twins });
  out({ id: "done" });
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id === "ph:run") run().catch((error) => out({ id: "done", error: String(error), stack: error?.stack }));
});
