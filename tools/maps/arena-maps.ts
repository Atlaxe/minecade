// A game's published arena maps (minigame-core's arena-map.ts) copied out of the map store's
// published\worlds\ for a server that can't mount it: a map editor's Preview of a game with arenas
// (preview-template.ts). The copy is laid out as /maps is (index.json, then <target>\<map>\<version>\
// with map.json and structure.mcstructure; no worlds), so the entrypoint reads it the same way.
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorldsIndex } from "./store.ts";
import { STRUCTURE_FILE } from "./store.ts";

/**
 * Copies the published maps of `targets` (the editor entries a game's arenas are under) from
 * `worlds` (published\worlds\) into `out`, with an index.json naming them. Returns how many maps it
 * copied; a map whose structure is missing is left out, as the entrypoint would.
 */
export async function copyArenaMaps(worlds: string, out: string, targets: readonly string[]): Promise<number> {
  const indexPath = join(worlds, "index.json");
  const index: WorldsIndex = existsSync(indexPath) ? (JSON.parse(readFileSync(indexPath, "utf8")) as WorldsIndex) : {};
  const copied: WorldsIndex = {};
  let count = 0;
  for (const target of targets) {
    for (const [map, version] of Object.entries(index[target] ?? {})) {
      const from = join(worlds, target, map, String(version));
      if (!existsSync(join(from, STRUCTURE_FILE)) || !existsSync(join(from, "map.json"))) continue;
      const to = join(out, target, map, String(version));
      await mkdir(to, { recursive: true });
      await copyFile(join(from, "map.json"), join(to, "map.json"));
      await copyFile(join(from, STRUCTURE_FILE), join(to, STRUCTURE_FILE));
      (copied[target] ??= {})[map] = version;
      count++;
    }
  }
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "index.json"), JSON.stringify(copied, null, 2));
  return count;
}
