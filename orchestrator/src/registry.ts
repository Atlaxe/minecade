// The game registry: every game and map the build produced (dist/registry.json, baked into the
// orchestrator image). start_game names a map id or "random", so a future map vote only has to
// supply an id.
import { readFileSync } from "node:fs";
import type { Registry, RegistryGame, RegistryMap } from "@minecade/minigame-core/config";

export type { Registry, RegistryGame, RegistryMap };

export function loadRegistry(path: string): Registry {
  const registry = JSON.parse(readFileSync(path, "utf8")) as Registry;
  if (!Array.isArray(registry.games)) throw new Error(`${path}: "games" must be an array`);
  for (const game of registry.games) {
    if (!game.id || !Array.isArray(game.maps) || game.maps.length === 0) {
      throw new Error(`${path}: game "${game.id}" needs an id and at least one map`);
    }
  }
  return registry;
}

export type Resolved = { ok: true; game: RegistryGame; map: RegistryMap } | { ok: false; reason: string };

export function resolveGameMap(registry: Registry, gameId: string, mapId: string, random = Math.random): Resolved {
  const game = registry.games.find((candidate) => candidate.id === gameId);
  if (!game) return { ok: false, reason: `unknown game "${gameId}"` };
  if (mapId === "random") return { ok: true, game, map: game.maps[Math.floor(random() * game.maps.length)] };
  const map = game.maps.find((candidate) => candidate.id === mapId);
  if (!map) return { ok: false, reason: `game "${gameId}" has no map "${mapId}"` };
  return { ok: true, game, map };
}
