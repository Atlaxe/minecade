// Checks for game configs and map.json files. Each function returns a list of problems (empty
// when valid) so the build can report everything at once instead of stopping at the first.
import type { GameConfig, MapConfig, Vec3 } from "@minecade/minigame-core/config";

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
  return problems;
}

export interface MapRules {
  kind: "lobby" | "game";
  /** For games: the map needs a spawn for every player slot. */
  maxPlayers?: number;
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
  const needed = rules.kind === "lobby" ? 1 : (rules.maxPlayers ?? 1);
  if (spawns.length < needed) {
    problems.push(`needs at least ${needed} spawn${needed === 1 ? "" : "s"}${rules.kind === "game" ? " (one per player slot)" : ""}, has ${spawns.length}`);
  }
  if (map.spectatorSpawn !== undefined && !isVec3(map.spectatorSpawn)) problems.push('"spectatorSpawn" must be [x, y, z]');

  const bounds = map.bounds;
  if (bounds !== undefined) {
    if (!isVec3(bounds?.min) || !isVec3(bounds?.max)) {
      problems.push('"bounds" must be { "min": [x, y, z], "max": [x, y, z] }');
    } else {
      if (bounds.min.some((value, axis) => value > bounds.max[axis])) problems.push('"bounds" min must not be larger than max');
      if (bounds.min[1] < MIN_Y || bounds.max[1] > MAX_Y) problems.push(`"bounds" y must stay within ${MIN_Y} to ${MAX_Y}`);
      const points = spawns.map((spawn, i): [string, unknown] => [`spawns[${i}]`, spawn]);
      if (map.spectatorSpawn !== undefined) points.push(["spectatorSpawn", map.spectatorSpawn]);
      for (const [name, point] of points) {
        if (isVec3(point) && !inside(point, bounds.min, bounds.max)) problems.push(`${name} ${JSON.stringify(point)} is outside "bounds"`);
      }
    }
  }

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

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

function inside(point: Vec3, min: Vec3, max: Vec3): boolean {
  return point.every((value, axis) => value >= min[axis] && value <= max[axis]);
}
