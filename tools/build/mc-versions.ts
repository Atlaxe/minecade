// Script module versions for pack manifests, pinned to the BDS release in docker/bds/Dockerfile
// (BDS_VERSION). Updating BDS means updating this table, the matching @minecraft/* npm
// devDependencies (a test keeps the two in step), and BDS_VERSION.

export const MODULE_VERSIONS: Record<string, string> = {
  "@minecraft/server": "2.11.0",
  "@minecraft/server-ui": "2.3.0",
  "@minecraft/server-admin": "1.0.0-beta",
  "@minecraft/server-net": "1.0.0-beta",
};

export const MIN_ENGINE_VERSION = [1, 26, 60];

export interface Manifest {
  header: { uuid: string; version?: number[]; min_engine_version?: number[] };
  modules: { type: string; uuid: string; version?: number[]; entry?: string }[];
  dependencies?: { module_name?: string; uuid?: string; version: unknown }[];
}

/**
 * Returns a copy of a pack manifest with pinned module versions and engine version. Throws for
 * a @minecraft module the table doesn't know, so a typo can't ship.
 */
export function pinManifest<M extends Manifest>(manifest: M): M {
  const pinned = structuredClone(manifest);
  pinned.header.min_engine_version = [...MIN_ENGINE_VERSION];
  for (const dependency of pinned.dependencies ?? []) {
    if (!dependency.module_name) continue;
    const version = MODULE_VERSIONS[dependency.module_name];
    if (!version) throw new Error(`unknown script module "${dependency.module_name}" (add it to tools/build/mc-versions.ts)`);
    dependency.version = version;
  }
  return pinned;
}
