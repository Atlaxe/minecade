// Resource packs are versioned by their content. Clients cache server packs by UUID and version,
// so a pack whose files changed must get a new version, or players keep using their old copy.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Manifest } from "./mc-versions.ts";

/**
 * A hash of every file under `dir` except manifest.json, as a version number from 0 to 32767.
 * BDS keeps version parts small: a pack versioned 1.0.1551049 was "not found" (logged as 1.0.0).
 */
export async function contentHash(dir: string): Promise<number> {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .filter((path) => path !== "manifest.json")
    .sort();
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(`${path}\0`);
    hash.update(await readFile(join(dir, path)));
    hash.update("\0");
  }
  return parseInt(hash.digest("hex").slice(0, 4), 16) & 0x7fff;
}

/** The manifest with the header and every module at [major, minor, patch], keeping major and minor. */
export function withPatchVersion<M extends Manifest>(manifest: M, patch: number): M {
  const stamped = structuredClone(manifest);
  const [major = 1, minor = 0] = stamped.header.version ?? [];
  stamped.header.version = [major, minor, patch];
  for (const module of stamped.modules) module.version = [major, minor, patch];
  return stamped;
}
