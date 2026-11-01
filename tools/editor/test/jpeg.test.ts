import { describe, expect, it } from "vitest";
import { decodeJpeg } from "../jpeg.ts";
import type { Picture } from "../png.ts";

// Pillow (libjpeg-turbo) at quality 90, 4:2:0 sampling, optimized Huffman tables: 40x24 in 16x16 tiles (the last
// column and row cut short), red, green and blue over yellow, white and near-black.
const TILES =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAYACgDASIAAhEBAxEB/8QAGAABAQADAAAAAAAAAAAAAAAAAAcICQr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAGAEAAwEBAAAAAAAAAAAAAAAABwgJAAL/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCBABkeNTQHSQiTgKJim2cAInmdZKgHoCdzNAMz/9k=";
// Pillow again, gray: 24x8 in three 8-wide stripes, 0, 100 and 230.
const GRAY =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAAIABgBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKohRW3//2Q==";
// Made by hand, and Windows' and Pillow's decoders agree on it: 48x16, 4:2:2 sampling, each 16x8 MCU one flat color,
// a restart marker after every second MCU.
const RESTARTS =
  "/9j/2wBDAAgBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAAQADADASEAAhEAAxEA/8QAMQAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoLEAEAAAAAAAAAAAAAAAAAAAAA/90ABAAC/9oADAMBAAIAAwAAPwDkAwnqrdBXzi//0OMD0tivdQ+XXdv/0QAOBDqmi//Z";

function pixel(picture: Picture, x: number, y: number): number[] {
  return [...picture.data.subarray((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 4)];
}

/** Each channel within 5 of this color's, and alpha 255. */
function near(red: number, green: number, blue: number): unknown[] {
  return [...[red, green, blue].map((c) => expect.closeTo(c, -1)), 255];
}

/** A JPEG that stops after its image header: `marker` says what kind it is. */
function header(marker: number, precision = 8, components = 3): Uint8Array {
  const parts = Array.from({ length: components }, (_, i) => [i + 1, 0x11, 0]).flat();
  return new Uint8Array([0xff, 0xd8, 0xff, marker, 0, 8 + parts.length, precision, 0, 16, 0, 16, components, ...parts]);
}

describe("JPEG", () => {
  it("reads a 4:2:0 JPEG another encoder wrote, at the size it says", () => {
    const tiles = decodeJpeg(Buffer.from(TILES, "base64"));
    expect([tiles.width, tiles.height, tiles.data.length]).toEqual([40, 24, 40 * 24 * 4]);
    expect(pixel(tiles, 8, 8)).toEqual(near(200, 30, 30));
    expect(pixel(tiles, 24, 8)).toEqual(near(30, 160, 60));
    expect(pixel(tiles, 36, 8)).toEqual(near(40, 70, 210));
    expect(pixel(tiles, 8, 20)).toEqual(near(240, 200, 40));
    expect(pixel(tiles, 24, 20)).toEqual(near(250, 250, 250));
    expect(pixel(tiles, 36, 20)).toEqual(near(20, 20, 20));
    expect(pixel(tiles, 39, 23)).toEqual(near(20, 20, 20));
  });

  it("reads a gray JPEG", () => {
    const gray = decodeJpeg(Buffer.from(GRAY, "base64"));
    expect([gray.width, gray.height]).toEqual([24, 8]);
    expect(pixel(gray, 4, 4)).toEqual(near(0, 0, 0));
    expect(pixel(gray, 12, 4)).toEqual(near(100, 100, 100));
    expect(pixel(gray, 20, 4)).toEqual(near(230, 230, 230));
  });

  it("starts over at each restart marker", () => {
    const blocks = decodeJpeg(Buffer.from(RESTARTS, "base64"));
    expect([blocks.width, blocks.height]).toEqual([48, 16]);
    expect(pixel(blocks, 8, 4)).toEqual(near(200, 30, 30));
    expect(pixel(blocks, 24, 4)).toEqual(near(30, 160, 60));
    expect(pixel(blocks, 40, 4)).toEqual(near(40, 70, 210));
    expect(pixel(blocks, 8, 12)).toEqual(near(240, 200, 40));
    expect(pixel(blocks, 24, 12)).toEqual(near(128, 128, 128));
    expect(pixel(blocks, 40, 12)).toEqual(near(90, 40, 140));
  });

  it("refuses what isn't an 8-bit baseline JPEG, or is cut short", () => {
    expect(() => decodeJpeg(Buffer.from("not a jpeg"))).toThrow("not a JPEG file");
    expect(() => decodeJpeg(header(0xc2))).toThrow("this JPEG is progressive: only baseline screenshots are read");
    expect(() => decodeJpeg(header(0xc9))).toThrow("this JPEG is arithmetic coded");
    expect(() => decodeJpeg(header(0xc0, 12))).toThrow("this JPEG is 12-bit");
    expect(() => decodeJpeg(header(0xc0, 8, 4))).toThrow("this JPEG has 4 color components");
    expect(() => decodeJpeg(header(0xc0))).toThrow("the JPEG has no image data");
    const tiles = Buffer.from(TILES, "base64");
    expect(() => decodeJpeg(tiles.subarray(0, tiles.length - 20))).toThrow("the JPEG's image data is cut short");
  });
});
