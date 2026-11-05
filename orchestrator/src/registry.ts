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

/**
 * The game and map a start asks for. `published` says which of the registry's maps have a world to
 * run (the published maps' index.json; every map when it's not given): "random" picks among those,
 * and a map without one is refused.
 */
export function resolveGameMap(registry: Registry, gameId: string, mapId: string, random = Math.random, published?: (map: string) => boolean): Resolved {
  const game = registry.games.find((candidate) => candidate.id === gameId);
  if (!game) return { ok: false, reason: `unknown game "${gameId}"` };
  const runnable = published ? game.maps.filter((map) => published(map.id)) : game.maps;
  if (mapId === "random") {
    if (runnable.length === 0) return { ok: false, reason: `none of ${game.name}'s maps is in the published maps; restart the network` };
    return { ok: true, game, map: runnable[Math.floor(random() * runnable.length)] };
  }
  const map = game.maps.find((candidate) => candidate.id === mapId);
  if (!map) return { ok: false, reason: `game "${gameId}" has no map "${mapId}"` };
  if (!runnable.includes(map)) return { ok: false, reason: `${game.name}'s ${map.name} isn't in the published maps; restart the network` };
  return { ok: true, game, map };
}
