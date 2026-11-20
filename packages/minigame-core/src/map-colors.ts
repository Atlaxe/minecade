// A map's colors (map.json "colors"): its water, grass and foliage (leaves and vines), each
// "#RRGGBB", or left out for plains' own. Every map's world is plains, so its servers get them as a
// small resource pack that gives plains the map's colors (tools/maps/colors-pack.ts). The map
// editor's Colors tool sets them: all three from any biome (biome-colors.ts), one at a time from a
// biome, or typed.
import { BIOME_COLORS, type BiomeColors } from "./biome-colors.ts";

export const COLOR_PARTS = ["water", "grass", "foliage"] as const;
export type ColorPart = (typeof COLOR_PARTS)[number];
export type MapColors = Partial<Record<ColorPart, string>>;

/** Each part's name in the Colors tool. */
export const COLOR_PART_NAMES: Record<ColorPart, string> = { water: "Water", grass: "Grass", foliage: "Foliage" };

/** The biome every map's world is: a map's colors replace its own. */
export const PLAINS: BiomeColors = BIOME_COLORS.find((biome) => biome.id === "plains") ?? { id: "plains", name: "Plains", water: "#44AFF5", grass: "#92BC58", foliage: "#77AB2F" };

const COLOR = /^#[0-9A-Fa-f]{6}$/;

/** True for a color as map.json keeps one: "#" and six hex digits. */
export function isColor(value: unknown): value is string {
  return typeof value === "string" && COLOR.test(value);
}

/** A typed color as "#RRGGBB" ("#44aff5", "44AFF5", or three digits, "4af"), or undefined when it isn't one. */
export function parseColor(text: string): string | undefined {
  const digits = text.trim().replace(/^#/, "");
  if (/^[0-9A-Fa-f]{6}$/.test(digits)) return `#${digits.toUpperCase()}`;
  if (/^[0-9A-Fa-f]{3}$/.test(digits)) return `#${[...digits].map((digit) => digit + digit).join("").toUpperCase()}`;
  return undefined;
}

/** What's wrong with map.json's "colors", if anything. */
export function colorsProblems(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ['"colors" must be { "water", "grass", "foliage" }, each a "#RRGGBB" color'];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!(COLOR_PARTS as readonly string[]).includes(key)) problems.push(`"colors.${key}": a map's colors are ${COLOR_PARTS.join(", ")}`);
    else if (!isColor(value)) problems.push(`"colors.${key}" must be a color, "#" and six hex digits ("#44AFF5")`);
  }
  return problems;
}

/** The colors a map shows: its own, and plains' for the parts it leaves out. */
export function shownColors(colors: MapColors | undefined): Record<ColorPart, string> {
  const shown = { water: PLAINS.water, grass: PLAINS.grass, foliage: PLAINS.foliage };
  for (const part of COLOR_PARTS) {
    const color = colors?.[part];
    if (isColor(color)) shown[part] = color.toUpperCase();
  }
  return shown;
}

/** Colors as map.json keeps them: in upper case, only the parts unlike plains'; undefined when none are. */
export function tidyColors(colors: MapColors | undefined): MapColors | undefined {
  const shown = shownColors(colors);
  const kept: MapColors = {};
  for (const part of COLOR_PARTS) if (shown[part] !== PLAINS[part]) kept[part] = shown[part];
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Plains first (the map's own biome, which others share colors with: Deep Dark), then every biome by name. */
const SEARCH_ORDER = [PLAINS, ...BIOME_COLORS.filter((biome) => biome.id !== PLAINS.id)];

/** The biome all three of these colors are, if one's are: Plains when it's theirs, else the first by name (Swamp before Swamp Hills). */
export function biomeOfColors(colors: MapColors | undefined): BiomeColors | undefined {
  const shown = shownColors(colors);
  return SEARCH_ORDER.find((biome) => COLOR_PARTS.every((part) => biome[part] === shown[part]));
}

/** The biome a part's color is from, if any biome has it: Plains when it's plains', else the first by name. */
export function biomeOfPart(part: ColorPart, color: string): BiomeColors | undefined {
  return SEARCH_ORDER.find((biome) => biome[part] === color.toUpperCase());
}

/** Where the map editor's pack has a biome's swatch (tools/editor/biome-swatches.ts): its foliage, grass and water, top to bottom. */
export function biomeSwatchTexture(id: string): string {
  return `textures/minecade/colors/${id}`;
}

/** Where the map editor's pack has a one-color swatch, for each color a biome has. */
export function colorSwatchTexture(color: string): string {
  return `textures/minecade/colors/c_${color.slice(1).toLowerCase()}`;
}

/** A map's colors in a word or two: a biome's name ("Swamp"; "Plains" for a map without colors), or "Custom". */
export function colorsText(colors: MapColors | undefined): string {
  return biomeOfColors(colors)?.name ?? "Custom";
}
