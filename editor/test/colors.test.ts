import { describe, expect, it } from "vitest";
import { BIOME_COLORS, biomeSwatchTexture, colorSwatchTexture, shownColors, stripColors, type MapConfig } from "@minecade/minigame-core/config";
import { MARK, saveBarText } from "../behavior_pack/scripts/marks.ts";
import { colorsScreenEntries, colorsSettings, mapMenuEntries } from "../behavior_pack/scripts/menu.ts";

const swamp = BIOME_COLORS.find((biome) => biome.id === "swampland")!;
const plains = shownColors(undefined);

describe("the Colors tool's menus", () => {
  it("shows the map's colors in its settings: a biome's name, Custom, or Plains for a map without", () => {
    const map: MapConfig = { name: "M", spawns: [], colors: { water: swamp.water, grass: swamp.grass, foliage: swamp.foliage } };
    expect(colorsSettings(map).map((entry) => stripColors(entry.text))).toEqual(["Water, grass and foliage", "Colors\nSwamp"]);
    expect(stripColors(colorsSettings({ name: "M", spawns: [] })[1].text)).toBe("Colors\nPlains");
    expect(stripColors(colorsSettings({ name: "M", spawns: [], colors: { water: "#123456" } })[1].text)).toBe("Colors\nCustom");
  });

  it("lists the Biome, Water, Grass and Foliage rows closed, then Type colors and Set colors", () => {
    const entries = colorsScreenEntries({ colors: plains, picked: {}, set: false });
    expect(entries.map((entry) => entry.action.kind)).toEqual(["open", "open", "open", "open", "type", "save"]);
    expect(entries.slice(0, 4).map((entry) => stripColors(entry.text))).toEqual(["Biome: Plains", `Water: ${plains.water}`, `Grass: ${plains.grass}`, `Foliage: ${plains.foliage}`]);
    expect(entries.at(-1)!.text).toBe(saveBarText("Set colors"));
  });

  it("opens the Biome list with every biome and its swatch, the picked one outlined", () => {
    const entries = colorsScreenEntries({ colors: { ...swamp }, picked: { biome: "swampland_mutated" }, open: "biome", set: true });
    const options = entries.filter((entry) => entry.action.kind === "biome");
    expect(options).toHaveLength(BIOME_COLORS.length);
    expect(options.every((entry) => entry.text.includes(MARK.card) && entry.text.includes(MARK.lead))).toBe(true);
    expect(options.map((entry) => entry.icon)).toEqual(BIOME_COLORS.map((biome) => biomeSwatchTexture(biome.id)));
    // Swamp and Swamp Hills have the same colors: the one picked is the one outlined.
    const outlined = options.filter((entry) => entry.text.includes(MARK.picked));
    expect(outlined.map((entry) => stripColors(entry.text))).toEqual(["Swamp Hills"]);
    expect(stripColors(entries[0].text)).toBe("Biome: Swamp Hills");
    // The map has colors: Remove colors, in red, before Set colors.
    expect(entries.at(-2)!.action.kind).toBe("remove");
  });

  it("opens a part's list with each biome's color for it, outlining the first biome with the color when none was picked", () => {
    const entries = colorsScreenEntries({ colors: { ...plains, water: swamp.water }, picked: {}, open: "water", set: true });
    const options = entries.filter((entry) => entry.action.kind === "part");
    expect(options).toHaveLength(BIOME_COLORS.length);
    expect(options.every((entry) => entry.action.kind === "part" && entry.action.part === "water")).toBe(true);
    expect(options[0].icon).toBe(colorSwatchTexture(BIOME_COLORS[0].water));
    expect(options.filter((entry) => entry.text.includes(MARK.picked)).map((entry) => stripColors(entry.text))).toEqual(["Swamp"]);
    // Water from one biome and plains' grass and foliage: no one biome's.
    expect(stripColors(entries.find((entry) => entry.action.kind === "open" && entry.action.list === "biome")!.text)).toBe("Biome: Custom");
  });

  it("puts the Colors row in the map menu while the tool is out", () => {
    const entries = mapMenuEntries({
      config: { name: "M", spawns: [] },
      checklist: { rows: [], problems: [], warnings: [], ready: false },
      tool: "colors",
      unsaved: false,
      saving: false,
      spawn: { lists: [], settings: { list: "spawns", center: true, keepFacing: false, snap: "exact" } },
      region: { entries: [] },
    });
    expect(entries.some((entry) => entry.action.kind === "colors")).toBe(true);
  });
});
