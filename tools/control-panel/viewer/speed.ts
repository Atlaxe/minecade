// The viewer's speed tools as plain data: the Mirror tool's mirroring of picked entries across a
// mirror plane (x, z, or both for a half turn), with their facings and boxes, as copies or moving
// the entries themselves, Select's copying of team entries to another team's list, duplicating
// entries in their own lists, and changing an entry's type (moving it to another list of its kind).
// A team's entries go to the team asked for. Plain TypeScript, tested.
import { isExact, listKey, type Box, type MapEdit, type MapList, type MapPosition, type Vec3 } from "@minecade/minigame-core/config";
import type { HeightLine, RegionEntry } from "../../../editor/behavior_pack/scripts/regions.ts";
import { addBoxEdit, heightEdit, removeBoxEdit, setBoxEdit, type BoxPlace } from "./boxes.ts";
import { normalYaw } from "./placing.ts";

/** Left to right (across a plane at x), front to back (across one at z), or a half turn (about the line where both meet). */
export type MirrorMode = "x" | "z" | "turn";

const flips = (mode: MirrorMode) => ({ x: mode !== "z", z: mode !== "x" });

/** Where the mirror plane is: x and z, each a whole or half block (a block's edge or its middle). */
export type Middle = { x: number; z: number };
const ORIGIN: Middle = { x: 0, z: 0 };
/** Twice a plane's place, a whole number: a point at p mirrors to twice - p. */
const twice = (value: number) => Math.round(value * 2);

/** A spot snapped to the nearest half block: a block's edge or its middle, where a mirror plane can be. */
export function snapHalf(value: number): number {
  return Math.round(value * 2) / 2 + 0;
}

/**
 * A position mirrored across the plane's x and/or z. A whole x or z is a block's middle (x + 0.5),
 * so its mirror is the block 2m - x - 1 (across 0: -x - 1); an exact point's is 2m - x. A facing
 * turns with it.
 */
export function mirrorPosition(at: MapPosition, mode: MirrorMode, middle: Middle = ORIGIN): MapPosition {
  const { x, z } = flips(mode);
  const exact = isExact(at);
  const flip = (value: number, m: number) => (exact ? Math.round((twice(m) - value) * 100) / 100 : twice(m) - value - 1) + 0;
  const out = [x ? flip(at[0], middle.x) : at[0], at[1], z ? flip(at[2], middle.z) : at[2]];
  return (at.length === 5 ? [...out, mirrorYaw(at[3], mode), at[4]] : out) as MapPosition;
}

/** A yaw (0 faces south, 90 west) mirrored: across x it's turned the other way, across z it faces back, and a half turn adds 180. */
export function mirrorYaw(yaw: number, mode: MirrorMode): number {
  return normalYaw(mode === "x" ? -yaw : mode === "z" ? 180 - yaw : yaw + 180);
}

/** A whole-block box mirrored across the plane's x and/or z (across 0: the blocks -max - 1 to -min - 1). */
export function mirrorBox(box: Box, mode: MirrorMode, middle: Middle = ORIGIN): Box {
  const { x, z } = flips(mode);
  const min = [...box.min] as Vec3;
  const max = [...box.max] as Vec3;
  for (const [axis, on, m] of [[0, x, middle.x], [2, z, middle.z]] as const) {
    if (!on) continue;
    min[axis] = twice(m) - box.max[axis] - 1 + 0;
    max[axis] = twice(m) - box.min[axis] - 1 + 0;
  }
  return { min, max };
}

/**
 * A picked entry the speed tools can mirror or copy: a point in its list (with its place there, to
 * move it), or a box where it's kept (with the map's entry for it, to move it).
 */
export type SpeedEntry =
  | { kind: "point"; label: string; target: MapList; position: MapPosition; index?: number; single?: boolean }
  | { kind: "box"; label: string; place: BoxPlace; box: Box; entry?: RegionEntry };

/** The team a list is a team's, by its last part: teamSpawns.red, points.hole.red, regions.spawnGuard.red. */
export function teamOf(entry: SpeedEntry, teams: readonly string[]): string | undefined {
  if (entry.kind === "point") {
    if (entry.target.list === "teamSpawns") return entry.target.team;
    if (entry.target.list === "points") return lastTeam(entry.target.name, teams);
    return undefined;
  }
  return entry.place.kind === "region" ? lastTeam(entry.place.name, teams) : undefined;
}

function lastTeam(name: string, teams: readonly string[]): string | undefined {
  const dot = name.lastIndexOf(".");
  const team = dot > 0 ? name.slice(dot + 1) : undefined;
  return team && teams.includes(team) ? team : undefined;
}

/** A name with its team part swapped: hole.red to hole.blue. */
const withTeam = (name: string, team: string) => `${name.slice(0, name.lastIndexOf("."))}.${team}`;

/** The entry as it would be in another team's list (only for a team's entry). */
function toTeam(entry: SpeedEntry, team: string): SpeedEntry {
  if (entry.kind === "point") {
    if (entry.target.list === "teamSpawns") return { ...entry, target: { list: "teamSpawns", team } };
    if (entry.target.list === "points") return { ...entry, target: { list: "points", name: withTeam(entry.target.name, team) } };
    return entry;
  }
  return entry.place.kind === "region" ? { ...entry, place: { kind: "region", name: withTeam(entry.place.name, team) } } : entry;
}

/** The team after a team, in the game's order (red to blue, and the last back to the first). */
export function nextTeam(team: string, teams: readonly string[]): string {
  const at = teams.indexOf(team);
  return teams[(at + 1) % teams.length] ?? team;
}

/** Where team entries go when mirrored: the next team, their own, or one team for all. */
export type MirrorTeam = { kind: "next" } | { kind: "same" } | { kind: "team"; team: string };

export interface MirrorOptions {
  mode: MirrorMode;
  /** The plane's place (x 0 and z 0 when not given). */
  middle?: Middle;
  /** Where a team's entries go (the next team when not given). */
  team?: MirrorTeam;
  /** Move the entries themselves rather than add mirrored copies. */
  move?: boolean;
}

/** The list a point or box is kept in, as map.json names it: "teamSpawns.red", "regions.kill", "bounds". */
export function entryListKey(entry: SpeedEntry): string {
  if (entry.kind === "point") return listKey(entry.target);
  return entry.place.kind === "region" ? `regions.${entry.place.name}` : entry.place.kind;
}

/** An entry as the Mirror tool makes it: in its team's list by the rule, mirrored across the plane. */
export function mirrorEntry(entry: SpeedEntry, teams: readonly string[], options: MirrorOptions): SpeedEntry {
  const team = teamOf(entry, teams);
  const rule = options.team ?? { kind: "next" };
  const to = !team || rule.kind === "same" ? team : rule.kind === "next" ? nextTeam(team, teams) : rule.team;
  const next = to && to !== team ? toTeam(entry, to) : entry;
  return next.kind === "point" ? { ...next, position: mirrorPosition(next.position, options.mode, options.middle) } : { ...next, box: mirrorBox(next.box, options.mode, options.middle) };
}

/**
 * What the Mirror tool would do with each entry: the mirrored entry, or why it's left out (a list
 * holding one entry can't take a copy, but its entry can be moved).
 */
export function mirrorPlan(entries: readonly SpeedEntry[], teams: readonly string[], options: MirrorOptions): { mirrored: { from: SpeedEntry; to: SpeedEntry }[]; skipped: string[] } {
  const mirrored: { from: SpeedEntry; to: SpeedEntry }[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    const to = mirrorEntry(entry, teams, options);
    if (!options.move && to.kind === "point" && to.single) skipped.push(`${entry.label} holds one entry`);
    else if (options.move && (entry.kind === "point" ? entry.index === undefined : entry.entry === undefined)) skipped.push(`${entry.label} can't be moved`);
    else mirrored.push({ from: entry, to });
  }
  return { mirrored, skipped };
}

/**
 * The edits that mirror entries, for one batch (one undo step), and the entries left out, with why.
 * Copies are added; moved entries are changed where they are, or, when they go to another team's
 * list, taken out of theirs (the last first, so the others keep their places) and added there.
 */
export function mirrorEdits(entries: readonly SpeedEntry[], teams: readonly string[], options: MirrorOptions): { edits: MapEdit[]; skipped: string[] } {
  const { mirrored, skipped } = mirrorPlan(entries, teams, options);
  if (!options.move) return { edits: mirrored.map(({ to }) => addEdit(to)), skipped };
  const sets: MapEdit[] = [];
  const removals: { list: string; index: number; edit: MapEdit }[] = [];
  const adds: MapEdit[] = [];
  for (const { from, to } of mirrored) {
    const same = entryListKey(from) === entryListKey(to);
    if (from.kind === "point" && to.kind === "point") {
      const index = from.index!;
      if (same) sets.push({ op: "set", target: from.target, index, at: to.position });
      else {
        removals.push({ list: entryListKey(from), index, edit: { op: "remove", target: from.target, index } });
        adds.push(addEdit(to));
      }
    } else if (from.kind === "box" && to.kind === "box") {
      const entry = from.entry!;
      if (same) sets.push(setBoxEdit(entry, to.box));
      else {
        removals.push({ list: entryListKey(from), index: entry.region?.index ?? entry.bounds ?? 0, edit: removeBoxEdit(entry) });
        adds.push(addEdit(to));
      }
    }
  }
  removals.sort((a, b) => (a.list < b.list ? -1 : a.list > b.list ? 1 : b.index - a.index));
  return { edits: [...sets, ...removals.map((removal) => removal.edit), ...adds], skipped };
}

/** The edits that copy team entries to another team's list as they are, and the entries left out, with why. */
export function copyEdits(entries: readonly SpeedEntry[], teams: readonly string[], copyTo: string): { edits: MapEdit[]; skipped: string[] } {
  const edits: MapEdit[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    const team = teamOf(entry, teams);
    if (!team) skipped.push(`${entry.label} isn't a team's`);
    else if (team === copyTo) skipped.push(`${entry.label} is already ${copyTo}'s`);
    else edits.push(addEdit(toTeam(entry, copyTo)));
  }
  return { edits, skipped };
}

/**
 * The edits that duplicate entries in their own lists, in the same place (each copy goes last in its
 * list), and the entries left out, with why: a list holding one entry can't take a copy.
 */
export function duplicateEdits(entries: readonly SpeedEntry[]): { edits: MapEdit[]; skipped: string[] } {
  const edits: MapEdit[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "point" && entry.single) skipped.push(`${entry.label} holds one entry`);
    else edits.push(addEdit(entry));
  }
  return { edits, skipped };
}

/**
 * The edit that changes a point's type: out of its list and into another (last there), where it is
 * and facing the same way, as one change. A list holding one entry that has it already (`replace`)
 * gets this one in place of that one.
 */
export function retypePointEdit(from: { target: MapList; index: number; position: MapPosition }, to: MapList, replace: boolean): MapEdit {
  return { op: "batch", edits: [{ op: "remove", target: from.target, index: from.index }, replace ? { op: "set", target: to, index: 0, at: from.position } : { op: "add", target: to, at: from.position }] };
}

/** The edit that changes a box's type: out of where it's kept and last into another list (the bounds, the spectator bounds, a region), as one change. */
export function retypeBoxEdit(entry: RegionEntry, box: Box, to: BoxPlace): MapEdit {
  return { op: "batch", edits: [removeBoxEdit(entry), addBoxEdit(to, box)] };
}

/** The edit that changes a height's type (kill Y, a side of the build limit) at the same height, replacing the other's, as one change. */
export function retypeHeightEdit(from: HeightLine, to: HeightLine, y: number): MapEdit {
  return { op: "batch", edits: [heightEdit(from), heightEdit(to, y)] };
}

function addEdit(entry: SpeedEntry): MapEdit {
  return entry.kind === "point" ? { op: "add", target: entry.target, at: entry.position } : addBoxEdit(entry.place, entry.box);
}
