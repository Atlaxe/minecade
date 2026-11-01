// The lists the spawn tool places entries into, and the markers that show every entry: pure
// functions of the map and its rules, so they can be tested without a server.
import {
  boundsBox,
  exactPosition,
  facingOf,
  listKey,
  listOf,
  mapRequirements,
  queueSettings,
  worldPoint,
  type EditorRules,
  type Facing,
  type MapConfig,
  type MapList,
  type MapPosition,
  type MarkerStyle,
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
  /** Holds at most one entry (the spectator and queue spawns): a new one replaces it. */
  single: boolean;
  /** How its markers are drawn (MARKER_STYLES, or a game's own model). */
  style: number;
}

/** Spawns, the spectator and queue spawns (games), each team's spawns, then the points the rules ask for and any others the map has. */
export function spawnLists(config: MapConfig, rules: EditorRules): SpawnList[] {
  const lists: SpawnList[] = [];
  const lobby = rules.kind === "lobby";
  const requires = rules.requires;
  const player = (marker: MarkerStyle | undefined) => markerStyle(marker, MARKER_STYLES.player, rules);
  lists.push({ target: { list: "spawns" }, key: "spawns", label: lobby ? "Spawn" : "Spawns", entry: "Spawn", color: "§f", single: false, style: player(requires?.spawns?.marker) });
  if (!lobby) {
    const spectator = player(markerOf(requires?.spectatorSpawn));
    const queue = player(markerOf(requires?.queueSpawn));
    lists.push({ target: { list: "spectatorSpawn" }, key: "spectatorSpawn", label: "Spectator spawn", entry: "Spectator spawn", color: "§7", single: true, style: spectator });
    lists.push({ target: { list: "queueSpawn" }, key: "queueSpawn", label: "Queue spawn", entry: "Queue spawn", color: "§b", single: true, style: queue });
  }
  const teams = rules.teams ?? [];
  const teamIds = new Set(teams.map((team) => team.id));
  const teamStyle = player(markerOf(requires?.teamSpawns));
  for (const team of teams) {
    const target: MapList = { list: "teamSpawns", team: team.id };
    lists.push({ target, key: listKey(target), label: `${team.name} spawns`, entry: `${team.name} spawn`, color: team.color, single: false, style: teamStyle });
  }
  // Team spawns a map already has for a team the game no longer lists, so they can be moved or removed.
  for (const team of Object.keys(config.teamSpawns ?? {})) {
    if (teamIds.has(team)) continue;
    const target: MapList = { list: "teamSpawns", team };
    lists.push({ target, key: listKey(target), label: `${team} spawns`, entry: `${team} spawn`, color: "§f", single: false, style: teamStyle });
  }
  const named = new Set<string>();
  const requirements = mapRequirements(requires, { kind: rules.kind, maxPlayers: rules.maxPlayers, teams });
  for (const requirement of requirements) {
    if (requirement.field !== "points" || requirement.name === undefined) continue;
    named.add(requirement.name);
    const color = teams.find((team) => team.id === requirement.team)?.color ?? "§e";
    lists.push(pointList(requirement.name, requirement.label, color, markerStyle(requirement.marker, MARKER_STYLES.post, rules)));
  }
  for (const name of Object.keys(config.points ?? {})) {
    if (!named.has(name)) lists.push(pointList(name, name, "§e", MARKER_STYLES.post));
  }
  return lists;
}

function pointList(name: string, label: string, color: string, style: number): SpawnList {
  const target: MapList = { list: "points", name };
  return { target, key: listKey(target), label, entry: label, color, single: false, style };
}

/** The `marker` of `spectatorSpawn: { marker }` and the like (`true` has none). */
function markerOf(requirement: boolean | { marker?: MarkerStyle } | undefined): MarkerStyle | undefined {
  return typeof requirement === "object" ? requirement.marker : undefined;
}

/** A marker style's number: the list's default without one, a post for a model the editor doesn't have. */
export function markerStyle(marker: MarkerStyle | undefined, fallback: number, rules: Pick<EditorRules, "markerModels">): number {
  if (marker === undefined) return fallback;
  if (marker === "player") return MARKER_STYLES.player;
  if (marker === "post") return MARKER_STYLES.post;
  return rules.markerModels?.[marker.model] ?? MARKER_STYLES.post;
}

/** The middle of a map's bounds, at floor level (where an entry without a facing looks). */
export function mapMiddle(config: MapConfig): Point {
  const box = boundsBox(config);
  if (!box) return { x: 0, y: 0, z: 0 };
  return { x: (box.min[0] + box.max[0] + 1) / 2, y: box.min[1], z: (box.min[2] + box.max[2] + 1) / 2 };
}

/** The level facing from `from` toward `to` (yaw 0 is south, 90 west). */
export function lookAt(from: Point, to: Point): Facing {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) return { yaw: 0, pitch: 0 };
  const yaw = Math.round((Math.atan2(-dx, dz) * 180) / Math.PI);
  // North is 180, not -180; + 0 turns -0 into 0.
  return { yaw: yaw === -180 ? 180 : yaw + 0, pitch: 0 };
}

/** A marker's color, by what it marks (its texture in the resource pack's render controller). */
export const MARKER_KINDS = { spawns: 0, spectatorSpawn: 1, queueSpawn: 2, teamSpawns: 3, points: 4, camera: 5 } as const;

/**
 * A marker's shape (the render controller's Array.shapes): a mannequin, a post, a camera head. A
 * game's own models come after these, numbered when the editor's template is built
 * (tools/editor/marker-models.ts), and get their own texture instead of the kind's color.
 */
export const MARKER_STYLES = { player: 0, post: 1, camera: 2 } as const;

/** What every marker has (markers.ts draws these): an entry's, or a camera's (cameras.ts). */
export interface MarkerShape {
  /** Stored on the marker entity: "<list key>#<index>", or "camera:<name>". */
  key: string;
  /** The marker's name tag. */
  label: string;
  /** Where the marker stands: the entry's exact point, or the middle of its block. */
  at: { x: number; y: number; z: number };
  facing?: Facing;
  /** Its color (MARKER_KINDS); spawns' when absent. */
  kind?: number;
  /** Its shape (MARKER_STYLES, or a game's model); a mannequin when absent. */
  style?: number;
  /** Where its line points when it has no saved facing: the middle of the map. */
  look?: Facing;
}

/** An entry's marker. */
export interface MarkerSpec extends MarkerShape {
  list: SpawnList;
  index: number;
}

/** A marker for every entry of every list. */
export function markerSpecs(config: MapConfig, lists: SpawnList[]): MarkerSpec[] {
  const middle = mapMiddle(config);
  return lists.flatMap((list) =>
    listOf(config, list.target).map((position, index) => {
      const facing = facingOf(position);
      const queue = list.key === "queueSpawn" ? ` (${queueText(config)})` : "";
      const name = `${list.color}${list.entry}${list.single ? "" : ` ${index + 1}`}${queue}`;
      return {
        key: `${list.key}#${index}`,
        list,
        index,
        label: facing ? `${name}\n§7faces ${compass(facing.yaw)}` : name,
        at: worldPoint(position),
        kind: MARKER_KINDS[list.target.list],
        style: list.style,
        ...(facing ? {} : { look: lookAt(worldPoint(position), middle) }),
        ...(facing ? { facing } : {}),
      };
    }),
  );
}

/** How players wait at the queue spawn, in a few words: "lock in, 5 s" or "free, 10 s". */
export function queueText(config: MapConfig): string {
  const queue = queueSettings(config);
  return `${queue.mode === "lock" ? "lock in" : "free"}, ${queue.countdown} s`;
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
