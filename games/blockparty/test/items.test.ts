// The items file (games/blockparty/items.json, items.ts): it reads without problems and has every
// item the game can use, a mistake in it is named, its letters never clash with a die's (they share
// the item panel's icon), and the build's icons come from the pack's own file or Minecraft's.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng, encodePng, blankImage } from "../../../tools/skins/png.ts";
import { VanillaTextures } from "../../../tools/build/vanilla-textures.ts";
import { addBoardIcons, addDiceIcons, addItemIcons, itemIcon, scaleUp } from "../../../tools/blockparty/item-icons.ts";
import { DICE, STANDARD } from "../behavior_pack/scripts/dice.ts";
import { EMPTY_ICON } from "../behavior_pack/scripts/screen-codes.ts";
import { ITEMS, ITEM_IDS, ITEM_PROBLEMS, iconPath, itemInFile, readItems, type ItemDef } from "../behavior_pack/scripts/items.ts";

describe("the items file", () => {
  it("has no problems, and an entry for every item the game can use", () => {
    expect(ITEM_PROBLEMS).toEqual([]);
    for (const id of ITEM_IDS) {
      expect(itemInFile(id)).toBe(true);
      expect(ITEMS[id].value).toBeGreaterThan(0);
    }
  });

  it("gives no item a die's letters (the item panel shows both by their letters)", () => {
    const dice = new Set(Object.values(DICE).map((die) => die.letters));
    for (const item of Object.values(ITEMS)) expect(dice.has(item.letters), item.id).toBe(false);
  });

  it("points every texture at the pack's own file or Minecraft's items, blocks or mobs", () => {
    const pack = new URL("../resource_pack/", import.meta.url);
    for (const item of Object.values(ITEMS)) {
      if (item.texture === undefined) continue;
      const own = existsSync(new URL(`${item.texture}.png`, pack));
      expect(own || /^textures\/(items|blocks|entity)\/[\w.-]+$/.test(item.texture), `${item.id}: ${item.texture}`).toBe(true);
    }
  });

  it("names each mistake, and leaves an item with one out", () => {
    const read = readItems({
      items: {
        stone_totem: { name: "Stone Totem", letters: "ST", texture: "textures/items/totem", description: "Roll an extra die.", value: 5 },
        ender_pearl: { name: "Ender Pearl", letters: "st", texture: "ender_pearl.png", description: "", value: 0 },
        golden_totem: { name: "Golden Totem", letters: "ST", description: "Doubles.", value: 10 },
        rocket: { name: "Rocket", letters: "R", description: "Flies.", value: 3 },
      },
    });
    expect(read.items.map((item) => item.id)).toEqual(["stone_totem", "golden_totem"]);
    expect(read.problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^ender_pearl: "letters"/),
        expect.stringMatching(/^ender_pearl: "texture"/),
        expect.stringMatching(/^ender_pearl: "description"/),
        expect.stringMatching(/^ender_pearl: "value"/),
        expect.stringMatching(/^rocket: the game has no item/),
        expect.stringMatching(/^cursed_totem: missing/),
        expect.stringMatching(/^golden_totem: "letters" ST are stone_totem's too/),
      ]),
    );
  });
});

describe("the item icons", () => {
  const item = (letters: string, texture: string): ItemDef => ({ id: "stone_totem", name: letters, letters, texture, description: "", value: 1 });
  const solid = (size: number, red: number) => {
    const image = blankImage(size, size);
    for (let at = 0; at < image.data.length; at += 4) image.data.set([red, 0, 0, 255], at);
    return image;
  };

  it("draws a small picture larger with hard pixels", () => {
    const image = blankImage(2, 1);
    image.data.set([255, 0, 0, 255, 0, 0, 255, 255]);
    const big = scaleUp(image, 2);
    expect([big.width, big.height]).toEqual([4, 2]);
    expect([...big.data.subarray(0, 16)]).toEqual([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  });

  it("writes each icon by its letters, from the pack's own file first, else Minecraft's", async () => {
    const out = await mkdtemp(join(tmpdir(), "item-icons-"));
    const own = join(out, "textures/blockparty/items/mine.png");
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, encodePng(solid(128, 10)));
    const vanilla = new VanillaTextures({ items: new Map([["totem.png", encodePng(solid(16, 20))]]), blocks: new Map() });
    const missing = await addItemIcons(out, [item("ST", "textures/items/totem"), item("MI", "textures/blockparty/items/mine"), item("NO", "textures/items/nothing")], vanilla);
    expect(missing).toEqual(["NO (textures/items/nothing)"]);
    const totem = decodePng(await readFile(join(out, `${iconPath({ letters: "ST" })}.png`)));
    expect([totem.width, totem.data[0]]).toEqual([64, 20]);
    const mine = decodePng(await readFile(join(out, "textures/blockparty/icons/MI.png")));
    expect([mine.width, mine.data[0]]).toEqual([128, 10]);
    expect(existsSync(join(out, "textures/blockparty/icons/NO.png"))).toBe(false);
  });

  it("draws a palette picture (the user's own art) larger too", () => {
    const pack = fileURLToPath(new URL("../resource_pack/", import.meta.url));
    for (const item of Object.values(ITEMS)) {
      if (!item.texture?.startsWith("textures/blockparty/")) continue;
      const icon = itemIcon(item, pack, undefined);
      expect(icon, item.id).toBeDefined();
      expect(decodePng(icon!).width, item.id).toBeGreaterThanOrEqual(64);
    }
  });

  it("writes each die's icon by its letters, face 1 of a six-face picture", async () => {
    const out = await mkdtemp(join(tmpdir(), "dice-icons-"));
    const six = blankImage(24, 16);
    six.data.set([200, 0, 0, 255], 0);
    six.data.set([0, 200, 0, 255], 8 * 4);
    const own = join(out, "textures/blockparty/dice/six.png");
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, encodePng(six));
    const vanilla = new VanillaTextures({ items: new Map(), blocks: new Map() });
    const missing = await addDiceIcons(out, [{ ...STANDARD, letters: "SX", texture: "textures/blockparty/dice/six" }, { ...STANDARD, letters: "NO", texture: "textures/blocks/nothing" }], vanilla);
    expect(missing).toEqual(["Standard Die (textures/blocks/nothing)"]);
    const icon = decodePng(await readFile(join(out, "textures/blockparty/icons/SX.png")));
    expect([icon.width, icon.height]).toEqual([64, 64]);
    expect([...icon.data.subarray(0, 4)]).toEqual([200, 0, 0, 255]);
    // Face 2's green is left out.
    expect([...icon.data].some((value, i) => i % 4 === 1 && value === 200)).toBe(false);
  });

  it("gives an empty item slot a clear picture", async () => {
    const out = await mkdtemp(join(tmpdir(), "board-icons-"));
    await addBoardIcons(out);
    const clear = decodePng(await readFile(join(out, `${iconPath({ letters: EMPTY_ICON })}.png`)));
    expect([...clear.data].every((value) => value === 0)).toBe(true);
  });
});
