// Checks for map.json files, shared by the build and the map editor (which shows the same
// problems live). validateMapConfig returns a list of problems (empty when valid) so everything
// is reported at once; mapWarnings lists things worth a look that don't stop a build.
import type { MapRequirementsConfig } from "./config.ts";
import { MAP_TIMES, mapTimeTicks, type Box, type MapConfig, type MapPosition, type Vec3 } from "./map-config.ts";
import { mapRequirements, type MapRequirement } from "./map-requirements.ts";

/** Bedrock overworld height limits. */
const MIN_Y = -64;
const MAX_Y = 319;

export interface MapRules {
  kind: "lobby" | "game";
  /** For games: the map needs a spawn for every player slot (or team spawns). */
  maxPlayers?: number;
  /** Map entries the game's (or lobby's) config requires: its `map` block. */
  requires?: MapRequirementsConfig;
  /** Every team the game can have. When given, team spawn keys and "<name>.<team>" keys must be one of them. */
  teams?: { id: string; name: string }[];
}

export function validateMapConfig(raw: unknown, rules: MapRules): string[] {
  if (!isRecord(raw)) return ["map.json must be a JSON object"];
  const map = raw as Partial<MapConfig>;
  const problems: string[] = [];
  const who = rules.kind === "lobby" ? "the lobby" : "this game";
  const requirements = mapRequirements(rules.requires, { kind: rules.kind, maxPlayers: rules.maxPlayers, teams: rules.teams });
  if (typeof map.name !== "string" || !map.name) problems.push('"name" is required');
  if (map.draft !== undefined && typeof map.draft !== "boolean") problems.push('"draft" must be true or false');

  const spawns = Array.isArray(map.spawns) ? map.spawns : [];
  if (!Array.isArray(map.spawns)) problems.push('"spawns" must be a list of [x, y, z] positions');
  spawns.forEach((spawn, i) => checkPosition(spawn, `spawns[${i}]`, problems));
  const hasTeamSpawns = isRecord(map.teamSpawns) && Object.keys(map.teamSpawns).length > 0;
  const spawnRule = requirements.find((requirement) => requirement.field === "spawns");
  // A map with team spawns only needs one plain spawn, for players waiting before the start.
  const needed = hasTeamSpawns ? 1 : (spawnRule?.min ?? 1);
  if (spawns.length < needed) {
    const perSlot = spawnRule?.perPlayer && needed > 1 ? " (one per player slot)" : "";
    problems.push(`needs at least ${needed} spawn${needed === 1 ? "" : "s"}${perSlot}, has ${spawns.length}`);
  }
  if (map.spectatorSpawn !== undefined) checkPosition(map.spectatorSpawn, "spectatorSpawn", problems, '"spectatorSpawn"');
  if (map.killY !== undefined) {
    if (typeof map.killY !== "number" || !Number.isFinite(map.killY)) problems.push('"killY" must be a number');
    else if (map.killY < MIN_Y || map.killY > MAX_Y) problems.push(`"killY" must be within ${MIN_Y} to ${MAX_Y}`);
  }
  if (map.time !== undefined && mapTimeTicks(map.time) === undefined) {
    problems.push(`"time" must be one of ${Object.keys(MAP_TIMES).join(", ")}, or ticks from 0 to 23999`);
  }
  if (map.stars !== undefined && typeof map.stars !== "boolean") problems.push('"stars" must be true or false');
  if (map.stars === true && rules.kind !== "lobby") problems.push('"stars" is only for the lobby map');

  // Named entries: shape and team keys, then (below) inside the bounds.
  const points: [string, Vec3][] = [];
  spawns.forEach((spawn, i) => isPosition(spawn) && points.push([`spawns[${i}]`, xyz(spawn)]));
  if (isPosition(map.spectatorSpawn)) points.push(["spectatorSpawn", xyz(map.spectatorSpawn)]);
  const teamIds = rules.teams?.map((team) => team.id);
  for (const [field, entries] of [
    ["teamSpawns", map.teamSpawns],
    ["points", map.points],
  ] as const) {
    if (entries === undefined) continue;
    if (!isRecord(entries)) {
      problems.push(`"${field}" must map names to lists of [x, y, z]`);
      continue;
    }
    for (const [name, list] of Object.entries(entries)) {
      checkTeamKey(field, name, teamIds, problems);
      if (!Array.isArray(list) || list.length === 0) {
        problems.push(`${field}.${name} must be a non-empty list of [x, y, z]`);
        continue;
      }
      list.forEach((point, i) => {
        if (checkPosition(point, `${field}.${name}[${i}]`, problems)) points.push([`${field}.${name}[${i}]`, xyz(point as MapPosition)]);
      });
    }
  }
  const boxes: [string, Box][] = [];
  if (map.regions !== undefined) {
    if (!isRecord(map.regions)) problems.push('"regions" must map names to lists of { "min", "max" } boxes');
    else {
      for (const [name, list] of Object.entries(map.regions)) {
        checkTeamKey("regions", name, teamIds, problems);
        if (!Array.isArray(list) || list.length === 0) problems.push(`regions.${name} must be a non-empty list of boxes`);
        else
          list.forEach((box, i) => {
            if (!isBox(box)) problems.push(`regions.${name}[${i}] must be { "min": [x, y, z], "max": [x, y, z] }`);
            else if (box.min.some((value, axis) => value > box.max[axis])) problems.push(`regions.${name}[${i}] min must not be larger than max`);
            else boxes.push([`regions.${name}[${i}]`, box]);
          });
      }
    }
  }

  const bounds = map.bounds;
  if (bounds !== undefined) {
    if (!isBox(bounds)) {
      problems.push('"bounds" must be { "min": [x, y, z], "max": [x, y, z] }');
    } else {
      if (bounds.min.some((value, axis) => value > bounds.max[axis])) problems.push('"bounds" min must not be larger than max');
      if (bounds.min[1] < MIN_Y || bounds.max[1] > MAX_Y) problems.push(`"bounds" y must stay within ${MIN_Y} to ${MAX_Y}`);
      for (const [name, point] of points) {
        if (!inside(point, bounds.min, bounds.max)) problems.push(`${name} ${JSON.stringify(point)} is outside "bounds"`);
      }
      for (const [name, box] of boxes) {
        if (!inside(box.min, bounds.min, bounds.max) || !inside(box.max, bounds.min, bounds.max)) problems.push(`${name} is outside "bounds"`);
      }
    }
  }

  for (const requirement of requirements) problems.push(...missing(requirement, map, who, hasTeamSpawns));

  if (map.build !== undefined) {
    const commands = isRecord(map.build) ? map.build.commands : undefined;
    if (!Array.isArray(commands) || commands.some((command) => typeof command !== "string")) {
      problems.push('"build.commands" must be a list of console commands');
    } else {
      commands.forEach((command: string, i) => {
        if (command.trimStart().startsWith("/")) problems.push(`build.commands[${i}]: leave out the leading "/"`);
      });
    }
    if (bounds === undefined) problems.push('"bounds" is required when "build" is present (baking works inside it)');
  }
  problems.push(...editorKeyProblems(map));
  return problems;
}

/** Things worth a look that don't stop a build: two entries of a list at the same block. */
export function mapWarnings(config: MapConfig): string[] {
  const warnings: string[] = [];
  const lists: [string, unknown][] = [["spawns", config.spawns]];
  for (const field of ["teamSpawns", "points"] as const) {
    const entries = config[field];
    if (isRecord(entries)) for (const [name, list] of Object.entries(entries)) lists.push([`${field}.${name}`, list]);
  }
  for (const [name, list] of lists) {
    if (!Array.isArray(list)) continue;
    const seen = new Map<string, number>();
    list.forEach((position, i) => {
      if (!isPosition(position)) return;
      const at = xyz(position).join(",");
      const first = seen.get(at);
      if (first === undefined) seen.set(at, i);
      else warnings.push(`${name}[${i}] is at the same block as ${name}[${first}]`);
    });
  }
  return warnings;
}

/** The problems with one requirement: entries missing, or fewer than needed. Spawns are checked above. */
function missing(requirement: MapRequirement, map: Partial<MapConfig>, who: string, hasTeamSpawns: boolean): string[] {
  const { field, name, min } = requirement;
  switch (field) {
    case "spawns":
      return [];
    case "spectatorSpawn":
      return map.spectatorSpawn === undefined ? [`${who} needs a "spectatorSpawn"`] : [];
    case "bounds":
      return map.bounds === undefined ? [`${who} needs "bounds"`] : [];
    case "killY":
      return map.killY === undefined ? [`${who} needs "killY"`] : [];
    case "teamSpawns":
      if (name === undefined) return hasTeamSpawns ? [] : [`${who} needs "teamSpawns"`];
      return count(`teamSpawns.${name}`, listLength(map.teamSpawns, name), min, who);
    case "points":
    case "regions":
      return count(`${field}.${name}`, listLength(map[field], name!), min, who);
  }
}

function count(key: string, have: number, min: number, who: string): string[] {
  if (have >= min) return [];
  return [min === 1 ? `${who} needs a "${key}" entry` : `${who} needs ${min} "${key}" entries, has ${have}`];
}

function listLength(entries: unknown, name: string): number {
  if (!isRecord(entries)) return 0;
  const list = entries[name];
  return Array.isArray(list) ? list.length : 0;
}

/** Team spawn keys are team ids; a "<name>.<team>" key's team must be one of the game's. */
function checkTeamKey(field: string, key: string, teamIds: string[] | undefined, problems: string[]): void {
  if (teamIds === undefined) return;
  const team = field === "teamSpawns" ? key : key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : undefined;
  if (team === undefined || teamIds.includes(team)) return;
  const known = teamIds.length > 0 ? `one of ${teamIds.join(", ")}` : "a team, and this map's game has none";
  problems.push(`${field}.${key}: "${team}" must be ${known}`);
}

/** The map editor's keys: where the map was cut from, and its preview cameras. */
function editorKeyProblems(map: Partial<MapConfig>): string[] {
  const problems: string[] = [];
  const source = map.source;
  if (source !== undefined && !(isRecord(source) && typeof source.world === "string" && isBox(source.box) && isVec3(source.offset))) {
    problems.push('"source" must be { "world", "box": { "min", "max" }, "offset": [x, y, z] }');
  }
  if (map.cameras !== undefined) {
    if (!isRecord(map.cameras)) problems.push('"cameras" must map names to { "at": [x, y, z, yaw, pitch], "kind" }');
    else {
      for (const [name, camera] of Object.entries(map.cameras)) {
        const ok = isRecord(camera) && isPosition(camera.at) && camera.at.length === 5 && (camera.kind === "map" || camera.kind === "game");
        if (!ok) problems.push(`cameras.${name} must be { "at": [x, y, z, yaw, pitch], "kind": "map" or "game" }`);
      }
    }
  }
  return problems;
}

/** Reports a bad position; true when it's a usable one. */
function checkPosition(value: unknown, name: string, problems: string[], quoted = name): boolean {
  if (!isPosition(value)) {
    problems.push(`${quoted} must be [x, y, z]`);
    return false;
  }
  if (value.length === 5) {
    const [, , , yaw, pitch] = value;
    if (yaw < -180 || yaw > 180 || pitch < -90 || pitch > 90) {
      problems.push(`${quoted} facing must be a yaw from -180 to 180 and a pitch from -90 to 90`);
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberList(value: unknown, lengths: number[]): boolean {
  return Array.isArray(value) && lengths.includes(value.length) && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

function isVec3(value: unknown): value is Vec3 {
  return isNumberList(value, [3]);
}

/** [x, y, z], or [x, y, z, yaw, pitch] with a saved facing. */
function isPosition(value: unknown): value is MapPosition {
  return isNumberList(value, [3, 5]);
}

function isBox(value: unknown): value is Box {
  return isRecord(value) && isVec3(value.min) && isVec3(value.max);
}

function xyz(position: MapPosition): Vec3 {
  return [position[0], position[1], position[2]];
}

function inside(point: Vec3, min: Vec3, max: Vec3): boolean {
  return point.every((value, axis) => value >= min[axis] && value <= max[axis]);
}
