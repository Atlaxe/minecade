// Plain definitions with no Minecraft imports, safe to load under Node: game.config.ts files
// (which the build runs) and the orchestrator import from "@minecade/minigame-core/config".
export { defineGame, type GameConfig } from "./config.ts";
export type { Box, MapConfig, Vec3 } from "./map-config.ts";
export type { Registry, RegistryGame, RegistryMap } from "./registry.ts";
