// A map's colors (map.json "colors", minigame-core map-colors.ts) as a resource pack its server
// loads: plains' client biome, as vanilla has it (PLAINS_CLIENT_BIOME), with the map's water, grass
// and foliage colors. Every map's world is plains, so the whole map takes them. The pack goes in a
// colors_pack\ folder beside the map's world wherever a server gets the map: its published version
// (store.ts), Edit's staged copy (tools/editor/session.ts) and a preview's template
// (tools/editor/preview-template.ts). The entrypoint (docker/bds/entrypoint.sh) adds it to the
// world's resource packs when it's there. Its ids come from what it holds, so each set of colors is
// a pack of its own, which a player's game downloads once and keeps.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COLOR_PARTS, PLAINS_CLIENT_BIOME, tidyColors, type ColorPart, type MapColors } from "@minecade/minigame-core/config";

/** The pack's folder, beside the map's world. */
export const COLORS_PACK = "colors_pack";
/** Where the pack's client biome goes in it. */
export const COLORS_BIOME_FILE = "biomes/plains.client_biome.json";

/** The client biome component each part of a map's colors goes in, and what it holds. */
const COMPONENTS: Record<ColorPart, (color: string) => [component: string, value: object]> = {
  water: (color) => ["minecraft:water_appearance", { surface_color: color }],
  grass: (color) => ["minecraft:grass_appearance", { color }],
  foliage: (color) => ["minecraft:foliage_appearance", { color }],
};

/** The pack's files (by path in it, as JSON text) for these colors, or undefined when they're plains' own. */
export function colorsPackFiles(colors: MapColors | undefined): Record<string, string> | undefined {
  const tidy = tidyColors(colors);
  if (!tidy) return undefined;
  const components: Record<string, unknown> = { ...PLAINS_CLIENT_BIOME.components };
  for (const part of COLOR_PARTS) {
    const color = tidy[part];
    if (!color) continue;
    const [component, value] = COMPONENTS[part](color);
    components[component] = value;
  }
  const biome = JSON.stringify(
    { format_version: PLAINS_CLIENT_BIOME.formatVersion, "minecraft:client_biome": { description: { identifier: "minecraft:plains" }, components } },
    null,
    2,
  );
  const hash = createHash("sha256").update(biome).digest("hex");
  const described = COLOR_PARTS.filter((part) => tidy[part]).map((part) => `${part} ${tidy[part]}`).join(", ");
  const manifest = {
    format_version: 2,
    header: {
      name: "Minecade map colors",
      description: `This map's ${described}`,
      uuid: uuidFrom(hash, "header"),
      version: [1, 0, 0],
      min_engine_version: [1, 26, 60],
    },
    modules: [{ type: "resources", uuid: uuidFrom(hash, "resources"), version: [1, 0, 0] }],
  };
  return { "manifest.json": JSON.stringify(manifest, null, 2), [COLORS_BIOME_FILE]: biome };
}

/**
 * Writes the pack for `colors` into `folder`\colors_pack\, or removes it for a map without colors.
 * Files already holding the same text are left alone. Synchronous, like the store's export.
 */
export function writeColorsPack(folder: string, colors: MapColors | undefined): void {
  const out = join(folder, COLORS_PACK);
  const files = colorsPackFiles(colors);
  if (!files) {
    rmSync(out, { recursive: true, force: true });
    return;
  }
  if (existsSync(out)) {
    // A pack for other colors: start over, so nothing of it stays.
    const same = Object.entries(files).every(([path, text]) => existsSync(join(out, path)) && readFileSync(join(out, path), "utf8") === text);
    if (same) return;
    rmSync(out, { recursive: true, force: true });
  }
  for (const [path, text] of Object.entries(files)) {
    const file = join(out, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(`${file}.new`, text);
    renameSync(`${file}.new`, file);
  }
}

/** A UUID made from a hash and what it's for, so the same colors always give the same pack. */
function uuidFrom(hash: string, purpose: string): string {
  const h = createHash("sha256").update(`${purpose}:${hash}`).digest("hex");
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
