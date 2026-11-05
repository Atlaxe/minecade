// The Snapshot's pictures on the host: Minecraft's own screenshot folders (JPEGs), and the shots
// kept to use again and where each was used.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodePng, encodePng } from "../png.ts";
import { minecraftScreenshotFolders } from "../screenshot.ts";
import { keepNewestScreenshot, readShots, shotFile, shotOf, shotUses, useShot } from "../shots.ts";

// A 24x8 gray JPEG (Pillow), as Minecraft's screenshot key saves them (baseline).
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAAIABgBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKohRW3//2Q==";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "minecade-shots-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Minecraft's screenshots", () => {
  it("are in a folder per account in each profile's com.mojang", async () => {
    const appData = join(dir, "AppData");
    const shots = join(appData, "Minecraft Bedrock", "Users", "123", "games", "com.mojang", "Screenshots");
    await mkdir(join(shots, "2535450329668473"), { recursive: true });
    await mkdir(join(appData, "Minecraft Bedrock", "Users", "Shared", "games", "com.mojang"), { recursive: true });
    expect(await minecraftScreenshotFolders(appData)).toEqual([join(shots, "2535450329668473")]);
    expect(await minecraftScreenshotFolders(join(dir, "nowhere"))).toEqual([]);
  });
});

describe("the shots kept to use again", () => {
  let root: string;
  let folder: string;

  beforeAll(async () => {
    root = join(dir, "checkout");
    folder = join(dir, "screenshots");
    await mkdir(folder, { recursive: true });
  });

  it("keep the newest screenshot (a JPEG too) at 320x180, once, and refuse an old one", async () => {
    const now = Date.now();
    const jpeg = join(folder, "shot.jpeg");
    const png = join(folder, "older.png");
    await writeFile(jpeg, Buffer.from(JPEG, "base64"));
    await writeFile(png, encodePng({ width: 32, height: 18, data: new Uint8Array(32 * 18 * 4).fill(200) }));
    await utimes(png, new Date(now - 60_000), new Date(now - 60_000));
    await utimes(jpeg, new Date(now - 5000), new Date(now - 5000));
    const shot = await keepNewestScreenshot(root, "Me", [folder], now);
    if (typeof shot === "string") throw new Error(shot);
    expect(shot).toMatchObject({ from: jpeg, by: "Me", uses: [] });
    const picture = decodePng(await readFile(shotFile(root, shot.id)));
    expect([picture.width, picture.height]).toEqual([320, 180]);
    // The same screenshot again is the same shot.
    expect(await keepNewestScreenshot(root, "Me", [folder], now)).toEqual(shot);
    expect(await readShots(root)).toHaveLength(1);
    expect(await keepNewestScreenshot(root, "Me", [folder], now + 11 * 60_000)).toContain("minutes old");
  });

  it("are used as a map's or a game's picture, noting where, and told apart by their bytes", async () => {
    const [shot] = await readShots(root);
    const preview = join(dir, "preview.png");
    const use = { target: "sumo", targetName: "Sumo", map: "arena_1", mapName: "Arena", kind: "map" as const, at: 1 };
    expect(shotUses(shot)).toEqual({});
    expect(await useShot(root, shot.id, preview, use)).toBeUndefined();
    expect(existsSync(preview)).toBe(true);
    const [used] = await readShots(root);
    expect(shotUses(used)).toEqual({ map: "Arena" });
    expect(await shotOf(root, preview, [used])).toBe(shot.id);
    await writeFile(preview, encodePng({ width: 2, height: 2, data: new Uint8Array(16) }));
    expect(await shotOf(root, preview, [used])).toBeUndefined();
    // The same map again replaces its use; a game's picture reads as the game's.
    await useShot(root, shot.id, preview, { ...use, at: 2 });
    await useShot(root, shot.id, join(dir, "icon.png"), { ...use, kind: "game", at: 3 });
    const [twice] = await readShots(root);
    expect(twice.uses.map((entry) => [entry.kind, entry.at])).toEqual([["game", 3], ["map", 2]]);
    expect(shotUses(twice)).toEqual({ map: "Arena", game: "Sumo" });
    expect(await useShot(root, "s_gone", preview, use)).toBe("that picture is gone");
  });
});
