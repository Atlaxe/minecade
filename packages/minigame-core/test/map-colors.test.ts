import { describe, expect, it } from "vitest";
import {
  BIOME_COLORS,
  PLAINS,
  applyEdit,
  biomeOfColors,
  biomeOfPart,
  colorsProblems,
  colorsText,
  describeEdit,
  formatMapConfig,
  parseColor,
  shownColors,
  tidyColors,
  validateMapConfig,
  type MapConfig,
} from "../src/definitions.ts";

const swamp = BIOME_COLORS.find((biome) => biome.id === "swampland")!;

describe("biome colors", () => {
  it("has every biome once, each color as #RRGGBB", () => {
    expect(BIOME_COLORS.length).toBeGreaterThanOrEqual(89);
    expect(new Set(BIOME_COLORS.map((biome) => biome.id)).size).toBe(BIOME_COLORS.length);
    expect(new Set(BIOME_COLORS.map((biome) => biome.name)).size).toBe(BIOME_COLORS.length);
    for (const biome of BIOME_COLORS) for (const color of [biome.water, biome.grass, biome.foliage]) expect(color).toMatch(/^#[0-9A-F]{6}$/);
    // Sorted by name, for the Colors tool's lists.
    expect(BIOME_COLORS.map((biome) => biome.name)).toEqual([...BIOME_COLORS.map((biome) => biome.name)].sort((a, b) => a.localeCompare(b)));
  });

  it("has vanilla's plains water, and the biomes the client colors by name", () => {
    expect(PLAINS.water).toBe("#44AFF5");
    expect(BIOME_COLORS.find((biome) => biome.id === "mesa")).toMatchObject({ name: "Badlands", grass: "#90814D", foliage: "#AEA42A" });
    expect(BIOME_COLORS.find((biome) => biome.id === "cherry_grove")).toMatchObject({ name: "Cherry Grove", water: "#5DB7EF", grass: "#B6DB61" });
  });
});

describe("a map's colors", () => {
  it("reads typed colors", () => {
    expect(parseColor("#44aff5")).toBe("#44AFF5");
    expect(parseColor(" 44AFF5 ")).toBe("#44AFF5");
    expect(parseColor("#4af")).toBe("#44AAFF");
    for (const text of ["", "#44AFF", "blue", "#GGGGGG", "#44AFF55"]) expect(parseColor(text)).toBeUndefined();
  });

  it("checks map.json's colors", () => {
    expect(colorsProblems({ water: "#44AFF5", grass: "#abcdef" })).toEqual([]);
    expect(colorsProblems("blue")).toHaveLength(1);
    expect(colorsProblems({ water: "blue", sky: "#000000" })).toHaveLength(2);
    const problems = validateMapConfig({ name: "M", spawns: [[0, 64, 0]], colors: { grass: "green" } }, { kind: "lobby" });
    expect(problems.some((problem) => problem.includes('"colors.grass"'))).toBe(true);
  });

  it("keeps only the parts unlike plains', in upper case", () => {
    expect(tidyColors({ water: "#617b64", grass: PLAINS.grass })).toEqual({ water: "#617B64" });
    expect(tidyColors({ water: PLAINS.water })).toBeUndefined();
    expect(tidyColors(undefined)).toBeUndefined();
    expect(shownColors({ water: "#617B64" })).toEqual({ water: "#617B64", grass: PLAINS.grass, foliage: PLAINS.foliage });
  });

  it("names the biome whose colors they are, else Custom", () => {
    expect(colorsText(undefined)).toBe("Plains");
    expect(colorsText(tidyColors(swamp))).toBe("Swamp");
    expect(colorsText({ water: "#123456" })).toBe("Custom");
    expect(biomeOfColors({ water: swamp.water, grass: swamp.grass, foliage: swamp.foliage })?.id).toBe("swampland");
    expect(biomeOfPart("water", "#44aff5")?.water).toBe("#44AFF5");
  });

  it("is set and removed by an edit, which leaves out parts like plains' and goes after the time", () => {
    const map: MapConfig = { name: "M", spawns: [], time: "noon", stars: true };
    const set = applyEdit(map, { op: "colors", colors: { water: swamp.water, grass: PLAINS.grass, foliage: swamp.foliage } });
    expect(set.colors).toEqual({ water: swamp.water, foliage: swamp.foliage });
    expect(Object.keys(set)).toEqual(["name", "spawns", "time", "colors", "stars"]);
    expect(formatMapConfig(set)).toContain(`"colors": { "water": "${swamp.water}", "foliage": "${swamp.foliage}" }`);
    expect(describeEdit({ op: "colors", colors: { water: swamp.water } })).toBe("set colors");
    expect(applyEdit(set, { op: "colors" }).colors).toBeUndefined();
    expect(applyEdit(set, { op: "colors", colors: { water: PLAINS.water } }).colors).toBeUndefined();
    expect(describeEdit({ op: "colors" })).toBe("clear colors");
    expect(() => applyEdit(map, { op: "colors", colors: { water: "blue" } })).toThrow(/colors\.water/);
  });
});
