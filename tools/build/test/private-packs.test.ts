import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { privatePacks } from "../packs.ts";

const dirs: string[] = [];
function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "minecade-private-"));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("privatePacks", () => {
  it("finds each half with a manifest and content, named for the target", async () => {
    const game = folder({
      "private_packs/README.md": "about",
      "private_packs/chameleon/behavior_pack/manifest.json": "{}",
      "private_packs/chameleon/behavior_pack/entities/player.json": "{}",
      "private_packs/chameleon/resource_pack/manifest.json": "{}",
      "private_packs/chameleon/resource_pack/entity/player.entity.json": "{}",
      // Only a manifest: no content, so not used.
      "private_packs/empty/resource_pack/manifest.json": "{}",
      "private_packs/empty/resource_pack/pack_icon.png": "",
      // No manifest yet.
      "private_packs/half/behavior_pack/scripts/main.js": "",
    });
    const found = await privatePacks(game, "probe");
    expect(found.map(({ kind, name }) => ({ kind, name }))).toEqual([
      { kind: "behavior", name: "probe_chameleon_bp" },
      { kind: "resource", name: "probe_chameleon_rp" },
    ]);
    expect(found[0].dir).toBe(join(game, "private_packs", "chameleon", "behavior_pack"));
  });

  it("is empty for a target without the folder", async () => {
    expect(await privatePacks(folder({ "game.config.ts": "" }), "sumo")).toEqual([]);
  });
});
