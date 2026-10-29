// esbuild plugin that resolves "#transport" to one transport implementation. The build bundles
// every pack once per transport (main.http.js, main.log.js) and the container entrypoint loads
// the one matching TRANSPORT, so a log-transport server never imports @minecraft/server-net.
import { fileURLToPath } from "node:url";
import type { Plugin } from "esbuild";
import type { TransportKind } from "@minecade/minigame-core/protocol";

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
