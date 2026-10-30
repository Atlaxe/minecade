// Plain definitions with no Minecraft imports, safe to load under Node: game.config.ts files
// (which the build runs) and the orchestrator import from "@minecade/minigame-core/config".
export {
  defineGame,
  defineLobby,
  type CombatConfig,
  type GameConfig,
  type GameOptionConfig,
  type KitDef,
  type KitItem,
  type LobbyConfig,
  type MapEntryRequirement,
  type MapRequirementsConfig,
  type RespawnConfig,
  type ScoringConfig,
  type StatsConfig,
  type StatsExtra,
  type TeamDef,
  type TeamsConfig,
} from "./config.ts";
export {
  EDITOR_ONLY_KEYS,
  KILL_REGION,
  MAP_TIMES,
  facingOf,
  mapTimeTicks,
  positionXyz,
  runtimeMapConfig,
  teamKey,
  type Box,
  type Facing,
  type MapCamera,
  type MapConfig,
  type MapPosition,
  type MapSource,
  type MapTime,
  type Vec3,
} from "./map-config.ts";
export { MapEditError, applyEdit, describeEdit, isMapKey, listKey, listOf, type MapEdit, type MapList } from "./map-edit.ts";
export { mapChecklist, type Checklist, type ChecklistRow } from "./map-checklist.ts";
export { formatMapConfig } from "./map-format.ts";
export { mapRequirements, type MapField, type MapRequirement, type RequirementOptions } from "./map-requirements.ts";
export { mapWarnings, validateMapConfig, type MapRules } from "./map-validate.ts";
export {
  ConfigAssembler,
  EDIT_LOG_MARKER,
  EDIT_SCRIPT_EVENT_ID,
  extractEditPayload,
  mapHash,
  parseEditorEvent,
  parseHostMessage,
  splitConfig,
  type EditorEvent,
  type EditorInfo,
  type EditorRules,
  type HostMessage,
} from "./editor-protocol.ts";
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
  type RegistryLobby,
  type RegistryMap,
  type SkinRender,
} from "./registry.ts";
export { killDeathRatio, winRate } from "./stats-math.ts";
export { DEFAULT_TEAMS, activeTeams, assignTeams, possibleTeams } from "./game/teams.ts";
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
