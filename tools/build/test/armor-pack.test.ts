import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEATHER_DYES, LEATHER_PIECES, dyedLeather } from "../../../packages/minigame-core/src/kit-defs.ts";
import { armorPackFiles, writeArmorPack } from "../../assets/armor.ts";
import { decodePng, encodePng } from "../../skins/png.ts";
import { VanillaTextures } from "../vanilla-textures.ts";

/** One pixel to dye (gray, alpha 255) and one marked to keep its color (alpha 1), like Minecraft's leather. */
const leather = () => new Uint8Array(encodePng({ width: 2, height: 1, data: new Uint8Array([200, 200, 200, 255, 90, 56, 32, 1]) }));
const TEXTURES = new VanillaTextures({
  items: new Map(LEATHER_PIECES.map((piece) => [`leather_${piece}.png`, leather()])),
  blocks: new Map(),
  armor: new Map([
    ["leather_1.png", leather()],
    ["leather_2.png", leather()],
  ]),
});

type Json = Record<string, any>;

describe("the armor pack", () => {
  const files = armorPackFiles(TEXTURES)!;
  const json = (path: string): Json => JSON.parse(files[path] as string) as Json;

  it("has every leather piece in all 16 dyes, worn where vanilla leather is, with the icon it names", () => {
    const icons = json("resource_pack/textures/item_texture.json").texture_data;
    const dyes = Object.keys(LEATHER_DYES);
    expect(dyes).toHaveLength(16);
    for (const dye of dyes) {
      for (const piece of LEATHER_PIECES) {
        const id = dyedLeather(piece, dye);
        const file = id.replace("minecade:", "");
        const item = json(`behavior_pack/items/${file}.json`)["minecraft:item"];
        expect(item.description.identifier).toBe(id);
        expect(item.components["minecraft:wearable"].slot).toBe(`slot.armor.${{ helmet: "head", chestplate: "chest", leggings: "legs", boots: "feet" }[piece]}`);
        const icon = icons[item.components["minecraft:icon"].textures.default].textures;
        expect(files[`resource_pack/${icon}.png`], id).toBeDefined();
        // Like vanilla leather: one look for players (the player model's armor), one for everything else.
        const player = json(`resource_pack/attachables/${file}.player.json`)["minecraft:attachable"].description;
        expect(player.item).toEqual({ [id]: "query.owner_identifier == 'minecraft:player'" });
        expect(player.geometry.default).toBe(`geometry.player.armor.${piece}`);
        const other = json(`resource_pack/attachables/${file}.json`)["minecraft:attachable"].description;
        expect(other.identifier).toBe(id);
        expect(other.geometry.default).toBe(`geometry.humanoid.armor.${piece}`);
        for (const look of [player, other]) expect(files[`resource_pack/${look.textures.default}.png`], id).toBeDefined();
      }
    }
    expect(json("behavior_pack/manifest.json").header.uuid).not.toBe(json("resource_pack/manifest.json").header.uuid);
  });

  it("tints Minecraft's leather the way the game dyes it: the gray times the dye, the marked pixels as they are", () => {
    const red = decodePng(files["resource_pack/textures/minecade/armor/red_leather_1.png"] as Buffer);
    expect([...red.data]).toEqual([Math.round(200 * 0xb0 / 255), Math.round(200 * 0x2e / 255), Math.round(200 * 0x26 / 255), 255, 90, 56, 32, 255]);
    const icon = decodePng(files["resource_pack/textures/minecade/armor/icons/blue_leather_boots.png"] as Buffer);
    expect([...icon.data.subarray(0, 4)]).toEqual([Math.round(200 * 0x3c / 255), Math.round(200 * 0x44 / 255), Math.round(200 * 0xaa / 255), 255]);
  });

  it("is written only when Minecraft's leather textures are there", async () => {
    const none = new VanillaTextures({ items: new Map(), blocks: new Map() });
    expect(armorPackFiles(none)).toBeUndefined();
    const out = `${await mkdtemp(join(tmpdir(), "armor-"))}/`;
    expect(writeArmorPack(none, out)).toBe(false);
    expect(writeArmorPack(TEXTURES, out)).toBe(true);
    expect((await readdir(out)).sort()).toEqual(["behavior_pack", "resource_pack"]);
    expect(JSON.parse(await readFile(join(out, "behavior_pack", "manifest.json"), "utf8")).header.name).toBe("Minecade Armor");
  });
});
