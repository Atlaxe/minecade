// The viewer's speed tools (pass V.9) as plain data: mirroring picked entries across the map's
// middle (its bounds' middle, as game Edit takes it for facings: x 0 and z 0 for a map Select
// centered, and with no bounds) left to right, front to back or turned half around, with their
// facings and boxes, and copying them to another team's list. Mirrored and copied entries are
// added (the picked ones stay), a team's going to the team asked for. Plain TypeScript, tested.
import { isExact, type Box, type MapEdit, type MapList, type MapPosition, type Vec3 } from "@minecade/minigame-core/config";
import { addBoxEdit, type BoxPlace } from "./boxes.ts";
import { normalYaw } from "./placing.ts";

/** Left to right (x), front to back (z), or a half turn (both). */
export type MirrorMode = "x" | "z" | "turn";

const flips = (mode: MirrorMode) => ({ x: mode !== "z", z: mode !== "x" });

/** The middle to mirror across: x and z, each a whole or half block (a whole-block box's middle). */
export type Middle = { x: number; z: number };
const ORIGIN: Middle = { x: 0, z: 0 };
/** Twice a middle, a whole number: a point at p mirrors to twice - p. */
const twice = (value: number) => Math.round(value * 2);

/**
 * A position mirrored across the middle's x and/or z. A whole x or z is a block's middle (x + 0.5),
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

/** A whole-block box mirrored across the middle's x and/or z (across 0: the blocks -max - 1 to -min - 1). */
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

/** A picked entry the speed tools can mirror or copy: a point in its list, or a box where it's kept. */
export type SpeedEntry =
  | { kind: "point"; label: string; target: MapList; position: MapPosition; single?: boolean }
  | { kind: "box"; label: string; place: BoxPlace; box: Box };

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

/**
 * The edits that add mirrored or copied entries, one batch (one undo step), and the entries left
 * out, with why. `copyTo` copies team entries to that team as they are (others are left out);
 * `mirror` adds each entry mirrored, a team's going to the team `mirrorTeam` says.
 */
export function speedEdits(entries: readonly SpeedEntry[], teams: readonly string[], options: { mirror: MirrorMode; mirrorTeam?: MirrorTeam; middle?: Middle } | { copyTo: string }): { edits: MapEdit[]; skipped: string[] } {
  const edits: MapEdit[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    const team = teamOf(entry, teams);
    let next: SpeedEntry;
    if ("copyTo" in options) {
      if (!team) {
        skipped.push(`${entry.label} isn't a team's`);
        continue;
      }
      if (team === options.copyTo) {
        skipped.push(`${entry.label} is already ${options.copyTo}'s`);
        continue;
      }
      next = toTeam(entry, options.copyTo);
    } else {
      const rule = options.mirrorTeam ?? { kind: "next" };
      const to = !team || rule.kind === "same" ? team : rule.kind === "next" ? nextTeam(team, teams) : rule.team;
      next = to && to !== team ? toTeam(entry, to) : entry;
      next = next.kind === "point" ? { ...next, position: mirrorPosition(next.position, options.mirror, options.middle) } : { ...next, box: mirrorBox(next.box, options.mirror, options.middle) };
    }
    if (next.kind === "point" && next.single) {
      skipped.push(`${entry.label} holds one entry`);
      continue;
    }
    edits.push(next.kind === "point" ? { op: "add", target: next.target, at: next.position } : addBoxEdit(next.place, next.box));
  }
  return { edits, skipped };
}
