// Checks for game configs and map.json files. Each function returns a list of problems (empty
// when valid) so the build can report everything at once instead of stopping at the first. The
// map checks live in minigame-core, so the map editor shows the same problems live.
import { MAX_ROUND_ICONS, MAX_SCORE_SIDES, MIN_BEST_OF, isMapKey, mapSettings, possibleTeams, settingFits, type GameConfig } from "@minecade/minigame-core/config";

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
    if (teams.option !== undefined) {
      const option = config.options?.find((candidate) => candidate.id === teams.option);
      if (!option) problems.push(`teams.option "${teams.option}" must be one of the game's options`);
      const [min, max] = typeof teams.count === "number" ? [1, teams.count] : teams.count;
      for (const { value } of option?.values ?? []) {
        const most = Number(value);
        if (!Number.isInteger(most) || most < min || most > max) problems.push(`teams.option "${teams.option}": every value must be a team count from ${min} to ${max}`);
      }
    }
  }
  problems.push(...validateOptions(config));
  problems.push(...validateScoring(config));
  const kits = config.kits;
  const kitIds = [...(kits?.base ? [kits.base.id] : []), ...(kits?.list.map((kit) => kit.id) ?? [])];
  if (new Set(kitIds).size !== kitIds.length) problems.push("kit ids must be unique");
  if (kits?.select !== undefined && !KIT_SELECTS.includes(kits.select)) problems.push(`kits.select must be ${KIT_SELECTS.join(" or ")}`);
  if (kits?.select === "round" && !config.bestOf) problems.push('kits.select "round" needs bestOf: kits are picked before each best-of round');
  if (kits?.pickSeconds !== undefined && !(Number.isInteger(kits.pickSeconds) && kits.pickSeconds >= 5 && kits.pickSeconds <= 120)) {
    problems.push("kits.pickSeconds must be whole seconds from 5 to 120");
  }
  for (const entry of config.mannequinItems ?? []) {
    const item: unknown = typeof entry === "string" ? entry : entry?.item;
    if (typeof item !== "string" || !ITEM_ID.test(item)) problems.push(`mannequinItems: ${JSON.stringify(item ?? entry)} must be an item id, such as "minecraft:bow"`);
  }
  problems.push(...validateBestOf(config));
  for (const name of config.build?.noBuild ?? []) {
    if (!REGION_NAME.test(name)) problems.push(`build.noBuild "${name}" must be a region name: letters, digits and _, starting with a letter`);
  }
  const extraKeys = config.stats?.extras?.map((extra) => extra.key) ?? [];
  if (new Set(extraKeys).size !== extraKeys.length) problems.push("stats extra keys must be unique");
  if (config.respawn?.mode === "lives" && !(Number.isInteger(config.respawn.lives) && config.respawn.lives! >= 1)) {
    problems.push('respawn.lives must be at least 1 when respawn.mode is "lives"');
  }
  problems.push(...validateMapSettings(config));
  problems.push(...validateBorrow(config));
  if (config.blocks !== undefined && config.blocks !== "full") problems.push('blocks must be "full" or left out');
  return problems;
}

const KIT_SELECTS: readonly string[] = ["match", "round"];
const REGION_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
/** An item id: "minecraft:bow", "minecade:{color}_paintball_rifle". */
const ITEM_ID = /^[a-z0-9_.-]+:[a-z0-9_.{}/-]+$/;

/** Per-map settings: a key of the game's own in map.json, whole numbers, and a default in range. */
function validateMapSettings(config: GameConfig): string[] {
  const problems: string[] = [];
  for (const setting of mapSettings(config.map)) {
    const where = `map.settings.${setting.key}`;
    if (!REGION_NAME.test(setting.key) || isMapKey(setting.key)) problems.push(`${where}: the key must be letters, digits and _, starting with a letter, and not one map.json has`);
    if (!setting.label) problems.push(`${where} needs a label`);
    if (![setting.min, setting.max, setting.default].every(Number.isInteger) || setting.min > setting.max) problems.push(`${where}: min and max must be whole numbers, min no more than max`);
    else if (!settingFits(setting, setting.default)) problems.push(`${where}: the default must be from ${setting.min} to ${setting.max}`);
  }
  return problems;
}

/** Best-of rounds: at least 3 rounds (or a first-to), and a display with room for them. */
function validateBestOf(config: GameConfig): string[] {
  const bestOf = config.bestOf;
  if (!bestOf) return [];
  const problems: string[] = [];
  const whole = (value: number | undefined, min: number) => value === undefined || (Number.isInteger(value) && value >= min);
  if (bestOf.rounds !== undefined && bestOf.firstTo !== undefined) problems.push("bestOf takes rounds or firstTo, not both");
  if (!whole(bestOf.rounds, MIN_BEST_OF)) problems.push(`bestOf.rounds must be a whole number of at least ${MIN_BEST_OF}`);
  if (!whole(bestOf.firstTo, 1)) problems.push("bestOf.firstTo must be a whole number of at least 1");
  if (!whole(bestOf.roundSeconds, 1)) problems.push("bestOf.roundSeconds must be whole seconds, at least 1");
  if (!whole(bestOf.countdownSeconds, 0)) problems.push("bestOf.countdownSeconds must be whole seconds");
  if (bestOf.display !== undefined && bestOf.display !== "icons" && bestOf.display !== "score") problems.push('bestOf.display must be "icons" or "score"');
  const counts = [bestOf.rounds ?? MIN_BEST_OF];
  if (bestOf.option !== undefined) {
    const option = config.options?.find((candidate) => candidate.id === bestOf.option);
    if (!option) problems.push(`bestOf.option "${bestOf.option}" must be one of the game's options`);
    for (const { value } of option?.values ?? []) {
      const rounds = Number(value);
      if (!Number.isInteger(rounds) || rounds < MIN_BEST_OF) problems.push(`bestOf.option "${bestOf.option}": every value must be a round count of at least ${MIN_BEST_OF}`);
      else counts.push(rounds);
    }
  }
  if (bestOf.display === "icons") {
    if (bestOf.firstTo !== undefined || counts.some((rounds) => rounds > MAX_ROUND_ICONS)) problems.push(`bestOf.display "icons" shows up to ${MAX_ROUND_ICONS} rounds`);
    const sides = config.teams ? possibleTeams(config.teams).length : config.maxPlayers;
    if (sides > 2) problems.push('bestOf.display "icons" is for two sides (two teams, or two players)');
  } else if (bestOf.display === "score" && config.teams && possibleTeams(config.teams).length > MAX_SCORE_SIDES) {
    problems.push(`bestOf.display "score" shows up to ${MAX_SCORE_SIDES} teams`);
  }
  if (bestOf.swapSides && (!config.teams || possibleTeams(config.teams).length !== 2)) problems.push("bestOf.swapSides is for two teams");
  return problems;
}

/** Games whose maps this one plays too (map.borrow): other games, named once each. Whether they ask enough of a map is checked once every game is loaded (build.ts). */
function validateBorrow(config: GameConfig): string[] {
  const borrow = config.map?.borrow;
  if (borrow === undefined) return [];
  if (!Array.isArray(borrow) || borrow.some((id) => typeof id !== "string" || !/^[a-z0-9_]+$/.test(id))) return ["map.borrow must be a list of game ids"];
  const problems: string[] = [];
  if (borrow.includes(config.id)) problems.push("map.borrow can't name the game itself: its own maps are its own");
  if (new Set(borrow).size !== borrow.length) problems.push("map.borrow names a game twice");
  return problems;
}

/** Scores shown as "sides" (each team's in its color, in the rounds box): team scores, up to four teams, and not beside best-of rounds. */
function validateScoring(config: GameConfig): string[] {
  const scoring = config.scoring;
  if (scoring?.display !== "sides") return [];
  const problems: string[] = [];
  if (scoring.per !== "team" || !config.teams) problems.push('scoring.display "sides" is for team scores (per: "team")');
  else if (possibleTeams(config.teams).length > MAX_SCORE_SIDES) problems.push(`scoring.display "sides" shows up to ${MAX_SCORE_SIDES} teams`);
  if (config.bestOf) problems.push('scoring.display "sides" shares its box with best-of rounds: use one or the other');
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
