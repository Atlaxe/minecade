import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Box } from "@minecade/minigame-core/config";
import { BOUNDS_COLOR, BUILD_LIMIT_COLOR, KILL_COLOR, SELECTION_COLOR, type HeightPlane, type OutlineBox, type Rgb } from "../behavior_pack/scripts/regions.ts";
import { PLANE_COLORS, boxSheets, chunkPieces, heightSheet, overlaySheets, planeColor, sheetHas, uniqueSheets, type Sheet } from "../behavior_pack/scripts/sheets.ts";
import { planeBlockFiles } from "../../tools/assets/plane-block.ts";

const color = (id: (typeof PLANE_COLORS)[number]["id"]) => PLANE_COLORS.findIndex((candidate) => candidate.id === id);
const rgb = (hex: number): Rgb => ({ red: (hex >> 16) / 255, green: ((hex >> 8) & 0xff) / 255, blue: (hex & 0xff) / 255 });
const blocks = (sheet: Sheet) => (sheet.max[0] - sheet.min[0] + 1) * (sheet.max[1] - sheet.min[1] + 1) * (sheet.max[2] - sheet.min[2] + 1);

describe("plane sheets", () => {
  const box: Box = { min: [0, 60, 0], max: [9, 69, 4] };

  it("put a box's sides in the blocks just outside it, each plane on the pixel next to the box", () => {
    const sheets = boxSheets(box, 3);
    expect(sheets.map(({ min, max, axis, offset }) => [min, max, axis, offset])).toEqual([
      [[-1, 60, 0], [-1, 69, 4], 0, 15],
      [[10, 60, 0], [10, 69, 4], 0, 0],
      [[0, 59, 0], [9, 59, 4], 1, 15],
      [[0, 70, 0], [9, 70, 4], 1, 0],
      [[0, 60, -1], [9, 69, -1], 2, 15],
      [[0, 60, 5], [9, 69, 5], 2, 0],
    ]);
    expect(sheets.every((sheet) => sheet.color === 3)).toBe(true);
    // No two sides share a block, and none is inside the box.
    const seen = new Set<string>();
    for (const sheet of sheets) {
      for (let x = sheet.min[0]; x <= sheet.max[0]; x++) {
        for (let y = sheet.min[1]; y <= sheet.max[1]; y++) {
          for (let z = sheet.min[2]; z <= sheet.max[2]; z++) {
            expect(seen.has(`${x},${y},${z}`)).toBe(false);
            seen.add(`${x},${y},${z}`);
            expect(sheetHas({ ...sheet, min: box.min, max: box.max }, [x, y, z])).toBe(false);
          }
        }
      }
    }
  });

  it("keep to the world's heights", () => {
    const sheets = boxSheets({ min: [0, -64, 0], max: [3, 319, 3] }, 0);
    expect(sheets).toHaveLength(4);
    expect(sheets.every((sheet) => sheet.min[1] === -64 && sheet.max[1] === 319)).toBe(true);
  });

  it("put a height across the bounds on the side where it holds", () => {
    // Kill Y and the build limit below: the blocks just under the height, the plane on their top pixel.
    expect(heightSheet(40, false, box, 0)).toEqual({ min: [0, 39, 0], max: [9, 39, 4], axis: 1, offset: 15, color: 0 });
    // The build limit above: the blocks just over it, the plane on their bottom pixel.
    expect(heightSheet(80, true, box, 0)).toEqual({ min: [0, 80, 0], max: [9, 80, 4], axis: 1, offset: 0, color: 0 });
    expect(heightSheet(-64, false, box, 0)).toBeUndefined();
  });

  it("come in a piece per chunk column, each small enough for one fill", () => {
    const sheet: Sheet = { min: [-20, 0, 5], max: [40, 0, 40], axis: 1, offset: 0, color: 0 };
    const pieces = chunkPieces(sheet);
    // x -20 to 40 crosses chunks -2 to 2, z 5 to 40 chunks 0 to 2.
    expect(pieces).toHaveLength(5 * 3);
    expect(pieces.reduce((sum, piece) => sum + blocks(piece), 0)).toBe(blocks(sheet));
    for (const piece of pieces) {
      expect(Math.floor(piece.min[0] / 16)).toBe(Math.floor(piece.max[0] / 16));
      expect(Math.floor(piece.min[2] / 16)).toBe(Math.floor(piece.max[2] / 16));
    }
    const tall = chunkPieces({ min: [0, -64, 0], max: [15, 319, 0], axis: 2, offset: 0, color: 0 });
    expect(tall).toHaveLength(1);
    expect(blocks(tall[0])).toBeLessThanOrEqual(32768);
  });

  it("take the plane color nearest each outline color", () => {
    expect(planeColor(SELECTION_COLOR)).toBe(color("yellow"));
    expect(planeColor(BOUNDS_COLOR)).toBe(color("white"));
    expect(planeColor(KILL_COLOR)).toBe(color("red"));
    expect(planeColor(BUILD_LIMIT_COLOR)).toBe(color("orange"));
    // The team colors.
    expect([0xff5555, 0x5555ff, 0x55ff55, 0xffff55, 0xff55ff, 0x55ffff, 0xaaaaaa, 0x000000].map((hex) => PLANE_COLORS[planeColor(rgb(hex))].id)).toEqual([
      "red",
      "blue",
      "lime",
      "yellow",
      "magenta",
      "light_blue",
      "light_gray",
      "black",
    ]);
    // A plane color is itself.
    PLANE_COLORS.forEach((plane, i) => expect(planeColor(rgb(plane.rgb))).toBe(i));
  });
});

describe("what a map editor sees drawn", () => {
  const bounds: OutlineBox = { key: "bounds", group: "bounds", box: { min: [0, 50, 0], max: [31, 90, 31] }, color: BOUNDS_COLOR };
  const kill: OutlineBox = { key: "regions.kill#0", group: "regions.kill", box: { min: [10, 50, 10], max: [12, 52, 12] }, color: KILL_COLOR };
  const heights: HeightPlane[] = [
    { line: "killY", y: 40, color: KILL_COLOR, group: "killY" },
    { line: "above", y: 95, color: BUILD_LIMIT_COLOR, group: "buildLimit" },
  ];
  const over = bounds.box;
  const selection: Box = { min: [1, 60, 1], max: [2, 61, 2] };
  const sees = (view: Parameters<typeof overlaySheets>[0]) => overlaySheets(view, [bounds, kill], heights, over);
  const floors = (sheets: Sheet[]) => sheets.filter((sheet) => sheet.axis === 1 && sheet.min[0] === 0 && sheet.max[0] === 31 && sheet.min[2] === 0 && sheet.max[2] === 31);
  const none = new Set<string>();

  it("holding the Kill Y tool: only the heights", () => {
    const sheets = sees({ tool: "killY", shown: none, selection });
    expect(sheets.map((sheet) => [sheet.min[1], sheet.color])).toEqual([
      [39, color("red")],
      [95, color("orange")],
    ]);
  });

  it("setting a height: only that one, where it's being set", () => {
    expect(sees({ tool: "killY", shown: new Set(["all"]), height: { line: "killY", y: 30 } }).map((sheet) => sheet.min[1])).toEqual([29]);
  });

  it("holding the Region tool: the selection first, every box and the heights", () => {
    const sheets = sees({ tool: "region", shown: none, selection });
    expect(sheets).toHaveLength(6 + 6 + 6 + 2);
    expect(sheets.slice(0, 6).every((sheet) => sheet.color === color("yellow"))).toBe(true);
    expect(floors(sheets).map((sheet) => sheet.min[1])).toEqual([49, 91, 39, 95]);
  });

  it("changing a box: it as the selection, every other boundary, not the box it was", () => {
    const sheets = sees({ shown: none, nudged: { box: selection, editing: "regions.kill#0" } });
    expect(sheets).toHaveLength(6 + 6 + 2);
    expect(sheets.some((sheet) => sheet.color === color("red") && sheet.axis !== 1)).toBe(false);
  });

  it("holding nothing: the boundaries switched on", () => {
    expect(sees({ shown: none })).toEqual([]);
    expect(sees({ shown: new Set(["killY"]) }).map((sheet) => sheet.min[1])).toEqual([39]);
    expect(sees({ shown: new Set(["all"]) })).toHaveLength(6 + 6 + 2);
  });

  it("draws a sheet two editors see once, where the first asked", () => {
    const a = sees({ tool: "killY", shown: none });
    const b = sees({ shown: new Set(["all"]) });
    const all = uniqueSheets([...a, ...b]);
    expect(all).toHaveLength(6 + 6 + 2);
    expect(all.slice(0, 2)).toEqual(a);
  });
});

describe("the plane block's files", () => {
  it("match what tools/assets/plane-block.ts writes (rerun it after changing the colors)", () => {
    for (const [path, content] of Object.entries(planeBlockFiles())) {
      const file = fileURLToPath(new URL(`../${path}`, import.meta.url));
      expect(existsSync(file), path).toBe(true);
      const disk = readFileSync(file);
      if (typeof content === "string") expect(disk.toString("utf8").replace(/\r\n/g, "\n"), path).toBe(content);
      else expect(disk.equals(content), path).toBe(true);
    }
  });

  it("has a geometry for every axis and pixel, and a texture for every color", () => {
    const block = JSON.parse(planeBlockFiles()["behavior_pack/blocks/plane.json"] as string)["minecraft:block"];
    expect(block.permutations).toHaveLength(3 * 16 + PLANE_COLORS.length);
    const geometry = JSON.parse(planeBlockFiles()["resource_pack/models/blocks/plane.geo.json"] as string)["minecraft:geometry"];
    // A floor's plane at pixel 15 is the block's top pixel; a wall across x at pixel 0 is its west pixel (x mirrored).
    const cube = (id: string) => geometry.find((entry: { description: { identifier: string } }) => entry.description.identifier === id).bones[0].cubes[0];
    expect(cube("geometry.minecade.plane_1_15").origin).toEqual([-8, 15, -8]);
    expect(cube("geometry.minecade.plane_0_0").origin).toEqual([7, 0, -8]);
    expect(cube("geometry.minecade.plane_2_15").origin).toEqual([-8, 0, 7]);
  });
});
