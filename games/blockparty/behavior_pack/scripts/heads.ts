// The pictures on the player cards and the results (docs/plans/block-party-ui.md, "Player heads"):
// a player's own portrait, head and shoulders in color, which the build renders from the skin the
// network's watcher saved (game.config.ts playerPortraits, at skinTexture(key, "portrait"); whose
// portraits there are comes as "#skins"); Steve's for a bot, which the build renders from
// Minecraft's own Steve; and none for a player the watcher hasn't seen yet, whose card keeps their
// letter until the next build after they've been in the lobby.
import { STEVE_SKIN, skinTexture, type PlayerSkin } from "@minecade/minigame-core";

/** The bots' picture: Steve's portrait. */
export const BOT_HEAD = skinTexture(STEVE_SKIN, "portrait");

export class Heads {
  private readonly portraits = new Map<string, string>();

  constructor(skins: readonly PlayerSkin[]) {
    for (const skin of skins) this.portraits.set(skin.name.toLowerCase(), skinTexture(skin.key, "portrait"));
  }

  /** A seat's picture: a player's portrait, Steve's for a bot, else none (the card shows the letter). */
  of(name: string, bot: boolean): string | undefined {
    return bot ? BOT_HEAD : this.portraits.get(name.toLowerCase());
  }
}
