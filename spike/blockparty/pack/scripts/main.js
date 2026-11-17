// Block Party's arena check: can a minigame's arena, written as a .mcstructure file from another
// map's world (tools/maps/structure.ts) and shipped in a behavior pack's structures/
// folder, be placed into a board's world far from the board, exactly? Prints BP|{json} lines;
// spike/blockparty/run.ts reads them. The world is a copy of the arena's own map, so the original
// blocks are right there to compare against.
import { system, world } from "@minecraft/server";

const out = (id, data) => console.log(`BP|${JSON.stringify({ id, ...data })}`);
const wait = (ticks) => new Promise((resolve) => system.runTimeout(resolve, ticks));
const dim = () => world.getDimension("overworld");

/** Runs a generator as a job (a little each tick) and resolves when it's done. */
function job(generator) {
  return new Promise((resolve, reject) => {
    function* wrapped() {
      try {
        yield* generator;
        resolve();
      } catch (error) {
        reject(error);
      }
    }
    system.runJob(wrapped());
  });
}

/** What a block is: its type, its states (sorted) and whether it holds water. */
function blockKey(block) {
  if (!block) return "unloaded";
  const states = block.permutation.getAllStates();
  const sorted = Object.keys(states)
    .sort()
    .map((key) => `${key}=${states[key]}`)
    .join(",");
  return `${block.typeId}[${sorted}]${block.isWaterlogged ? "~water" : ""}`;
}

/** Every block of a box as ids of their keys (z fastest, then y, then x), plus what's in containers and on signs. */
function* scan(min, size, keys, into, extra) {
  const d = dim();
  let n = 0;
  for (let x = 0; x < size.x; x++) {
    for (let y = 0; y < size.y; y++) {
      for (let z = 0; z < size.z; z++) {
        const block = d.getBlock({ x: min.x + x, y: min.y + y, z: min.z + z });
        const key = blockKey(block);
        let id = keys.get(key);
        if (id === undefined) {
          id = keys.size;
          keys.set(key, id);
        }
        into[n++] = id;
        const inventory = block?.getComponent("minecraft:inventory")?.container;
        if (inventory) {
          let items = 0;
          for (let slot = 0; slot < inventory.size; slot++) items += inventory.getItem(slot)?.amount ?? 0;
          extra.push(`inv@${x},${y},${z}:${items}`);
        }
        const sign = block?.getComponent("minecraft:sign");
        if (sign) extra.push(`sign@${x},${y},${z}:${sign.getText() ?? ""}`);
        if (n % 512 === 0) yield;
      }
    }
  }
}

async function area(name, min, max) {
  const manager = world.tickingAreaManager;
  const started = system.currentTick;
  await manager.createTickingArea(name, { dimension: dim(), from: min, to: max });
  return system.currentTick - started;
}

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

/** Scans the copy and says how it differs from the source: how many blocks, the first few, and counts by kind. */
async function compareCopy(id, source, sourceExtra, copyMin, size, keys) {
  const copy = new Int32Array(source.length);
  const copyExtra = [];
  const started = Date.now();
  await job(scan(copyMin, size, keys, copy, copyExtra));
  const names = [...keys.keys()];
  const mismatches = [];
  const kinds = {};
  let differ = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === copy[i]) continue;
    differ++;
    const from = names[source[i]].replace(/\[.*$/, "");
    const to = names[copy[i]].replace(/\[.*$/, "");
    const kind = `${from} > ${to}`;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (mismatches.length < 4) {
      const x = Math.floor(i / (size.y * size.z));
      const y = Math.floor(i / size.z) % size.y;
      const z = i % size.z;
      mismatches.push({ at: [x, y, z], source: names[source[i]], copy: names[copy[i]] });
    }
  }
  const extraSame = JSON.stringify(sourceExtra) === JSON.stringify(copyExtra);
  out(id, { ms: Date.now() - started, blocks: source.length, differ, kinds, mismatches, containersAndSignsSame: extraSame });
}

async function compareArena(arena) {
  const min = arena.min;
  const size = arena.size;
  const max = add(min, { x: size.x - 1, y: size.y - 1, z: size.z - 1 });
  const offset = arena.offset;
  out("source_area", { ticks: await area("bp_source", min, max) });
  const keys = new Map();
  const source = new Int32Array(size.x * size.y * size.z);
  const sourceExtra = [];
  let started = Date.now();
  await job(scan(min, size, keys, source, sourceExtra));
  out("source_scanned", { ms: Date.now() - started, kinds: keys.size, containers: sourceExtra.filter((e) => e.startsWith("inv")).length, signs: sourceExtra.filter((e) => e.startsWith("sign")).length });

  const structure = world.structureManager.get(arena.id);
  out("structure", { id: arena.id, found: !!structure, size: structure?.size });
  const copyMin = add(min, offset);
  out("copy_area", { ticks: await area("bp_copy", copyMin, add(max, offset)), chunkCount: world.tickingAreaManager.chunkCount });
  started = Date.now();
  world.structureManager.place(arena.id, dim(), copyMin, { includeEntities: false });
  out("placed", { ms: Date.now() - started });
  await wait(2);

  await compareCopy("compared", source, sourceExtra, copyMin, size, keys);
  // Blocks that pop off or change when their neighbors aren't there yet: does a second placement fix them?
  started = Date.now();
  world.structureManager.place(arena.id, dim(), copyMin, { includeEntities: false });
  out("placed_again", { ms: Date.now() - started });
  await wait(2);
  await compareCopy("compared_again", source, sourceExtra, copyMin, size, keys);
  world.tickingAreaManager.removeTickingArea("bp_source");
  world.tickingAreaManager.removeTickingArea("bp_copy");
}

/** The big synthetic structure: concrete in a pattern only a whole placement gets right everywhere. */
async function checkBig(big) {
  const structure = world.structureManager.get(big.id);
  out("big_structure", { id: big.id, found: !!structure, size: structure?.size });
  if (!structure) return;
  const size = structure.size;
  const min = big.at;
  const max = add(min, { x: size.x - 1, y: size.y - 1, z: size.z - 1 });
  const manager = world.tickingAreaManager;
  out("big_area", { fits: manager.hasCapacity({ dimension: dim(), from: min, to: max }), ticks: await area("bp_big", min, max), chunkCount: manager.chunkCount });
  let started = Date.now();
  let placeError;
  try {
    world.structureManager.place(big.id, dim(), min, { includeEntities: false });
  } catch (error) {
    placeError = String(error);
  }
  out("big_placed", { ms: Date.now() - started, error: placeError });
  await wait(2);
  const colors = big.colors;
  let wrong = 0;
  let first;
  started = Date.now();
  await job(
    (function* () {
      const d = dim();
      for (let x = 0; x < size.x; x++) {
        for (let y = 0; y < size.y; y++) {
          for (let z = 0; z < size.z; z++) {
            const want = colors[(x + 3 * z + 7 * y) % colors.length];
            const got = d.getBlock({ x: min.x + x, y: min.y + y, z: min.z + z })?.typeId;
            if (got !== want) {
              wrong++;
              first ??= { at: [x, y, z], want, got };
            }
          }
          yield;
        }
      }
    })(),
  );
  out("big_checked", { ms: Date.now() - started, blocks: size.x * size.y * size.z, wrong, first });
  manager.removeTickingArea("bp_big");
}

async function run(spec) {
  out("limits", { maxChunkCount: world.tickingAreaManager.maxChunkCount, worldStructures: world.structureManager.getWorldStructureIds() });
  await compareArena(spec.arena);
  await checkBig(spec.big);
}

system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
  if (id !== "bp:run") return;
  run(JSON.parse(message))
    .catch((error) => out("error", { message: String(error), stack: error?.stack }))
    .finally(() => out("done", {}));
});
