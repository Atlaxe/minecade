// Kits as plain data: the game's and the map's kits put together, team colors in item ids, what a
// spawn gives back, and the text and pictures the kit form shows. No Minecraft imports: the build
// uses this too, to draw each kit's picture into the game's resource pack.
import type { KitDef, KitItem, KitRefill, KitSelect, KitsConfig, MapKitsConfig } from "./config.ts";

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

/** True when a kit has items in the team's color, so its picture differs by team. */
export function teamColored(kit: KitDef): boolean {
  return kit.items.some((item) => item.item.includes(COLOR_SLOT));
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

export function matchKits(game: KitsConfig | undefined, map: MapKitsConfig | undefined): MatchKits {
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
