// Respawning away from everyone else, for free-for-all games with unlimited respawns (One in the
// Quiver, Gun Game): a random one of the spawns farthest from the players still in play, so a
// respawn is never on top of someone and can't be predicted. Pure: the game passes where everyone is.
import type { Vector3 } from "@minecraft/server";
import { worldPoint, type MapPosition } from "../map-config.ts";

/** The share of spawns, safest first, that a respawn picks from at random (at least one). */
const SAFE_SHARE = 0.3;

/**
 * A spawn away from the enemies: one of the safest few (the top 30%, at least one), at random so
 * respawns can't be predicted. With nobody else alive, any spawn. Undefined when there are none.
 */
export function pickSpawn(spawns: MapPosition[], enemies: Vector3[], random: () => number): MapPosition | undefined {
  if (spawns.length === 0) return undefined;
  const ranked = rankSpawns(spawns, enemies);
  const pool = enemies.length === 0 ? ranked : ranked.slice(0, Math.max(1, Math.round(ranked.length * SAFE_SHARE)));
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** Spawns from the one farthest from its nearest enemy to the closest (map order breaks ties). */
export function rankSpawns(spawns: MapPosition[], enemies: Vector3[]): MapPosition[] {
  const scored = spawns.map((spawn, index) => {
    const at = worldPoint(spawn);
    const nearest = Math.min(...enemies.map((enemy) => Math.hypot(enemy.x - at.x, enemy.y - at.y, enemy.z - at.z)));
    return { spawn, index, nearest };
  });
  return scored.sort((a, b) => b.nearest - a.nearest || a.index - b.index).map((entry) => entry.spawn);
}
