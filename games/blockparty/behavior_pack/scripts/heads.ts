// The 2D heads on the player cards and the results (docs/plans/block-party-ui.md, "Player heads"):
// a player's own face, which the build renders from the skin the network's watcher saved
// (game.config.ts playerFaces, at skinTexture(key, "face"); whose faces there are comes as
// "#skins"); Steve's face for a bot (the private faces pack, made by the workshop's dialogue tool
// from the game's own Steve); and none for a player the watcher hasn't seen yet, whose card keeps
// their letter until the next build after they've been in the lobby.
import { skinTexture, type PlayerSkin } from "@minecade/minigame-core";

/** The bots' head: Steve's face, in the private faces pack (private_packs/faces). */
export const BOT_HEAD = "textures/blockparty/faces/steve";

export class Heads {
  private readonly faces = new Map<string, string>();

  constructor(skins: readonly PlayerSkin[]) {
    for (const skin of skins) this.faces.set(skin.name.toLowerCase(), skinTexture(skin.key, "face"));
  }

  /** A seat's head picture: a player's face, Steve's for a bot, else none (the card shows the letter). */
  of(name: string, bot: boolean): string | undefined {
    return bot ? BOT_HEAD : this.faces.get(name.toLowerCase());
  }
}
