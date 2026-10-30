// Checks for game configs and map.json files. Each function returns a list of problems (empty
// when valid) so the build can report everything at once instead of stopping at the first. The
// map checks live in minigame-core, so the map editor shows the same problems live.
import type { GameConfig } from "@minecade/minigame-core/config";

export { mapWarnings, validateMapConfig, type MapRules } from "@minecade/minigame-core/config";

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
  problems.push(...validateOptions(config));
  const kitIds = config.kits?.list.map((kit) => kit.id) ?? [];
  if (new Set(kitIds).size !== kitIds.length) problems.push("kit ids must be unique");
  const extraKeys = config.stats?.extras?.map((extra) => extra.key) ?? [];
  if (new Set(extraKeys).size !== extraKeys.length) problems.push("stats extra keys must be unique");
  if (config.respawn?.mode === "lives" && !(Number.isInteger(config.respawn.lives) && config.respawn.lives! >= 1)) {
    problems.push('respawn.lives must be at least 1 when respawn.mode is "lives"');
  }
  return problems;
}

/** Setting ids and values the orchestrator passes on (cleanSettings in orchestrator/src/session-manager.ts). */
const SETTING_ID = /^[a-z][a-zA-Z0-9_]{0,31}$/;
const MAX_SETTING_VALUE = 32;
const MAX_SETTINGS = 8;

function validateOptions(config: GameConfig): string[] {
  const options = config.options ?? [];
  const problems: string[] = [];
  const teams = config.teams;
  // Team games where players pick get a Teams setting of their own (lobby game-screen.ts).
  const builtInTeams = teams !== undefined && teams.pick !== false && !(teams.defs ?? []).some((team) => team.size !== undefined);
  const ids = options.map((option) => option.id);
  if (new Set(ids).size !== ids.length) problems.push("options ids must be unique");
  if (options.length + (builtInTeams ? 1 : 0) > MAX_SETTINGS) problems.push(`a game can have at most ${MAX_SETTINGS} settings, Teams included`);
  for (const option of options) {
    const name = `options "${option.id}"`;
    if (!SETTING_ID.test(option.id)) problems.push(`${name}: the id must be lower camelCase letters, digits or _, up to 32 characters`);
    if (builtInTeams && option.id === "teams") problems.push(`${name}: team games already get a Teams setting`);
    if (!option.label) problems.push(`${name}: label is required`);
    if (option.values.length < 2) problems.push(`${name}: needs at least 2 values`);
    for (const { value, label } of option.values) {
      if (!value || value.length > MAX_SETTING_VALUE) problems.push(`${name}: values must be 1 to ${MAX_SETTING_VALUE} characters`);
      if (!label) problems.push(`${name}: every value needs a label`);
    }
    const values = option.values.map((entry) => entry.value);
    if (new Set(values).size !== values.length) problems.push(`${name}: values must be unique`);
  }
  return problems;
}
