// What a Block Party minigame is (docs/plans/block-party.md, "Minigames"), and what it gets to play
// with. A minigame plays on its arena map (arenas.ts: each minigame its own entry in the map editor,
// its published Arena box placed where the arena goes, the board map's arena slot or the empty space
// far east of the board), or, while it has none, on a test arena of its own laid in code there. Both
// come to the minigame as a Field: the arena's box and its markup where it now is in the world. The
// runner (minigame-runner.ts) lays it behind the loading screen, puts everyone on its spawns, shows
// the rules until everyone is ready, counts down, calls play(), and takes everyone back to the
// board; play() says how it went.
import { BlockVolume, type Dimension, type Entity, type Vector3 } from "@minecraft/server";
import { arenaBox, mapTimeTicks, type Box, type MapConfig, type MapPosition, type PlacedArena, type Scope } from "@minecade/minigame-core";
import type { Who } from "../bots.ts";
import type { Kind } from "../minigame-rules.ts";

export type Vec3 = [number, number, number];

/**
 * How long a title takes, in ticks: fading in, staying, fading out. A title that follows another
 * quickly (the roulette's names, the countdown) comes in at once: fading each in made them flicker.
 */
export interface TitleTiming {
  fadeIn: number;
  stay: number;
  fadeOut: number;
}

export const TITLE = {
  /** A title on its own. */
  show: { fadeIn: 4, stay: 40, fadeOut: 10 },
  /** One of a run of titles, each replaced by the next before it ends. */
  swap: { fadeIn: 0, stay: 30, fadeOut: 0 },
  /** A countdown's number: a second each. */
  count: { fadeIn: 0, stay: 20, fadeOut: 0 },
  /** The end of a run (the roulette's pick, Go): in at once, then out slowly. */
  land: { fadeIn: 0, stay: 40, fadeOut: 10 },
  /** A minigame's results. */
  results: { fadeIn: 4, stay: 60, fadeOut: 10 },
} satisfies Record<string, TitleTiming>;

/** How a minigame went: places best first (each a group of keys tied for it), or the side that won (undefined: a draw). */
export type Outcome = { places: string[][] } | { winner: number | undefined };

/** A spot in the world, and its facing when the map gave it one. */
export interface Spot extends Vector3 {
  yaw?: number;
  pitch?: number;
}

/** A box in the world: whole blocks, both corners inside. */
export interface WorldBox {
  min: Vector3;
  max: Vector3;
}

/** The arena being played, where it is in the world: its box, and its markup there. */
export interface Field {
  /** The arena's lowest corner, and its size. */
  min: Vector3;
  size: Vec3;
  /** Its plain spawns, in order. */
  spawns: Spot[];
  /** A team's spawns ("red"). */
  teamSpawns(team: string): Spot[];
  /** A named point's spots, a named region's boxes. */
  points(name: string): Spot[];
  regions(name: string): WorldBox[];
  /** Where players who are out watch from (the map's spectator spawn). */
  watch?: Spot;
  /** What everyone looks through while the rules show (the map's Start view camera). */
  camera?: Required<Spot>;
  /** The arena's own time of day, in ticks. */
  time?: number;
}

/** A test arena's markup (made in code, already in the world's terms) as a Field. */
export function testField(
  min: Vector3,
  size: Vec3,
  markup: { spawns?: Spot[]; teamSpawns?: Record<string, Spot[]>; points?: Record<string, Spot[]>; regions?: Record<string, WorldBox[]> },
): Field {
  return {
    min,
    size,
    spawns: markup.spawns ?? [],
    teamSpawns: (team) => markup.teamSpawns?.[team] ?? [],
    points: (name) => markup.points?.[name] ?? [],
    regions: (name) => markup.regions?.[name] ?? [],
  };
}

/** An arena map's markup, its Arena box placed (placeArena), as a Field. */
export function mapField(config: MapConfig, placed: PlacedArena): Field {
  const spot = (position: MapPosition): Spot => placed.point(position);
  const world = (box: Box): WorldBox => {
    const turned = placed.box(box);
    return { min: { x: turned.min[0], y: turned.min[1], z: turned.min[2] }, max: { x: turned.max[0], y: turned.max[1], z: turned.max[2] } };
  };
  const time = mapTimeTicks(config.time);
  // The Start view, as servers get it: the lens of the camera players wait looking through.
  const view = config.startView ? placed.point(config.startView) : undefined;
  return {
    min: { x: placed.min[0], y: placed.min[1], z: placed.min[2] },
    size: placed.size,
    spawns: (config.spawns ?? []).map(spot),
    teamSpawns: (team) => (config.teamSpawns?.[team] ?? []).map(spot),
    points: (name) => (config.points?.[name] ?? []).map(spot),
    regions: (name) => (config.regions?.[name] ?? []).map(world),
    ...(config.spectatorSpawn ? { watch: spot(config.spectatorSpawn) } : {}),
    ...(view ? { camera: { x: view.x, y: view.y, z: view.z, yaw: view.yaw ?? 0, pitch: view.pitch ?? 0 } } : {}),
    ...(time !== undefined ? { time } : {}),
  };
}

/** An arena map's Arena box size (x, y, z), before any turning. */
export function arenaSize(config: MapConfig): Vec3 | undefined {
  const box = arenaBox(config);
  return box ? [box.max[0] - box.min[0] + 1, box.max[1] - box.min[1] + 1, box.max[2] - box.min[2] + 1] : undefined;
}

/** What a minigame plays with. */
export interface Play {
  /** The minigame's own: everything in it ends with the minigame. */
  scope: Scope;
  dimension: Dimension;
  /** The arena, where it is: its box and its markup. */
  field: Field;
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
  title(text: string, subtitle?: string, timing?: TitleTiming): void;
  /** The same title for everyone, each player's own line under it (by key; "" for none). */
  titleEach(text: string, subtitleOf: (key: string) => string, timing?: TitleTiming): void;
  say(text: string): void;
  /** The line top right for everyone while it's on: its clock, its score. */
  status(text: string): void;
}

export interface MinigameDef {
  /** Its arena's id too (arenas.ts): its arena maps are blockparty-<id>'s. */
  id: string;
  name: string;
  kind: Kind;
  /** The rules, one line, shown before Ready. */
  rules: string;
  /** Its test arena (while it has no arena map): its size (x, y, z), laying it from `min`, and its markup there. */
  size: Vec3;
  build(dimension: Dimension, min: Vector3, random: () => number): void;
  testField(min: Vector3): Field;
  /** Why it can't be played on a field (an arena map's floor too small), or undefined. */
  problem?(field: Field): string | undefined;
  /** Where each member of each side starts on a field: [side][member]. */
  spawns(field: Field, sides: readonly number[]): Spot[][];
  play(play: Play): Promise<Outcome>;
}

/** Hands out spawns in order, each side its own players' worth (FFA and duels: one each). */
export function inOrder(spawns: readonly Spot[], sides: readonly number[]): Spot[][] {
  let next = 0;
  return sides.map((count) => spawns.slice(next, (next += count)));
}

/** Whether a spot is over a box's footprint, from `below` under its lowest layer to `above` over its top. */
export function over(box: WorldBox, at: Vector3, below = 1, above = 3): boolean {
  return at.x >= box.min.x && at.x < box.max.x + 1 && at.z >= box.min.z && at.z < box.max.z + 1 && at.y >= box.min.y - below && at.y <= box.max.y + 1 + above;
}

/** A box's middle, standing on its top. */
export function middleOf(box: WorldBox): Vector3 {
  return { x: (box.min.x + box.max.x + 1) / 2, y: box.max.y + 1, z: (box.min.z + box.max.z + 1) / 2 };
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
