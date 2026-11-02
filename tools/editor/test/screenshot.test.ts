import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cropToAspect, decodePng, encodePng, scaleDown, type Picture } from "../png.ts";
import { NEWEST_WITHIN_MS, newestScreenshot, saveNewestScreenshot, screenshotFolders } from "../screenshot.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

/** A picture whose every pixel says where it is: red is x, green is y. */
function gradient(width: number, height: number): Picture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([x % 256, y % 256, 7, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

function pixel(picture: Picture, x: number, y: number): number[] {
  return [...picture.data.subarray((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 4)];
}

describe("PNG", () => {
  it("reads PNGs another encoder wrote, RGB and RGBA", () => {
    // Pillow's (tools/assets/make-assets.py): a game's icon.png can be replaced by a screenshot, this can't.
    const icon = decodePng(readFileSync(join(root, "lobby/resource_pack/textures/minecade/ui/map_placeholder.png")));
    expect([icon.width, icon.height]).toEqual([320, 180]);
    expect(pixel(icon, 0, 0)).toEqual([40, 52, 70, 255]);
    expect(pixel(icon, 160, 90)).toEqual([29, 38, 52, 255]);
    expect(pixel(icon, 319, 179)).toEqual([18, 24, 34, 255]);
    const play = decodePng(readFileSync(join(root, "lobby/resource_pack/textures/minecade/ui/icon_play.png")));
    expect(pixel(play, 32, 32)).toEqual([190, 240, 255, 255]);
    expect(pixel(play, 0, 0)[3]).toBe(0);
  });

  it("writes a picture it reads back the same", () => {
    const picture = gradient(37, 21);
    const back = decodePng(encodePng(picture));
    expect([back.width, back.height]).toEqual([37, 21]);
    expect(back.data).toEqual(picture.data);
  });

  it("refuses what isn't an 8-bit RGB or RGBA PNG", () => {
    expect(() => decodePng(Buffer.from("not a png"))).toThrow("not a PNG file");
    const gray = encodePng(gradient(2, 2));
    gray[8 + 8 + 9] = 0; // IHDR's color type: grayscale
    expect(() => decodePng(gray)).toThrow("color type 0");
  });

  it("crops the middle 16:9 out of a wider or taller picture, then scales it down by averages", () => {
    const wide = cropToAspect(gradient(2560, 1080), 16, 9);
    expect([wide.width, wide.height]).toEqual([1920, 1080]);
    expect(pixel(wide, 0, 0)).toEqual([320 % 256, 0, 7, 255]);
    const tall = cropToAspect(gradient(1920, 1200), 16, 9);
    expect([tall.width, tall.height]).toEqual([1920, 1080]);
    expect(pixel(tall, 0, 0)).toEqual([0, 60, 7, 255]);
    const small = scaleDown({ width: 4, height: 2, data: new Uint8Array([0, 0, 0, 255, 100, 0, 0, 255, 10, 10, 10, 255, 30, 30, 30, 255, 0, 0, 0, 255, 100, 0, 0, 255, 10, 10, 10, 255, 30, 30, 30, 255]) }, 2, 1);
    expect([...small.data]).toEqual([50, 0, 0, 255, 20, 20, 20, 255]);
  });
});

describe("the newest screenshot", () => {
  let dir: string;
  let captures: string;
  let screenshots: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "minecade-screenshots-test-"));
    captures = join(dir, "Videos", "Captures");
    screenshots = join(dir, "Pictures", "Screenshots");
    await mkdir(captures, { recursive: true });
    await mkdir(screenshots, { recursive: true });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("looks in Game Bar's, Windows' and OneDrive's folders", () => {
    expect(screenshotFolders({ USERPROFILE: "C:\\Users\\Me", OneDrive: "C:\\Users\\Me\\OneDrive" })).toEqual([
      join("C:\\Users\\Me", "Videos", "Captures"),
      join("C:\\Users\\Me", "Pictures", "Screenshots"),
      join("C:\\Users\\Me\\OneDrive", "Pictures", "Screenshots"),
    ]);
  });

  it("picks the newest PNG in any folder, and saves its middle 16:9 at 320x180", async () => {
    const now = Date.now();
    const older = join(captures, "Minecraft 1.png");
    const newer = join(screenshots, "Screenshot 2.png");
    await writeFile(older, encodePng(gradient(64, 36)));
    await writeFile(newer, encodePng(gradient(400, 300)));
    await writeFile(join(captures, "notes.txt"), "not a picture");
    await utimes(older, new Date(now - 60_000), new Date(now - 60_000));
    await utimes(newer, new Date(now - 5000), new Date(now - 5000));
    expect((await newestScreenshot([captures, screenshots, join(dir, "missing")]))?.path).toBe(newer);
    const out = join(dir, "preview.png");
    const saved = await saveNewestScreenshot(out, [captures, screenshots], now);
    expect(saved).toEqual({ from: newer, ageMs: expect.closeTo(5000, -2) as number });
    const picture = decodePng(await readFile(out));
    expect([picture.width, picture.height]).toEqual([320, 180]);
  });

  it("says why when there's no screenshot, or only an old one", async () => {
    const empty = join(dir, "empty");
    await mkdir(empty);
    expect(await saveNewestScreenshot(join(dir, "x.png"), [empty])).toContain("there's no screenshot on this PC yet");
    expect(await saveNewestScreenshot(join(dir, "x.png"), [captures, screenshots], Date.now() + NEWEST_WITHIN_MS + 60_000)).toContain("minutes old: take one first");
  });
});
