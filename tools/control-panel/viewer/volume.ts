// A map's blocks in the viewer page: the view file (tools/viewer/view-format.ts) unpacked into one
// grid of look ids, each look's six face colors and whether it's drawn, and picking (a ray walked
// through the grid, block by block). Plain TypeScript: the page and the mesh workers use it.
import { lookAt, type View, type ViewLook } from "../../viewer/view-format.ts";

/** Faces in this order everywhere: up (+y), down (-y), north (-z), south (+z), west (-x), east (+x). */
export const UP = 0;
export const DOWN = 1;
export const NORTH = 2;
export const SOUTH = 3;
export const WEST = 4;
export const EAST = 5;

/** The color table's colors for a block: up, down, side, RGBA each. */
export type FaceColors = [number[], number[], number[]];

/** Blocks that are never drawn (V.7's Hidden blocks toggle outlines some of them). */
export const HIDDEN = /^minecraft:(air|structure_void|barrier|invisible_bedrock|light_block(_\d+)?|light)$/;
/** A block with no color in the table: loud, so it's seen. */
export const UNKNOWN: number[] = [255, 0, 255, 255];

export interface Volume {
  /** The world spot of the grid's corner (multiples of 16). */
  origin: [number, number, number];
  /** The grid's size in blocks (multiples of 16), and in sections. */
  size: [number, number, number];
  sections: [number, number, number];
  /** Look ids at ((x * size z) + z) * size y + y, in grid spots. */
  blocks: Uint16Array;
  looks: ViewLook[];
  /** 1 for looks that are drawn. */
  drawn: Uint8Array;
  /** 24 bytes a look: each face's RGBA, faces in the order above. */
  colors: Uint8Array;
  /** Drawn looks with no color in the table, by name. */
  unknown: string[];
  /** The box the blocks fill, in world spots. */
  box: View["box"];
}

export function buildVolume(view: View, table: Record<string, FaceColors>): Volume {
  const origin = view.box.min.map((v) => Math.floor(v / 16) * 16) as [number, number, number];
  const sections = view.box.max.map((v, i) => Math.floor(v / 16) - origin[i] / 16 + 1) as [number, number, number];
  const size = sections.map((n) => n * 16) as [number, number, number];
  const blocks = new Uint16Array(size[0] * size[1] * size[2]);
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
  }
  const drawn = new Uint8Array(view.looks.length);
  const colors = new Uint8Array(view.looks.length * 24);
  const unknown = new Set<string>();
  view.looks.forEach((look, id) => {
    if (id === 0 || HIDDEN.test(look.name)) return;
    drawn[id] = 1;
    const faces = table[look.name];
    if (!faces) unknown.add(look.name);
    faceColors(look, faces).forEach((color, face) => colors.set(color, id * 24 + face * 4));
  });
  return { origin, size, sections, blocks, looks: view.looks, drawn, colors, unknown: [...unknown].sort(), box: view.box };
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
 * The first drawn block a ray meets that isn't past a cut, walking the grid one block at a time
 * (Amanatides and Woo). `from` and `direction` are in grid units.
 */
export function pick(volume: Volume, from: number[], direction: number[], keep: Keep = {}, maxSteps = 4000): Hit | undefined {
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
  for (let n = 0; n < maxSteps; n++) {
    const look = lookAtSpot(volume, cell[0], cell[1], cell[2]);
    if (volume.drawn[look] && isKept(keep, cell[0], cell[1], cell[2])) {
      return { block: [cell[0], cell[1], cell[2]], normal, point: from.map((v, i) => v + direction[i] * t) as [number, number, number], look };
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
