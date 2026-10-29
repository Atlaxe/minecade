// A map's map.json. The build validates it, `npm run bake` builds the world from it, and the
// runtime receives it (without "build") as the mapConfig server variable.

export type Vec3 = [x: number, y: number, z: number];

export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface MapConfig {
  name: string;
  /** Where players appear: one for the lobby, at least one per player slot for a game. */
  spawns: Vec3[];
  spectatorSpawn?: Vec3;
  /** The playable area. Required for baking, which builds and checks inside it. */
  bounds?: Box;
  /** Console commands (without "/") that `npm run bake` runs once to build the world. */
  build?: { commands: string[] };
  /** Game-specific values, such as Sumo's eliminationY. */
  [key: string]: unknown;
}
