import { describe, expect, it } from "vitest";
import { biomeSwatch, colorSwatch } from "../biome-swatches.ts";

/** A pixel's color as "#RRGGBB". */
function at(image: { width: number; data: Uint8Array }, x: number, y: number): string {
  const i = (y * image.width + x) * 4;
  return `#${[0, 1, 2].map((c) => image.data[i + c].toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

describe("the Colors tool's swatches", () => {
  it("bands a biome's foliage over its grass over its water, in a frame", () => {
    const image = biomeSwatch({ foliage: "#6A7039", grass: "#4C763C", water: "#617B64" });
    expect([image.width, image.height]).toEqual([16, 16]);
    expect([at(image, 0, 0), at(image, 15, 8), at(image, 8, 15)]).toEqual(["#1E1E22", "#1E1E22", "#1E1E22"]);
    expect([at(image, 8, 1), at(image, 8, 5), at(image, 8, 6), at(image, 8, 10), at(image, 8, 11), at(image, 8, 14)]).toEqual(["#6A7039", "#6A7039", "#4C763C", "#4C763C", "#617B64", "#617B64"]);
  });

  it("fills a color's swatch with it", () => {
    const image = colorSwatch("#44AFF5");
    expect([at(image, 1, 1), at(image, 14, 14), at(image, 0, 7)]).toEqual(["#44AFF5", "#44AFF5", "#1E1E22"]);
    expect(image.data[3]).toBe(255);
  });
});
