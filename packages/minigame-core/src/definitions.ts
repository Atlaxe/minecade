// Plain definitions with no Minecraft imports, safe to load under Node: game.config.ts files
// (which the build runs) and the orchestrator import from "@minecade/minigame-core/config".
export {
  defineGame,
  type CombatConfig,
  type GameConfig,
  type GameOptionConfig,
  type KitDef,
  type KitItem,
  type RespawnConfig,
  type ScoringConfig,
  type StatsConfig,
  type StatsExtra,
  type TeamDef,
  type TeamsConfig,
} from "./config.ts";
export type { Box, MapConfig, Vec3 } from "./map-config.ts";
export {
  BADGE_CHARACTERS,
  PLACEHOLDER_PICTURES,
  badgeFor,
  holoPictures,
  holoPortraits,
  skinTexture,
  type PlayerSkin,
  type Registry,
  type RegistryGame,
  type RegistryMap,
  type SkinRender,
} from "./registry.ts";
export { killDeathRatio, winRate } from "./stats-math.ts";
export { DEFAULT_TEAMS, activeTeams, assignTeams } from "./game/teams.ts";
export {
  COLOR,
  KILL_VERBS,
  NO_KILLER_LINES,
  deathMessage,
  nameOf,
  ordinal,
  say,
  stripColors,
  type Death,
  type DeathMessageConfig,
} from "./text.ts";
