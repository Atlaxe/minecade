import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import bridges from "../../../games/bridges/game.config.ts";
import probe from "../../../games/probe/game.config.ts";
import { decodePng, encodePng, type Image } from "../../skins/png.ts";
import { HOTBAR_SLOTS, addGameKitPictures, blockIcon, drawKitPicture, dyeLeather, pictureArmor, pictureItems } from "../kit-pictures.ts";
import { VanillaTextures, cacheVanillaTextures, decodeTga, readArchive } from "../vanilla-textures.ts";

const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kit-pictures-"));
  dirs.push(dir);
  return dir;
}

function solid(width: number, height: number, color: number[]): Image {
  const image = { width, height, data: new Uint8Array(width * height * 4) };
  for (let index = 0; index < width * height; index++) image.data.set(color, index * 4);
  return image;
}

const pixel = (image: Image, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

/** An archive the way Minecraft packs one: a 16-byte head, 256 bytes per entry, then the files. */
function archive(files: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(files);
  const head = new Uint8Array(16 + names.length * 256);
  const view = new DataView(head.buffer);
  view.setUint32(8, names.length, true);
  let offset = 0;
  names.forEach((name, index) => {
    const entry = 16 + index * 256;
    head[entry] = name.length;
    head.set(new TextEncoder().encode(name), entry + 1);
    view.setUint32(entry + 248, offset, true);
    view.setUint32(entry + 252, files[name].length, true);
    offset += files[name].length;
  });
  return new Uint8Array(Buffer.concat([head, ...names.map((name) => files[name])]));
}

/** A 32-bit TGA of these pixels (RGBA, a row at a time from the top), stored bottom row first as Minecraft's are. */
function tga(width: number, rows: number[][][]): Uint8Array {
  const head = [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, width, 0, rows.length, 0, 32, 8];
  const pixels = [...rows].reverse().flatMap((row) => row.flatMap(([r, g, b, a]) => [b, g, r, a]));
  return new Uint8Array([...head, ...pixels]);
}

const png = (color: number[]) => new Uint8Array(encodePng(solid(16, 16, color)));
const GRAY = [200, 200, 200, 255];
const TEXTURES = new VanillaTextures({
  items: new Map([
    ["snowball.png", png([240, 240, 255, 255])],
    ["feather.png", png([250, 250, 250, 255])],
    ["wood_sword.png", png([150, 100, 50, 255])],
    ["iron_sword.png", png([220, 220, 220, 255])],
    ["iron_chestplate.png", png([210, 210, 210, 255])],
    ["gold_helmet.png", png([250, 200, 50, 255])],
    ["bucket_water.png", png([60, 60, 250, 255])],
    ["leather_chestplate.png", png(GRAY)],
    ["leather_boots.tga", tga(1, [[GRAY]])],
  ]),
  blocks: new Map([
    ["wool_colored_red.png", png([200, 40, 40, 255])],
    ["wool_colored_blue.png", png([40, 40, 200, 255])],
    ["wool_colored_silver.png", png([160, 160, 160, 255])],
  ]),
});

describe("kit pictures", () => {
  it("lists a kit's items in the team's dye, in order, then the off hand, and its armor head to feet", () => {
    expect(pictureItems(bridges.kits.base, "§9")).toEqual([
      { item: "minecraft:wooden_sword", count: 1 },
      { item: "minecraft:bow", count: 1 },
      { item: "minecraft:blue_wool", count: 64 },
      { item: "minecraft:arrow", count: 1 },
    ]);
    const kit = { id: "k", name: "K", items: [{ item: "minecraft:bow" }], armor: { feet: "minecraft:iron_boots", offhand: "minecraft:shield", head: "minecraft:iron_helmet" } };
    expect(pictureItems(kit, undefined).map((item) => item.item)).toEqual(["minecraft:bow", "minecraft:shield"]);
    expect(pictureArmor(kit)).toEqual(["minecraft:iron_helmet", "minecraft:iron_boots"]);
  });

  it("draws the nine hotbar slots, the items from the left with counts over 1 in the corner, and the armor in the last", () => {
    const white = { kind: "item" as const, image: solid(16, 16, [255, 255, 255, 255]), count: 1 };
    const red = { ...white, image: solid(16, 16, [255, 0, 0, 255]) };
    const one = drawKitPicture([white]);
    expect([one.width, one.height]).toEqual([HOTBAR_SLOTS * 80, 80]);
    expect(pixel(one, 0, 0)).toEqual([139, 139, 139, 255]); // the slot's frame
    expect(pixel(one, 6, 6)).toEqual([0, 0, 0, 150]); // its see-through inside
    expect(pixel(one, 40, 40)).toEqual([255, 255, 255, 255]); // the icon
    expect(pixel(one, 120, 40)).toEqual([0, 0, 0, 150]); // an empty slot, as on the hotbar
    const lastMiddle = 8 * 80 + 40;
    expect(pixel(one, lastMiddle, 40)).toEqual([0, 0, 0, 150]); // no armor: the last slot is empty
    // Nine items fill the hotbar; with armor, the ninth gives way to it. More are left out.
    const nine: (typeof white)[] = Array(9).fill(white);
    expect(pixel(drawKitPicture(nine), lastMiddle, 40)).toEqual([255, 255, 255, 255]);
    expect(pixel(drawKitPicture(nine, [red]), lastMiddle, 40)).toEqual([255, 0, 0, 255]);
    expect(drawKitPicture(Array(12).fill(white)).height).toBe(80);
    // Several pieces share the last slot at half size: four in a square, head to feet.
    const four = drawKitPicture([], [red, white, red, white]);
    const left = 8 * 80 + 8; // the last slot's icon square
    expect([pixel(four, left + 16, 24), pixel(four, left + 48, 24), pixel(four, left + 16, 56), pixel(four, left + 48, 56)]).toEqual([
      [255, 0, 0, 255],
      [255, 255, 255, 255],
      [255, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
    // Two side by side, in the middle.
    const two = drawKitPicture([], [red, white]);
    expect([pixel(two, left + 16, 12)[3], pixel(two, left + 16, 40), pixel(two, left + 48, 40)]).toEqual([150, [255, 0, 0, 255], [255, 255, 255, 255]]);
    // A count's shadow ends one pixel past its digits: the slot's right frame, two rows above its bottom.
    const counted = drawKitPicture([{ ...white, count: 8 }]);
    expect(pixel(counted, 19 * 4, 18 * 4 - 1)).toEqual([63, 63, 63, 255]);
  });

  it("dyes leather: its gray times the dye, and the pixels marked to keep their color solid as they are", () => {
    const leather = { width: 3, height: 1, data: new Uint8Array([200, 200, 200, 255, 100, 50, 25, 3, 0, 0, 0, 0]) };
    expect([...dyeLeather(leather, { red: 0.5, green: 1, blue: 0 }).data]).toEqual([100, 200, 0, 255, 100, 50, 25, 255, 0, 0, 0, 0]);
  });

  it("draws a block as a cube: the top lit, the sides darker", () => {
    const icon = blockIcon(solid(16, 16, [200, 100, 50, 255]));
    expect([icon.width, icon.height]).toEqual([64, 64]);
    expect(pixel(icon, 32, 12)).toEqual([200, 100, 50, 255]);
    expect(pixel(icon, 18, 44)).toEqual([160, 80, 40, 255]);
    expect(pixel(icon, 46, 44)).toEqual([120, 60, 30, 255]);
    expect(pixel(icon, 1, 1)[3]).toBe(0);
  });

  it("draws Bridges' kits (not the base kit everyone gets), and a map's own", async () => {
    const out = await tempDir();
    const kit = { id: "ice", name: "Ice", items: [{ item: "minecraft:snowball", count: 16 }] };
    expect(await addGameKitPictures(out, bridges, [{ id: "glacier", config: { name: "Glacier", spawns: [], kits: { list: [kit] } } }], TEXTURES)).toBe(3);
    const folder = join(out, "textures", "minecade", "kits");
    expect((await readdir(folder)).sort()).toEqual(["glacier", "leap.png", "snowballs.png"]);
    expect(await readdir(join(folder, "glacier"))).toEqual(["ice.png"]);
    const snowballs = decodePng(await readFile(join(folder, "snowballs.png")));
    expect([snowballs.width, snowballs.height]).toEqual([HOTBAR_SLOTS * 80, 80]);
  });

  it("draws a kit in team colors once per dye, and its leather in the team's color", async () => {
    const out = await tempDir();
    const game = { ...bridges, kits: { ...bridges.kits, list: [{ id: "wool", name: "Wool", items: [{ item: "minecraft:{color}_wool", count: 16 }] }] } };
    expect(await addGameKitPictures(out, game, [], TEXTURES)).toBe(2);
    expect((await readdir(join(out, "textures", "minecade", "kits"))).sort()).toEqual(["wool_blue.png", "wool_red.png"]);
    // Probe's: soldier (no team colors), builder (team wool), scout and painter (team leather) for red and blue.
    const probeOut = await tempDir();
    expect(await addGameKitPictures(probeOut, probe, [], TEXTURES)).toBe(7);
    const folder = join(probeOut, "textures", "minecade", "kits");
    expect((await readdir(folder)).sort()).toEqual([
      "builder_blue.png",
      "builder_red.png",
      "painter_blue.png",
      "painter_red.png",
      "scout_blue.png",
      "scout_red.png",
      "soldier.png",
    ]);
    // The scout's chestplate and boots share the last slot, in red: 200 gray times red's 0.85, 0.15, 0.15.
    const scout = decodePng(await readFile(join(folder, "scout_red.png")));
    expect(pixel(scout, 8 * 80 + 8 + 16, 40)).toEqual([170, 30, 30, 255]);
    // The painter's guns are the guns pack's own items: their hotbar icons fill the first four slots.
    const painter = decodePng(await readFile(join(folder, "painter_red.png")));
    const drawn = (slot: number) => {
      let solid = 0;
      for (let y = 8; y < 72; y++) for (let x = slot * 80 + 8; x < slot * 80 + 72; x++) if (pixel(painter, x, y)[3] === 255) solid++;
      return solid;
    };
    for (const slot of [0, 1, 2, 3]) expect(drawn(slot), `slot ${slot}`).toBeGreaterThan(200);
    expect(drawn(4)).toBe(0);
  });
});

describe("Minecraft's textures", () => {
  it("reads the files out of an archive", () => {
    const files = readArchive(archive({ "a.png": new Uint8Array([1, 2, 3]), "bb.png": new Uint8Array([4, 5]) }));
    expect([...files.keys()]).toEqual(["a.png", "bb.png"]);
    expect([...files.get("bb.png")!]).toEqual([4, 5]);
  });

  it("reads a TGA, its rows bottom first or top first, plain or run-length encoded", () => {
    const red = [255, 0, 0, 255];
    const blue = [0, 0, 255, 128];
    expect(decodeTga(tga(1, [[red], [blue]]))?.data).toEqual(new Uint8Array([...red, ...blue]));
    const topFirst = tga(1, [[blue], [red]]);
    topFirst[17] |= 0x20;
    expect(decodeTga(topFirst)?.data).toEqual(new Uint8Array([...red, ...blue]));
    // Run-length: a run of two reds, then one raw blue (BGRA in the file).
    const packed = new Uint8Array([0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 0, 32, 0x28, 0x81, 0, 0, 255, 255, 0x00, 255, 0, 0, 128]);
    expect(decodeTga(packed)?.data).toEqual(new Uint8Array([...red, ...red, ...blue]));
    expect(decodeTga(new Uint8Array([0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 8, 0, 0]))).toBeUndefined(); // color mapped
  });

  it("finds an item's picture by its id: wool as a block, other names Minecraft uses, leather's TGA", () => {
    expect(TEXTURES.item("minecraft:wooden_sword")?.kind).toBe("item");
    expect(TEXTURES.item("minecraft:snowball")?.kind).toBe("item");
    expect(TEXTURES.item("minecraft:red_wool")?.kind).toBe("block");
    expect(TEXTURES.item("minecraft:light_gray_wool")?.kind).toBe("block");
    expect(TEXTURES.item("minecraft:golden_helmet")?.kind).toBe("item");
    expect(TEXTURES.item("minecraft:water_bucket")?.kind).toBe("item");
    expect(TEXTURES.item("minecraft:leather_boots")?.image.width).toBe(1);
    expect(TEXTURES.item("minecraft:bow")).toBeUndefined();
  });

  it("copies the archives from Minecraft into the cache, and reads them from there", async () => {
    const pack = await tempDir();
    const cache = join(await tempDir(), "vanilla");
    expect(cacheVanillaTextures(pack, cache)).toBe(false);
    await mkdir(join(pack, "__brarchive", "textures"), { recursive: true });
    await writeFile(join(pack, "__brarchive", "textures", "items.brarchive"), archive({ "snowball.png": png([255, 255, 255, 255]) }));
    await writeFile(join(pack, "__brarchive", "textures", "blocks.brarchive"), archive({}));
    expect(cacheVanillaTextures(pack, cache)).toBe(true);
    expect((await readdir(cache)).sort()).toEqual(["blocks.brarchive", "items.brarchive"]);
    // Without Minecraft, the cache is enough.
    expect(VanillaTextures.load(join(pack, "gone"), cache)?.item("minecraft:snowball")?.kind).toBe("item");
  });
});
