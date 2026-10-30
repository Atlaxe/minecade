import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY, SLIM, WIDE, modelFor, parseGeometry } from "../geometry.ts";
import { hologramLook } from "../look.ts";
import { blankImage, decodePng, encodePng, type Image } from "../png.ts";
import { renderModel } from "../render.ts";
import { renderSkinSet } from "../skin-set.ts";
import { readSkins } from "../store.ts";

/** A 64x64 classic skin with every part a different color (only what these tests look at). */
function testSkin(): Image {
  const skin = blankImage(64, 64);
  const box = (x: number, y: number, width: number, height: number, color: [number, number, number]) => {
    for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) skin.data.set([...color, 255], (row * 64 + column) * 4);
  };
  box(0, 0, 32, 16, [200, 160, 120]); // head (every side)
  box(8, 8, 8, 8, [250, 210, 170]); // the face
  box(16, 16, 24, 16, [40, 60, 220]); // body: blue
  box(40, 16, 16, 16, [230, 40, 40]); // right arm: red
  box(32, 48, 16, 16, [40, 210, 40]); // left arm: green
  box(0, 16, 16, 16, [20, 20, 60]); // right leg
  box(16, 48, 16, 16, [20, 20, 60]); // left leg
  return skin;
}

const pixel = (image: Image, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
/** Which of red, green and blue is strongest at a pixel, or "clear" where nothing is drawn. */
const strongest = (image: Image, x: number, y: number) => {
  const [r, g, b, a] = pixel(image, x, y);
  if (a < 128) return "clear";
  return r > g && r > b ? "red" : g > r && g > b ? "green" : b > r && b > g ? "blue" : "other";
};
/** The colors along a row, left to right, each listed once. */
const row = (image: Image, y: number) => [...new Set(Array.from({ length: image.width }, (_, x) => strongest(image, x, y)).filter((color) => color !== "clear"))];

describe("PNG files", () => {
  it("writes what it reads, and reads files from other encoders (every filter, RGB too)", () => {
    const image = blankImage(3, 2);
    image.data.set([1, 2, 3, 4, 250, 128, 0, 255], 0);
    expect(decodePng(encodePng(image))).toEqual(image);
    // Saved by Pillow, which filters rows: pixel (x, y) is (50x, 60y, 13xy mod 256, 255 - 10x).
    const gradient = decodePng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAAKUlEQVR42mNkYGD4b8TA8A0ZszDYMDAwMPCiYCRBKThGE1RnYGBQZwAAy7IHZZzvusUAAAAASUVORK5CYII=", "base64"));
    expect([gradient.width, gradient.height]).toEqual([5, 4]);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) expect(pixel(gradient, x, y)).toEqual([x * 50, y * 60, (x * y * 13) % 256, 255 - x * 10]);
    const rgb = decodePng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAF0lEQVR4nGPkEpFjYGBgYGBgglD7AkQAB04BYgb4MDcAAAAASUVORK5CYII=", "base64"));
    expect(pixel(rgb, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(pixel(rgb, 2, 1)).toEqual([200, 100, 50, 255]);
  });
});

describe("player models", () => {
  it("picks vanilla's wide, slim or old model for a classic skin, and a character creator skin's own", () => {
    expect(modelFor({ width: 64, height: 64, armSize: "wide", geometry: { default: "geometry.humanoid.custom" } })).toBe(WIDE);
    expect(modelFor({ width: 64, height: 64, armSize: "slim" })).toBe(SLIM);
    expect(modelFor({ width: 64, height: 64, geometry: { default: "geometry.humanoid.customSlim" } })).toBe(SLIM);
    expect(modelFor({ width: 64, height: 32 })).toBe(LEGACY);
    const own = { "minecraft:geometry": [{ description: { identifier: "geometry.persona_x", texture_width: 256, texture_height: 256 }, bones: [{ name: "head" }] }] };
    expect(modelFor({ width: 256, height: 256, persona: true, geometry: { default: "geometry.persona_x" } }, own)).toEqual({ textureWidth: 256, textureHeight: 256, bones: [{ name: "head" }] });
    expect(SLIM.bones.find((bone) => bone.name === "rightArm")?.cubes?.[0].size).toEqual([3, 12, 4]);
  });

  it("reads both geometry file formats, picking by identifier", () => {
    const old = { format_version: "1.8.0", "geometry.a": { texturewidth: 32, bones: [{ name: "a" }] }, "geometry.b:geometry.a": { bones: [{ name: "b" }] } };
    expect(parseGeometry(old, "geometry.b")).toEqual({ textureWidth: 64, textureHeight: 64, bones: [{ name: "b" }] });
    expect(parseGeometry(old).bones[0].name).toBe("a");
    expect(() => parseGeometry({})).toThrow();
  });
});

describe("rendering a model", () => {
  it("draws the front of a skin facing the viewer: the player's right arm on the left, transparent around", () => {
    const front = renderModel(WIDE, testSkin(), { width: 64, height: 128, yaw: 0, pitch: 0, framing: "full", supersample: 1 });
    expect(strongest(front, 0, 0)).toBe("clear");
    // Across the chest: right arm (red), body (blue), left arm (green).
    expect(row(front, 50)).toEqual(["red", "blue", "green"]);
    // The face is in the top part.
    expect(pixel(front, 32, 15)[3]).toBe(255);
  });

  it("turns the model so its right side shows, and frames a bust or a head", () => {
    const skin = testSkin();
    const turned = renderModel(WIDE, skin, { width: 128, height: 128, yaw: 30, pitch: 10, framing: "bust", supersample: 1 });
    // The bust is cut at the chest: arms and body reach the bottom edge.
    expect(row(turned, 127)).toEqual(expect.arrayContaining(["red", "blue"]));
    const head = renderModel(WIDE, skin, { width: 64, height: 64, framing: "head", supersample: 1 });
    const colors = new Set(Array.from({ length: 64 }, (_, y) => row(head, y)).flat());
    expect(colors.has("blue")).toBe(false);
    expect(colors.size).toBeGreaterThan(0);
  });

  it("draws per-face UV and rotated bones from a character creator style model", () => {
    const texture = blankImage(16, 16);
    for (let i = 0; i < 16 * 16; i++) texture.data.set(i % 16 < 8 ? [250, 20, 20, 255] : [20, 20, 250, 255], i * 4);
    const model = {
      textureWidth: 16,
      textureHeight: 16,
      bones: [{ name: "body", pivot: [0, 0, 0] as [number, number, number], rotation: [0, 90, 0] as [number, number, number], cubes: [{ origin: [-2, 0, -2] as [number, number, number], size: [4, 4, 4] as [number, number, number], uv: { north: { uv: [0, 0] as [number, number], uv_size: [8, 8] as [number, number] }, east: { uv: [8, 0] as [number, number], uv_size: [8, 8] as [number, number] }, west: { uv: [8, 0] as [number, number], uv_size: [8, 8] as [number, number] } } }] }],
    };
    // Turned a quarter, a side face (blue) faces the viewer instead of the front (red).
    const image = renderModel(model, texture, { width: 32, height: 32, yaw: 0, pitch: 0, supersample: 1 });
    expect(strongest(image, 16, 16)).toBe("blue");
  });
});

describe("the hologram look", () => {
  it("turns a render blue on black, with bright edges", () => {
    const render = blankImage(5, 5);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) render.data.set([200, 50, 50, 255], (y * 5 + x) * 4);
    const look = hologramLook(render);
    expect(pixel(look, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(strongest(look, 2, 2)).toBe("blue");
    expect(pixel(look, 1, 1)).toEqual([190, 240, 255, 255]);
  });
});

describe("saved skins", () => {
  it("reads the watcher's folders, skips broken ones, and renders a set for each", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skins-"));
    const skin = testSkin();
    await mkdir(join(dir, "123"));
    await writeFile(join(dir, "123", "meta.json"), JSON.stringify({ xuid: "123", name: "Steve", width: 64, height: 64, armSize: "wide", hash: "h", updatedAt: "now" }));
    await writeFile(join(dir, "123", "skin.rgba"), skin.data);
    await mkdir(join(dir, "456"));
    await writeFile(join(dir, "456", "meta.json"), JSON.stringify({ xuid: "456", name: "Broken", width: 64, height: 64 }));
    await writeFile(join(dir, "456", "skin.rgba"), Buffer.alloc(10));
    const skins = await readSkins(dir);
    expect(skins.map((stored) => stored.meta.name)).toEqual(["Steve"]);
    expect(await readSkins(join(dir, "missing"))).toEqual([]);

    const set = renderSkinSet(skins[0]);
    expect([set.holo.width, set.holo.height, set.portrait.width, set.head.width]).toEqual([128, 128, 128, 64]);
    expect(pixel(set.holo, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(set.portrait, 0, 0)[3]).toBe(0);
  });
});
