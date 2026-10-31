// A map's map.json. The build validates it, `npm run bake` builds the world from it, the map
// editor writes it, and the runtime receives it (without the editor-only keys) as the mapConfig
// server variable.

export type Vec3 = [x: number, y: number, z: number];

/**
 * A position in map.json: [x, y, z] (spawns face the map's middle), or [x, y, z, yaw, pitch] for
 * a fixed facing in degrees (yaw -180 to 180, 0 is south; pitch -90 up to 90 down). Whole x and z
 * mean the middle of that block; a fraction in either makes it an exact point (see worldPoint).
 */
export type MapPosition = Vec3 | [x: number, y: number, z: number, yaw: number, pitch: number];

export interface Facing {
  yaw: number;
  pitch: number;
}

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** The region name whose boxes put a player out, the same as falling below killY. */
export const KILL_REGION = "kill";

/** Per-team entries in points and regions are keyed "<name>.<team>", such as "buyZone.red". */
export function teamKey(name: string, team?: string): string {
  return team ? `${name}.${team}` : name;
}

export function positionXyz(position: MapPosition): Vec3 {
  return [position[0], position[1], position[2]];
}

/** True when x or z has a fraction: the position is an exact point, not a block's middle. */
export function isExact(position: MapPosition): boolean {
  return !Number.isInteger(position[0]) || !Number.isInteger(position[2]);
}

/**
 * Where a position stands in the world: whole x and z are the middle of that block (as every map
 * made before exact positions), anything else is exactly that point. y is the feet in both.
 */
export function worldPoint(position: MapPosition): { x: number; y: number; z: number } {
  const [x, y, z] = position;
  return isExact(position) ? { x, y, z } : { x: x + 0.5, y, z: z + 0.5 };
}

/**
 * An exact position at a point in the world, rounded to 0.01, with the facing when given. Whole x
 * and z would read as a block's middle, half a block away, so x moves by 0.01 then.
 */
export function exactPosition(point: { x: number; y: number; z: number }, facing?: Facing): MapPosition {
  const round = (value: number) => Math.round(value * 100) / 100 || 0;
  let x = round(point.x);
  const z = round(point.z);
  if (Number.isInteger(x) && Number.isInteger(z)) x = round(x + 0.01);
  const y = round(point.y);
  return facing ? [x, y, z, facing.yaw, facing.pitch] : [x, y, z];
}

/** The block a position is in. */
export function blockOf(position: MapPosition): Vec3 {
  return [Math.floor(position[0]), Math.floor(position[1]), Math.floor(position[2])];
}

/** A position for messages: "3 65 -2", or "3.27 65 -1.84". */
export function positionText(position: MapPosition): string {
  return position
    .slice(0, 3)
    .map((value) => String(Math.round(value * 100) / 100))
    .join(" ");
}

/** A position's saved facing, or undefined when it faces the map's middle. */
export function facingOf(position: MapPosition): Facing | undefined {
  return position.length === 5 ? { yaw: position[3], pitch: position[4] } : undefined;
}

/** Names for times of day, in ticks (Bedrock's TimeOfDay values). */
export const MAP_TIMES = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 } as const;

/** A map's fixed time of day: one of the names, or ticks (0 to 23999). */
export type MapTime = keyof typeof MAP_TIMES | number;

/** The ticks a map's "time" stands for, or undefined when it's unset or not valid. */
export function mapTimeTicks(time: unknown): number | undefined {
  if (typeof time === "string") return Object.hasOwn(MAP_TIMES, time) ? MAP_TIMES[time as keyof typeof MAP_TIMES] : undefined;
  if (typeof time === "number" && Number.isInteger(time) && time >= 0 && time < 24000) return time;
  return undefined;
}

/** Where a map was cut from (the map editor's Select mode), so "Update from world" can redo it. */
export interface MapSource {
  /** The converted world's name. */
  world: string;
  /** The selected box, in that world's coordinates. */
  box: Box;
  /** What was added to move the box to the middle (x 0, z 0). */
  offset: Vec3;
}

/** A preview camera placed in the map editor: where the screenshot is taken from. */
export interface MapCamera {
  at: [x: number, y: number, z: number, yaw: number, pitch: number];
  /** "map": the map's preview, without players. "game": the game's picture, players in the shot. */
  kind: "map" | "game";
}

export interface MapConfig {
  name: string;
  /** An unfinished map: the build skips it until the editor's Publish removes the flag. */
  draft?: boolean;
  /** Where players appear: one for the lobby, at least one per player slot for a game. */
  spawns: MapPosition[];
  spectatorSpawn?: MapPosition;
  /** Where players wait for everyone to join, before the game puts them at their spawns. */
  queueSpawn?: MapPosition;
  /** How players wait at the queue spawn (see QueueSettings). */
  queue?: Partial<QueueSettings>;
  /** The playable area. Required for baking, which builds and checks inside it. */
  bounds?: Box;
  /** Below this height a player is out (void games). */
  killY?: number;
  /** Spawns per team, role or side, keyed by its id. */
  teamSpawns?: Record<string, MapPosition[]>;
  /** Named positions, such as bomb sites or mob spawns; "<name>.<team>" for one team's. */
  points?: Record<string, MapPosition[]>;
  /** Named areas, such as build plots or a floor; "<name>.<team>" for one team's; "kill" puts players out. */
  regions?: Record<string, Box[]>;
  /** A fixed time of day: the daylight cycle stops there (set when the server starts). */
  time?: MapTime;
  /** The lobby only: a star box around the map, so stars show in every direction, below the horizon too. */
  stars?: boolean;
  /** Console commands (without "/") that `npm run bake` runs once to build the world. */
  build?: { commands: string[] };
  /** The map editor only (stripped from servers' copies). */
  source?: MapSource;
  cameras?: Record<string, MapCamera>;
  /** Game-specific values, such as Sumo's eliminationY. */
  [key: string]: unknown;
}

/**
 * How players wait at a map's queue spawn: "lock" keeps them on the spot (looking around, not
 * moving) and invisible to each other, "free" lets them roam. Once everyone is in, `countdown`
 * seconds count down before the game puts them at their spawns.
 */
export interface QueueSettings {
  mode: "lock" | "free";
  countdown: number;
}

export const QUEUE_MODES = ["lock", "free"] as const;
export const QUEUE_COUNTDOWN = { default: 5, min: 1, max: 60 } as const;

/** A map's queue settings, with the defaults for what's unset. */
export function queueSettings(config: Pick<MapConfig, "queue">): QueueSettings {
  const queue = config.queue ?? {};
  return {
    mode: queue.mode === "free" ? "free" : "lock",
    countdown: typeof queue.countdown === "number" ? queue.countdown : QUEUE_COUNTDOWN.default,
  };
}

/** Keys only the build and the map editor use; servers get the map without them. */
export const EDITOR_ONLY_KEYS = ["build", "source", "cameras", "draft"] as const;

/** The map as servers get it: without the editor-only keys. */
export function runtimeMapConfig(config: MapConfig): MapConfig {
  const runtime: MapConfig = { ...config };
  for (const key of EDITOR_ONLY_KEYS) delete runtime[key];
  return runtime;
}
