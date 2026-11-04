import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";
import { modBlockShapes, readModBlockShapes } from "../mod-blocks.ts";
import { modBlocksPlugin } from "../transport-plugin.ts";

const scratch = mkdtempSync(join(tmpdir(), "mod-blocks-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the shared blocks pack's shapes (#mod-blocks)", () => {
  it("keeps the shapes a game can repaint: full cubes of any kind as cubes, connected panes as panes", () => {
    const shapes = modBlockShapes({
      "minecade:bricks": { k: "cube", f: 1 },
      "minecade:lamp": { k: "decor", f: 1 },
      "minecade:chair": { k: "decor" },
      "minecade:bricks_stairs": { k: "stairs" },
      "minecade:bricks_vertical_slab": { k: "vertical_slab" },
      "minecade:window_pane": { k: "ct_pane" },
      "minecade:rope_fence_gate": { k: "gate" },
      "minecade:oak_chest": { k: "chest" },
      "minecade:ladder": { k: "ladder" },
    });
    expect(shapes).toEqual({
      "minecade:bricks": "cube",
      "minecade:lamp": "cube",
      "minecade:bricks_stairs": "stairs",
      "minecade:bricks_vertical_slab": "vertical_slab",
      "minecade:window_pane": "pane",
      "minecade:rope_fence_gate": "gate",
    });
  });

  it("reads the installed pack's table, or nothing when the pack isn't installed", async () => {
    const data = join(scratch, "data.js");
    writeFileSync(data, 'export const BLOCKS = {"minecade:bricks_wall":{"k":"wall","b":[],"s":{}}};\nexport const SIDE_TABLES = [];\n');
    expect(await readModBlockShapes(data)).toEqual({ "minecade:bricks_wall": "wall" });
    expect(await readModBlockShapes(join(scratch, "missing.js"))).toEqual({});
  });

  it("is inlined into a pack's bundle as JSON", async () => {
    const result = await build({
      stdin: { contents: 'import shapes from "#mod-blocks";\nexport const count = Object.keys(shapes).length;', resolveDir: scratch, loader: "ts" },
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      plugins: [modBlocksPlugin()],
      logLevel: "silent",
    });
    expect(result.outputFiles[0].text).toContain("Object.keys(");
    expect(result.errors).toEqual([]);
  });
});
