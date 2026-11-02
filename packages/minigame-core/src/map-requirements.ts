// What a game's (or the lobby's) maps need, from the `map` block of its config, as one flat list:
// the build checks every map against it, and the map editor shows it as a checklist.
import type { MapEntryRequirement, MapRequirementsConfig, MarkerStyle } from "./config.ts";
import { BUILD_LIMIT_SIDES, teamKey, type Box, type BuildLimitSide, type Vec3 } from "./map-config.ts";

/** "spectatorOrQueue": a spectator spawn or a queue spawn, either one (games that name neither). */
export type MapField = "spawns" | "spectatorSpawn" | "queueSpawn" | "spectatorOrQueue" | "bounds" | "killY" | "buildLimit" | "points" | "regions" | "teamSpawns";

export interface MapRequirement {
  /** Where it lives in map.json, and a unique id: "spawns", "points.bombA", "regions.buyZone.red", "teamSpawns.red". */
  key: string;
  label: string;
  field: MapField;
  /** The point or region key (with ".<team>" for one team's), or the team id for team spawns. */
  name?: string;
  team?: string;
  /** Entries needed; for the spectator and queue spawns, bounds, killY and a build limit side, 1 means "set". */
  min: number;
  /** Spawns only: the minimum is one per player slot. */
  perPlayer?: boolean;
  /** Points only: how the map editor draws them, when the config says. */
  marker?: MarkerStyle;
  /** Regions only: the fewest blocks each box spans along every side; smaller boxes don't count. */
  minSize?: number;
}

/** How many blocks a box spans along each side (its corners are whole blocks, both inside). */
export function boxSize(box: Box): Vec3 {
  return [0, 1, 2].map((axis) => box.max[axis] - box.min[axis] + 1) as Vec3;
}

/** Whether a box is big enough for a requirement's `minSize` (any box is without one). */
export function bigEnough(box: Box, minSize: number | undefined): boolean {
  return minSize === undefined || boxSize(box).every((side) => side >= minSize);
}

/** The `minSize` a game asks of a region's boxes (`name` may be one team's "<name>.<team>"), if any. */
export function regionMinSize(map: MapRequirementsConfig | undefined, name: string): number | undefined {
  for (const [region, entry] of entriesOf(map?.regions)) {
    if (name === region || name.startsWith(`${region}.`)) return entry.minSize;
  }
  return undefined;
}

/**
 * Whether a map has plain spawns (map.json "spawns"): always for the lobby; for a game unless its
 * config says spawns: false, or asks for team spawns without naming spawns (players then wait and
 * play at their team's spawns).
 */
export function usesPlainSpawns(map: MapRequirementsConfig | undefined, kind: "lobby" | "game"): boolean {
  if (kind === "lobby") return true;
  if (map?.spawns === false) return false;
  return !(map?.teamSpawns && map.spawns === undefined);
}

export interface RequirementOptions {
  kind: "lobby" | "game";
  maxPlayers?: number;
  /** Every team the game can have (possibleTeams), for team spawns and per-team entries. */
  teams?: { id: string; name: string }[];
}

/** The requirements in checklist order: spawns, spectator or queue spawn, spectator spawn, queue spawn, bounds, killY, the build limit, points, regions, team spawns. */
export function mapRequirements(map: MapRequirementsConfig | undefined, options: RequirementOptions): MapRequirement[] {
  const list: MapRequirement[] = [];
  const teams = options.teams ?? [];
  const asked = map?.spawns ? map.spawns.min : undefined;
  if (options.kind === "lobby") {
    list.push({ key: "spawns", label: "Spawn", field: "spawns", min: typeof asked === "number" ? asked : 1 });
  } else if (!usesPlainSpawns(map, options.kind)) {
    // Team spawns only.
  } else if (typeof asked === "number") {
    list.push({ key: "spawns", label: "Spawns", field: "spawns", min: asked });
  } else {
    // Team games spawn players by team, so their plain spawns only need one (for waiting).
    const perPlayer = !map?.teamSpawns;
    list.push({ key: "spawns", label: "Spawns", field: "spawns", min: perPlayer ? (options.maxPlayers ?? 1) : 1, perPlayer });
  }
  // A game watches from the spectator spawn, or from the queue spawn when the map has no spectator
  // spawn: one or the other, unless the game names what it needs.
  if (options.kind === "game" && map?.spectatorSpawn === undefined && map?.queueSpawn === undefined) {
    list.push({ key: "spectatorOrQueue", label: "Spectator or queue spawn", field: "spectatorOrQueue", min: 1 });
  }
  if (map?.spectatorSpawn) list.push({ key: "spectatorSpawn", label: "Spectator spawn", field: "spectatorSpawn", min: 1 });
  if (map?.queueSpawn) list.push({ key: "queueSpawn", label: "Queue spawn", field: "queueSpawn", min: 1 });
  if (map?.bounds) list.push({ key: "bounds", label: "Bounds", field: "bounds", min: 1 });
  if (map?.killY) list.push({ key: "killY", label: "Kill Y", field: "killY", min: 1 });
  for (const side of buildLimitSides(map?.buildLimit)) {
    list.push({ key: `buildLimit.${side}`, label: `Build limit ${side}`, field: "buildLimit", name: side, min: 1 });
  }
  for (const field of ["points", "regions"] as const) {
    for (const [name, entry] of entriesOf(map?.[field])) {
      const label = entry.label ?? name;
      const min = entry.count ?? 1;
      const marker = field === "points" && entry.marker !== undefined ? { marker: entry.marker } : {};
      const size = field === "regions" && entry.minSize !== undefined ? { minSize: entry.minSize } : {};
      if (entry.perTeam && teams.length > 0) {
        for (const team of teams) {
          const key = teamKey(name, team.id);
          list.push({ key: `${field}.${key}`, label: `${label} (${team.name})`, field, name: key, team: team.id, min, ...marker, ...size });
        }
      } else {
        list.push({ key: `${field}.${name}`, label, field, name, min, ...marker, ...size });
      }
    }
  }
  const teamSpawns = map?.teamSpawns;
  if (teamSpawns) {
    const perTeam = typeof teamSpawns === "object" ? (teamSpawns.perTeam ?? 1) : 1;
    if (teams.length === 0) list.push({ key: "teamSpawns", label: "Team spawns", field: "teamSpawns", min: 1 });
    for (const team of teams) {
      list.push({ key: `teamSpawns.${team.id}`, label: `${team.name} spawns`, field: "teamSpawns", name: team.id, team: team.id, min: perTeam });
    }
  }
  return list;
}

/** The build limit's sides a config asks for: true is both. */
function buildLimitSides(value: MapRequirementsConfig["buildLimit"]): BuildLimitSide[] {
  if (!value) return [];
  return value === true ? [...BUILD_LIMIT_SIDES] : BUILD_LIMIT_SIDES.filter((side) => value[side]);
}

function entriesOf(value: string[] | Record<string, MapEntryRequirement> | undefined): [string, MapEntryRequirement][] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((name) => [name, {}]);
  return Object.entries(value);
}
