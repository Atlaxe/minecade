import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writePackLists } from "../packs.ts";

const dirs: string[] = [];
function folder(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "minecade-lists-"));
  dirs.push(dir);
  for (const [path, json] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(json));
  }
  return dir;
}
const manifest = (uuid: string, version = [1, 0, 0]) => ({ header: { uuid, version }, modules: [] });
const list = (dir: string, kind: string) => JSON.parse(readFileSync(join(dir, `world_${kind}_packs.json`), "utf8"));

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("writePackLists", () => {
  it("lists the template's packs and the shared ones by their names in the container", async () => {
    const template = folder({
      "behavior_packs/lobby_bp/manifest.http.json": manifest("lobby-bp"),
      "behavior_packs/lobby_bp/manifest.log.json": manifest("lobby-bp"),
      "resource_packs/lobby_rp/manifest.json": manifest("lobby-rp", [1, 0, 77]),
    });
    const shared = folder({
      "behavior_packs/minecade_blocks_bp/manifest.json": manifest("blocks-bp"),
      "behavior_packs/minecade_armor_bp/manifest.json": manifest("armor-bp"),
      "resource_packs/minecade_core_rp/manifest.json": manifest("core-rp", [1, 0, 3]),
      "resource_packs/minecade_guns_rp/manifest.json": manifest("guns-rp"),
    });
    await writePackLists(template, shared);
    // minecade_armor_bp, minecade_blocks_bp, minecade_lobby_bp: the order the entrypoint's glob gave.
    expect(list(template, "behavior").map((ref: { pack_id: string }) => ref.pack_id)).toEqual(["armor-bp", "blocks-bp", "lobby-bp"]);
    expect(list(template, "resource")).toEqual([
      { pack_id: "core-rp", version: [1, 0, 3] },
      { pack_id: "guns-rp", version: [1, 0, 0] },
      { pack_id: "lobby-rp", version: [1, 0, 77] },
    ]);
  });

  it("takes shared packs from the template itself, and writes empty lists for none", async () => {
    const template = folder({ "behavior_packs/blocks_bp/manifest.json": manifest("blocks-bp") });
    await writePackLists(template);
    expect(list(template, "behavior")).toEqual([{ pack_id: "blocks-bp", version: [1, 0, 0] }]);
    expect(list(template, "resource")).toEqual([]);
  });

  it("refuses a pack whose transports' manifests name different packs", async () => {
    const template = folder({
      "behavior_packs/sumo_bp/manifest.http.json": manifest("sumo-bp"),
      "behavior_packs/sumo_bp/manifest.log.json": manifest("sumo-bp", [1, 0, 1]),
    });
    await expect(writePackLists(template)).rejects.toThrow("name different packs");
  });
});
