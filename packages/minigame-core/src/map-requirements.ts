// What a game's (or the lobby's) maps need, from the `map` block of its config, as one flat list:
// the build checks every map against it, and the map editor shows it as a checklist.
import type { MapEntryRequirement, MapRequirementsConfig } from "./config.ts";
import { teamKey } from "./map-config.ts";

export type MapField = "spawns" | "spectatorSpawn" | "bounds" | "killY" | "points" | "regions" | "teamSpawns";

export interface MapRequirement {
  /** Where it lives in map.json, and a unique id: "spawns", "points.bombA", "regions.buyZone.red", "teamSpawns.red". */
  key: string;
  label: string;
  field: MapField;
  /** The point or region key (with ".<team>" for one team's), or the team id for team spawns. */
  name?: string;
  team?: string;
  /** Entries needed; for the spectator spawn, bounds and killY, 1 means "set". */
  min: number;
  /** Spawns only: the minimum is one per player slot. */
  perPlayer?: boolean;
}

export interface RequirementOptions {
  kind: "lobby" | "game";
  maxPlayers?: number;
  /** Every team the game can have (possibleTeams), for team spawns and per-team entries. */
  teams?: { id: string; name: string }[];
}

/** The requirements in checklist order: spawns, spectator spawn, bounds, killY, points, regions, team spawns. */
export function mapRequirements(map: MapRequirementsConfig | undefined, options: RequirementOptions): MapRequirement[] {
  const list: MapRequirement[] = [];
  const teams = options.teams ?? [];
  const asked = map?.spawns?.min;
  if (options.kind === "lobby") {
    list.push({ key: "spawns", label: "Spawn", field: "spawns", min: typeof asked === "number" ? asked : 1 });
  } else if (typeof asked === "number") {
    list.push({ key: "spawns", label: "Spawns", field: "spawns", min: asked });
  } else {
    // Team games spawn players by team, so their plain spawns only need one (for waiting).
    const perPlayer = !map?.teamSpawns;
    list.push({ key: "spawns", label: "Spawns", field: "spawns", min: perPlayer ? (options.maxPlayers ?? 1) : 1, perPlayer });
  }
  if (map?.spectatorSpawn) list.push({ key: "spectatorSpawn", label: "Spectator spawn", field: "spectatorSpawn", min: 1 });
  if (map?.bounds) list.push({ key: "bounds", label: "Bounds", field: "bounds", min: 1 });
  if (map?.killY) list.push({ key: "killY", label: "Kill Y", field: "killY", min: 1 });
  for (const field of ["points", "regions"] as const) {
    for (const [name, entry] of entriesOf(map?.[field])) {
      const label = entry.label ?? name;
      const min = entry.count ?? 1;
      if (entry.perTeam && teams.length > 0) {
        for (const team of teams) {
          const key = teamKey(name, team.id);
          list.push({ key: `${field}.${key}`, label: `${label} (${team.name})`, field, name: key, team: team.id, min });
        }
      } else {
        list.push({ key: `${field}.${name}`, label, field, name, min });
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

function entriesOf(value: string[] | Record<string, MapEntryRequirement> | undefined): [string, MapEntryRequirement][] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((name) => [name, {}]);
  return Object.entries(value);
}
