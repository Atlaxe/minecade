// A game's definition, exported from games/<id>/game.config.ts. The build reads it to fill the
// registry and check the game's maps; the game server reads it to run the match. Every field
// beyond the basics is optional, with defaults that suit a free-for-all last-standing game.
import type { DeathMessageConfig } from "./text.ts";

export interface TeamDef {
  id: string;
  name: string;
  /** A § color code, such as "§c" for red. */
  color: string;
  /** Fixed size for role teams (1 seeker), or "rest" for whoever is left (the hiders). */
  size?: number | "rest";
}

export interface TeamsConfig {
  /** An exact number of teams, or a [min, max] range filled as the player count allows. */
  count: number | [min: number, max: number];
  /** Smallest useful team; decides how many teams a range opens. Default 1. */
  minPerTeam?: number;
  /** Let players pick a team before the match; the rest are spread randomly. Default true. */
  pick?: boolean;
  friendlyFire?: boolean;
  /** Team names and colors. Default: Red, Blue, Green, Yellow. */
  defs?: TeamDef[];
}

/** A choice on the lobby's game screen. The game reads the picked value from ctx.vars.settings[id]. */
export interface GameOptionConfig {
  /** Lower camelCase, such as "round". */
  id: string;
  label: string;
  /** The first is the default. */
  values: { value: string; label: string }[];
}

export interface RespawnConfig {
  mode: "none" | "lives" | "unlimited" | "stage";
  lives?: number;
  delaySeconds?: number;
  /** Seconds of spawn protection after a respawn. */
  protectSeconds?: number;
}

export interface CombatConfig {
  /**
   * "none" cancels every hit, knockback included (building and parkour games). For hits that
   * push but don't hurt, keep "normal" and return 0 from onDamage, as Sumo does: a 0-damage hit
   * keeps vanilla knockback and the 10-tick hit cooldown.
   */
  damage?: "normal" | "none";
  fall?: boolean;
  /** What leaving the map bounds (or dropping below killY) does. Default "down". */
  outOfBounds?: "down" | "ignore";
  killCreditSeconds?: number;
}

export interface ScoringConfig {
  per: "player" | "team";
  perKill?: number;
  /** First to reach this wins. */
  target?: number;
  /** Sidebar title. */
  title?: string;
}

export interface KitItem {
  item: string;
  count?: number;
  /** Hotbar or inventory slot; next free slot when omitted. */
  slot?: number;
  name?: string;
}

export interface KitDef {
  id: string;
  name: string;
  /** Icon texture path for the picker button. */
  icon?: string;
  items: KitItem[];
  armor?: Partial<Record<"head" | "chest" | "legs" | "feet" | "offhand", string>>;
  effects?: { id: string; amplifier?: number; seconds?: number }[];
  /** Dye leather armor in the player's team color. */
  teamArmor?: boolean;
}

export interface StatsExtra {
  key: string;
  label: string;
  agg: "sum" | "max";
}

export interface StatsConfig {
  /** How wins are counted: one winner, a winning team, or everyone together. */
  mode: "solo" | "team" | "coop";
  /** Whether kills and deaths are against other players (false for PvE and building games). */
  pvp?: boolean;
  extras?: StatsExtra[];
}

export interface GameConfig {
  /** Must match the game's folder name under games/. */
  id: string;
  name: string;
  description?: string;
  minPlayers: number;
  maxPlayers: number;

  waitForPlayersSeconds?: number;
  countdownSeconds?: number;
  timeLimitSeconds?: number;
  endDelaySeconds?: number;
  /** Players who arrive after the start: sent back, spectating, or joining in. Default "spectate". */
  lateJoin?: "return" | "spectate" | "join";
  teams?: TeamsConfig;
  /** Extra choices for the lobby's game screen (team games already get Teams: Pick or Random). */
  options?: GameOptionConfig[];
  respawn?: RespawnConfig;
  combat?: CombatConfig;
  /** "last" = last player (or team) standing, "coop" = everyone wins or loses together. */
  win?: "last" | "coop" | "custom";
  scoring?: ScoringConfig;
  /** Who wins when time runs out. Default: the highest score, else a draw. */
  timeUp?: "highestScore" | "draw" | { team: string };
  kits?: { pick?: boolean; list: KitDef[] };
  /** Game rules for the match (world.gameRules keys). Restored afterwards. */
  gameRules?: Record<string, boolean | number>;
  /** Map entries this game needs. The build checks every map has them, and the map editor lists them. */
  map?: MapRequirementsConfig;
  /** Recorded to the stats service when set; games without it record nothing. */
  stats?: StatsConfig;
  /** Kill-feed wording: extra "was <verb> by" verbs (Paintball: "painted"), or lines of its own. */
  deathMessages?: DeathMessageConfig;
}

/** Identity helper that type-checks a game.config.ts default export. */
export function defineGame<C extends GameConfig>(config: C): C {
  return config;
}

/** A named point or region a map needs. */
export interface MapEntryRequirement {
  /** Shown in the map editor's checklist. Default: the name. */
  label?: string;
  /** How many entries. Default 1. */
  count?: number;
  /** One per team ("<name>.<team>" keys), for every team the game can have. */
  perTeam?: boolean;
}

/**
 * The map entries a game (or the lobby) needs. The short forms still work: `points` and `regions`
 * as lists of names, `teamSpawns: true`.
 */
export interface MapRequirementsConfig {
  /** Spawns needed: a number, or "maxPlayers" (the default for games; the lobby needs 1). */
  spawns?: { min?: number | "maxPlayers" };
  /** Spawns per team: true for at least 1 each, or how many each team needs. */
  teamSpawns?: boolean | { perTeam?: number };
  spectatorSpawn?: boolean;
  killY?: boolean;
  bounds?: boolean;
  points?: string[] | Record<string, MapEntryRequirement>;
  regions?: string[] | Record<string, MapEntryRequirement>;
}

/** The lobby's definition, exported from lobby/lobby.config.ts: what its maps need. */
export interface LobbyConfig {
  map?: MapRequirementsConfig;
}

/** Identity helper that type-checks lobby/lobby.config.ts's default export. */
export function defineLobby<C extends LobbyConfig>(config: C): C {
  return config;
}
