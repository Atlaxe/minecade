// Where the map store is: MAP_STORE (from the environment, else .env), or else maps\ beside the
// checkout, ..\maps from the repo root. That is the same folder from the main checkout and from
// every network-<topic> worktree beside it, so all of them see the same maps.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv } from "../control-panel/core.ts";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function storeDir(root = repoRoot): string {
  const fromEnv = process.env.MAP_STORE || envValue(root, "MAP_STORE");
  return fromEnv ? resolve(root, fromEnv) : resolve(root, "..", "maps");
}

/** The published maps, as the store's export writes them: catalog\ and worlds\ (store.ts exportPublished). */
export function publishedDir(root = repoRoot): string {
  return join(storeDir(root), "published");
}

/**
 * What the network's build reads of the published maps (their cards and pictures): MAPS_CATALOG
 * (the Docker build sets it), else the store's published\catalog\.
 */
export function catalogDir(root = repoRoot): string {
  return process.env.MAPS_CATALOG ? resolve(process.env.MAPS_CATALOG) : join(publishedDir(root), "catalog");
}

/** Where a target's maps are worked on: working\lobby\, or working\<game>\. */
export function workingDir(target: string, store = storeDir()): string {
  return join(store, "working", target);
}

function envValue(root: string, key: string): string | undefined {
  const path = join(root, ".env");
  if (!existsSync(path)) return undefined;
  try {
    return readEnv(readFileSync(path, "utf8"))[key] || undefined;
  } catch {
    return undefined;
  }
}
