// A map's checklist in the map editor: each thing its game (or the lobby) needs, with how many the
// map has, plus every problem the build would report. The editor pack shows it in game, the host
// logs it, and the Panel mirrors it.
import type { MapConfig } from "./map-config.ts";
import { mapRequirements, type MapRequirement } from "./map-requirements.ts";
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
  const rows = mapRequirements(rules.requires, { kind: rules.kind, maxPlayers: rules.maxPlayers, teams: rules.teams }).map((requirement) => {
    const have = count(config, requirement);
    // The same rule as the validator: with team spawns, plain spawns are only where players wait.
    const need = requirement.field === "spawns" && hasTeamSpawns ? 1 : requirement.min;
    return { ...requirement, have, need, done: have >= need };
  });
  const problems = validateMapConfig(config, rules);
  return { rows, problems, warnings: problems.length === 0 ? mapWarnings(config) : [], ready: problems.length === 0 };
}

function count(config: MapConfig, requirement: MapRequirement): number {
  switch (requirement.field) {
    case "spawns":
      return Array.isArray(config.spawns) ? config.spawns.length : 0;
    case "spectatorSpawn":
    case "queueSpawn":
    case "bounds":
    case "killY":
      return config[requirement.field] === undefined ? 0 : 1;
    case "teamSpawns":
      if (requirement.name === undefined) return isRecord(config.teamSpawns) ? Object.keys(config.teamSpawns).length : 0;
      return lengthOf(config.teamSpawns, requirement.name);
    case "points":
    case "regions":
      return lengthOf(config[requirement.field], requirement.name ?? "");
  }
}

function lengthOf(entries: unknown, name: string): number {
  if (!isRecord(entries)) return 0;
  const list = entries[name];
  return Array.isArray(list) ? list.length : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
