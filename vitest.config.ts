import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The real @minecraft/* modules exist only inside BDS. Tests run against fakes.
const fake = (file: string) => fileURLToPath(new URL(`./packages/minigame-core/test/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@minecraft\/server$/, replacement: fake("fake-mc-server.ts") },
      { find: /^@minecraft\/server-net$/, replacement: fake("fake-mc-server-net.ts") },
      { find: /^@minecraft\/server-ui$/, replacement: fake("fake-mc-server-ui.ts") },
      { find: /^@minecraft\/server-admin$/, replacement: fake("fake-mc-server-admin.ts") },
      // Pack bundles pick a transport at build time; tests use the log one, which only needs the fakes.
      {
        find: /^#transport$/,
        replacement: fileURLToPath(new URL("./packages/minigame-core/src/transport/log-stdin.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "orchestrator/test/**/*.test.ts",
      "tools/**/test/**/*.test.ts",
      "lobby/test/**/*.test.ts",
      "editor/test/**/*.test.ts",
      "games/*/test/**/*.test.ts",
    ],
  },
});
