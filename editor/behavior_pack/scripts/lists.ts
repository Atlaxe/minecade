// The lists the spawn tool places entries into, and the markers that show every entry: pure
// functions of the map and its rules, so they can be tested without a server.
import {
  exactPosition,
  facingOf,
  listKey,
  listOf,
  mapRequirements,
  worldPoint,
  type EditorRules,
  type Facing,
  type MapConfig,
  type MapList,
  type MapPosition,
} from "@minecade/minigame-core/config";

export interface SpawnList {
  target: MapList;
  /** Its place in map.json: "spawns", "teamSpawns.red", "points.bombA". */
  key: string;
  /** The list in forms: "Spawns", "Red spawns", "Bomb site A". */
  label: string;
  /** One entry on its marker: "Spawn", "Red spawn", "Bomb site A". */
  entry: string;
  /** A § color code for its markers. */
  color: string;
  /** Holds at most one entry (the spectator spawn): a new one replaces it. */
  single: boolean;
}

/** Spawns, the spectator spawn (games), each team's spawns, then the points the rules ask for and any others the map has. */
export function spawnLists(config: MapConfig, rules: EditorRules): SpawnList[] {
  const lists: SpawnList[] = [];
  const lobby = rules.kind === "lobby";
  lists.push({ target: { list: "spawns" }, key: "spawns", label: lobby ? "Spawn" : "Spawns", entry: "Spawn", color: "§f", single: false });
  if (!lobby) {
    lists.push({ target: { list: "spectatorSpawn" }, key: "spectatorSpawn", label: "Spectator spawn", entry: "Spectator spawn", color: "§7", single: true });
  }
  const teams = rules.teams ?? [];
  const teamIds = new Set(teams.map((team) => team.id));
  for (const team of teams) {
    const target: MapList = { list: "teamSpawns", team: team.id };
    lists.push({ target, key: listKey(target), label: `${team.name} spawns`, entry: `${team.name} spawn`, color: team.color, single: false });
  }
  // Team spawns a map already has for a team the game no longer lists, so they can be moved or removed.
  for (const team of Object.keys(config.teamSpawns ?? {})) {
    if (teamIds.has(team)) continue;
    const target: MapList = { list: "teamSpawns", team };
    lists.push({ target, key: listKey(target), label: `${team} spawns`, entry: `${team} spawn`, color: "§f", single: false });
  }
  const named = new Set<string>();
  const requirements = mapRequirements(rules.requires, { kind: rules.kind, maxPlayers: rules.maxPlayers, teams });
  for (const requirement of requirements) {
    if (requirement.field !== "points" || requirement.name === undefined) continue;
    named.add(requirement.name);
    const color = teams.find((team) => team.id === requirement.team)?.color ?? "§e";
    lists.push(pointList(requirement.name, requirement.label, color));
  }
  for (const name of Object.keys(config.points ?? {})) {
    if (!named.has(name)) lists.push(pointList(name, name, "§e"));
  }
  return lists;
}

function pointList(name: string, label: string, color: string): SpawnList {
  const target: MapList = { list: "points", name };
  return { target, key: listKey(target), label, entry: label, color, single: false };
}

export interface MarkerSpec {
  /** "<list key>#<index>", stored on the marker entity. */
  key: string;
  list: SpawnList;
  index: number;
  /** The marker's name tag. */
  label: string;
  /** Where the marker stands: the entry's exact point, or the middle of its block. */
  at: { x: number; y: number; z: number };
  facing?: Facing;
}

/** A marker for every entry of every list. */
export function markerSpecs(config: MapConfig, lists: SpawnList[]): MarkerSpec[] {
  return lists.flatMap((list) =>
    listOf(config, list.target).map((position, index) => {
      const facing = facingOf(position);
      const name = `${list.color}${list.entry}${list.single ? "" : ` ${index + 1}`}`;
      return {
        key: `${list.key}#${index}`,
        list,
        index,
        label: facing ? `${name}\n§7faces ${compass(facing.yaw)}` : name,
        at: worldPoint(position),
        ...(facing ? { facing } : {}),
      };
    }),
  );
}

const DIRECTIONS = ["south", "southwest", "west", "northwest", "north", "northeast", "east", "southeast"];

/** The nearest of 8 compass directions for a yaw (0 faces south, 90 west). */
export function compass(yaw: number): string {
  return DIRECTIONS[Math.round((((yaw % 360) + 360) % 360) / 45) % 8];
}

export type Snap = "exact" | "45" | "90";

export const SNAPS: { snap: Snap; label: string }[] = [
  { snap: "exact", label: "Exact" },
  { snap: "45", label: "45 degrees" },
  { snap: "90", label: "90 degrees" },
];

/**
 * A facing to save from a player's view: whole degrees, or the yaw snapped to 45 or 90 degrees
 * with the pitch level. Yaw ends up from -180 to under 180.
 */
export function snapFacing(view: Facing, snap: Snap): Facing {
  const step = snap === "exact" ? 1 : Number(snap);
  const yaw = Math.round(view.yaw / step) * step;
  const pitch = snap === "exact" ? Math.round(view.pitch) : 0;
  // + 0 turns -0 into 0, so map.json never reads "-0".
  return { yaw: ((((yaw + 180) % 360) + 360) % 360) - 180 + 0, pitch: Math.max(-90, Math.min(90, pitch)) + 0 };
}

/** A marker's facing line tilt: the entry's pitch in whole degrees, 0 without a facing. */
export function markerPitch(facing: Facing | undefined): number {
  return facing ? Math.max(-90, Math.min(90, Math.round(facing.pitch))) + 0 : 0;
}

/** Whether two yaws point the same way, within half a degree (-180 and 180 are the same). */
export function sameYaw(a: number, b: number): boolean {
  const difference = (((a - b) % 360) + 360) % 360;
  return Math.min(difference, 360 - difference) <= 0.5;
}

/** The block a player stands in: their feet, in whole blocks. */
export function blockPosition(location: { x: number; y: number; z: number }): [number, number, number] {
  // Standing on a block puts the feet at a whole number, sometimes a hair under it.
  return [Math.floor(location.x), Math.floor(location.y + 0.01), Math.floor(location.z)];
}

type Point = { x: number; y: number; z: number };

/** The face of a block a use is aimed at, and where on it (from the block's bottom north-west corner). */
export interface AimedFace {
  block: Point;
  face: "Up" | "Down" | "North" | "South" | "East" | "West";
  faceLocation: Point;
}

/** How far in front of a block's side an entry goes, so a player standing there isn't in the wall. */
const SIDE_GAP = 0.3;
const OUTWARD: Record<AimedFace["face"], [number, number, number]> = {
  Up: [0, 1, 0],
  Down: [0, -1, 0],
  North: [0, 0, -1],
  South: [0, 0, 1],
  East: [1, 0, 0],
  West: [-1, 0, 0],
};

/**
 * The spot an aimed use picks: on top of a block, exactly where it's aimed (onTop); at a side or
 * underneath, just in front of that spot, for the editor to drop to the floor below it.
 */
export function aimedPoint(aim: AimedFace): { point: Point; onTop: boolean } {
  const { block, face } = aim;
  // The API gives the hit from the block's corner; a world location (older versions) is taken back to that.
  const corner = (value: number, base: number) => (value < -0.01 || value > 1.01 ? value - base : value);
  const hit = {
    x: block.x + corner(aim.faceLocation.x, block.x),
    y: block.y + corner(aim.faceLocation.y, block.y),
    z: block.z + corner(aim.faceLocation.z, block.z),
  };
  if (face === "Up") return { point: { x: hit.x, y: block.y + 1, z: hit.z }, onTop: true };
  const [dx, dy, dz] = OUTWARD[face];
  return { point: { x: hit.x + dx * SIDE_GAP, y: hit.y + dy * SIDE_GAP, z: hit.z + dz * SIDE_GAP }, onTop: false };
}

/**
 * An entry's position at a point: exactly there (to 0.01), or with `center` the middle of the
 * block it's in, as whole numbers. The facing comes along when given.
 */
export function entryPosition(point: Point, center: boolean, facing?: Facing): MapPosition {
  if (!center) return exactPosition(point, facing);
  const at = blockPosition(point);
  return facing ? [...at, facing.yaw, facing.pitch] : at;
}
