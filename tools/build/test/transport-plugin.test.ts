import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import type { TransportKind } from "@minecade/minigame-core/protocol";
import { PRIVATE_DATA, privateDataPlugin, transportPlugin } from "../transport-plugin.ts";

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

describe("privateDataPlugin", () => {
  /** A game folder with data.json, its scripts importing it, and maybe a saved copy in private_data. */
  async function bundleData(saved: boolean): Promise<{ code: string; used: string[] }> {
    const dir = await mkdtemp(join(tmpdir(), "private-data-"));
    try {
      await mkdir(join(dir, "scripts"));
      await writeFile(join(dir, "data.json"), JSON.stringify({ text: "committed" }));
      await writeFile(join(dir, "scripts", "main.ts"), 'import data from "../data.json";\nexport const text = data.text;\n');
      if (saved) {
        await mkdir(join(dir, PRIVATE_DATA));
        await writeFile(join(dir, PRIVATE_DATA, "data.json"), JSON.stringify({ text: "saved" }));
      }
      const used: string[] = [];
      const result = await build({ entryPoints: [join(dir, "scripts", "main.ts")], bundle: true, write: false, format: "esm", platform: "neutral", plugins: [privateDataPlugin((path) => used.push(path))], logLevel: "silent" });
      return { code: result.outputFiles[0].text, used: used.map((path) => relative(dir, path)) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("takes a data file from private_data beside it when a tool saved one there, and says so", async () => {
    const { code, used } = await bundleData(true);
    expect(code).toContain('"saved"');
    expect(code).not.toContain('"committed"');
    expect(used).toEqual([join(PRIVATE_DATA, "data.json")]);
  });

  it("keeps the committed file when there's no saved copy", async () => {
    const { code, used } = await bundleData(false);
    expect(code).toContain('"committed"');
    expect(used).toEqual([]);
  });
});
