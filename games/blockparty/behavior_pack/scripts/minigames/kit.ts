// What a Block Party minigame is (docs/plans/block-party.md, "Minigames"), and what it gets to play
// with. Until minigames have arena maps of their own (pass 5's next part: each minigame its own entry
// in the editor's map list, its arena copied into the board's world), each lays a test arena of its
// own in code where the arena goes: the board map's arena slot, or the empty space far east of the
// board. The runner (minigame-runner.ts) builds it behind the loading screen, puts everyone on its
// spawns, shows the rules until everyone is ready, counts down, calls play(), and takes everyone
// back to the board; play() says how it went.
import { BlockVolume, type Dimension, type Entity, type Vector3 } from "@minecraft/server";
import type { Scope } from "@minecade/minigame-core";
import type { Who } from "../bots.ts";
import type { Kind } from "../minigame-rules.ts";

export type Vec3 = [number, number, number];

/** How a minigame went: places best first (each a group of keys tied for it), or the side that won (undefined: a draw). */
export type Outcome = { places: string[][] } | { winner: number | undefined };

/** What a minigame plays with. */
export interface Play {
  /** The minigame's own: everything in it ends with the minigame. */
  scope: Scope;
  dimension: Dimension;
  /** The arena's lowest corner, and its size. */
  min: Vector3;
  size: Vec3;
  /** FFA and duels: each alone. 2v2: two pairs. 1v3: the solo, then the rest. */
  sides: Who[][];
  random(): number;
  /** Everyone still in. */
  inPlay(): Who[];
  /** Takes someone off the field: a player watches as a spectator over the arena, a bot from the stand beside it. */
  out(who: Who): void;
  isOut(who: Who): boolean;
  /** A body now: a player who left has none. */
  bodyOf(who: Who): Entity | undefined;
  /** Holds a player where they are for `ticks` (a bot is simply not moved). */
  freeze(who: Who, ticks: number): void;
  title(text: string, subtitle?: string): void;
  say(text: string): void;
  /** The line top right for everyone while it's on: its clock, its score. */
  status(text: string): void;
}

export interface MinigameDef {
  id: string;
  name: string;
  kind: Kind;
  /** The rules, one line, shown before Ready. */
  rules: string;
  /** Its test arena's size: x, y, z. */
  size: Vec3;
  /** Lays its test arena from `min`. */
  build(dimension: Dimension, min: Vector3, random: () => number): void;
  /** Where each member of each side starts: [side][member]. */
  spawns(min: Vector3, sides: readonly number[]): Vector3[][];
  play(play: Play): Promise<Outcome>;
}

/** Most blocks one fill may set (the game's limit for a fill command, kept to here too). */
const FILL_MAX = 32768;

/** Fills a box with one block (`from` and `to` its corners, both in), in parts small enough to fill. */
export function fill(dimension: Dimension, from: Vector3, to: Vector3, block: string): void {
  const min = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) };
  const max = { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z) };
  const layer = (max.x - min.x + 1) * (max.z - min.z + 1);
  const layers = Math.max(1, Math.floor(FILL_MAX / layer));
  for (let y = min.y; y <= max.y; y += layers) {
    dimension.fillBlocks(new BlockVolume({ x: min.x, y, z: min.z }, { x: max.x, y: Math.min(max.y, y + layers - 1), z: max.z }), block);
  }
}

/** A point `dx`, `dy`, `dz` from `min`, on a block's middle. */
export function at(min: Vector3, dx: number, dy: number, dz: number): Vector3 {
  return { x: min.x + dx + 0.5, y: min.y + dy, z: min.z + dz + 0.5 };
}

/** Spread `count` spots evenly across a line from `a` to `b`. */
export function spread(a: Vector3, b: Vector3, count: number): Vector3[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  });
}

/** "12 s". */
export function secondsText(ticks: number): string {
  return `${Math.max(0, Math.ceil(ticks / 20))} s`;
}
