// How the viewer draws each block that isn't a plain cube, and what a click on it does: slabs,
// stairs, thin layers, posts, doors, gates and trapdoors as boxes, plants as two crossed faces,
// water and lava a little under full height, and custom blocks by their collision boxes (the Panel
// reads those from the blocks pack: tools/viewer/custom-shapes.ts). Boxes are in sixteenths of a
// block, x east, y up, z south, as Java's block shapes are. Direction states follow what Paintball
// measured on BDS (docs/spike-results.md, "Painted shapes"; games/paintball's paint.ts). Plain
// TypeScript: the page and the mesh workers use it.
import type { ViewLook } from "../../viewer/view-format.ts";

/** A box in sixteenths: x0, y0, z0, x1, y1, z1. */
export type Box16 = readonly [number, number, number, number, number, number];

export interface Shape {
  /** The boxes it's drawn as (none for a plant). */
  boxes: Box16[];
  /** Two crossed faces (flowers, grass, torches): drawn, never clicked. */
  cross?: boolean;
  /** Water or lava: its top 2/16 under the block's unless the same liquid is above; never clicked. */
  liquid?: "water" | "lava";
  /** Clicks pass through it (plants, liquids, signs, flat things on the ground). */
  passable?: boolean;
}

export const FULL: Box16 = [0, 0, 0, 16, 16, 16];
export const CUBE: Shape = { boxes: [FULL] };
/** How high a liquid's top is, in sixteenths, without the same liquid above it. */
export const LIQUID_TOP = 14;

/** What a custom block's behavior pack says (custom-shapes.ts): its boxes, a plant (no collision), or a cube. */
export type CustomShape = { boxes: Box16[]; seeThrough?: boolean } | { plant: true; seeThrough?: boolean } | { cube: true; seeThrough?: boolean };

const SIDES = ["north", "east", "south", "west"] as const;
type Side = (typeof SIDES)[number];

/** Swaps x and z: a box along one axis as the same box along the other. */
const swapXZ = ([x0, y0, z0, x1, y1, z1]: Box16): Box16 => [z0, y0, x0, z1, y1, x1];
/** Mirrors z (south to north). */
const flipZ = ([x0, y0, z0, x1, y1, z1]: Box16): Box16 => [x0, y0, 16 - z1, x1, y1, 16 - z0];
/** Mirrors x (east to west). */
const flipX = ([x0, y0, z0, x1, y1, z1]: Box16): Box16 => [16 - x1, y0, z0, 16 - x0, y1, z1];
/** Mirrors y (bottom to top). */
const flipY = ([x0, y0, z0, x1, y1, z1]: Box16): Box16 => [x0, 16 - y1, z0, x1, 16 - y0, z1];

/** A box on the north side turned to `side` (north is as given). */
function toSide(box: Box16, side: Side): Box16 {
  if (side === "north") return box;
  if (side === "south") return flipZ(box);
  const west = swapXZ(box);
  return side === "west" ? west : flipX(west);
}

/** The side a quarter turn counterclockwise (seen from above) and clockwise. */
const COUNTERCLOCKWISE: Record<Side, Side> = { north: "west", west: "south", south: "east", east: "north" };
const CLOCKWISE: Record<Side, Side> = { north: "east", east: "south", south: "west", west: "north" };

/** A quarter of the block's floor plan, by its two sides: [x0, z0, x1, z1]. */
function quarter(a: Side, b: Side): [number, number, number, number] {
  const x = a === "east" || b === "east" ? [8, 16] : [0, 8];
  const z = a === "south" || b === "south" ? [8, 16] : [0, 8];
  return [x[0], z[0], x[1], z[1]];
}

/** Half the block's floor plan on a side: [x0, z0, x1, z1]. */
function half(side: Side): [number, number, number, number] {
  return side === "north" ? [0, 0, 16, 8] : side === "south" ? [0, 8, 16, 16] : side === "west" ? [0, 0, 8, 16] : [8, 0, 16, 16];
}

// Vanilla's direction states as the side a block faces (Java's "facing").
/** weirdo_direction 0 to 3 (stairs). */
export const STAIRS_FACING: readonly Side[] = ["east", "west", "south", "north"];
/** direction 0 to 3 (trapdoors). */
export const TRAPDOOR_FACING: readonly Side[] = ["east", "west", "south", "north"];
/** A door's minecraft:cardinal_direction as the side it faces: a quarter turn from Java's. */
export const DOOR_FACING: Record<string, Side> = { south: "east", west: "south", north: "west", east: "north" };
/** facing_direction 0 to 5: down, up, north, south, west, east. */
const FACING_DIRECTION = ["down", "up", "north", "south", "west", "east"] as const;

const truthy = (value: unknown) => value === 1 || value === true || value === "true";
const sideOf = (value: unknown): Side => ((SIDES as readonly unknown[]).includes(value) ? (value as Side) : "north");

/** A door's or an open trapdoor's panel against each side (Java's door shapes). */
const PANEL: Record<Side, Box16> = {
  north: [0, 0, 0, 16, 16, 3],
  south: [0, 0, 13, 16, 16, 16],
  west: [0, 0, 0, 3, 16, 16],
  east: [13, 0, 0, 16, 16, 16],
};
/** Where a Java door's panel is by its facing, hinge and whether it's open (DoorBlock.getShape). */
const DOOR_PANEL: Record<Side, { shut: Side; right: Side; left: Side }> = {
  south: { shut: "north", right: "west", left: "east" },
  west: { shut: "east", right: "north", left: "south" },
  north: { shut: "south", right: "east", left: "west" },
  east: { shut: "west", right: "south", left: "north" },
};
/** An open trapdoor is against the side it faces away from. */
const OPEN_TRAPDOOR: Record<Side, Side> = { north: "south", south: "north", east: "west", west: "east" };

// Fence gates as vanilla's model has them, facing south: posts at the ends along x, the rails between
// them when shut, or swung toward +z when open.
const GATE_POSTS: Box16[] = [
  [0, 5, 7, 2, 16, 9],
  [14, 5, 7, 16, 16, 9],
];
const GATE_SHUT: Box16[] = [
  [2, 6, 7, 14, 9, 9],
  [2, 12, 7, 14, 15, 9],
  [6, 9, 7, 10, 12, 9],
];
const GATE_OPEN_SOUTH: Box16[] = [
  [0, 6, 9, 2, 9, 15],
  [0, 12, 9, 2, 15, 15],
  [14, 6, 9, 16, 9, 15],
  [14, 12, 9, 16, 15, 15],
];

/** Plants and other small things drawn as two crossed faces, by name (without "minecraft:"). */
const CROSS = new Set([
  "short_grass", "tall_grass", "fern", "large_fern", "deadbush", "dead_bush", "seagrass", "kelp", "kelp_plant", "reeds", "sugar_cane",
  "wheat", "carrots", "potatoes", "beetroot", "nether_wart", "melon_stem", "pumpkin_stem", "torchflower", "torchflower_crop", "pitcher_crop",
  "pitcher_plant", "sunflower", "lilac", "rose_bush", "peony", "web", "cobweb", "brown_mushroom", "red_mushroom", "nether_sprouts",
  "spore_blossom", "small_dripleaf_block", "hanging_roots", "bamboo_sapling", "sweet_berry_bush", "bush", "firefly_bush", "short_dry_grass",
  "tall_dry_grass", "cactus_flower", "golden_dandelion", "open_eyeblossom", "closed_eyeblossom", "red_flower", "yellow_flower", "poppy",
  "dandelion", "allium", "azure_bluet", "blue_orchid", "cornflower", "lily_of_the_valley", "oxeye_daisy", "wither_rose", "lever",
  "tripwire_hook", "vine", "glow_lichen", "sculk_vein", "resin_clump", "frog_spawn", "end_gateway", "portal", "fire", "soul_fire",
]);
/** Name patterns drawn as crossed faces. */
const CROSS_LIKE = [
  /_sapling$/, /(^|_)torch$/, /^colored_torch_/, /_button$/, /(^|_)rail$/, /_tulip$/, /_coral(_fan|_wall_fan)?$/, /_roots$/, /_fungus$/,
  /_vines(_plant)?$/, /^cave_vines/, /_propagule$/, /_bush$/, /_hanging_moss$/, /_sign$/, /_banner$/, /(^|_)candle$/,
];
/** Flat things on the ground that clicks pass through. */
const FLAT = new Set(["pink_petals", "wildflowers", "leaf_litter", "redstone_wire", "trip_wire", "frame", "glow_frame"]);
/** Blocks drawn shorter than a cube, by name: their height in sixteenths. */
const SHORT: Record<string, Box16> = {
  farmland: [0, 0, 0, 16, 15, 16],
  grass_path: [0, 0, 0, 16, 15, 16],
  dirt_path: [0, 0, 0, 16, 15, 16],
  chest: [1, 0, 1, 15, 14, 15],
  trapped_chest: [1, 0, 1, 15, 14, 15],
  ender_chest: [1, 0, 1, 15, 14, 15],
  enchanting_table: [0, 0, 0, 16, 12, 16],
  end_portal_frame: [0, 0, 0, 16, 13, 16],
  daylight_detector: [0, 0, 0, 16, 6, 16],
  daylight_detector_inverted: [0, 0, 0, 16, 6, 16],
  stonecutter_block: [0, 0, 0, 16, 9, 16],
  campfire: [0, 0, 0, 16, 7, 16],
  soul_campfire: [0, 0, 0, 16, 7, 16],
  bed: [0, 0, 0, 16, 9, 16],
  cake: [1, 0, 1, 15, 8, 15],
  flower_pot: [5, 0, 5, 11, 6, 11],
  skull: [4, 0, 4, 12, 8, 12],
  cactus: [1, 0, 1, 15, 16, 15],
  decorated_pot: [1, 0, 1, 15, 16, 15],
  waterlily: [1, 0, 1, 15, 1, 15],
  lily_pad: [1, 0, 1, 15, 1, 15],
  sea_pickle: [6, 0, 6, 10, 6, 10],
  turtle_egg: [3, 0, 3, 13, 7, 13],
  bamboo: [6, 0, 6, 10, 16, 10],
  conduit: [5, 5, 5, 11, 11, 11],
  heavy_core: [4, 0, 4, 12, 8, 12],
};

/** Whether a vanilla block is drawn see-through (blended), by name (without "minecraft:"). */
export function vanillaSeeThrough(name: string): boolean {
  return /glass(_pane)?$/.test(name) || /^(ice|frosted_ice|slime|honey_block|water|flowing_water|bubble_column)$/.test(name);
}

/** How a vanilla block is drawn, by its name (without "minecraft:") and its drawn states. */
export function vanillaShape(name: string, states: Record<string, string | number> = {}): Shape {
  if (name === "water" || name === "flowing_water" || name === "bubble_column") return { boxes: [], liquid: "water", passable: true };
  if (name === "lava" || name === "flowing_lava") return { boxes: [], liquid: "lava", passable: true };
  if (FLAT.has(name)) return { boxes: [[0, 0, 0, 16, 1, 16]], passable: true };
  if (CROSS.has(name) || CROSS_LIKE.some((pattern) => pattern.test(name))) return { boxes: [], cross: true, passable: true };
  if (/double_slab$|^double_/.test(name)) return CUBE;
  if (/slab\d?$/.test(name) || "minecraft:vertical_half" in states) {
    const top = states["minecraft:vertical_half"] === "top" || truthy(states.top_slot_bit);
    return { boxes: [top ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16]] };
  }
  if (name.endsWith("_stairs")) return stairs(states);
  if (name.endsWith("_wall") || "wall_connection_type_north" in states) return wall(states);
  if (name.endsWith("fence_gate")) return gate(states);
  if (name.endsWith("fence")) return fence(states);
  if (/(pane|bars)$/.test(name) || "minecraft:connection_north" in states) return pane(states);
  if (/(^|_)chain$/.test(name)) return rod(states.pillar_axis, 7, 9);
  if (/(^|_)(end_rod|lightning_rod)$/.test(name)) return rod(axisOfFacing(states.facing_direction), 6, 10);
  if (name.endsWith("trapdoor")) return trapdoor(states);
  if (name.endsWith("_door")) return door(states);
  if (name.endsWith("carpet")) return { boxes: [[0, 0, 0, 16, 1, 16]] };
  if (name.endsWith("pressure_plate")) return { boxes: [[1, 0, 1, 15, 1, 15]] };
  if (name === "snow_layer") return { boxes: [[0, 0, 0, 16, Math.min(16, (Number(states.height ?? 0) + 1) * 2), 16]] };
  if (name === "ladder") return ladder(states.facing_direction);
  if (/(^|_)lantern$/.test(name)) return { boxes: [truthy(states.hanging) ? [5, 1, 5, 11, 10, 11] : [5, 0, 5, 11, 9, 11]] };
  if (/_bed$/.test(name)) return { boxes: [SHORT.bed] };
  if (/copper_chest$/.test(name)) return { boxes: [SHORT.chest] };
  if (/(_skull|_head)$/.test(name)) return { boxes: [SHORT.skull] };
  const short = SHORT[name];
  if (short) return { boxes: [short] };
  return CUBE;
}

/** Stairs: the bottom (or top) half, and the step on the side it faces, cornered as minecraft:corner says. */
function stairs(states: Record<string, string | number>): Shape {
  const facing = STAIRS_FACING[Number(states.weirdo_direction ?? 0) & 3];
  const top = truthy(states.upside_down_bit);
  const corner = String(states["minecraft:corner"] ?? "none");
  const [slab, step]: [[number, number], [number, number]] = top ? [[8, 16], [0, 8]] : [[0, 8], [8, 16]];
  const pieces: [number, number, number, number][] = [];
  if (corner === "outer_left") pieces.push(quarter(facing, COUNTERCLOCKWISE[facing]));
  else if (corner === "outer_right") pieces.push(quarter(facing, CLOCKWISE[facing]));
  else {
    pieces.push(half(facing));
    const back = OPEN_TRAPDOOR[facing];
    if (corner === "inner_left") pieces.push(quarter(back, COUNTERCLOCKWISE[facing]));
    if (corner === "inner_right") pieces.push(quarter(back, CLOCKWISE[facing]));
  }
  return { boxes: [[0, slab[0], 0, 16, slab[1], 16], ...pieces.map(([x0, z0, x1, z1]): Box16 => [x0, step[0], z0, x1, step[1], z1])] };
}

/** Walls: a post when wall_post_bit is set, and a short or tall arm to each joined side. */
function wall(states: Record<string, string | number>): Shape {
  const boxes: Box16[] = [];
  const known = "wall_post_bit" in states;
  if (!known || truthy(states.wall_post_bit)) boxes.push([4, 0, 4, 12, 16, 12]);
  for (const side of SIDES) {
    const joined = String(states[`wall_connection_type_${side}`] ?? "none");
    if (joined === "short") boxes.push(toSide([5, 0, 0, 11, 14, 8], side));
    if (joined === "tall") boxes.push(toSide([5, 0, 0, 11, 16, 8], side));
  }
  return { boxes: boxes.length > 0 ? boxes : [[4, 0, 4, 12, 16, 12]] };
}

/** Fences: a post, and two rails to each joined side. */
function fence(states: Record<string, string | number>): Shape {
  const boxes: Box16[] = [[6, 0, 6, 10, 16, 10]];
  for (const side of SIDES) {
    if (truthy(states[`minecraft:connection_${side}`])) boxes.push(toSide([7, 12, 0, 9, 15, 6], side), toSide([7, 6, 0, 9, 9, 6], side));
  }
  return { boxes };
}

/** Panes and bars: a thin post, and a thin sheet to each joined side. */
function pane(states: Record<string, string | number>): Shape {
  const boxes: Box16[] = [[7, 0, 7, 9, 16, 9]];
  for (const side of SIDES) if (truthy(states[`minecraft:connection_${side}`])) boxes.push(toSide([7, 0, 0, 9, 16, 7], side));
  return { boxes };
}

/** A rod through the block's middle along an axis (chains by pillar_axis, end rods by their facing). */
function rod(axis: unknown, from: number, to: number): Shape {
  if (axis === "x") return { boxes: [[0, from, from, 16, to, to]] };
  if (axis === "z") return { boxes: [[from, from, 0, to, to, 16]] };
  return { boxes: [[from, 0, from, to, 16, to]] };
}

function axisOfFacing(value: unknown): "x" | "y" | "z" {
  const facing = FACING_DIRECTION[Number(value ?? 1)] ?? "up";
  return facing === "west" || facing === "east" ? "x" : facing === "north" || facing === "south" ? "z" : "y";
}

/** A ladder: a thin panel against the wall behind it (it faces away from the wall). */
function ladder(value: unknown): Shape {
  const facing = FACING_DIRECTION[Number(value ?? 2)];
  const against: Side = facing === "south" ? "north" : facing === "west" ? "east" : facing === "east" ? "west" : "south";
  return { boxes: [PANEL[against]] };
}

function gate(states: Record<string, string | number>): Shape {
  const facing = sideOf(states["minecraft:cardinal_direction"]);
  const open = truthy(states.open_bit);
  const drop = truthy(states.in_wall_bit) ? 3 : 0;
  let boxes = [...GATE_POSTS, ...(open ? GATE_OPEN_SOUTH : GATE_SHUT)];
  // Facing north the open rails swing to -z; facing east or west the gate runs along z.
  if (facing === "north") boxes = boxes.map(flipZ);
  if (facing === "east") boxes = boxes.map(swapXZ);
  if (facing === "west") boxes = boxes.map(swapXZ).map(flipX);
  return { boxes: boxes.map(([x0, y0, z0, x1, y1, z1]): Box16 => [x0, y0 - drop, z0, x1, y1 - drop, z1]) };
}

function trapdoor(states: Record<string, string | number>): Shape {
  const facing = TRAPDOOR_FACING[Number(states.direction ?? 0) & 3];
  if (truthy(states.open_bit)) return { boxes: [PANEL[OPEN_TRAPDOOR[facing]]] };
  return { boxes: [truthy(states.upside_down_bit) ? [0, 13, 0, 16, 16, 16] : [0, 0, 0, 16, 3, 16]] };
}

/**
 * A door half: one panel by facing, hinge and open. The viewer's volume gives each half the lower
 * half's facing and open and the upper half's hinge (volume.ts), as the game reads them.
 */
function door(states: Record<string, string | number>): Shape {
  const facing = DOOR_FACING[String(states["minecraft:cardinal_direction"] ?? "south")] ?? "east";
  const panel = DOOR_PANEL[facing];
  const side = !truthy(states.open_bit) ? panel.shut : truthy(states.door_hinge_bit) ? panel.right : panel.left;
  return { boxes: [PANEL[side]] };
}

/** How a block is drawn: vanilla's by name and states, a custom block's from its pack (cube when unknown). */
export function shapeOf(look: ViewLook, custom: CustomShape | undefined): Shape {
  if (look.name.startsWith("minecraft:")) return vanillaShape(look.name.slice("minecraft:".length), look.states);
  if (!custom || "cube" in custom) return CUBE;
  if ("plant" in custom) return { boxes: [], cross: true, passable: true };
  const boxes = custom.boxes.filter(([x0, y0, z0, x1, y1, z1]) => x1 > x0 && y1 > y0 && z1 > z0);
  return boxes.length === 0 ? { boxes: [], cross: true, passable: true } : isFull(boxes) ? CUBE : { boxes };
}

/** Whether boxes fill the whole block (one box from corner to corner). */
function isFull(boxes: Box16[]): boolean {
  return boxes.some(([x0, y0, z0, x1, y1, z1]) => x0 <= 0 && y0 <= 0 && z0 <= 0 && x1 >= 16 && y1 >= 16 && z1 >= 16);
}

/** A key for a shape, so looks drawn alike share one. */
export function shapeKey(shape: Shape): string {
  return JSON.stringify([shape.boxes, shape.cross ?? false, shape.liquid ?? "", shape.passable ?? false]);
}

/** Faces in volume.ts's order: up, down, north, south, west, east. */
const FACE_AXIS = [1, 1, 2, 2, 0, 0];
const FACE_SIGN = [1, -1, -1, 1, -1, 1];
export const OPPOSITE = [1, 0, 3, 2, 5, 4];

/** A rectangle on a block's side, in sixteenths along that side's two other axes (in x, y, z order): [u0, v0, u1, v1]. */
export type Rect = [number, number, number, number];

/** For each shape and each face, the rectangles its boxes put on that side of the block. */
export function sideRects(shape: Shape): Rect[][] {
  const out: Rect[][] = [[], [], [], [], [], []];
  for (const box of shape.boxes) {
    for (let face = 0; face < 6; face++) {
      const axis = FACE_AXIS[face];
      const at = FACE_SIGN[face] > 0 ? box[axis + 3] : box[axis];
      if (at !== (FACE_SIGN[face] > 0 ? 16 : 0)) continue;
      const [u, v] = [0, 1, 2].filter((a) => a !== axis);
      out[face].push([box[u], box[v], box[u + 3], box[v + 3]]);
    }
  }
  return out;
}

/** Whether any of `rects` holds all of `rect`. */
export function covered(rects: Rect[], rect: Rect): boolean {
  return rects.some(([u0, v0, u1, v1]) => u0 <= rect[0] && v0 <= rect[1] && u1 >= rect[2] && v1 >= rect[3]);
}

/** The tables the mesher and the picker read, by look id. */
export interface ShapeTable {
  /** Each distinct shape; 0 is the cube. */
  shapes: Shape[];
  /** Each look's shape. */
  shapeOf: Uint16Array;
  /** Each look's flags: OCCLUDES, SEE_THROUGH, WATER, LAVA, PASSABLE. */
  flags: Uint8Array;
}

/** A drawn, not see-through cube: it hides its neighbors' faces against it and darkens their corners. */
export const OCCLUDES = 1;
/** Drawn see-through (glass, water): blended, in a mesh of its own. */
export const SEE_THROUGH = 2;
export const WATER = 4;
export const LAVA = 8;
/** Clicks pass through it. */
export const PASSABLE = 16;

/** The shape table for a map's looks. `drawn[look]` is 1 for drawn looks. */
export function buildShapeTable(looks: ViewLook[], drawn: Uint8Array, custom: Record<string, CustomShape>): ShapeTable {
  const shapes: Shape[] = [CUBE];
  const ids = new Map<string, number>([[shapeKey(CUBE), 0]]);
  const shapeIds = new Uint16Array(looks.length);
  const flags = new Uint8Array(looks.length);
  looks.forEach((look, id) => {
    const own = custom[lookKey(look)];
    const shape = shapeOf(look, own);
    const key = shapeKey(shape);
    let shapeId = ids.get(key);
    if (shapeId === undefined) {
      shapeId = shapes.length;
      shapes.push(shape);
      ids.set(key, shapeId);
    }
    shapeIds[id] = shapeId;
    const vanilla = look.name.startsWith("minecraft:");
    const seeThrough = vanilla ? vanillaSeeThrough(look.name.slice("minecraft:".length)) : own?.seeThrough === true;
    let flag = 0;
    if (drawn[id] && shapeId === 0 && !seeThrough) flag |= OCCLUDES;
    if (seeThrough) flag |= SEE_THROUGH;
    if (shape.liquid === "water") flag |= WATER;
    if (shape.liquid === "lava") flag |= LAVA;
    if (shape.passable || !drawn[id]) flag |= PASSABLE;
    flags[id] = flag;
  });
  return { shapes, shapeOf: shapeIds, flags };
}

/** How a look is named in the custom shapes the Panel sends: its name and states. */
export function lookKey(look: ViewLook): string {
  return look.states ? `${look.name}${JSON.stringify(look.states)}` : look.name;
}

/** The top of a look's shape, in blocks (0 to 1): where a point on it stands. */
export function shapeTop(shape: Shape): number {
  if (shape.boxes.length === 0) return 0;
  return Math.max(...shape.boxes.map((box) => box[4])) / 16;
}

/** Whether a point inside a block (0 to 1 on each axis) is in one of its shape's boxes. */
export function insideShape(shape: Shape, x: number, y: number, z: number): boolean {
  const [px, py, pz] = [x * 16, y * 16, z * 16];
  return shape.boxes.some(([x0, y0, z0, x1, y1, z1]) => px >= x0 && px < x1 && py >= y0 && py < y1 && pz >= z0 && pz < z1);
}

/**
 * Where a ray meets a shape's boxes inside a block: `from` is the ray's start relative to the
 * block's corner (in blocks). The nearest box face hit, at or after `tMin`.
 */
export function hitShape(shape: Shape, from: number[], direction: number[], tMin: number): { t: number; normal: [number, number, number] } | undefined {
  let best: { t: number; normal: [number, number, number] } | undefined;
  for (const box of shape.boxes) {
    let near = -Infinity;
    let far = Infinity;
    let axisNear = 0;
    let ok = true;
    for (let axis = 0; axis < 3; axis++) {
      const lo = box[axis] / 16;
      const hi = box[axis + 3] / 16;
      if (direction[axis] === 0) {
        if (from[axis] < lo || from[axis] > hi) ok = false;
        continue;
      }
      let t0 = (lo - from[axis]) / direction[axis];
      let t1 = (hi - from[axis]) / direction[axis];
      if (t0 > t1) [t0, t1] = [t1, t0];
      if (t0 > near) {
        near = t0;
        axisNear = axis;
      }
      far = Math.min(far, t1);
    }
    if (!ok || near > far || far < tMin) continue;
    const t = Math.max(near, tMin);
    if (best && t >= best.t) continue;
    const normal: [number, number, number] = [0, 0, 0];
    normal[axisNear] = direction[axisNear] > 0 ? -1 : 1;
    best = { t, normal };
  }
  return best;
}

/** The faces of a box (in sixteenths) as quads: each face's corners in winding order seen from outside. */
export const BOX_FACES: { face: number; corners: [number, number, number][] }[] = [
  { face: 0, corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { face: 1, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { face: 2, corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  { face: 3, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { face: 4, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { face: 5, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
];
export { FACE_AXIS, FACE_SIGN };
