// Players' skin renders, which the build puts in the lobby pack (tools/skins, from what the skin
// watcher saved): main.ts hands over the build's list ("#skins"), and the screens ask here for a
// player's pictures. A player the watcher hasn't seen yet keeps their letter badge.
import { badgeFor, skinTexture, type PlayerSkin, type SkinRender } from "@minecade/minigame-core";

/** Each player's render key (their xuid), by lowercased gamertag. */
const keys = new Map<string, string>();

export function useSkins(skins: PlayerSkin[]): void {
  keys.clear();
  for (const skin of skins) keys.set(skin.name.toLowerCase(), skin.key);
}

function pictureFor(name: string, render: SkinRender): string {
  const key = keys.get(name.toLowerCase());
  return key ? skinTexture(key, render) : badgeFor(name);
}

/** The head at an angle, in color (the stats list's rows). */
export function headFor(name: string): string {
  return pictureFor(name, "head");
}

/** Head and shoulders at an angle, in color (the stats screen's portrait). */
export function portraitFor(name: string): string {
  return pictureFor(name, "portrait");
}

/** Head and shoulders at an angle, in the hologram's blue (the hologram's portrait). */
export function holoPortraitFor(name: string): string {
  return pictureFor(name, "holo");
}
