// A map's checklist in the map editor: each thing its game (or the lobby) needs, with how many the
// map has, plus every problem the build would report. The editor pack shows it in game, the host
// logs it, and the Panel mirrors it.
import { checkBoard } from "./board/board-check.ts";
import { spacesOf } from "./board/board-map.ts";
import type { Box, BuildLimitSide, MapConfig } from "./map-config.ts";
import { fitsSize, mapRequirements, type MapRequirement } from "./map-requirements.ts";
import { mapWarnings, validateMapConfig, type MapRules } from "./map-validate.ts";

export interface ChecklistRow extends MapRequirement {
  have: number;
  /** Entries needed: the requirement's minimum, except that team spawns leave plain spawns needing 1. */
  need: number;
  done: boolean;
}

export interface Checklist {
  rows: ChecklistRow[];
  /** What the build would refuse the map for (the missing entries among them). */
  problems: string[];
  /** Worth a look, but no reason to refuse it. */
  warnings: string[];
  /** No problems: the map could be marked ready. */
  ready: boolean;
}

export function mapChecklist(config: MapConfig, rules: MapRules): Checklist {
  const teamSpawns = isRecord(config.teamSpawns) ? config.teamSpawns : {};
  const hasTeamSpawns = Object.keys(teamSpawns).length > 0;
  // The map's own requirement options (map.json "requirements") decide its rows, as in the validator.
  const rows = mapRequirements(rules.requires, { kind: rules.kind, maxPlayers: rules.maxPlayers, teams: rules.teams, choices: config.requirements }).map((requirement) => {
    const have = count(config, requirement);
    // The same rule as the validator: with team spawns, plain spawns are only where players wait.
    const need = requirement.field === "spawns" && hasTeamSpawns ? 1 : requirement.min;
    return { ...requirement, have, need, done: have >= need };
  });
  const problems = validateMapConfig(config, rules);
  // A board's warnings (/boardcheck's), while its spaces count (a map can turn them off).
  const board = rules.requires?.board;
  const spaces = spacesOf(config);
  const boardWarnings = board && rows.some((row) => row.field === "spaces") && spaces.length > 0 ? checkBoard(spaces, board).warnings.map((warning) => warning.text) : [];
  return { rows, problems, warnings: problems.length === 0 ? [...mapWarnings(config), ...boardWarnings] : [], ready: problems.length === 0 };
}

function count(config: MapConfig, requirement: MapRequirement): number {
  switch (requirement.field) {
    case "spawns":
      return Array.isArray(config.spawns) ? config.spawns.length : 0;
    case "spectatorSpawn":
    case "queueSpawn":
    case "killY":
      return config[requirement.field] === undefined ? 0 : 1;
    case "buildLimit":
      return isRecord(config.buildLimit) && config.buildLimit[requirement.name as BuildLimitSide] !== undefined ? 1 : 0;
    case "spectatorOrQueue":
      return config.spectatorSpawn === undefined && config.queueSpawn === undefined ? 0 : 1;
    case "bounds":
      return Array.isArray(config.bounds) ? config.bounds.length : config.bounds === undefined ? 0 : 1;
    case "spaces":
      return spacesOf(config).length;
    case "teamSpawns":
      if (requirement.name === undefined) return isRecord(config.teamSpawns) ? Object.keys(config.teamSpawns).length : 0;
      return lengthOf(config.teamSpawns, requirement.name);
    case "points":
      return lengthOf(config.points, requirement.name ?? "");
    case "regions": {
      // Only boxes the size the game asks for count (the problems name the others).
      const list: unknown = isRecord(config.regions) ? config.regions[requirement.name ?? ""] : undefined;
      return Array.isArray(list) ? list.filter((box) => isBoxLike(box) && fitsSize(box, requirement)).length : 0;
    }
  }
}

function isBoxLike(value: unknown): value is Box {
  return isRecord(value) && Array.isArray(value.min) && Array.isArray(value.max);
}

function lengthOf(entries: unknown, name: string): number {
  if (!isRecord(entries)) return 0;
  const list = entries[name];
  return Array.isArray(list) ? list.length : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
