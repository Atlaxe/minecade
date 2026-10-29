import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import type { TransportKind } from "@minecade/minigame-core/protocol";
import { transportPlugin } from "../transport-plugin.ts";

const entry = fileURLToPath(new URL("./fixtures/transport-entry.ts", import.meta.url));

async function bundle(kind: TransportKind): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    external: ["@minecraft/*"],
    plugins: [transportPlugin(kind)],
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

describe("transportPlugin", () => {
  it("builds a log bundle that never imports @minecraft/server-net", async () => {
    const code = await bundle("log");
    expect(code).not.toContain("@minecraft/server-net");
    expect(code).toContain("scriptEventReceive");
  });

  it("builds an HTTP bundle that imports @minecraft/server-net", async () => {
    const code = await bundle("http");
    expect(code).toMatch(/from\s*"@minecraft\/server-net"/);
    expect(code).not.toContain("scriptEventReceive");
  });
});
