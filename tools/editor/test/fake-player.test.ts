import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { addFakePlayer, addFakeSkins, mannequinSkins, skinKey } from "../fake-player.ts";

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
  it("copies Minecraft's Steve and Alex into the pack, and points one this PC lacks at the client's own", async () => {
    const pack = await tempDir();
    await cp(join(preview, "resource_pack"), pack, { recursive: true });
    const skins = await tempDir();
    await writeFile(join(skins, "steve.png"), "steve");
    expect(await addFakeSkins(pack, skins)).toBe(1);
    expect(await readFile(join(pack, "textures", "minecade", "fake", "skins", "steve.png"), "utf8")).toBe("steve");
    const textures = await texturesOf(pack);
    expect(textures).toEqual({ color: "textures/minecade/fake/white", steve: "textures/minecade/fake/skins/steve", alex: "textures/entity/alex" });
  });

  it("adds the fake player to Edit's packs, without the preview's heart font, with the players' skins after its own", async () => {
    const out = await tempDir();
    const image = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) };
    await addFakePlayer(join(out, "bp"), join(out, "rp"), [{ skin: { name: "Sam", key: "p0123456789", slim: true }, image }]);
    expect(existsSync(join(out, "bp", "entities", "fake_player.json"))).toBe(true);
    expect(existsSync(join(out, "rp", "models", "entity", "fake_player.geo.json"))).toBe(true);
    expect(existsSync(join(out, "rp", "textures", "minecade", "fake", "white.png"))).toBe(true);
    expect(existsSync(join(out, "rp", "textures", "minecade", "fake", "skins", "p0123456789.png"))).toBe(true);
    expect(existsSync(join(out, "rp", "font"))).toBe(false);
    expect(Object.keys(await texturesOf(join(out, "rp")))).toEqual(["color", "steve", "alex", "p0123456789"]);
    const controller = JSON.parse(await readFile(join(out, "rp", "render_controllers", "fake_player.render_controllers.json"), "utf8")).render_controllers["controller.render.minecade.fake_player"];
    expect(controller.arrays.textures["Array.skins"].at(-1)).toBe("Texture.p0123456789");
    expect(controller.arrays.geometries["Array.models"].at(-1)).toBe("Geometry.slim");
    const properties = JSON.parse(await readFile(join(out, "bp", "entities", "fake_player.json"), "utf8"))["minecraft:entity"].description.properties;
    expect(properties["minecade:skin"].range).toEqual([0, 3]);
  });

  it("takes the watcher's classic skins for mannequins, by a key that names no player, and leaves character creator skins out", async () => {
    const dir = await tempDir();
    const save = async (xuid: string, meta: Record<string, unknown>, width: number, height: number, fill: (data: Uint8Array) => void = () => {}) => {
      await mkdir(join(dir, xuid));
      const data = new Uint8Array(width * height * 4);
      fill(data);
      await writeFile(join(dir, xuid, "meta.json"), JSON.stringify({ xuid, width, height, hash: "x", updatedAt: "", ...meta }));
      await writeFile(join(dir, xuid, "skin.rgba"), data);
    };
    await save("1", { name: "Wide", armSize: "wide", geometry: { default: "geometry.humanoid.custom" } }, 64, 64);
    // The watcher saves a classic skin's model data too.
    await writeFile(join(dir, "1", "model.geo.json"), JSON.stringify({ "minecraft:geometry": [] }));
    await save("5", { name: "Custom model", geometry: { default: "geometry.skinpack.dragon" } }, 64, 64);
    await save("2", { name: "Slim", armSize: "slim", geometry: { default: "geometry.humanoid.customSlim" } }, 128, 128);
    await save("3", { name: "Persona", persona: true, geometry: { default: "geometry.persona_1" } }, 256, 256);
    // An old skin: the right leg's front at (4, 20) is red; it becomes the left leg's front, mirrored, at (20, 52).
    await save("4", { name: "Old" }, 64, 32, (data) => data.set([255, 0, 0, 255], (20 * 64 + 4) * 4));
    const skins = await mannequinSkins(dir);
    expect(skins.map(({ skin }) => skin)).toEqual([
      { name: "Old", key: skinKey("4"), slim: false },
      { name: "Slim", key: skinKey("2"), slim: true },
      { name: "Wide", key: skinKey("1"), slim: false },
    ]);
    expect(skinKey("1")).toMatch(/^p[0-9a-f]{10}$/);
    const old = skins[0].image;
    expect([old.width, old.height]).toEqual([64, 64]);
    expect([...old.data.subarray((52 * 64 + 23) * 4, (52 * 64 + 23) * 4 + 4)]).toEqual([255, 0, 0, 255]);
    expect(skins[1].image.width).toBe(128);
  });
});
