import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import bridges from "../../../games/bridges/game.config.ts";
import { decodePng, encodePng, type Image } from "../../skins/png.ts";
import { ROW_SLOTS, addGameKitPictures, blockIcon, drawKitPicture, pictureItems } from "../kit-pictures.ts";
import { VanillaTextures, cacheVanillaTextures, readArchive } from "../vanilla-textures.ts";

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

const png = (color: number[]) => new Uint8Array(encodePng(solid(16, 16, color)));
const TEXTURES = new VanillaTextures({
  items: new Map([
    ["snowball.png", png([240, 240, 255, 255])],
    ["feather.png", png([250, 250, 250, 255])],
    ["wood_sword.png", png([150, 100, 50, 255])],
  ]),
  blocks: new Map([
    ["wool_colored_red.png", png([200, 40, 40, 255])],
    ["wool_colored_blue.png", png([40, 40, 200, 255])],
    ["wool_colored_silver.png", png([160, 160, 160, 255])],
  ]),
});

describe("kit pictures", () => {
  it("lists a kit's items in the team's dye, in order", () => {
    expect(pictureItems(bridges.kits.base, "§9")).toEqual([
      { item: "minecraft:wooden_sword", count: 1 },
      { item: "minecraft:bow", count: 1 },
      { item: "minecraft:blue_wool", count: 64 },
      { item: "minecraft:arrow", count: 1 },
    ]);
  });

  it("draws a full row of hotbar slots, the items from the left, nine to a row, counts over 1 in the corner", () => {
    const icon = { kind: "item" as const, image: solid(16, 16, [255, 255, 255, 255]), count: 1 };
    const one = drawKitPicture([icon]);
    expect([one.width, one.height]).toEqual([ROW_SLOTS * 80, 80]);
    const pixel = (image: Image, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
    expect(pixel(one, 0, 0)).toEqual([139, 139, 139, 255]); // the slot's frame
    expect(pixel(one, 6, 6)).toEqual([0, 0, 0, 150]); // its see-through inside
    expect(pixel(one, 40, 40)).toEqual([255, 255, 255, 255]); // the icon
    expect(pixel(one, 100, 40)[3]).toBe(0); // no slot past the last item
    expect(drawKitPicture(Array(10).fill(icon)).height).toBe(160);
    // A count's shadow ends one pixel past its digits: the slot's right frame, two rows above its bottom.
    const counted = drawKitPicture([{ ...icon, count: 8 }]);
    expect(pixel(counted, 19 * 4, 18 * 4 - 1)).toEqual([63, 63, 63, 255]);
  });

  it("draws a block as a cube: the top lit, the sides darker", () => {
    const icon = blockIcon(solid(16, 16, [200, 100, 50, 255]));
    expect([icon.width, icon.height]).toEqual([64, 64]);
    const pixel = (x: number, y: number) => [...icon.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
    expect(pixel(32, 12)).toEqual([200, 100, 50, 255]);
    expect(pixel(18, 44)).toEqual([160, 80, 40, 255]);
    expect(pixel(46, 44)).toEqual([120, 60, 30, 255]);
    expect(pixel(1, 1)[3]).toBe(0);
  });

  it("draws Bridges' kits (not the base kit everyone gets), and a map's own", async () => {
    const out = await tempDir();
    const kit = { id: "ice", name: "Ice", items: [{ item: "minecraft:snowball", count: 16 }] };
    expect(await addGameKitPictures(out, bridges, [{ id: "glacier", config: { name: "Glacier", spawns: [], kits: { list: [kit] } } }], TEXTURES)).toBe(3);
    const folder = join(out, "textures", "minecade", "kits");
    expect((await readdir(folder)).sort()).toEqual(["glacier", "leap.png", "snowballs.png"]);
    expect(await readdir(join(folder, "glacier"))).toEqual(["ice.png"]);
    const snowballs = decodePng(await readFile(join(folder, "snowballs.png")));
    expect([snowballs.width, snowballs.height]).toEqual([ROW_SLOTS * 80, 80]);
  });

  it("draws a kit in team colors once per dye", async () => {
    const out = await tempDir();
    const game = { ...bridges, kits: { ...bridges.kits, list: [{ id: "wool", name: "Wool", items: [{ item: "minecraft:{color}_wool", count: 16 }] }] } };
    expect(await addGameKitPictures(out, game, [], TEXTURES)).toBe(2);
    expect((await readdir(join(out, "textures", "minecade", "kits"))).sort()).toEqual(["wool_blue.png", "wool_red.png"]);
  });
});

describe("Minecraft's textures", () => {
  it("reads the files out of an archive", () => {
    const files = readArchive(archive({ "a.png": new Uint8Array([1, 2, 3]), "bb.png": new Uint8Array([4, 5]) }));
    expect([...files.keys()]).toEqual(["a.png", "bb.png"]);
    expect([...files.get("bb.png")!]).toEqual([4, 5]);
  });

  it("finds an item's picture by its id, wool as a block", () => {
    expect(TEXTURES.item("minecraft:wooden_sword")?.kind).toBe("item");
    expect(TEXTURES.item("minecraft:snowball")?.kind).toBe("item");
    expect(TEXTURES.item("minecraft:red_wool")?.kind).toBe("block");
    expect(TEXTURES.item("minecraft:light_gray_wool")?.kind).toBe("block");
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
