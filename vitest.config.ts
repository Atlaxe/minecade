import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The real @minecraft/* modules exist only inside BDS. Tests run against fakes.
const fake = (file: string) => fileURLToPath(new URL(`./packages/minigame-core/test/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@minecraft\/server$/, replacement: fake("fake-mc-server.ts") },
      { find: /^@minecraft\/server-net$/, replacement: fake("fake-mc-server-net.ts") },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "orchestrator/test/**/*.test.ts", "tools/**/test/**/*.test.ts"],
  },
});
