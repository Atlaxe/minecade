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
  /** Let players pick a team in the lobby before the match; the rest are spread randomly. Default true. */
  pick?: boolean;
  friendlyFire?: boolean;
  /** Team names and colors. Default: Red, Blue, Green, Yellow. */
  defs?: TeamDef[];
  /**
   * A lobby option (one of `options`) whose value is the most teams a match has, such as
   * Paintball's "Team count" (2, 3 or 4). A range still opens no more teams than the players fill.
   */
  option?: string;
}

/** A choice on the lobby's game screen. The game reads the picked value from ctx.vars.settings[id]. */
export interface GameOptionConfig {
  /** Lower camelCase, such as "round". */
  id: string;
  label: string;
  /** The first is the default. */
  values: { value: string; label: string }[];
}

/**
 * A Waypoints setting for a game's `options`: On shows the other players on the locator bar (the
 * dots over the hotbar), Off (the default, as in every game without it) shows nobody there.
 */
export const WAYPOINTS_OPTION: GameOptionConfig = {
  id: "waypoints",
  label: "Waypoints",
  values: [
    { value: "off", label: "Off" },
    { value: "on", label: "On" },
  ],
};

/** The playerWaypoints game rule a game server starts with, from the game screen's settings. */
export function playerWaypoints(settings: Record<string, string>): "everyone" | "off" {
  return settings[WAYPOINTS_OPTION.id] === "on" ? "everyone" : "off";
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
  /**
   * Who sees which scores: "sidebar" (the default) lists everyone's; "own" shows each player only
   * theirs (their team's in team games), top right in a box with a skull, left of the clock;
   * "sides" shows every team's score in its color, "R | B | Y | G", in the box best-of rounds use
   * (team scores, up to four teams, in games without best-of rounds).
   */
  display?: "sidebar" | "own" | "sides";
}

export interface KitItem {
  /**
   * The item id. "{color}" stands for the player's team color as a dye name, for blocks in the
   * team's color: "minecraft:{color}_wool" is red_wool on Red, white_wool without a team.
   */
  item: string;
  count?: number;
  /** Hotbar or inventory slot; next free slot when omitted. */
  slot?: number;
  /** The item's name in the hotbar (a feather named "Leap"); the kit form shows it too. */
  name?: string;
}

/**
 * When a kit's items come back: "life" on every spawn (the default); "round" at the start of the
 * match and of every best-of round, with what's left kept through a respawn; "match" once, with
 * what's left kept through every respawn and round.
 */
export type KitRefill = "life" | "round" | "match";

/**
 * An enchantment on a kit's item or armor: the item id as the kit writes it, the enchantment and its
 * level, such as `{ item: "minecraft:trident", enchantment: "minecraft:loyalty", level: 3 }`.
 */
export interface KitEnchantment {
  item: string;
  enchantment: string;
  level: number;
}

export interface KitDef {
  id: string;
  name: string;
  /** Icon texture path, for the button of a classic form. */
  icon?: string;
  items: KitItem[];
  armor?: Partial<Record<"head" | "chest" | "legs" | "feet" | "offhand", string>>;
  effects?: { id: string; amplifier?: number; seconds?: number }[];
  /**
   * Leather armor in the player's team color: the shared armor pack's piece in the team's dye
   * (minecade:red_leather_helmet) in place of vanilla leather, which scripts can't dye.
   */
  teamArmor?: boolean;
  /** Enchantments on the kit's items and armor. */
  enchantments?: KitEnchantment[];
  refill?: KitRefill;
}

/**
 * When players pick their kit, in a live form that stays open until everyone has picked: "match",
 * once before the match starts; "round", before every best-of round (round 1's pick is the
 * match's). Kit changes in the middle of a round are still to come.
 */
export type KitSelect = "match" | "round";

export interface KitsConfig {
  /** What everyone gets on top of the kit they pick (Bridges: the sword, bow, wool and arrow). */
  base?: KitDef;
  /** The kits. Without `select`, everyone gets the first. */
  list: KitDef[];
  select?: KitSelect;
  /** Seconds to pick, after which whoever hasn't gets the first kit. Default 30. */
  pickSeconds?: number;
  /**
   * false: the kits are the same on every map (Siege's classes). A map's own `kits` are refused by
   * the build and the map editor's checklist, and never used. Default true.
   */
  mapKits?: boolean;
}

/**
 * A map's own kits (map.json "kits"): added after the game's ("append", the default), or in place of
 * them ("replace"). A `base` replaces the game's base in either mode.
 */
export interface MapKitsConfig {
  mode?: "append" | "replace";
  base?: KitDef;
  list?: KitDef[];
}

/**
 * Best-of rounds: the match is a series of rounds, each won by one player or team, and the first to
 * win more than half of them takes it. (Turn-based rounds, where sides take turns, are a separate
 * system still to come.) The rounds show top right, in the HUD.
 */
export interface BestOfConfig {
  /** Best of this many rounds, at least 3: the first side to win more than half takes the match. */
  rounds?: number;
  /** Instead of `rounds`: the first side to this many round wins, however many rounds it takes. */
  firstTo?: number;
  /**
   * How the HUD shows them: "icons", a circle per round, white until someone wins it, then in the
   * winner's color, left to right (two sides, best of up to 7); "score", each side's round wins in
   * its color, "R | B" (up to 4 sides). Default: icons when they fit, else the score.
   */
  display?: "icons" | "score";
  /** The frozen countdown before every round after the first, in seconds. Default 3. */
  countdownSeconds?: number;
  /** Each round's time limit in seconds; onRoundTimeUp decides it (a drawn round by default). None by default. */
  roundSeconds?: number;
  /** A lobby option (one of `options`) whose value replaces `rounds`, such as Bridges' "Best of". */
  option?: string;
  /**
   * Two teams take each other's team spawns every other round (Gunfight): round 1 at their own,
   * round 2 at the other team's, and so on. Only the spawns swap.
   */
  swapSides?: boolean;
}

/**
 * Games where players build (Bridges): they play in survival mode and place blocks inside the
 * bounds, and break only the blocks placed during the match (nothing drops).
 */
export interface BuildConfig {
  /**
   * Regions (map.json "regions") where nobody can place a block. A name counts its per-team lists
   * too: "spawnGuard" covers "spawnGuard.red" and "spawnGuard.blue".
   */
  noBuild?: string[];
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
  /** A test game (Probe): the lobby lists it only while DEV_TEST_GAMES is 1. The map editor always does. */
  test?: boolean;

  waitForPlayersSeconds?: number;
  /** The frozen countdown at the spawns before the match, in seconds; 0 for none. Default 5. */
  countdownSeconds?: number;
  timeLimitSeconds?: number;
  endDelaySeconds?: number;
  /** Players who arrive after the start: sent back, spectating, or joining in. Default "spectate". */
  lateJoin?: "return" | "spectate" | "join";
  /**
   * Gamertags over players during the match. Default false: hidden from the start until the end.
   * They always show while players wait at the queue spawn (free) or their spawns.
   */
  nameTags?: boolean;
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
  kits?: KitsConfig;
  /** A match of best-of rounds instead of one long stage (see BestOfConfig). */
  bestOf?: BestOfConfig;
  build?: BuildConfig;
  /**
   * The shared blocks pack this game's servers load: the network's cut of it, only the blocks the
   * published maps use (the default), or "full", every block, for a game whose players build from
   * creative's menu (Build Swap). Only its players load the bigger pack.
   */
  blocks?: "full";
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

/**
 * How the map editor draws a list's entries: "player", a mannequin (the default for spawns);
 * "post", a thin post with a square head (the default for points, such as the lobby's terminal);
 * or `{ model }`, the game's own model: `markers/<model>.geo.json` and `markers/<model>.png` in the
 * game's folder (the lobby's: `lobby/markers/`).
 */
export type MarkerStyle = "player" | "post" | { model: string };

/** A named point or region a map needs. */
export interface MapEntryRequirement {
  /** Shown in the map editor's checklist. Default: the name. */
  label?: string;
  /** How many entries. Default 1. */
  count?: number;
  /** One per team ("<name>.<team>" keys), for every team the game can have. */
  perTeam?: boolean;
  /** Points only: how the map editor draws them. Default "post". */
  marker?: MarkerStyle;
  /** Regions only: the fewest blocks each box spans along every side (Build Swap's 24 for 24x24x24 building boundaries). */
  minSize?: number;
}

/**
 * The map entries a game (or the lobby) needs. The short forms still work: `points` and `regions`
 * as lists of names, `teamSpawns: true`.
 */
export interface MapRequirementsConfig {
  /**
   * Spawns needed: a number, or "maxPlayers" (the default for games; the lobby needs 1). false: the
   * game uses no plain spawns, only team spawns (and the spectator and queue spawns). A game that
   * asks for team spawns and doesn't name this has them off; naming it turns them back on.
   */
  spawns?: false | { min?: number | "maxPlayers"; marker?: MarkerStyle };
  /** Spawns per team: true for at least 1 each, or how many each team needs. */
  teamSpawns?: boolean | { perTeam?: number; marker?: MarkerStyle };
  /**
   * Where players watch from (map.json "spectatorSpawn"). A game that names neither this nor
   * queueSpawn needs one or the other: without a spectator spawn, players watch from the queue
   * spawn. Naming either one asks for exactly what's named (both, for a game that needs both).
   */
  spectatorSpawn?: boolean | { marker?: MarkerStyle };
  /** Where players wait for everyone to join before they're put at their spawns (map.json "queueSpawn"). */
  queueSpawn?: boolean | { marker?: MarkerStyle };
  killY?: boolean;
  /** Heights nobody builds past (map.json "buildLimit"): true for both sides, or the sides needed. Set with the Kill Y tool. */
  buildLimit?: boolean | { above?: boolean; below?: boolean };
  bounds?: boolean;
  points?: string[] | Record<string, MapEntryRequirement>;
  regions?: string[] | Record<string, MapEntryRequirement>;
  /**
   * Settings the game reads from each map (map.json keys of its own), by key: Build Swap's
   * buildPadding. The map editor's Game settings tool sets them; a map without one has its default.
   */
  settings?: Record<string, MapSettingConfig>;
  /**
   * Other games whose published maps this game plays too, as they are (Gunfight plays Siege's): the
   * build lists them with the game's own, and each stays that game's map, made and published there.
   * Their games must ask at least what this game asks of a map (checked at build).
   */
  borrow?: string[];
}

/** A whole number a game reads from each of its maps (minigame.mapSetting), set in the map editor. */
export interface MapSettingConfig {
  /** Its name in the map editor: "Build padding". */
  label: string;
  /** What it changes, under its name in the map editor's Game settings tool. */
  hint?: string;
  /** What a map that doesn't set it gets. */
  default: number;
  min: number;
  max: number;
  /** What the number counts, after it: "blocks". */
  unit?: string;
}

/** The lobby's definition, exported from lobby/lobby.config.ts: what its maps need. */
export interface LobbyConfig {
  map?: MapRequirementsConfig;
}

/** Identity helper that type-checks lobby/lobby.config.ts's default export. */
export function defineLobby<C extends LobbyConfig>(config: C): C {
  return config;
}
