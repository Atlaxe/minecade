// The viewer's boxes and heights as plain data (pass V.6): a box from two corner blocks, a face
// dragged or nudged in whole blocks (never past the opposite face), a face set to a cut, the edits
// that save a box where it belongs (the bounds, the spectator bounds, a region), and the heights
// game Edit's Kill Y tool sets, with its rules. Plain TypeScript, tested.
import { boxSize, type Box, type BuildLimitSide, type MapConfig, type MapEdit, type Vec3 } from "@minecade/minigame-core/config";
import type { HeightLine, RegionEntry } from "../../../editor/behavior_pack/scripts/regions.ts";
export { heightProblem } from "../../viewer/edit-check.ts";

/** A box's face: the axis it's across (0 x, 1 y, 2 z) and which end. */
export interface Face {
  axis: 0 | 1 | 2;
  side: "min" | "max";
}

export const FACES: Face[] = [0, 1, 2].flatMap((axis) => (["min", "max"] as const).map((side) => ({ axis: axis as 0 | 1 | 2, side })));

/** The lowest kill Y and build limit, and the highest of each (a build limit can be one over the world's top). */
export const MIN_HEIGHT = -64;
export const MAX_KILL_Y = 319;
export const MAX_LIMIT = 320;

/** The box two corner blocks span, both inside. */
export function boxFrom(a: Vec3, b: Vec3): Box {
  return { min: [0, 1, 2].map((axis) => Math.min(a[axis], b[axis])) as Vec3, max: [0, 1, 2].map((axis) => Math.max(a[axis], b[axis])) as Vec3 };
}

/**
 * The box two corner blocks span, grown to at least `minSize` blocks along every side when its
 * list has a minimum: each short side runs on from the first corner the way the second lies (up
 * when they're level), so two clicks on one floor make a box tall enough without a block up there
 * to click. It stays within the world's heights, growing down from the top when it must.
 */
export function boxAtLeast(first: Vec3, second: Vec3, minSize: number | undefined): Box {
  const box = boxFrom(first, second);
  if (minSize === undefined) return box;
  for (const axis of [0, 1, 2] as const) {
    if (box.max[axis] - box.min[axis] + 1 >= minSize) continue;
    if (second[axis] < first[axis]) box.min[axis] = first[axis] - minSize + 1;
    else box.max[axis] = first[axis] + minSize - 1;
    if (axis !== 1) continue;
    if (box.max[1] > MAX_KILL_Y) [box.min[1], box.max[1]] = [MAX_KILL_Y - minSize + 1, MAX_KILL_Y];
    if (box.min[1] < MIN_HEIGHT) [box.min[1], box.max[1]] = [MIN_HEIGHT, MIN_HEIGHT + minSize - 1];
  }
  return box;
}

/** Where a face is: the plane between blocks it lies on (a max face is past its last block). */
export function facePlane(box: Box, face: Face): number {
  return face.side === "min" ? box.min[face.axis] : box.max[face.axis] + 1;
}

/** The box with a face moved to the plane nearest `plane`, keeping at least one block between it and the other face. */
export function moveFace(box: Box, face: Face, plane: number): Box {
  const at = Math.round(plane);
  const min = [...box.min] as Vec3;
  const max = [...box.max] as Vec3;
  if (face.side === "min") min[face.axis] = Math.min(at, box.max[face.axis]);
  else max[face.axis] = Math.max(at - 1, box.min[face.axis]);
  return { min, max };
}

/** The box with a face moved out (positive steps) or in (negative), in whole blocks. */
export function nudgeFace(box: Box, face: Face, steps: number): Box {
  const outward = face.side === "max" ? 1 : -1;
  return moveFace(box, face, facePlane(box, face) + steps * outward);
}

/**
 * The box with a face set to a cut's layer: the face on the cut's axis nearer to it (or `face`
 * when given and on that axis) moves so the cut layer is the box's last (or first) layer.
 */
export function faceToCut(box: Box, axis: 0 | 1 | 2, layer: number, face?: Face): Box {
  const side = face?.axis === axis ? face.side : Math.abs(layer - box.max[axis]) <= Math.abs(layer - box.min[axis]) ? "max" : "min";
  return moveFace(box, { axis, side }, side === "max" ? layer + 1 : layer);
}

/** "12 x 5 x 30". */
export function sizeText(box: Box): string {
  return boxSize(box).join(" x ");
}

/** Where a new box goes: the list game Edit's Region tool would save it in. */
export type BoxPlace = { kind: "bounds" } | { kind: "spectatorBounds" } | { kind: "region"; name: string };

/** The edit that adds a box to a list. */
export function addBoxEdit(place: BoxPlace, box: Box): MapEdit {
  if (place.kind === "region") return { op: "addRegion", name: place.name, box };
  return { op: "addBounds", box, ...(place.kind === "spectatorBounds" ? { spectators: true } : {}) };
}

/** The edit that changes a box the map has. */
export function setBoxEdit(entry: RegionEntry, box: Box): MapEdit {
  if (entry.region) return { op: "setRegion", name: entry.region.name, index: entry.region.index, box };
  return { op: "setBounds", index: entry.bounds ?? 0, box, ...(entry.spectators ? { spectators: true } : {}) };
}

/** The edit that removes a box the map has. */
export function removeBoxEdit(entry: RegionEntry): MapEdit {
  if (entry.region) return { op: "removeRegion", name: entry.region.name, index: entry.region.index };
  return { op: "removeBounds", index: entry.bounds ?? 0, ...(entry.spectators ? { spectators: true } : {}) };
}

/** A height a click on a block's layer sets, as game Edit's Kill Y tool starts it: kill Y under the block (one below the feet of someone on it), a build limit at their feet. */
export function heightFromBlock(line: HeightLine, layer: number): number {
  return line === "killY" ? layer : layer + 1;
}

/** The height a line has now, if it's set. */
export function heightOf(config: MapConfig, line: HeightLine): number | undefined {
  const value = line === "killY" ? config.killY : config.buildLimit?.[line as BuildLimitSide];
  return typeof value === "number" ? value : undefined;
}

/** The edit that sets a line to a height, or (none) removes it. */
export function heightEdit(line: HeightLine, y?: number): MapEdit {
  return line === "killY" ? { op: "killY", ...(y === undefined ? {} : { y }) } : { op: "buildLimit", side: line, ...(y === undefined ? {} : { y }) };
}

/**
 * Where along a line (`point` + s `axis`) it comes nearest to a ray: s, or undefined when they run
 * the same way (a handle dragged straight along the view).
 */
export function nearestOnAxis(point: Vec3, axis: Vec3, origin: Vec3, direction: Vec3): number | undefined {
  const dot = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const w = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  const a = dot(axis, axis);
  const b = dot(axis, direction);
  const c = dot(direction, direction);
  const d = dot(axis, w);
  const e = dot(direction, w);
  const denominator = a * c - b * b;
  if (Math.abs(denominator) < 1e-6 * a * c) return undefined;
  return (b * e - c * d) / denominator;
}
