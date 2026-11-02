import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import bridges from "../../../games/bridges/game.config.ts";
import { decodePng } from "../../skins/png.ts";
import { addGameKitPictures, drawKitPicture, pictureItems } from "../kit-pictures.ts";

const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("kit pictures", () => {
  it("picks the items that have an icon, in the team's dye", () => {
    const base = bridges.kits.base;
    expect(pictureItems(base, "§9", () => true)).toEqual([
      { icon: "wooden_sword", count: 1 },
      { icon: "bow", count: 1 },
      { icon: "blue_wool", count: 64 },
      { icon: "arrow", count: 1 },
    ]);
    expect(pictureItems(base, "§9", (name) => name !== "bow").map((item) => item.icon)).not.toContain("bow");
  });

  it("draws the icons 4 times as large in a row, with counts over 1 in the corner", () => {
    const icon = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).fill(255) };
    const one = drawKitPicture([{ icon, count: 1 }]);
    expect([one.width, one.height]).toEqual([68, 68]);
    const two = drawKitPicture([{ icon, count: 1 }, { icon, count: 64 }]);
    expect(two.width).toBe(64 * 2 + 8 + 4);
    // The count's shadow sits one icon pixel past the bottom right corner of the second icon.
    const shadow = ((64 + 3) * two.width + (64 + 8 + 64 + 3)) * 4;
    expect([...two.data.subarray(shadow, shadow + 4)]).toEqual([62, 62, 62, 255]);
  });

  it("draws Bridges' kits: the base kit per team dye, and each kit", async () => {
    const out = await mkdtemp(join(tmpdir(), "kit-pictures-"));
    dirs.push(out);
    const kit = { id: "ice", name: "Ice", items: [{ item: "minecraft:snowball", count: 16 }] };
    expect(await addGameKitPictures(out, bridges, [{ id: "glacier", config: { name: "Glacier", spawns: [], kits: { list: [kit] } } }])).toBe(5);
    const folder = join(out, "textures", "minecade", "kits");
    expect((await readdir(folder)).sort()).toEqual(["bridges_blue.png", "bridges_red.png", "glacier", "leap.png", "snowballs.png"]);
    expect(await readdir(join(folder, "glacier"))).toEqual(["ice.png"]);
    const base = decodePng(await readFile(join(folder, "bridges_red.png")));
    expect([base.width, base.height]).toEqual([4 * 64 + 3 * 8 + 4, 68]);
  });
});
