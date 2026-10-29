// Plain definitions with no Minecraft imports, safe to load under Node: game.config.ts files
// (which the build runs) and the orchestrator import from "@minecade/minigame-core/config".
export {
  defineGame,
  type CombatConfig,
  type GameConfig,
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
export type { Registry, RegistryGame, RegistryMap } from "./registry.ts";
