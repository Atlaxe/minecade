// Paintball's paint, as plain logic: what a block becomes when a ball of a dye hits it
// (paintTarget), which blocks a ball's splat or a grenade's burst paints (Painter, through a port
// to the world, so tests run it on plain data), and which team's paint a block shows (paintDyeOf). Full blocks become the dye's concrete; stairs
// and slabs vanilla's concrete stairs and slabs; carpets the dye's carpet; walls, fences, panes,
// gates, doors, trapdoors and vertical slabs Paintball's own painted blocks (shapes.ts). Blocks
// from the shared blocks pack are painted by their shape (the build's "#mod-blocks" table). Small
// things (plants, torches, rails, signs, buttons, ladders, chests, beds, heads) and anything that
// isn't solid (air, liquids, barriers, light) stay as they are.
import { PAINT_SHAPES, SHAPE_STATES, SIDES, paintBlock, parsePaintBlock, type PaintShape, type Side } from "./shapes.ts";

export type States = Record<string, string | number | boolean>;

/** A block's type and states. */
export interface BlockLook {
  typeId: string;
  states: States;
}

export interface Vec {
  x: number;
  y: number;
  z: number;
}

const AIR = "minecraft:air";

/** Blocks that are never painted, by name (without "minecraft:"). */
const NEVER = new Set([
  "air", "allow", "deny", "border_block", "barrier", "invisible_bedrock", "structure_block", "structure_void", "jigsaw", "unknown",
  "command_block", "chain_command_block", "repeating_command_block", "moving_block", "piston_arm_collision", "sticky_piston_arm_collision",
  "water", "flowing_water", "lava", "flowing_lava", "bubble_column", "fire", "soul_fire", "portal", "end_portal", "end_gateway", "powder_snow",
  "anvil", "chipped_anvil", "damaged_anvil", "azalea", "flowering_azalea", "bamboo", "bed", "beetroot", "bell", "big_dripleaf", "small_dripleaf_block",
  "brewing_stand", "brown_mushroom", "red_mushroom", "cactus", "cactus_flower", "cake", "camera", "campfire", "soul_campfire", "carrots", "potatoes", "wheat",
  "cauldron", "lava_cauldron", "chest", "trapped_chest", "ender_chest", "chorus_flower", "chorus_plant", "cocoa", "composter", "conduit",
  "crimson_fungus", "warped_fungus", "daylight_detector", "daylight_detector_inverted", "dragon_egg", "dried_ghast", "enchanting_table",
  "end_portal_frame", "end_rod", "frame", "glow_frame", "frog_spawn", "glow_lichen", "grindstone", "heavy_core", "hopper", "icicle",
  "ladder", "lectern", "lever", "melon_stem", "pumpkin_stem", "nether_sprouts", "nether_wart", "open_eyeblossom", "closed_eyeblossom",
  "pale_hanging_moss", "pink_petals", "leaf_litter", "wildflowers", "pitcher_crop", "pitcher_plant", "pointed_dripstone",
  "powered_comparator", "unpowered_comparator", "powered_repeater", "unpowered_repeater", "redstone_wire", "reeds", "resin_clump",
  "scaffolding", "sea_pickle", "shelf_mushroom", "sniffer_egg", "snow_layer", "spore_blossom", "stonecutter_block", "sulfur_spike",
  "trip_wire", "tripwire_hook", "turtle_egg", "web", "lilac", "peony", "sunflower", "rose_bush", "waterlily", "kelp", "seagrass",
  "lantern", "soul_lantern", "chain", "deadbush", "short_grass", "tall_grass", "fern", "large_fern", "short_dry_grass", "tall_dry_grass",
  "torchflower", "torchflower_crop", "sweet_berry_bush", "cave_vines", "twisting_vines", "weeping_vines", "vine", "hanging_roots",
  "crimson_roots", "warped_roots", "mangrove_propagule", "bamboo_sapling", "decorated_pot", "flower_pot", "calibrated_sculk_sensor",
  "sculk_sensor", "sculk_shrieker", "sculk_vein", "creaking_heart", "bush", "golden_dandelion", "red_shrub", "lab_table",
]);

/** Name patterns that are never painted: small or see-through things, whatever their kind. */
const NEVER_LIKE = [
  /(^|_)torch$/, /^colored_torch_/, /(^|_)rail$/, /_sign$/, /_button$/, /_pressure_plate$/, /_banner$/, /(^|_)head$/, /skull$/, /_bed$/,
  /(^|_)candle(_cake)?$/, /_sapling$/, /_coral(_fan|_wall_fan)?$/, /^light_block/, /lightning_rod$/, /(^|_)copper_(chest|golem_statue|lantern|chain)$/,
  /_amethyst_bud$|^amethyst_cluster$/, /_shelf$/, /_tulip$/, /^(allium|azure_bluet|blue_orchid|cornflower|dandelion|lily_of_the_valley|oxeye_daisy|poppy|wither_rose|red_flower|yellow_flower)$/,
  /_bush$/, /_propagule$/, /^element_/, /_pot$/, /_hanging_moss$/, /^cave_vines/, /(^|_)chain$/,
];

/** A paintable vanilla block's kind, by its name and states. */
type VanillaKind = PaintShape | "stairs" | "slab" | "carpet" | "cube";

export function vanillaKind(name: string, states: States): VanillaKind | undefined {
  if (NEVER.has(name) || NEVER_LIKE.some((pattern) => pattern.test(name))) return undefined;
  if (name.endsWith("_double_slab")) return "cube";
  if (name.endsWith("_slab") || "minecraft:vertical_half" in states) return "slab";
  if (name.endsWith("_stairs")) return "stairs";
  if (name.endsWith("_wall") || "wall_connection_type_north" in states) return "wall";
  if (name.endsWith("fence_gate")) return "fence_gate";
  if (name.endsWith("fence")) return "fence";
  if (name.endsWith("pane") || name.endsWith("bars") || "minecraft:connection_north" in states) return "pane";
  if (name.endsWith("trapdoor")) return "trapdoor";
  if (name.endsWith("_door")) return "door";
  if (name.endsWith("carpet")) return "carpet";
  return "cube";
}

// Vanilla's states for a direction, as the side the block faces (Java's "facing", which the painted
// blocks use): stairs' and trapdoors' numbers, and doors' cardinal direction, which is a quarter turn
// from Java's (a shut door whose cardinal direction is south stands on the block's west side, as a
// Java door facing east). Measured on BDS (spike/paint, docs/spike-results.md). A gate's cardinal
// direction is Java's facing.
/** weirdo_direction 0 to 3 (stairs). */
export const STAIRS_FACING: readonly Side[] = ["east", "west", "south", "north"];
/** direction 0 to 3 (trapdoors). */
export const TRAPDOOR_FACING: readonly Side[] = ["east", "west", "south", "north"];
/** minecraft:cardinal_direction (doors), as the door faces. */
export const DOOR_FACING: Record<string, Side> = { south: "east", west: "south", north: "west", east: "north" };

const bool = (value: unknown) => String(value === true || value === "true" || value === 1);
const side = (value: unknown): Side => (SIDES as readonly unknown[]).includes(value) ? (value as Side) : "north";

/** A painted block's states, from what it's painted over: only its own state names, the rest at their first value. */
function shapeStates(shape: PaintShape, from: States): States {
  const states: States = {};
  for (const [name, values] of Object.entries(SHAPE_STATES[shape])) {
    const value = from[name];
    states[name] = typeof value === "string" && values.includes(value) ? value : values[0];
  }
  return states;
}

/** A vanilla wall's, fence's, pane's, gate's, trapdoor's or door's states as a painted block's (shapes.ts). */
function fromVanilla(shape: PaintShape, states: States): States {
  const out: States = {};
  switch (shape) {
    case "wall": {
      const arm: Record<string, string> = { none: "none", short: "low", tall: "tall" };
      out["minecade:up"] = bool(states.wall_post_bit);
      for (const at of SIDES) out[`minecade:${at}`] = arm[String(states[`wall_connection_type_${at}`])] ?? "none";
      break;
    }
    case "fence":
    case "pane":
      for (const at of SIDES) out[`minecade:${at}`] = bool(states[`minecraft:connection_${at}`]);
      break;
    case "fence_gate":
      out["minecade:facing"] = side(states["minecraft:cardinal_direction"]);
      out["minecade:open"] = bool(states.open_bit);
      out["minecade:in_wall"] = bool(states.in_wall_bit);
      break;
    case "trapdoor":
      out["minecade:facing"] = TRAPDOOR_FACING[Number(states.direction) & 3];
      out["minecade:half"] = states.upside_down_bit === true ? "top" : "bottom";
      out["minecade:open"] = bool(states.open_bit);
      break;
    case "door":
      out["minecade:facing"] = DOOR_FACING[String(states["minecraft:cardinal_direction"])] ?? "north";
      out["minecade:half"] = states.upper_block_bit === true ? "upper" : "lower";
      out["minecade:hinge"] = states.door_hinge_bit === true ? "right" : "left";
      out["minecade:open"] = bool(states.open_bit);
      break;
    case "vertical_slab":
      break;
  }
  return shapeStates(shape, out);
}

/** Mod stairs' (or painted-from) facing, half and shape as vanilla stairs' states. */
function stairsStates(facing: unknown, top: boolean, shape: unknown): States {
  const corner = typeof shape === "string" && shape !== "straight" ? shape : "none";
  return { weirdo_direction: Math.max(0, STAIRS_FACING.indexOf(side(facing))), upside_down_bit: top, "minecraft:corner": corner };
}

const concrete = (dye: string) => ({ typeId: `minecraft:${dye}_concrete`, states: {} });

/** A mod block (the shared blocks pack's) painted, by its shape. */
function paintMod(shape: string, states: States, dye: string): BlockLook | undefined {
  switch (shape) {
    case "cube":
      return concrete(dye);
    case "stairs":
      return { typeId: `minecraft:${dye}_concrete_stairs`, states: stairsStates(states["minecade:facing"], states["minecade:half"] === "top", states["minecade:shape"]) };
    case "slab":
      if (states["minecade:type"] === "double") return concrete(dye);
      return { typeId: `minecraft:${dye}_concrete_slab`, states: { "minecraft:vertical_half": states["minecade:type"] === "top" ? "top" : "bottom" } };
    case "vertical_slab":
      if (states["minecade:type"] === "double") return concrete(dye);
      return { typeId: paintBlock(dye, "vertical_slab"), states: shapeStates("vertical_slab", states) };
    case "gate":
      return { typeId: paintBlock(dye, "fence_gate"), states: shapeStates("fence_gate", states) };
    default:
      return (PAINT_SHAPES as readonly string[]).includes(shape) ? { typeId: paintBlock(dye, shape as PaintShape), states: shapeStates(shape as PaintShape, states) } : undefined;
  }
}

/**
 * What a block becomes in a dye's paint, or undefined to leave it as it is (it can't be painted, or
 * it's that color already). `modShape` is a mod block's shape from "#mod-blocks".
 */
export function paintTarget(block: BlockLook, dye: string, modShape?: string): BlockLook | undefined {
  const painted = paintedLook(block, dye, modShape);
  if (!painted || (painted.typeId === block.typeId && sameStates(painted.states, block.states))) return undefined;
  return painted;
}

function paintedLook(block: BlockLook, dye: string, modShape?: string): BlockLook | undefined {
  const own = parsePaintBlock(block.typeId);
  if (own) return { typeId: paintBlock(dye, own.shape), states: shapeStates(own.shape, block.states) };
  if (!block.typeId.startsWith("minecraft:")) return modShape ? paintMod(modShape, block.states, dye) : undefined;
  const name = block.typeId.slice("minecraft:".length);
  const kind = vanillaKind(name, block.states);
  switch (kind) {
    case undefined:
      return undefined;
    case "cube":
      return concrete(dye);
    case "carpet":
      return { typeId: `minecraft:${dye}_carpet`, states: {} };
    case "stairs":
      return {
        typeId: `minecraft:${dye}_concrete_stairs`,
        states: { weirdo_direction: Number(block.states.weirdo_direction ?? 0), upside_down_bit: block.states.upside_down_bit === true, "minecraft:corner": String(block.states["minecraft:corner"] ?? "none") },
      };
    case "slab":
      return { typeId: `minecraft:${dye}_concrete_slab`, states: { "minecraft:vertical_half": block.states["minecraft:vertical_half"] === "top" ? "top" : "bottom" } };
    default:
      return { typeId: paintBlock(dye, kind), states: fromVanilla(kind, block.states) };
  }
}

function sameStates(a: States, b: States): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** Whether a block is one half of a door (vanilla's, a mod one or a painted one), and which. */
function doorHalf(block: BlockLook, modShape: string | undefined): "lower" | "upper" | undefined {
  const own = parsePaintBlock(block.typeId);
  if (own?.shape === "door" || modShape === "door") return block.states["minecade:half"] === "upper" ? "upper" : "lower";
  if (block.typeId.startsWith("minecraft:") && vanillaKind(block.typeId.slice("minecraft:".length), block.states) === "door") return block.states.upper_block_bit === true ? "upper" : "lower";
  return undefined;
}

/**
 * A door's two halves keep different states in vanilla (the lower its facing and whether it's open,
 * the upper its hinge): the painted halves take each from the half that keeps it.
 */
function mergeDoor(lower: BlockLook, upper: BlockLook): { lower: States; upper: States } {
  const vanilla = lower.typeId.startsWith("minecraft:");
  const facing = vanilla ? "minecraft:cardinal_direction" : "minecade:facing";
  const open = vanilla ? "open_bit" : "minecade:open";
  const hinge = vanilla ? "door_hinge_bit" : "minecade:hinge";
  const base = { ...lower.states, [hinge]: upper.states[hinge] ?? lower.states[hinge] };
  const half = vanilla ? "upper_block_bit" : "minecade:half";
  return { lower: { ...base, [half]: vanilla ? false : "lower" }, upper: { ...base, [facing]: lower.states[facing], [open]: lower.states[open], [half]: vanilla ? true : "upper" } };
}

/**
 * The dye a block shows as paint: a dye's concrete (stairs, slabs), carpet, or a painted shape. Any
 * such block counts, painted or built that way. Undefined for anything else.
 */
export function paintDyeOf(typeId: string): string | undefined {
  const own = parsePaintBlock(typeId);
  if (own) return own.dye;
  return /^minecraft:([a-z_]+?)_(concrete|concrete_stairs|concrete_slab|concrete_double_slab|carpet)$/.exec(typeId)?.[1];
}

/** A block as the painter reads it from the world. */
export interface WorldBlock extends BlockLook {
  /** Paint flies through it as through air: a plant, a torch, a rail. */
  open?: boolean;
}

/** What Painter needs of the world. */
export interface PaintPort {
  /** The block at a place (air where there's none); undefined where it can't be read (unloaded). */
  read(at: Vec): WorldBlock | undefined;
  /** Puts a block there; false if it couldn't. */
  write(at: Vec, look: BlockLook): boolean;
  /** Whether a place may be painted (inside the map's bounds). */
  inside(at: Vec): boolean;
  /** A mod block's shape ("#mod-blocks"), if it has a paintable one. */
  modShape(typeId: string): string | undefined;
}

/** The faces a ball can hit, as the way out of the block. */
export const FACE_OUT: Record<string, Vec> = {
  Up: { x: 0, y: 1, z: 0 },
  Down: { x: 0, y: -1, z: 0 },
  North: { x: 0, y: 0, z: -1 },
  South: { x: 0, y: 0, z: 1 },
  East: { x: 1, y: 0, z: 0 },
  West: { x: -1, y: 0, z: 0 },
};
const NEIGHBORS = Object.values(FACE_OUT);

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const keyOf = (at: Vec) => `${at.x},${at.y},${at.z}`;
const floor = (at: Vec): Vec => ({ x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) });

export class Painter {
  private readonly port: PaintPort;

  constructor(port: PaintPort) {
    this.port = port;
  }

  /** Paints one block (both halves of a door) in a dye; the number of blocks it changed. */
  paint(at: Vec, dye: string): number {
    const place = floor(at);
    if (!this.port.inside(place)) return 0;
    const block = this.port.read(place);
    if (!block || block.typeId === AIR) return 0;
    const modShape = block.typeId.startsWith("minecraft:") ? undefined : this.port.modShape(block.typeId);
    const half = doorHalf(block, modShape);
    if (half) return this.paintDoor(place, block, half, dye, modShape);
    const target = paintTarget(block, dye, modShape);
    return target && this.port.write(place, target) ? 1 : 0;
  }

  private paintDoor(at: Vec, block: BlockLook, half: "lower" | "upper", dye: string, modShape: string | undefined): number {
    const otherAt = add(at, { x: 0, y: half === "lower" ? 1 : -1, z: 0 });
    const other = this.port.read(otherAt);
    if (!other || other.typeId !== block.typeId || !this.port.inside(otherAt)) {
      const target = paintTarget(block, dye, modShape);
      return target && this.port.write(at, target) ? 1 : 0;
    }
    const [lowerAt, upperAt] = half === "lower" ? [at, otherAt] : [otherAt, at];
    const [lower, upper] = half === "lower" ? [block, other] : [other, block];
    const merged = mergeDoor(lower, upper);
    let painted = 0;
    for (const [place, states] of [
      [lowerAt, merged.lower],
      [upperAt, merged.upper],
    ] as const) {
      const target = paintTarget({ typeId: block.typeId, states }, dye, modShape);
      if (target && this.port.write(place, target)) painted++;
    }
    return painted;
  }

  /**
   * A ball's splat: the block it hit (at `hit`, on its `face`), and every block with a face within
   * `radius` of where it hit (`point`) that the paint reaches through the open air in front of the
   * hit. On a floor or a wall that's a circle `radius` * 2 across; it runs up walls and over edges
   * the air leads to, never through a wall to its other side. What the air holds (a carpet) counts
   * too; plants and torches, which paint flies through, aren't painted.
   */
  splatBlocks(point: Vec, hit: Vec, face: string, radius: number): Vec[] {
    const out = FACE_OUT[face] ?? FACE_OUT.Up;
    const struck = floor(hit);
    const center = onFace(point, struck, out);
    const cache = new Map<string, WorldBlock | undefined>();
    const read = (at: Vec) => {
      const key = keyOf(at);
      if (!cache.has(key)) cache.set(key, this.port.read(at));
      return cache.get(key);
    };
    const found = new Map<string, Vec>([[keyOf(struck), struck]]);
    const first = add(struck, out);
    const seen = new Set<string>([keyOf(first)]);
    const queue: Vec[] = [first];
    // An air cell is worth going through while one of its faces (half a block from its middle) may be in reach.
    const cellReach = radius + 0.5;
    while (queue.length > 0) {
      const cell = queue.shift()!;
      const here = read(cell);
      if (!isOpen(here)) continue;
      if (here!.typeId !== AIR && gap(middle(cell), center) <= radius) found.set(keyOf(cell), cell);
      for (const step of NEIGHBORS) {
        const next = add(cell, step);
        const key = keyOf(next);
        const block = read(next);
        if (isOpen(block)) {
          if (!seen.has(key) && gap(middle(next), center) <= cellReach) {
            seen.add(key);
            queue.push(next);
          }
        } else if (block && gap(faceMiddle(cell, step), center) <= radius) {
          found.set(key, next);
        }
      }
    }
    return [...found.values()];
  }

  /** Paints a ball's splat; the number of blocks it changed. */
  splat(point: Vec, hit: Vec, face: string, dye: string, radius: number): number {
    return this.splatBlocks(point, hit, face, radius).reduce((sum, at) => sum + this.paint(at, dye), 0);
  }

  /** The blocks of a ball `radius` blocks around `center` that show (a side open to the air). */
  burstBlocks(center: Vec, radius: number): Vec[] {
    const found: Vec[] = [];
    const middle = floor(center);
    const reach = Math.ceil(radius);
    for (let x = -reach; x <= reach; x++) {
      for (let y = -reach; y <= reach; y++) {
        for (let z = -reach; z <= reach; z++) {
          const at = { x: middle.x + x, y: middle.y + y, z: middle.z + z };
          const dx = at.x + 0.5 - center.x;
          const dy = at.y + 0.5 - center.y;
          const dz = at.z + 0.5 - center.z;
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          const block = this.port.read(at);
          if (!block || block.typeId === AIR) continue;
          if (NEIGHBORS.some((step) => this.port.read(add(at, step))?.typeId === AIR)) found.push(at);
        }
      }
    }
    return found;
  }

  /** Paints a grenade's burst; the number of blocks it changed. */
  burst(center: Vec, radius: number, dye: string): number {
    return this.burstBlocks(center, radius).reduce((sum, at) => sum + this.paint(at, dye), 0);
  }
}

/** Air, or something paint flies through (a plant, a torch). Not where it can't be read. */
const isOpen = (block: WorldBlock | undefined) => block !== undefined && (block.typeId === AIR || block.open === true);
const gap = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const middle = (at: Vec): Vec => ({ x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 });
/** The middle of the face between a cell and the one a step away. */
const faceMiddle = (at: Vec, step: Vec): Vec => ({ x: at.x + 0.5 + step.x / 2, y: at.y + 0.5 + step.y / 2, z: at.z + 0.5 + step.z / 2 });

/** The point on a block's face (`out` from the block) nearest `point`: where a ball met it. */
function onFace(point: Vec, block: Vec, out: Vec): Vec {
  const clamp = (value: number, low: number) => Math.min(low + 1, Math.max(low, value));
  const on = { x: clamp(point.x, block.x), y: clamp(point.y, block.y), z: clamp(point.z, block.z) };
  if (out.x !== 0) on.x = block.x + (out.x > 0 ? 1 : 0);
  if (out.y !== 0) on.y = block.y + (out.y > 0 ? 1 : 0);
  if (out.z !== 0) on.z = block.z + (out.z > 0 ? 1 : 0);
  return on;
}

/** A painted door's, trapdoor's or gate's states opened or shut (a right click); both door halves take the same. */
export function toggled(states: States): States {
  return { ...states, "minecade:open": states["minecade:open"] === "true" ? "false" : "true" };
}
