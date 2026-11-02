import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { addFakePlayer, addFakeSkins } from "../fake-player.ts";

const preview = fileURLToPath(new URL("../../../editor/preview/", import.meta.url));
const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fake-player-"));
  dirs.push(dir);
  return dir;
}

const texturesOf = async (pack: string) => JSON.parse(await readFile(join(pack, "entity", "fake_player.entity.json"), "utf8"))["minecraft:client_entity"].description.textures;

describe("the fake player's skins", () => {
  it("copies Minecraft's default skins into the pack, and points the ones this PC lacks at Steve or Alex", async () => {
    const pack = await tempDir();
    await cp(join(preview, "resource_pack"), pack, { recursive: true });
    const skins = await tempDir();
    await writeFile(join(skins, "kai.png"), "kai");
    await writeFile(join(skins, "efe.png"), "efe");
    expect(await addFakeSkins(pack, skins)).toBe(2);
    expect(await readFile(join(pack, "textures", "minecade", "fake", "skins", "kai.png"), "utf8")).toBe("kai");
    const textures = await texturesOf(pack);
    expect(textures.color).toBe("textures/minecade/fake/white");
    expect(textures.kai).toBe("textures/minecade/fake/skins/kai");
    expect(textures.efe).toBe("textures/minecade/fake/skins/efe");
    expect(textures.zuri).toBe("textures/entity/steve");
    expect(textures.noor).toBe("textures/entity/alex");
  });

  it("adds the fake player to Edit's packs, without the preview's heart font", async () => {
    const out = await tempDir();
    await addFakePlayer(join(out, "bp"), join(out, "rp"));
    expect(existsSync(join(out, "bp", "entities", "fake_player.json"))).toBe(true);
    expect(existsSync(join(out, "rp", "render_controllers", "fake_player.render_controllers.json"))).toBe(true);
    expect(existsSync(join(out, "rp", "textures", "minecade", "fake", "white.png"))).toBe(true);
    expect(existsSync(join(out, "rp", "font"))).toBe(false);
    expect(Object.keys(await texturesOf(join(out, "rp")))).toHaveLength(10);
  });
});
