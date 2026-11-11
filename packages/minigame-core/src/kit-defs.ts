// Kits as plain data: the game's and the map's kits put together, team colors in item ids, what a
// spawn gives back, and the text and pictures the kit form shows. No Minecraft imports: the build
// uses this too, to draw each kit's picture into the game's resource pack.
import type { GameConfig, KitDef, KitItem, KitRefill, KitSelect, KitsConfig, MapKitsConfig } from "./config.ts";

/** Stands for the player's team color in a kit item's id: "minecraft:{color}_wool". */
export const COLOR_SLOT = "{color}";
/** Seconds players have to pick a kit, unless the game says otherwise. */
export const DEFAULT_PICK_SECONDS = 30;

/** Dye names for the § color codes teams use (white without a team, or for a color with no dye). */
const DYE_NAMES: Record<string, string> = {
  "§0": "black",
  "§1": "blue",
  "§2": "green",
  "§3": "cyan",
  "§4": "red",
  "§5": "purple",
  "§6": "orange",
  "§7": "light_gray",
  "§8": "gray",
  "§9": "blue",
  "§a": "lime",
  "§b": "light_blue",
  "§c": "red",
  "§d": "magenta",
  "§e": "yellow",
  "§f": "white",
};

export function dyeName(teamColor?: string): string {
  return (teamColor && DYE_NAMES[teamColor]) || "white";
}

/** The item a kit entry gives a player of this team color. */
export function kitItemId(item: KitItem, teamColor?: string): string {
  return item.item.replaceAll(COLOR_SLOT, dyeName(teamColor));
}

/** A color as leather armor takes it, each channel 0 to 1. */
export type DyeColor = { red: number; green: number; blue: number };

/** The color each of the 16 dyes gives leather (Minecraft's own, 0xRRGGBB), in Minecraft's dye order. */
export const LEATHER_DYES: Record<string, number> = {
  white: 0xf9fffe,
  orange: 0xf9801d,
  magenta: 0xc74ebd,
  light_blue: 0x3ab3da,
  yellow: 0xfed83d,
  lime: 0x80c71f,
  pink: 0xf38baa,
  gray: 0x474f52,
  light_gray: 0x9d9d97,
  cyan: 0x169c9c,
  purple: 0x8932b8,
  blue: 0x3c44aa,
  brown: 0x835432,
  green: 0x5e7c16,
  red: 0xb02e26,
  black: 0x1d1d21,
};

/** A dye's leather color (white's for a name that isn't a dye). */
export function leatherColor(dye: string): DyeColor {
  const rgb = LEATHER_DYES[dye] ?? LEATHER_DYES.white;
  return { red: (rgb >> 16) / 255, green: ((rgb >> 8) & 0xff) / 255, blue: (rgb & 0xff) / 255 };
}

/** The color a team's leather armor takes (teamArmor): its dye's, by the team's § color code. */
export function teamArmorColor(teamColor: string): DyeColor {
  return leatherColor(dyeName(teamColor));
}

/** The four leather pieces. */
export const LEATHER_PIECES = ["helmet", "chestplate", "leggings", "boots"] as const;
export type LeatherPiece = (typeof LEATHER_PIECES)[number];

/**
 * A leather piece in a dye, from the shared armor pack (packs/armor): minecade:red_leather_helmet.
 * Bedrock's scripts can't dye vanilla leather, so team armor is these items instead.
 */
export function dyedLeather(piece: LeatherPiece, dye: string): string {
  return `minecade:${dye}_leather_${piece}`;
}

/** Which leather piece in which dye an item id is (the armor pack's); undefined for anything else. */
export function parseDyedLeather(itemId: string): { piece: LeatherPiece; dye: string } | undefined {
  const match = /^minecade:(\w+)_leather_(helmet|chestplate|leggings|boots)$/.exec(itemId);
  return match && match[1] in LEATHER_DYES ? { piece: match[2] as LeatherPiece, dye: match[1] } : undefined;
}

/** The armor a kit gives a team player: vanilla leather becomes the armor pack's in the team's dye (teamArmor). */
export function teamArmorItem(itemId: string, teamColor?: string): string {
  const leather = /^minecraft:leather_(helmet|chestplate|leggings|boots)$/.exec(itemId);
  return leather && teamColor ? dyedLeather(leather[1] as LeatherPiece, dyeName(teamColor)) : itemId;
}

/**
 * Colors mixed the way Minecraft dyes leather: the average of each channel, scaled back up so the
 * mix is as bright as its colors were on average. Red and yellow make orange, red and blue purple.
 */
export function mixDyes(colors: readonly DyeColor[]): DyeColor {
  if (colors.length === 0) return { red: 1, green: 1, blue: 1 };
  const average = (pick: (color: DyeColor) => number) => colors.reduce((sum, color) => sum + pick(color), 0) / colors.length;
  const [red, green, blue] = [average((color) => color.red), average((color) => color.green), average((color) => color.blue)];
  const brightest = Math.max(red, green, blue);
  if (brightest === 0) return { red: 0, green: 0, blue: 0 };
  const scale = average((color) => Math.max(color.red, color.green, color.blue)) / brightest;
  return { red: red * scale, green: green * scale, blue: blue * scale };
}

/** The armor a kit puts on, in the order the kit form's picture shows it (not the off hand). */
export const ARMOR_PIECES = ["head", "chest", "legs", "feet"] as const;

/** Leather armor, which takes a dye. */
export function isLeather(itemId: string): boolean {
  return /^minecraft:leather_(helmet|chestplate|leggings|boots)$/.test(itemId);
}

/** True when a kit has items in the team's color, or leather armor it dyes, so its picture differs by team. */
export function teamColored(kit: KitDef): boolean {
  if (kit.items.some((item) => item.item.includes(COLOR_SLOT))) return true;
  return kit.teamArmor === true && ARMOR_PIECES.some((piece) => isLeather(kit.armor?.[piece] ?? ""));
}

/** The kits a match on one map uses: the game's, with the map's added or in their place. */
export interface MatchKits {
  base?: KitDef;
  list: KitDef[];
  select?: KitSelect;
  pickSeconds: number;
  /** The ids of the kits that came from the map (their pictures are filed under the map). */
  fromMap: Set<string>;
}

export function matchKits(game: KitsConfig | undefined, ownKits: MapKitsConfig | undefined): MatchKits {
  // A game whose kits are the same on every map never takes a map's.
  const map = game?.mapKits === false ? undefined : ownKits;
  const fromMap = new Set<string>();
  const mapList = map?.list ?? [];
  for (const kit of mapList) fromMap.add(kit.id);
  const base = map?.base ?? game?.base;
  if (map?.base) fromMap.add(map.base.id);
  const gameList = game?.list ?? [];
  // A map's kit replaces the game's kit with the same id, in its place.
  const list = map?.mode === "replace" ? [...mapList] : [...gameList.map((kit) => mapList.find((own) => own.id === kit.id) ?? kit), ...mapList.filter((own) => !gameList.some((kit) => kit.id === own.id))];
  return { base, list, select: game?.select, pickSeconds: game?.pickSeconds ?? DEFAULT_PICK_SECONDS, fromMap };
}

export type KitSpawn = "start" | "round" | "respawn" | "join";

/**
 * What a spawn gives of a kit: all of it ("full"), or only what the player had left when they went
 * down ("kept"; a player with nothing kept, such as a late joiner, gets all of it).
 */
export function refillOnSpawn(refill: KitRefill | undefined, why: KitSpawn): "full" | "kept" {
  switch (refill ?? "life") {
    case "life":
      return "full";
    case "round":
      return why === "start" || why === "round" ? "full" : "kept";
    case "match":
      return why === "start" ? "full" : "kept";
  }
}

/** An item's name for the kit form: its own name, else from its id ("minecraft:wooden_sword" is "Wooden Sword"). */
export function itemLabel(item: KitItem, teamColor?: string): string {
  if (item.name) return item.name;
  const id = (teamColor === undefined ? item.item.replaceAll(`${COLOR_SLOT}_`, "") : kitItemId(item, teamColor)).replace(/^[a-z0-9_]+:/, "");
  return id
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * What the map editor's mannequins can hold, once each, with its name: every item in the game's
 * kits, then its mannequinItems (what it hands out from its own code, such as Gunfight's guns).
 */
export function holdItems(config: Pick<GameConfig, "kits" | "mannequinItems">): { item: string; label: string }[] {
  const items = new Map<string, string>();
  const add = (entry: KitItem) => {
    if (!items.has(entry.item)) items.set(entry.item, itemLabel(entry));
  };
  for (const kit of [config.kits?.base, ...(config.kits?.list ?? [])]) for (const entry of kit?.items ?? []) add(entry);
  for (const entry of config.mannequinItems ?? []) add(typeof entry === "string" ? { item: entry } : entry);
  return [...items].map(([item, label]) => ({ item, label }));
}

/** A kit's items as the kit form lists them: "Wooden Sword", "64x Red Wool". */
export function kitLines(kit: KitDef, teamColor?: string): string[] {
  return kit.items.map((item) => ((item.count ?? 1) > 1 ? `${item.count}x ${itemLabel(item, teamColor)}` : itemLabel(item, teamColor)));
}

/** The folder of kit pictures in a game's resource pack. */
export const KIT_PICTURES = "textures/minecade/kits";

/**
 * Where a kit's picture is in the game's resource pack (without ".png"): `<kit>`, `<kit>_<dye>` for
 * a kit in team colors, under `<map>/` for a map's own kit.
 */
export function kitPicturePath(kitId: string, options: { map?: string; teamColor?: string; colored?: boolean } = {}): string {
  const folder = options.map === undefined ? KIT_PICTURES : `${KIT_PICTURES}/${options.map}`;
  return `${folder}/${kitId}${options.colored ? `_${dyeName(options.teamColor)}` : ""}`;
}

/** Every dye a kit picture in team colors is drawn in: one per team color the game can have, else white. */
export function pictureDyes(teamColors: string[]): string[] {
  return teamColors.length === 0 ? ["white"] : [...new Set(teamColors.map((color) => dyeName(color)))];
}
