// Checks for game configs and map.json files. Each function returns a list of problems (empty
// when valid) so the build can report everything at once instead of stopping at the first.
import type { Box, GameConfig, MapConfig, Vec3 } from "@minecade/minigame-core/config";

/** Bedrock overworld height limits. */
const MIN_Y = -64;
const MAX_Y = 319;

export function validateGameConfig(config: GameConfig, folder: string): string[] {
  const problems: string[] = [];
  if (config.id !== folder) problems.push(`id "${config.id}" must match the folder name "${folder}"`);
  if (!config.name) problems.push("name is required");
  if (!Number.isInteger(config.minPlayers) || config.minPlayers < 1) problems.push("minPlayers must be a whole number of at least 1");
  if (!Number.isInteger(config.maxPlayers) || config.maxPlayers < config.minPlayers) {
    problems.push("maxPlayers must be a whole number no smaller than minPlayers");
  }
  const teams = config.teams;
  if (teams) {
    const roles = (teams.defs ?? []).some((team) => team.size !== undefined);
    const count = typeof teams.count === "number" ? teams.count : teams.count[0];
    const defs = teams.defs?.length ?? 4;
    if (!roles && (count < 1 || count > defs)) problems.push(`teams.count needs ${count} teams but only ${defs} are defined`);
    if (!roles && typeof teams.count === "number" && config.minPlayers < teams.count * (teams.minPerTeam ?? 1)) {
      problems.push(`minPlayers must be at least ${teams.count * (teams.minPerTeam ?? 1)} to fill ${teams.count} teams`);
    }
    if (Array.isArray(teams.count) && teams.count[0] > teams.count[1]) problems.push("teams.count range must be [min, max]");
  }
  const kitIds = config.kits?.list.map((kit) => kit.id) ?? [];
  if (new Set(kitIds).size !== kitIds.length) problems.push("kit ids must be unique");
  const extraKeys = config.stats?.extras?.map((extra) => extra.key) ?? [];
  if (new Set(extraKeys).size !== extraKeys.length) problems.push("stats extra keys must be unique");
  if (config.respawn?.mode === "lives" && !(Number.isInteger(config.respawn.lives) && config.respawn.lives! >= 1)) {
    problems.push('respawn.lives must be at least 1 when respawn.mode is "lives"');
  }
  return problems;
}

export interface MapRules {
  kind: "lobby" | "game";
  /** For games: the map needs a spawn for every player slot (or team spawns). */
  maxPlayers?: number;
  /** Map entries the game's config requires. */
  requires?: GameConfig["map"];
}

export function validateMapConfig(raw: unknown, rules: MapRules): string[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["map.json must be a JSON object"];
  const map = raw as Partial<MapConfig>;
  const problems: string[] = [];
  if (typeof map.name !== "string" || !map.name) problems.push('"name" is required');

  const spawns = Array.isArray(map.spawns) ? map.spawns : [];
  if (!Array.isArray(map.spawns)) problems.push('"spawns" must be a list of [x, y, z] positions');
  spawns.forEach((spawn, i) => {
    if (!isVec3(spawn)) problems.push(`spawns[${i}] must be [x, y, z]`);
  });
  const hasTeamSpawns = map.teamSpawns !== undefined && Object.keys(map.teamSpawns).length > 0;
  const needed = rules.kind === "lobby" || hasTeamSpawns ? 1 : (rules.maxPlayers ?? 1);
  if (spawns.length < needed) {
    problems.push(`needs at least ${needed} spawn${needed === 1 ? "" : "s"}${needed > 1 ? " (one per player slot)" : ""}, has ${spawns.length}`);
  }
  if (map.spectatorSpawn !== undefined && !isVec3(map.spectatorSpawn)) problems.push('"spectatorSpawn" must be [x, y, z]');
  if (map.killY !== undefined && (typeof map.killY !== "number" || !Number.isFinite(map.killY))) problems.push('"killY" must be a number');

  // Named entries: shape, then (below) inside the bounds.
  const points: [string, unknown][] = spawns.map((spawn, i): [string, unknown] => [`spawns[${i}]`, spawn]);
  if (map.spectatorSpawn !== undefined) points.push(["spectatorSpawn", map.spectatorSpawn]);
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
      if (!Array.isArray(list) || list.length === 0) problems.push(`${field}.${name} must be a non-empty list of [x, y, z]`);
      else list.forEach((point, i) => (isVec3(point) ? points.push([`${field}.${name}[${i}]`, point]) : problems.push(`${field}.${name}[${i}] must be [x, y, z]`)));
    }
  }
  const boxes: [string, Box][] = [];
  if (map.regions !== undefined) {
    if (!isRecord(map.regions)) problems.push('"regions" must map names to lists of { "min", "max" } boxes');
    else {
      for (const [name, list] of Object.entries(map.regions)) {
        if (!Array.isArray(list) || list.length === 0) problems.push(`regions.${name} must be a non-empty list of boxes`);
        else list.forEach((box, i) => (isBox(box) ? boxes.push([`regions.${name}[${i}]`, box]) : problems.push(`regions.${name}[${i}] must be { "min": [x, y, z], "max": [x, y, z] }`)));
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
        if (isVec3(point) && !inside(point, bounds.min, bounds.max)) problems.push(`${name} ${JSON.stringify(point)} is outside "bounds"`);
      }
      for (const [name, box] of boxes) {
        if (!inside(box.min, bounds.min, bounds.max) || !inside(box.max, bounds.min, bounds.max)) problems.push(`${name} is outside "bounds"`);
      }
    }
  }

  const requires = rules.requires;
  for (const name of requires?.points ?? []) if (!map.points?.[name]) problems.push(`this game needs a "points.${name}" entry`);
  for (const name of requires?.regions ?? []) if (!map.regions?.[name]) problems.push(`this game needs a "regions.${name}" entry`);
  if (requires?.teamSpawns && !hasTeamSpawns) problems.push('this game needs "teamSpawns"');

  if (map.build !== undefined) {
    const commands = (map.build as { commands?: unknown }).commands;
    if (!Array.isArray(commands) || commands.some((command) => typeof command !== "string")) {
      problems.push('"build.commands" must be a list of console commands');
    } else {
      commands.forEach((command: string, i) => {
        if (command.trimStart().startsWith("/")) problems.push(`build.commands[${i}]: leave out the leading "/"`);
      });
    }
    if (bounds === undefined) problems.push('"bounds" is required when "build" is present (baking works inside it)');
  }
  return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

function isBox(value: unknown): value is Box {
  return isRecord(value) && isVec3(value.min) && isVec3(value.max);
}

function inside(point: Vec3, min: Vec3, max: Vec3): boolean {
  return point.every((value, axis) => value >= min[axis] && value <= max[axis]);
}
