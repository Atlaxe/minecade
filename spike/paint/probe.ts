// Paint shapes check (the pack script spike/paint/run.ts bundles): for every state of vanilla's
// doors, trapdoors and fence gates, it places the vanilla block and, beside it, the painted block
// Paintball makes of it (paint.ts paintTarget), then casts rays at both from every side and prints
// where each ray hits. A painted block that keeps its shape is hit in the same places. It also
// places every painted block in every state, so a state Bedrock refuses shows as an error.
//   scriptevent paint:probe        runs it and prints "PAINT|" lines, then "PAINT|done"
import { BlockPermutation, system, world, type Vector3 } from "@minecraft/server";
import { paintTarget, type States } from "../../games/paintball/behavior_pack/scripts/paint.ts";
import { PAINT_SHAPES, PAINT_USE, SHAPE_STATES, paintBlock } from "../../games/paintball/behavior_pack/scripts/shapes.ts";

const Y = 101;
const out = (value: unknown) => console.log(`PAINT|${JSON.stringify(value)}`);
const SIDES = ["north", "east", "south", "west"];

/** Rays toward the block's middle from each side (and from above and below), at a height in it. */
const RAYS: { name: string; from: Vector3; dir: Vector3 }[] = [
  { name: "from_north", from: { x: 0.5, y: 0.5, z: -1.5 }, dir: { x: 0, y: 0, z: 1 } },
  { name: "from_south", from: { x: 0.5, y: 0.5, z: 2.5 }, dir: { x: 0, y: 0, z: -1 } },
  { name: "from_west", from: { x: -1.5, y: 0.5, z: 0.5 }, dir: { x: 1, y: 0, z: 0 } },
  { name: "from_east", from: { x: 2.5, y: 0.5, z: 0.5 }, dir: { x: -1, y: 0, z: 0 } },
  { name: "from_above", from: { x: 0.5, y: 2.5, z: 0.5 }, dir: { x: 0, y: -1, z: 0 } },
  { name: "from_below", from: { x: 0.5, y: -1.5, z: 0.5 }, dir: { x: 0, y: 1, z: 0 } },
];

/** Where each ray first hits the block at `at`: the face and how far into the block, or "-". */
function signature(at: Vector3): string {
  const dimension = world.getDimension("overworld");
  return RAYS.map((ray) => {
    const origin = { x: at.x + ray.from.x, y: at.y + ray.from.y, z: at.z + ray.from.z };
    const hit = dimension.getBlockFromRay(origin, ray.dir, { maxDistance: 4, includePassableBlocks: true, includeLiquidBlocks: false });
    if (!hit || hit.block.x !== at.x || hit.block.y !== at.y || hit.block.z !== at.z) return `${ray.name}:-`;
    const depth = ray.dir.x !== 0 ? hit.faceLocation.x : ray.dir.y !== 0 ? hit.faceLocation.y : hit.faceLocation.z;
    return `${ray.name}:${hit.face}@${Math.round(depth * 100) / 100}`;
  }).join(" ");
}

function put(at: Vector3, typeId: string, states: States): string | undefined {
  try {
    world.getDimension("overworld").getBlock(at)?.setPermutation(BlockPermutation.resolve(typeId, states));
    return undefined;
  } catch (error) {
    return String(error);
  }
}

function clear(at: Vector3): void {
  world.getDimension("overworld").getBlock(at)?.setType("minecraft:air");
}

/** Every combination of the states named. */
function combinations(states: Record<string, readonly (string | number | boolean)[]>): States[] {
  let list: States[] = [{}];
  for (const [name, values] of Object.entries(states)) list = list.flatMap((partial) => values.map((value) => ({ ...partial, [name]: value })));
  return list;
}

/** Compares one vanilla block (with an upper half for doors) and its painted copy. */
function compare(id: string, typeId: string, states: States, upper?: States): void {
  const vanilla = { x: 0, y: Y, z: 0 };
  const painted = { x: 6, y: Y, z: 0 };
  for (const at of [vanilla, painted]) {
    clear(at);
    clear({ ...at, y: at.y + 1 });
  }
  const errors: string[] = [];
  const target = paintTarget({ typeId, states }, "red");
  if (!target) return out({ id, error: "no painted block" });
  errors.push(put(vanilla, typeId, states) ?? "");
  errors.push(put(painted, target.typeId, target.states) ?? "");
  if (upper) {
    const top = paintTarget({ typeId, states: upper }, "red")!;
    errors.push(put({ ...vanilla, y: Y + 1 }, typeId, upper) ?? "");
    errors.push(put({ ...painted, y: Y + 1 }, top.typeId, top.states) ?? "");
  }
  const a = signature(vanilla);
  const b = signature(painted);
  out({ id, same: a === b, vanilla: a, painted: b, target: target.states, errors: errors.filter(Boolean) });
}

function probe(): void {
  // Something to stand doors on.
  world.getDimension("overworld").runCommand(`fill -2 ${Y - 1} -2 8 ${Y - 1} 2 stone`);
  for (const facing of SIDES) {
    for (const open of [false, true]) {
      for (const hinge of [false, true]) {
        const lower = { "minecraft:cardinal_direction": facing, open_bit: open, upper_block_bit: false, door_hinge_bit: hinge };
        compare(`door ${facing} open=${open} hinge=${hinge}`, "minecraft:wooden_door", lower, { ...lower, upper_block_bit: true });
      }
      compare(`gate ${facing} open=${open}`, "minecraft:fence_gate", { "minecraft:cardinal_direction": facing, open_bit: open, in_wall_bit: false });
    }
  }
  world.getDimension("overworld").runCommand(`fill -2 ${Y - 1} -2 8 ${Y - 1} 2 air`);
  for (let direction = 0; direction < 4; direction++) {
    for (const open of [false, true]) {
      for (const top of [false, true]) compare(`trapdoor ${direction} open=${open} top=${top}`, "minecraft:trapdoor", { direction, open_bit: open, upside_down_bit: top });
    }
  }
  // Every painted block in every state: Bedrock refuses a state it doesn't have.
  let placed = 0;
  const refused: string[] = [];
  for (const shape of PAINT_SHAPES) {
    for (const dye of ["red", "blue", "yellow", "green"]) {
      for (const states of combinations(SHAPE_STATES[shape])) {
        const error = put({ x: 0, y: Y + 4, z: 0 }, paintBlock(dye, shape), states);
        if (error) refused.push(`${paintBlock(dye, shape)} ${JSON.stringify(states)}: ${error}`);
        else placed++;
      }
    }
  }
  out({ id: "states", placed, refused: refused.slice(0, 10), refusedCount: refused.length });
  console.log("PAINT|done");
}

// The painted doors', trapdoors' and gates' right click (the game's main.ts registers it the same way):
// a block naming a custom component nobody registered fails to load.
system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => blockComponentRegistry.registerCustomComponent(PAINT_USE, {}));

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id === "paint:probe") system.run(probe);
});
