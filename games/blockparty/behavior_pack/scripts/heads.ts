// The pictures on the player cards and the results (docs/plans/block-party-ui.md, "Player heads"):
// a player's own portrait, head and shoulders in color, which the build renders from the skin the
// network's watcher saved (game.config.ts playerPortraits, at skinTexture(key, "portrait"); whose
// portraits there are comes as "#skins"); a bot's skin's (bot-skins.ts), which the build renders
// from Minecraft's own Steve and Alex and the private skins pack (tools/blockparty/bot-portraits.ts);
// and none for a player the watcher hasn't seen yet, whose card keeps their letter until the next
// build after they've been in the lobby.
import { STEVE_SKIN, skinTexture, type PlayerSkin } from "@minecade/minigame-core";
import type { BotSkin } from "./bot-skins.ts";

/** A bot's picture: its skin's portrait (Steve's is STEVE_SKIN's). */
export function botHead(skin: BotSkin | undefined): string {
  return skinTexture(skin?.id ?? STEVE_SKIN, "portrait");
}

export class Heads {
  private readonly portraits = new Map<string, string>();

  constructor(skins: readonly PlayerSkin[]) {
    for (const skin of skins) this.portraits.set(skin.name.toLowerCase(), skinTexture(skin.key, "portrait"));
  }

  /** A seat's picture: a bot's skin's portrait (`bot` its skin, or true for Steve's), a player's own, else none (the card shows the letter). */
  of(name: string, bot: BotSkin | boolean): string | undefined {
    if (bot) return botHead(bot === true ? undefined : bot);
    return this.portraits.get(name.toLowerCase());
  }
}
