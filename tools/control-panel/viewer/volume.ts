// A map's blocks in the viewer page: the view file (tools/viewer/view-format.ts) unpacked into one
// grid of look ids (and the water of waterlogged blocks, layer 1, by section), each look's six face
// colors, whether it's drawn and how (shapes.ts), and picking (a ray walked through the grid, block
// by block, meeting each block's shape). Plain TypeScript: the page and the mesh workers use it.
import { lookAt, type View, type ViewLook } from "../../viewer/view-format.ts";
import { buildShapeTable, hitShape, PASSABLE, SEE_THROUGH, shapeTop, WATER, type CustomShape, type ShapeTable } from "./shapes.ts";

/** Faces in this order everywhere: up (+y), down (-y), north (-z), south (+z), west (-x), east (+x). */
export const UP = 0;
export const DOWN = 1;
export const NORTH = 2;
export const SOUTH = 3;
export const WEST = 4;
export const EAST = 5;

/** The color table's colors for a block: up, down, side, RGBA each. */
export type FaceColors = [number[], number[], number[]];

/** Blocks that are never drawn; the Hidden blocks setting outlines some of them (OUTLINED). */
export const HIDDEN = /^minecraft:(air|structure_void|barrier|invisible_bedrock|light_block(_\d+)?|light)$/;
/** Hidden blocks the Hidden blocks setting outlines: walls in a game, and light. */
export const OUTLINED = /^minecraft:(barrier|invisible_bedrock|light_block(_\d+)?|light)$/;
/** A block with no color in the table: loud, so it's seen. */
export const UNKNOWN: number[] = [255, 0, 255, 255];
/** How see-through water is drawn (0 to 255), and the range other see-through blocks are kept in. */
const WATER_ALPHA = 150;
const SEE_THROUGH_ALPHA: [number, number] = [70, 190];

export interface Volume {
  /** The world spot of the grid's corner (multiples of 16). */
  origin: [number, number, number];
  /** The grid's size in blocks (multiples of 16), and in sections. */
  size: [number, number, number];
  sections: [number, number, number];
  /** Look ids at ((x * size z) + z) * size y + y, in grid spots. */
  blocks: Uint16Array;
  /** Layer 1 (the water in waterlogged blocks) by section index ((cx * ny) + cy) * nz + cz, at ((x * 16) + z) * 16 + y. */
  water: Map<number, Uint16Array>;
  /** The view's looks, then the doors' halves read together (a door's halves keep different states). */
  looks: ViewLook[];
  /** 1 for looks that are drawn. */
  drawn: Uint8Array;
  /** 24 bytes a look: each face's RGBA, faces in the order above. */
  colors: Uint8Array;
  /** How each look is drawn and picked. */
  table: ShapeTable;
  /** Drawn looks with no color in the table, by name. */
  unknown: string[];
  /** How many blocks of each look there are. */
  counts: Uint32Array;
  /** The box the blocks fill, in world spots. */
  box: View["box"];
}

export function buildVolume(view: View, table: Record<string, FaceColors>, custom: Record<string, CustomShape> = {}): Volume {
  const origin = view.box.min.map((v) => Math.floor(v / 16) * 16) as [number, number, number];
  const sections = view.box.max.map((v, i) => Math.floor(v / 16) - origin[i] / 16 + 1) as [number, number, number];
  const size = sections.map((n) => n * 16) as [number, number, number];
  const blocks = new Uint16Array(size[0] * size[1] * size[2]);
  const water = new Map<number, Uint16Array>();
  for (const section of view.list) {
    const bx = section.x * 16 - origin[0];
    const by = section.y * 16 - origin[1];
    const bz = section.z * 16 - origin[2];
    if (bx < 0 || by < 0 || bz < 0 || bx >= size[0] || by >= size[1] || bz >= size[2]) continue;
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const column = ((bx + x) * size[2] + bz + z) * size[1] + by;
        if (typeof section.blocks === "number") blocks.fill(section.blocks, column, column + 16);
        else for (let y = 0; y < 16; y++) blocks[column + y] = lookAt(section.blocks, x, y, z);
      }
    }
    if (section.water !== undefined && section.water !== 0) {
      const layer = new Uint16Array(4096);
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 16; y++) layer[(x * 16 + z) * 16 + y] = lookAt(section.water, x, y, z);
      if (layer.some((look) => look !== 0)) water.set(((bx / 16) * sections[1] + by / 16) * sections[2] + bz / 16, layer);
    }
  }
  const looks = [...view.looks];
  joinDoors(looks, blocks, size);
  const drawn = new Uint8Array(looks.length);
  const colors = new Uint8Array(looks.length * 24);
  const unknown = new Set<string>();
  looks.forEach((look, id) => {
    if (id === 0 || HIDDEN.test(look.name)) return;
    drawn[id] = 1;
    const faces = table[look.name];
    if (!faces) unknown.add(look.name);
    faceColors(look, faces).forEach((color, face) => colors.set(color, id * 24 + face * 4));
  });
  const shapes = buildShapeTable(looks, drawn, custom);
  // Alpha is how see-through a see-through block is drawn; every other block is drawn solid.
  for (let id = 0; id < looks.length; id++) {
    for (let face = 0; face < 6; face++) {
      const at = id * 24 + face * 4 + 3;
      if (!(shapes.flags[id] & SEE_THROUGH)) colors[at] = 255;
      else colors[at] = shapes.flags[id] & WATER ? WATER_ALPHA : Math.max(SEE_THROUGH_ALPHA[0], Math.min(SEE_THROUGH_ALPHA[1], colors[at]));
    }
  }
  const counts = new Uint32Array(looks.length);
  for (let i = 0; i < blocks.length; i++) counts[blocks[i]]++;
  return { origin, size, sections, blocks, water, looks, drawn, colors, table: shapes, unknown: [...unknown].sort(), counts, box: view.box };
}

/**
 * Doors keep different states in their two halves: the facing and whether it's open in the lower
 * one, the hinge in the upper (docs/spike-results.md, "Painted shapes"). Each half's look becomes
 * one with both, added to `looks`, so the door is drawn the way the game shows it.
 */
function joinDoors(looks: ViewLook[], blocks: Uint16Array, size: [number, number, number]): void {
  const isDoor = looks.map((look) => look.name.startsWith("minecraft:") && look.name.endsWith("_door"));
  if (!isDoor.some(Boolean)) return;
  const sy = size[1];
  const ids = new Map<string, number>();
  const upper = (look: ViewLook) => look.states?.upper_block_bit === 1 || look.states?.upper_block_bit === "true";
  for (let i = 0; i < blocks.length; i++) {
    const id = blocks[i];
    if (!isDoor[id]) continue;
    const look = looks[id];
    const y = i % sy;
    const top = upper(look);
    const otherIndex = top ? (y > 0 ? i - 1 : -1) : y + 1 < sy ? i + 1 : -1;
    const other = otherIndex >= 0 && isDoor[blocks[otherIndex]] ? looks[blocks[otherIndex]] : undefined;
    if (!other || other.name !== look.name || upper(other) === top) continue;
    const [lower, higher] = top ? [other, look] : [look, other];
    const states = { ...look.states, "minecraft:cardinal_direction": lower.states?.["minecraft:cardinal_direction"] ?? "south", open_bit: lower.states?.open_bit ?? 0, door_hinge_bit: higher.states?.door_hinge_bit ?? 0 };
    const key = `${look.name}${JSON.stringify(states)}`;
    let joined = ids.get(key);
    if (joined === undefined) {
      joined = looks.length;
      looks.push({ name: look.name, states });
      isDoor.push(true);
      ids.set(key, joined);
    }
    blocks[i] = joined;
  }
}

/** A look's six face colors: a log lying along x or z (pillar_axis) has its rings on its ends. */
export function faceColors(look: ViewLook, faces: FaceColors | undefined): number[][] {
  if (!faces) return [UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN];
  const [up, down, side] = faces;
  const axis = look.states?.pillar_axis;
  if (axis === "x") return [side, side, side, side, down, up];
  if (axis === "z") return [side, side, down, up, side, side];
  return [up, down, side, side, side, side];
}

/** The look at a grid spot, 0 outside the grid. */
export function lookAtSpot(volume: Volume, x: number, y: number, z: number): number {
  const [sx, sy, sz] = volume.size;
  if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return 0;
  return volume.blocks[(x * sz + z) * sy + y];
}

/** The look in layer 1 at a grid spot (the water of a waterlogged block), 0 for none. */
export function waterAtSpot(volume: Volume, x: number, y: number, z: number): number {
  const [nx, ny, nz] = volume.sections;
  const [cx, cy, cz] = [x >> 4, y >> 4, z >> 4];
  if (x < 0 || y < 0 || z < 0 || cx >= nx || cy >= ny || cz >= nz) return 0;
  const layer = volume.water.get((cx * ny + cy) * nz + cz);
  return layer ? layer[((x & 15) * 16 + (z & 15)) * 16 + (y & 15)] : 0;
}

/** Whether a click can land on the block at a grid spot (drawn, and not a plant, a liquid or hidden). */
export function isSolidSpot(volume: Volume, x: number, y: number, z: number): boolean {
  const look = lookAtSpot(volume, x, y, z);
  return volume.drawn[look] === 1 && !(volume.table.flags[look] & PASSABLE);
}

/** How high the top of a solid block at a grid spot is (0 to 1), or undefined for one a click passes through. */
export function solidTop(volume: Volume, x: number, y: number, z: number): number | undefined {
  if (!isSolidSpot(volume, x, y, z)) return undefined;
  const look = lookAtSpot(volume, x, y, z);
  return shapeTop(volume.table.shapes[volume.table.shapeOf[look]]);
}

/** What's kept of the map when it's cut: the grid spots a click can reach. */
export interface Keep {
  /** The highest layer kept (grid y), or undefined. */
  top?: number;
  /** x and z: a plane and which side of it is kept (grid spots: below keeps at <= at). */
  x?: { at: number; side: "below" | "above" };
  z?: { at: number; side: "below" | "above" };
}

export function isKept(keep: Keep, x: number, y: number, z: number): boolean {
  if (keep.top !== undefined && y > keep.top) return false;
  for (const [cut, value] of [[keep.x, x], [keep.z, z]] as const) {
    if (cut && (cut.side === "below" ? value > cut.at : value < cut.at)) return false;
  }
  return true;
}

export interface Hit {
  /** The block's grid spot. */
  block: [number, number, number];
  /** The face hit, as a unit step out of the block. */
  normal: [number, number, number];
  /** Where the ray met the face, in grid units. */
  point: [number, number, number];
  look: number;
}

/**
 * The first block a ray meets that a click can land on and that isn't past a cut, walking the grid
 * one block at a time (Amanatides and Woo); in a block that isn't a cube, the ray must meet one of
 * its boxes. Plants, liquids and hidden blocks are passed through. `from` and `direction` are in
 * grid units. Blocks whose middle is within `skipNear` of `from` are passed through (the camera is
 * in them).
 */
export function pick(volume: Volume, from: number[], direction: number[], keep: Keep = {}, skipNear = 0, maxSteps = 4000): Hit | undefined {
  const size = volume.size;
  // Start where the ray enters the grid, through the face of the axis that's entered last.
  let tEnter = 0;
  let tExit = Infinity;
  let entered = 1;
  for (let i = 0; i < 3; i++) {
    if (direction[i] === 0) {
      if (from[i] < 0 || from[i] > size[i]) return undefined;
      continue;
    }
    const a = (0 - from[i]) / direction[i];
    const b = (size[i] - from[i]) / direction[i];
    if (Math.min(a, b) > tEnter) {
      tEnter = Math.min(a, b);
      entered = i;
    }
    tExit = Math.min(tExit, Math.max(a, b));
  }
  if (tEnter > tExit) return undefined;
  const start = from.map((v, i) => v + direction[i] * tEnter);
  const step = direction.map((d) => (d > 0 ? 1 : d < 0 ? -1 : 0));
  const cell = start.map((v, i) => Math.min(size[i] - 1, Math.max(0, i === entered && tEnter > 0 ? (step[i] > 0 ? 0 : size[i] - 1) : Math.floor(v))));
  const tDelta = direction.map((d) => (d !== 0 ? Math.abs(1 / d) : Infinity));
  const tMax = direction.map((d, i) => tEnter + (d > 0 ? (cell[i] + 1 - start[i]) / d : d < 0 ? (cell[i] - start[i]) / d : Infinity));
  let normal: [number, number, number] = [0, 0, 0];
  normal[entered] = -step[entered] || 1;
  let t = tEnter;
  const { shapes, shapeOf, flags } = volume.table;
  for (let n = 0; n < maxSteps; n++) {
    const look = lookAtSpot(volume, cell[0], cell[1], cell[2]);
    if (volume.drawn[look] && !(flags[look] & PASSABLE) && isKept(keep, cell[0], cell[1], cell[2])) {
      const near = skipNear > 0 && Math.hypot(cell[0] + 0.5 - from[0], cell[1] + 0.5 - from[1], cell[2] + 0.5 - from[2]) < skipNear;
      if (!near) {
        if (shapeOf[look] === 0) return { block: [cell[0], cell[1], cell[2]], normal, point: from.map((v, i) => v + direction[i] * t) as [number, number, number], look };
        const inside = hitShape(
          shapes[shapeOf[look]],
          from.map((v, i) => v - cell[i]),
          direction,
          t,
        );
        if (inside) return { block: [cell[0], cell[1], cell[2]], normal: inside.normal, point: from.map((v, i) => v + direction[i] * inside.t) as [number, number, number], look };
      }
    }
    const axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    t = tMax[axis];
    cell[axis] += step[axis];
    if (cell[axis] < 0 || cell[axis] >= size[axis]) return undefined;
    tMax[axis] += tDelta[axis];
    normal = [0, 0, 0];
    normal[axis] = -step[axis];
  }
  return undefined;
}

/** The grid spots of every block of the given looks, in grid order (for outlining or finding them). */
export function spotsOf(volume: Volume, wanted: (look: number) => boolean, limit = Infinity): [number, number, number][] {
  const [, sy, sz] = volume.size;
  const want = volume.looks.map((_, look) => wanted(look));
  const out: [number, number, number][] = [];
  for (let i = 0; i < volume.blocks.length && out.length < limit; i++) {
    if (!want[volume.blocks[i]]) continue;
    const y = i % sy;
    const z = Math.floor(i / sy) % sz;
    const x = Math.floor(i / (sy * sz));
    out.push([x, y, z]);
  }
  return out;
}
