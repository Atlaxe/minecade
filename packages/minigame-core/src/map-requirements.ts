// What a game's (or the lobby's) maps need, from the `map` block of its config, as one flat list:
// the build checks every map against it, and the map editor shows it as a checklist.
import type { MapAdjustable, MapEntryRequirement, MapRequirementsConfig, MapSettingConfig, MarkerStyle } from "./config.ts";
import { BUILD_LIMIT_SIDES, teamKey, type Box, type BuildLimitSide, type MapConfig, type Vec3 } from "./map-config.ts";

/** "spectatorOrQueue": a spectator spawn or a queue spawn, either one (games that name neither). */
export type MapField = "spawns" | "spectatorSpawn" | "queueSpawn" | "spectatorOrQueue" | "bounds" | "killY" | "buildLimit" | "points" | "regions" | "teamSpawns" | "spaces";

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
  /** Regions only: the most blocks each box spans along any side; bigger boxes don't count. */
  maxSize?: number;
  /** Spawns and regions: the region every entry must be inside a box of. */
  inside?: string;
  /** Regions only: exactly this many blocks across, x by z either way round. */
  footprint?: [number, number];
  /**
   * When the game lets each map change the row (map.adjustable): the fewest entries one of its maps
   * can be left with, 0 when the row can be turned off. Rows that can't change have none: min.
   */
  floor?: number;
}

/** How many blocks a box spans along each side (its corners are whole blocks, both inside). */
export function boxSize(box: Box): Vec3 {
  return [0, 1, 2].map((axis) => box.max[axis] - box.min[axis] + 1) as Vec3;
}

/** Whether a box is big enough for a requirement's `minSize` (any box is without one). */
export function bigEnough(box: Box, minSize: number | undefined): boolean {
  return minSize === undefined || boxSize(box).every((side) => side >= minSize);
}

/** Whether a box is small enough for a requirement's `maxSize` (any box is without one). */
export function smallEnough(box: Box, maxSize: number | undefined): boolean {
  return maxSize === undefined || boxSize(box).every((side) => side <= maxSize);
}

/** Whether a box is exactly a footprint across (x by z, either way round), or any box without one. */
export function fitsFootprint(box: Box, footprint: readonly [number, number] | undefined): boolean {
  if (!footprint) return true;
  const [x, , z] = boxSize(box);
  return (x === footprint[0] && z === footprint[1]) || (x === footprint[1] && z === footprint[0]);
}

/** Whether a box fits a region requirement's sizes: big enough, small enough, and its footprint. */
export function fitsSize(box: Box, requirement: { minSize?: number; maxSize?: number; footprint?: readonly [number, number] }): boolean {
  return bigEnough(box, requirement.minSize) && smallEnough(box, requirement.maxSize) && fitsFootprint(box, requirement.footprint);
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
  /**
   * The map's own requirement options (map.json "requirements"): a row the game lets a map turn off
   * goes, and a count set within the game's range replaces the game's own. Choices the game doesn't
   * allow are left out (validateMapConfig names them). Without it, every row the game names (what
   * the editors' lists offer).
   */
  choices?: unknown;
}

/** The requirements in checklist order: spawns, spectator or queue spawn, spectator spawn, queue spawn, bounds, killY, the build limit, points, regions, team spawns. */
export function mapRequirements(map: MapRequirementsConfig | undefined, options: RequirementOptions): MapRequirement[] {
  const list: MapRequirement[] = [];
  const teams = options.teams ?? [];
  const asked = map?.spawns ? map.spawns.min : undefined;
  const spawnsInside = map?.spawns && map.spawns.inside !== undefined ? { inside: map.spawns.inside } : {};
  if (options.kind === "lobby") {
    list.push({ key: "spawns", label: "Spawn", field: "spawns", min: typeof asked === "number" ? asked : 1 });
  } else if (!usesPlainSpawns(map, options.kind)) {
    // Team spawns only.
  } else if (typeof asked === "number") {
    list.push({ key: "spawns", label: asked === 1 ? "Spawn" : "Spawns", field: "spawns", min: asked, ...spawnsInside });
  } else {
    // Team games spawn players by team, so their plain spawns only need one (for waiting).
    const perPlayer = !map?.teamSpawns;
    list.push({ key: "spawns", label: "Spawns", field: "spawns", min: perPlayer ? (options.maxPlayers ?? 1) : 1, perPlayer, ...spawnsInside });
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
      const size =
        field === "regions"
          ? {
              ...(entry.minSize !== undefined ? { minSize: entry.minSize } : {}),
              ...(entry.maxSize !== undefined ? { maxSize: entry.maxSize } : {}),
              ...(entry.inside !== undefined ? { inside: entry.inside } : {}),
              ...(entry.footprint !== undefined ? { footprint: entry.footprint } : {}),
            }
          : {};
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
  if (map?.board) list.push({ key: "spaces", label: map.board.label ?? "Spaces", field: "spaces", min: map.board.minSpaces });
  const teamSpawns = map?.teamSpawns;
  if (teamSpawns) {
    const perTeam = typeof teamSpawns === "object" ? (teamSpawns.perTeam ?? 1) : 1;
    if (teams.length === 0) list.push({ key: "teamSpawns", label: "Team spawns", field: "teamSpawns", min: 1 });
    for (const team of teams) {
      list.push({ key: `teamSpawns.${team.id}`, label: `${team.name} spawns`, field: "teamSpawns", name: team.id, team: team.id, min: perTeam });
    }
  }
  const adjustable = map?.adjustable;
  const rows = adjustable ? list.map((row) => withFloor(row, adjustable[optionKey(row)])) : list;
  return options.choices === undefined ? rows : applyChoices(rows, adjustable, options.choices);
}

/**
 * The key a row is changed by (map.adjustable in the game's config, "requirements" in map.json):
 * its key without a team, so one choice covers every team's row ("points.hole", "teamSpawns").
 */
export function optionKey(row: MapRequirement): string {
  if (row.field === "teamSpawns") return "teamSpawns";
  if (row.team !== undefined && (row.field === "points" || row.field === "regions")) return row.key.slice(0, -(row.team.length + 1));
  return row.key;
}

/** Whether a row has a count a map can change: points, regions, team spawns, and spawns given as a number. */
export function hasCount(row: MapRequirement): boolean {
  return row.field === "points" || row.field === "regions" || row.field === "teamSpawns" || row.field === "spaces" || (row.field === "spawns" && !row.perPlayer);
}

/** A row a game lets each map change, and how (the Panel's Requirements group lists them). */
export interface RequirementOption {
  /** Its key in map.json "requirements". */
  key: string;
  label: string;
  /** The game's own count, for a row with one (each team's, for a row per team). */
  count?: number;
  /** A map can turn it off. */
  off: boolean;
  /** The counts a map can ask for instead, when it can. */
  range?: { min: number; max: number };
}

/** The rows a game lets each map change (its config's map.adjustable, where they name a row), in checklist order. */
export function requirementOptions(map: MapRequirementsConfig | undefined, options: Omit<RequirementOptions, "choices">): RequirementOption[] {
  return optionsOf(mapRequirements(map, { ...options, choices: undefined }), map?.adjustable);
}

function optionsOf(rows: readonly MapRequirement[], adjustable: Record<string, MapAdjustable> | undefined): RequirementOption[] {
  const found = new Map<string, RequirementOption>();
  for (const row of rows) {
    const key = optionKey(row);
    const adjust = adjustable?.[key];
    if (!adjust || found.has(key)) continue;
    const counted = hasCount(row);
    const ranged = counted && Number.isInteger(adjust.min) && Number.isInteger(adjust.max);
    found.set(key, {
      key,
      label: optionLabel(row),
      ...(counted ? { count: row.min } : {}),
      off: adjust.off === true,
      ...(ranged ? { range: { min: adjust.min!, max: adjust.max! } } : {}),
    });
  }
  return [...found.values()];
}

/** A row's name without its team: "Hole" for "Hole (Red)", "Team spawns" for "Red spawns". */
function optionLabel(row: MapRequirement): string {
  if (row.field === "teamSpawns") return "Team spawns";
  return row.team === undefined ? row.label : row.label.replace(/ \([^()]*\)$/, "");
}

/** Why a map's choice for a row doesn't fit what its game allows, or undefined when it does. */
export function choiceProblem(option: RequirementOption | undefined, key: string, value: unknown, who = "this game"): string | undefined {
  if (!option) return `"requirements.${key}": ${who} doesn't let a map change that`;
  if (value === false) return option.off ? undefined : `"requirements.${key}": ${who} can't do without ${option.label}`;
  if (typeof value !== "number" || !Number.isInteger(value)) return `"requirements.${key}" must be false (off) or a count`;
  if (!option.range) return `"requirements.${key}": ${option.label} has no count to set`;
  return value >= option.range.min && value <= option.range.max ? undefined : `"requirements.${key}" must be a whole number from ${option.range.min} to ${option.range.max}`;
}

/** The problems with a map's "requirements" against what its game allows (none when it has none). */
export function choiceProblems(choices: unknown, map: MapRequirementsConfig | undefined, options: Omit<RequirementOptions, "choices">, who = "this game"): string[] {
  if (choices === undefined) return [];
  if (typeof choices !== "object" || choices === null || Array.isArray(choices)) return ['"requirements" must map checklist rows to false (off) or a count'];
  const allowed = requirementOptions(map, options);
  return Object.entries(choices).flatMap(([key, value]) => {
    const problem = choiceProblem(allowed.find((option) => option.key === key), key, value, who);
    return problem ? [problem] : [];
  });
}

/**
 * What's wrong with a game's map.adjustable (checked at build): a key that names no row, a count
 * range on a row without a count, a range that doesn't hold the game's own count, or nothing to change.
 */
export function adjustableProblems(map: MapRequirementsConfig | undefined, options: Omit<RequirementOptions, "choices">): string[] {
  const problems: string[] = [];
  const rows = mapRequirements(map, { ...options, choices: undefined });
  for (const [key, adjust] of Object.entries(map?.adjustable ?? {})) {
    const where = `map.adjustable.${key}`;
    const row = rows.find((candidate) => optionKey(candidate) === key);
    if (!row) {
      problems.push(`${where}: no row of the game's checklist has that key`);
      continue;
    }
    if (typeof adjust !== "object" || adjust === null) {
      problems.push(`${where} must be { off, min, max }`);
      continue;
    }
    if (adjust.off !== undefined && typeof adjust.off !== "boolean") problems.push(`${where}.off must be true or false`);
    const ranged = adjust.min !== undefined || adjust.max !== undefined;
    if (ranged) {
      const { min, max } = adjust;
      if (!hasCount(row)) problems.push(`${where}: ${row.label} has no count to change, only off`);
      else if (!Number.isInteger(min) || !Number.isInteger(max) || min! < 1 || min! > max!) problems.push(`${where}: min and max must be whole numbers from 1, min no more than max`);
      else if (row.min < min! || row.min > max!) problems.push(`${where}: the game's own count (${row.min}) must be from ${min} to ${max}`);
    }
    if (adjust.off !== true && !ranged) problems.push(`${where}: nothing to change (give off, or min and max)`);
  }
  return problems;
}

/** A row with the fewest entries a map can be left with, when the game lets maps change it. */
function withFloor(row: MapRequirement, adjust: MapAdjustable | undefined): MapRequirement {
  if (!adjust) return row;
  const lowest = adjust.off === true ? 0 : hasCount(row) && Number.isInteger(adjust.min) ? Math.min(adjust.min!, row.min) : row.min;
  return { ...row, floor: lowest };
}

/** The rows after a map's own choices: those it turned off go, and counts it set replace the game's. */
function applyChoices(rows: readonly MapRequirement[], adjustable: Record<string, MapAdjustable> | undefined, choices: unknown): MapRequirement[] {
  if (typeof choices !== "object" || choices === null || Array.isArray(choices)) return [...rows];
  const allowed = optionsOf(rows, adjustable);
  const chosen = choices as Record<string, unknown>;
  return rows.flatMap((row) => {
    const key = optionKey(row);
    const value = chosen[key];
    if (value === undefined || choiceProblem(allowed.find((option) => option.key === key), key, value) !== undefined) return [row];
    if (value === false) return [];
    const { perPlayer: _perPlayer, ...rest } = row;
    return [{ ...rest, min: value as number }];
  });
}

/**
 * What `needs` (a game borrowing another's maps) asks of a map that `has` (the maps' own game)
 * doesn't, so a map passing `has` could still fail `needs`: empty when every map of that game will
 * do. A spectator-or-queue need is met by asking for either spawn.
 */
export function uncoveredRequirements(needs: readonly MapRequirement[], has: readonly MapRequirement[]): MapRequirement[] {
  const byKey = new Map(has.map((requirement) => [requirement.key, requirement]));
  return needs.filter((need) => {
    // A row either game lets maps change counts at its floor: the fewest a map can be left with.
    const needs = need.floor ?? need.min;
    if (need.key === "spectatorOrQueue") return needs > 0 && !["spectatorOrQueue", "spectatorSpawn", "queueSpawn"].some((key) => {
        const own = byKey.get(key);
        return own !== undefined && (own.floor ?? own.min) > 0;
      });
    const own = byKey.get(need.key);
    if (!own) return needs > 0;
    if ((own.floor ?? own.min) < needs) return true;
    if (need.inside !== undefined && own.inside !== need.inside) return true;
    if (need.maxSize !== undefined && (own.maxSize ?? Infinity) > need.maxSize) return true;
    if (need.footprint !== undefined && (own.footprint === undefined || !fitsFootprint({ min: [0, 0, 0], max: [own.footprint[0] - 1, 0, own.footprint[1] - 1] }, need.footprint))) return true;
    return (need.minSize ?? 0) > (own.minSize ?? 0);
  });
}

/** The build limit's sides a config asks for: true is both. */
function buildLimitSides(value: MapRequirementsConfig["buildLimit"]): BuildLimitSide[] {
  if (!value) return [];
  return value === true ? [...BUILD_LIMIT_SIDES] : BUILD_LIMIT_SIDES.filter((side) => value[side]);
}

/** A game's per-map settings (its config's `map.settings`), in config order, each with its map.json key. */
export function mapSettings(map: MapRequirementsConfig | undefined): (MapSettingConfig & { key: string })[] {
  return Object.entries(map?.settings ?? {}).map(([key, setting]) => ({ key, ...setting }));
}

/** Whether `value` is something a setting can be: a whole number from its min to its max. */
export function settingFits(setting: MapSettingConfig, value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= setting.min && value <= setting.max;
}

/** A setting's value on a map: the map's own when it fits, else the default. */
export function mapSettingValue(setting: MapSettingConfig, map: MapConfig, key: string): number {
  const value = map[key];
  return settingFits(setting, value) ? value : setting.default;
}

/** "2 blocks", "1 block", "5". */
export function settingText(setting: MapSettingConfig, value: number): string {
  if (!setting.unit) return String(value);
  return `${value} ${value === 1 && setting.unit.endsWith("s") ? setting.unit.slice(0, -1) : setting.unit}`;
}

function entriesOf(value: string[] | Record<string, MapEntryRequirement> | undefined): [string, MapEntryRequirement][] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((name) => [name, {}]);
  return Object.entries(value);
}
