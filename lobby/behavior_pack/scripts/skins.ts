// Players' skin renders, which the build puts in the lobby pack (tools/skins, from what the skin
// watcher saved), in the hologram's look: main.ts hands over the build's list ("#skins"), and the
// screens ask here for a player's pictures. A player the watcher hasn't seen yet keeps their
// letter badge.
import { badgeFor, skinTexture, type PlayerSkin, type SkinRender } from "@minecade/minigame-core";

/** Each player's render key (their xuid), by lowercased gamertag. */
const keys = new Map<string, string>();

export function useSkins(skins: PlayerSkin[]): void {
  keys.clear();
  for (const skin of skins) keys.set(skin.name.toLowerCase(), skin.key);
}

/** Whether the lobby pack has renders of a player's skin (otherwise they get their letter badge). */
export function hasSkin(name: string): boolean {
  return keys.has(name.toLowerCase());
}

function pictureFor(name: string, render: SkinRender): string {
  const key = keys.get(name.toLowerCase());
  return key ? skinTexture(key, render) : badgeFor(name);
}

/** The head at an angle (the stats list's rows). */
export function headFor(name: string): string {
  return pictureFor(name, "holo_head");
}

/** Head and shoulders at an angle (the stats screen's portrait, and the hologram's). */
export function portraitFor(name: string): string {
  return pictureFor(name, "holo");
}

/** Whether a player is the skin watcher (`watcher` is WATCHER_GAMERTAG; empty when there's none). */
export function isWatcher(name: string, watcher: string): boolean {
  return watcher !== "" && name.toLowerCase() === watcher.toLowerCase();
}
