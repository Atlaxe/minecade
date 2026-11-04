// esbuild plugin that resolves "#transport" to one transport implementation. The build bundles
// every pack once per transport (main.http.js, main.log.js) and the container entrypoint loads
// the one matching TRANSPORT, so a log-transport server never imports @minecraft/server-net.
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
