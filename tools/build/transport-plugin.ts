// esbuild plugin that resolves "#transport" to one transport implementation. The build bundles
// every pack once per transport (main.http.js, main.log.js) and the container entrypoint loads
// the one matching TRANSPORT, so a log-transport server never imports @minecraft/server-net.
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "esbuild";
import type { PlayerSkin, Registry } from "@minecade/minigame-core/config";
import type { TransportKind } from "@minecade/minigame-core/protocol";
import { readModBlockShapes } from "./mod-blocks.ts";

const transportDir = fileURLToPath(new URL("../../packages/minigame-core/src/transport/", import.meta.url));

const IMPLEMENTATIONS: Record<TransportKind, string> = {
  http: `${transportDir}http.ts`,
  log: `${transportDir}log-stdin.ts`,
};

export function transportPlugin(kind: TransportKind): Plugin {
  return {
    name: "minecade-transport",
    setup(build) {
      build.onResolve({ filter: /^#transport$/ }, () => ({ path: IMPLEMENTATIONS[kind] }));
    },
  };
}

/**
 * Resolves "#registry" to the game registry of this build, inlined as JSON. Packs that import
 * it (the lobby) get the same list the orchestrator loads from registry.json.
 */
export function registryPlugin(registry: Registry): Plugin {
  return {
    name: "minecade-registry",
    setup(build) {
      build.onResolve({ filter: /^#registry$/ }, () => ({ path: "registry", namespace: "minecade-registry" }));
      build.onLoad({ filter: /.*/, namespace: "minecade-registry" }, () => ({ contents: JSON.stringify(registry), loader: "json" }));
    },
  };
}

/**
 * Resolves "#mod-blocks" to the shapes of the shared blocks pack's repaintable blocks
 * ({ "minecade:andesite_bricks_stairs": "stairs", ... }, mod-blocks.ts), inlined as JSON.
 */
export function modBlocksPlugin(): Plugin {
  return {
    name: "minecade-mod-blocks",
    setup(build) {
      build.onResolve({ filter: /^#mod-blocks$/ }, () => ({ path: "mod-blocks", namespace: "minecade-mod-blocks" }));
      build.onLoad({ filter: /.*/, namespace: "minecade-mod-blocks" }, async () => ({ contents: JSON.stringify(await readModBlockShapes()), loader: "json" }));
    },
  };
}

/** The folder beside a JSON data file whose copy of it, when there is one, a build uses instead (privateDataPlugin). */
export const PRIVATE_DATA = "private_data";

/**
 * A JSON file a pack's scripts import ("../../dialogue.json") is taken from a private_data folder
 * beside it when that holds a file of the same name: git-ignored, and kept up to date by a workshop
 * tool on every save (Block Party's dialogue editor writes dialogue.json and sounds.json there), so a
 * build, and a Restart, has what was saved without a commit. The committed file stays what tests and
 * GitHub see. `used` hears each file taken from there, once.
 */
export function privateDataPlugin(used: (path: string) => void = () => undefined): Plugin {
  const told = new Set<string>();
  return {
    name: "minecade-private-data",
    setup(build) {
      build.onResolve({ filter: /\.json$/ }, (args) => {
        if (args.kind !== "import-statement" || !args.path.startsWith(".")) return undefined;
        const file = resolve(args.resolveDir, args.path);
        const own = join(dirname(file), PRIVATE_DATA, basename(file));
        if (!existsSync(own)) return undefined;
        if (!told.has(own)) {
          told.add(own);
          used(own);
        }
        return { path: own };
      });
    },
  };
}

/** Resolves "#skins" to the players whose skin renders this build put in the lobby pack, inlined as JSON. */
export function skinsPlugin(skins: PlayerSkin[]): Plugin {
  return {
    name: "minecade-skins",
    setup(build) {
      build.onResolve({ filter: /^#skins$/ }, () => ({ path: "skins", namespace: "minecade-skins" }));
      build.onLoad({ filter: /.*/, namespace: "minecade-skins" }, () => ({ contents: JSON.stringify(skins), loader: "json" }));
    },
  };
}
