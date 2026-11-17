// The viewer's bulk edits as plain data. With several entries picked, Select's right panel shows each
// value they share (one they don't share shows as Mixed), and a value typed there goes to every one
// of them as one change; the gizmo, or a picked marker dragged, moves them all together by whole
// blocks, keeping where they stand from each other; Type moves them all into one list. Also the
// overview's runs: Shift + click picks every entry from the last one clicked to this one. Plain
// TypeScript, tested.
import { bigEnough, listKey, type Box, type MapEdit, type MapList, type MapPosition, type Vec3 } from "@minecade/minigame-core/config";
import type { RegionEntry } from "../../../editor/behavior_pack/scripts/regions.ts";
import { addBoxEdit, boxFrom, removeBoxEdit, setBoxEdit, type BoxPlace } from "./boxes.ts";
import { normalYaw } from "./placing.ts";
import { spacePosition } from "./spaces.ts";

/**
 * A picked entry as the bulk edits take it: a spawn or game marker in its list (with its place
 * there, and the way it faces when it has no facing of its own), a board's space, or a box where
 * it's kept.
 */
export type BulkEntry =
  | { kind: "point"; key: string; label: string; target: MapList; index: number; position: MapPosition; yaw: number; single?: boolean }
  | { kind: "space"; key: string; label: string; id: number; position: MapPosition }
  | { kind: "box"; key: string; label: string; entry: RegionEntry; box: Box; minSize?: number };

export type BulkPoint = Extract<BulkEntry, { kind: "point" }>;
export type BulkSpace = Extract<BulkEntry, { kind: "space" }>;
export type BulkBox = Extract<BulkEntry, { kind: "box" }>;

/** A number to two places, without "-0". */
const round2 = (value: number) => Math.round(value * 100) / 100 + 0;

/** The value every one of them has, or undefined when they differ (Mixed) or there are none. */
export function shared<T>(values: readonly T[]): T | undefined {
  if (values.length === 0) return undefined;
  return values.every((value) => value === values[0]) ? values[0] : undefined;
}

/** All, some or none of them: a checkbox ticked, half ticked (some) or clear. */
export function howMany<T>(items: readonly T[], test: (item: T) => boolean): "all" | "some" | "none" {
  const count = items.filter(test).length;
  return count === 0 ? "none" : count === items.length ? "all" : "some";
}

/** A box moved by whole blocks. */
export function boxMovedBy(box: Box, offset: Vec3): Box {
  return { min: box.min.map((v, axis) => v + offset[axis]) as Vec3, max: box.max.map((v, axis) => v + offset[axis]) as Vec3 };
}

/**
 * The edits that move entries together by whole blocks, each keeping its facing. A whole offset
 * keeps a block's middle a block's middle and an exact point exact, so they stay where they stand
 * from each other.
 */
export function moveEdits(entries: readonly BulkEntry[], offset: Vec3): MapEdit[] {
  if (offset.every((v) => v === 0)) return [];
  return entries.map((entry): MapEdit => {
    if (entry.kind === "box") return setBoxEdit(entry.entry, boxMovedBy(entry.box, offset));
    const at = [0, 1, 2].map((axis) => round2(entry.position[axis] + offset[axis])) as Vec3;
    return entry.kind === "space" ? { op: "moveSpace", id: entry.id, at: spacePosition(at) } : { op: "move", target: entry.target, index: entry.index, at };
  });
}

/** A change to the picked points' values: one of x, y and z, whether they face a fixed way, or their yaw or pitch. */
export type PointChange = { axis: 0 | 1 | 2; value: number } | { faced: boolean } | { yaw: number } | { pitch: number };

/**
 * The edits that give every picked point (spawns, markers and spaces) the same value, leaving out
 * the ones that have it already. Spaces take x, y and z only (they don't face a way); a yaw or
 * pitch goes only to the points facing a fixed way, as the field shows only when they all do.
 */
export function pointEdits(entries: readonly (BulkPoint | BulkSpace)[], change: PointChange): MapEdit[] {
  const edits: MapEdit[] = [];
  for (const entry of entries) {
    const [x, y, z] = entry.position;
    const facing = entry.position.length === 5 ? ([entry.position[3], entry.position[4]] as const) : undefined;
    if ("axis" in change) {
      const at = [x, y, z] as Vec3;
      at[change.axis] = round2(change.value);
      if (at[change.axis] === entry.position[change.axis]) continue;
      if (entry.kind === "space") {
        const next = spacePosition(at);
        if (next.every((v, axis) => v === spacePosition(entry.position)[axis])) continue;
        edits.push({ op: "moveSpace", id: entry.id, at: next });
      } else edits.push({ op: "set", target: entry.target, index: entry.index, at: facing ? [...at, facing[0], facing[1]] : at });
      continue;
    }
    if (entry.kind === "space") continue;
    let next: MapPosition | undefined;
    if ("faced" in change) {
      if (change.faced === (facing !== undefined)) continue;
      // A point starting to face a fixed way faces the way it was shown (the map's middle), level.
      next = change.faced ? [x, y, z, normalYaw(Math.round(entry.yaw)), 0] : [x, y, z];
    } else if (facing) {
      const yaw = "yaw" in change ? normalYaw(Math.round(change.yaw)) : facing[0];
      const pitch = "pitch" in change ? Math.max(-90, Math.min(90, Math.round(change.pitch))) : facing[1];
      if (yaw === facing[0] && pitch === facing[1]) continue;
      next = [x, y, z, yaw, pitch];
    }
    if (next) edits.push({ op: "set", target: entry.target, index: entry.index, at: next });
  }
  return edits;
}

/**
 * The edits that set one corner's x, y or z on every picked box, as each box's own field would
 * (the corners swap when they pass each other), or why not: a box would be too small for its list.
 */
export function boxCornerEdits(boxes: readonly BulkBox[], side: "min" | "max", axis: 0 | 1 | 2, value: number): { edits: MapEdit[]; problem?: string } {
  const edits: MapEdit[] = [];
  for (const box of boxes) {
    const corners = { min: [...box.box.min] as Vec3, max: [...box.box.max] as Vec3 };
    corners[side][axis] = Math.round(value);
    const next = boxFrom(corners.min, corners.max);
    if (next.min.every((v, i) => v === box.box.min[i]) && next.max.every((v, i) => v === box.box.max[i])) continue;
    if (!bigEnough(next, box.minSize)) return { edits: [], problem: `${box.label} would be too small: it must span at least ${box.minSize} blocks along every side.` };
    edits.push(setBoxEdit(box.entry, next));
  }
  return { edits };
}

/**
 * The removals for entries leaving their lists, the last of each list first, so the others keep
 * their places while the batch runs.
 */
function removalsInOrder(removals: { list: string; index: number; edit: MapEdit }[]): MapEdit[] {
  return [...removals].sort((a, b) => (a.list < b.list ? -1 : a.list > b.list ? 1 : b.index - a.index)).map((removal) => removal.edit);
}

/**
 * The edits that move picked spawns and markers into one list (a list holding many), where they
 * are and facing the same way, as one change: out of their lists, then last into that one, in the
 * order they were picked. The ones in it already stay. `moved` is how many go.
 */
export function retypePointsEdits(points: readonly BulkPoint[], to: MapList): { edits: MapEdit[]; moved: number } {
  const key = listKey(to);
  const going = points.filter((point) => listKey(point.target) !== key);
  const removals = going.map((point) => ({ list: listKey(point.target), index: point.index, edit: { op: "remove", target: point.target, index: point.index } as MapEdit }));
  return { edits: [...removalsInOrder(removals), ...going.map((point): MapEdit => ({ op: "add", target: to, at: point.position }))], moved: going.length };
}

/** Where a box is kept, as map.json names the list: "bounds", "spectatorBounds", "regions.kill". */
export function boxListKey(entry: RegionEntry): string {
  return entry.region ? `regions.${entry.region.name}` : entry.spectators ? "spectatorBounds" : "bounds";
}

/**
 * The edits that move picked boxes into one list (the bounds, the spectator bounds, a region) as
 * one change, or why not: a box too small for that list. The ones in it already stay.
 */
export function retypeBoxesEdits(boxes: readonly BulkBox[], to: BoxPlace, toKey: string, toLabel: string, minSize: number | undefined): { edits: MapEdit[]; moved: number; problem?: string } {
  const going = boxes.filter((box) => boxListKey(box.entry) !== toKey);
  const small = going.find((box) => !bigEnough(box.box, minSize));
  if (small) return { edits: [], moved: 0, problem: `${small.label} is too small for ${toLabel}: boxes there span at least ${minSize} blocks along every side.` };
  const removals = going.map((box) => ({ list: boxListKey(box.entry), index: box.entry.region?.index ?? box.entry.bounds ?? 0, edit: removeBoxEdit(box.entry) }));
  return { edits: [...removalsInOrder(removals), ...going.map((box) => addBoxEdit(to, box.box))], moved: going.length };
}

/** A change to the picked spaces: their type, or one of their switches. */
export type SpaceChange = { type: string } | { flag: "locked" | "star" | "opening"; on: boolean };

/** The edits that give every picked space a type (as one retype) or a switch, leaving out the ones that have it already. */
export function spaceEdits(spaces: readonly { id: number; type?: string; locked?: boolean; star?: boolean; opening?: boolean }[], change: SpaceChange): MapEdit[] {
  if ("type" in change) {
    const types: Record<string, string> = {};
    for (const space of spaces) if (space.type !== change.type) types[String(space.id)] = change.type;
    return Object.keys(types).length > 0 ? [{ op: "retypeSpaces", types }] : [];
  }
  return spaces.filter((space) => (space[change.flag] === true) !== change.on).map((space): MapEdit => ({ op: "setSpace", id: space.id, [change.flag]: change.on }));
}

/**
 * The entries from one to another in the overview's order, both included (Shift + click): from the
 * last one clicked to this one, whichever way. Only this one when the other isn't shown.
 */
export function runOf(order: readonly string[], from: string | undefined, to: string): string[] {
  const end = order.indexOf(to);
  const start = from === undefined ? -1 : order.indexOf(from);
  if (end < 0) return [to];
  if (start < 0) return [to];
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** The middle of a group's spots (points' feet to a block above them, boxes' blocks): where its gizmo goes. */
export function groupMiddle(points: readonly { x: number; y: number; z: number }[], boxes: readonly Box[]): Vec3 | undefined {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  const take = (min: readonly number[], max: readonly number[]) => {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], min[axis]);
      high[axis] = Math.max(high[axis], max[axis]);
    }
  };
  for (const point of points) take([point.x, point.y, point.z], [point.x, point.y + 1, point.z]);
  for (const box of boxes) take(box.min, box.max.map((v) => v + 1));
  if (!Number.isFinite(low[0])) return undefined;
  return [0, 1, 2].map((axis) => (low[axis] + high[axis]) / 2) as Vec3;
}
