// Map editor spike (run by spike/editor/run.ts). Commands arrive as scriptevents with a JSON
// message; results go to the console as `ES|<json>` lines.
//   es:fingerprint {id, min, max}         every non-air block in the box: relative position, type,
//                                         states, container contents and sign text, hashed; plus
//                                         counts and the entities inside
//   es:probe {id, min, sizes: [[x,y,z]]}  which structure sizes createFromWorld accepts, and how long
//   es:move {id, min, max, offset, tile}  captures the box in tile x tile columns (full height),
//                                         clears it (entities, then air in 32-block cubes) and
//                                         places the tiles at min + offset
import { BlockVolume, StructureSaveMode, system, world } from "@minecraft/server";

const out = (data) => console.log(`ES|${JSON.stringify(data)}`);

function fnv(hash, text) {
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

const sizeOf = (min, max) => ({ x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 });

function* fingerprint({ id, min, max }) {
  const dim = world.getDimension("overworld");
  const started = Date.now();
  let hash = 2166136261;
  let solid = 0;
  let containers = 0;
  let items = 0;
  let signs = 0;
  let unloaded = 0;
  const byType = {};
  for (let x = min.x; x <= max.x; x++) {
    for (let y = min.y; y <= max.y; y++) {
      for (let z = min.z; z <= max.z; z++) {
        let block;
        try {
          block = dim.getBlock({ x, y, z });
        } catch {
          unloaded++;
          continue;
        }
        if (!block || block.typeId === "minecraft:air") continue;
        solid++;
        let text = `${x - min.x},${y - min.y},${z - min.z}:${block.typeId}:${JSON.stringify(block.permutation.getAllStates())}`;
        const container = block.getComponent("minecraft:inventory")?.container;
        if (container) {
          containers++;
          for (let slot = 0; slot < container.size; slot++) {
            const item = container.getItem(slot);
            if (!item) continue;
            items += item.amount;
            text += `|${slot}=${item.typeId}x${item.amount}`;
          }
        }
        const sign = block.getComponent("minecraft:sign");
        if (sign) {
          signs++;
          text += `|sign=${sign.getText() ?? ""}`;
        }
        hash = fnv(hash, text);
        const entry = (byType[block.typeId] ??= [0, 2166136261]);
        entry[0]++;
        entry[1] = fnv(entry[1], text);
      }
      yield;
    }
  }
  const entities = dim
    .getEntities({ location: min, volume: sizeOf(min, max) })
    .filter((entity) => entity.typeId !== "minecraft:player")
    .map((entity) => entity.typeId);
  out({ id, part: "fingerprint", hash: hash.toString(16), solid, containers, items, signs, unloaded, entities: entities.length, entityTypes: [...new Set(entities)], ms: Date.now() - started });
  // Per block type: count and hash, to find what differs between two fingerprints.
  out({ id, part: "types", byType: Object.fromEntries(Object.entries(byType).map(([type, [count, typeHash]]) => [type, `${count}:${typeHash.toString(16)}`])) });
}

function probe({ id, min, sizes }) {
  const dim = world.getDimension("overworld");
  const results = [];
  for (const [sx, sy, sz] of sizes) {
    const name = `es:probe_${sx}_${sy}_${sz}`;
    const started = Date.now();
    try {
      world.structureManager.createFromWorld(name, dim, min, { x: min.x + sx - 1, y: min.y + sy - 1, z: min.z + sz - 1 }, { includeEntities: true, saveMode: StructureSaveMode.Memory });
      results.push({ size: [sx, sy, sz], ok: true, ms: Date.now() - started });
      world.structureManager.delete(name);
    } catch (error) {
      results.push({ size: [sx, sy, sz], ok: false, error: String(error).slice(0, 240) });
    }
  }
  out({ id, part: "probe", results });
}

function* move({ id, min, max, offset, tile, passes = 1 }) {
  const dim = world.getDimension("overworld");
  const started = Date.now();
  const tiles = [];
  let captureMs = 0;
  let clearMs = 0;
  let placeMs = 0;
  for (let x = min.x; x <= max.x; x += tile) {
    for (let z = min.z; z <= max.z; z += tile) {
      const from = { x, y: min.y, z };
      const to = { x: Math.min(x + tile - 1, max.x), y: max.y, z: Math.min(z + tile - 1, max.z) };
      const name = `es:tile_${tiles.length}`;
      const t0 = Date.now();
      world.structureManager.createFromWorld(name, dim, from, to, { includeEntities: true, saveMode: StructureSaveMode.Memory });
      captureMs += Date.now() - t0;
      tiles.push({ name, from });
      yield;
    }
  }
  let t0 = Date.now();
  let removed = 0;
  for (const entity of dim.getEntities({ location: min, volume: sizeOf(min, max) })) {
    if (entity.typeId === "minecraft:player") continue;
    entity.remove();
    removed++;
  }
  for (let x = min.x; x <= max.x; x += 32) {
    for (let y = min.y; y <= max.y; y += 32) {
      for (let z = min.z; z <= max.z; z += 32) {
        const to = { x: Math.min(x + 31, max.x), y: Math.min(y + 31, max.y), z: Math.min(z + 31, max.z) };
        dim.fillBlocks(new BlockVolume({ x, y, z }, to), "minecraft:air");
      }
      yield;
    }
  }
  clearMs = Date.now() - t0;
  for (let pass = 0; pass < passes; pass++) {
    for (const { name, from } of tiles) {
      t0 = Date.now();
      // Entities only once, or they would be doubled.
      world.structureManager.place(name, dim, { x: from.x + offset.x, y: from.y + offset.y, z: from.z + offset.z }, { includeEntities: pass === 0 });
      placeMs += Date.now() - t0;
      yield;
    }
  }
  for (const { name } of tiles) world.structureManager.delete(name);
  let drops = 0;
  const moved = { x: min.x + offset.x, y: min.y + offset.y, z: min.z + offset.z };
  for (const [location, size] of [[min, sizeOf(min, max)], [moved, sizeOf(min, max)]]) {
    for (const entity of dim.getEntities({ location, volume: size, type: "minecraft:item" })) {
      entity.remove();
      drops++;
    }
  }
  out({ id, part: "move", tiles: tiles.length, passes, removedEntities: removed, drops, captureMs, clearMs, placeMs, ms: Date.now() - started });
}

const COMMANDS = { "es:fingerprint": fingerprint, "es:probe": probe, "es:move": move };

system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
  const command = COMMANDS[id];
  if (!command) return;
  const args = JSON.parse(message);
  system.runJob(
    (function* () {
      try {
        const result = command(args);
        if (result && typeof result.next === "function") yield* result;
      } catch (error) {
        out({ id: args.id, part: "error", error: String(error).slice(0, 400) });
      }
      out({ id: args.id, part: "end" });
    })(),
  );
});
