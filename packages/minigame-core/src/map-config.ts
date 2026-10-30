// A map's map.json. The build validates it, `npm run bake` builds the world from it, and the
// runtime receives it (without "build") as the mapConfig server variable.

export type Vec3 = [x: number, y: number, z: number];

export interface Box {
  min: Vec3;
  max: Vec3;
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

export interface MapConfig {
  name: string;
  /** Where players appear: one for the lobby, at least one per player slot for a game. */
  spawns: Vec3[];
  spectatorSpawn?: Vec3;
  /** The playable area. Required for baking, which builds and checks inside it. */
  bounds?: Box;
  /** Below this height a player is out (void games). */
  killY?: number;
  /** Spawns per team, role or side, keyed by its id. */
  teamSpawns?: Record<string, Vec3[]>;
  /** Named positions, such as bomb sites or mob spawns. */
  points?: Record<string, Vec3[]>;
  /** Named areas, such as build plots or a floor. */
  regions?: Record<string, Box[]>;
  /** A fixed time of day: the daylight cycle stops there (set when the server starts). */
  time?: MapTime;
  /** The lobby only: a star box around the map, so stars show in every direction, below the horizon too. */
  stars?: boolean;
  /** Console commands (without "/") that `npm run bake` runs once to build the world. */
  build?: { commands: string[] };
  /** Game-specific values, such as Sumo's eliminationY. */
  [key: string]: unknown;
}
