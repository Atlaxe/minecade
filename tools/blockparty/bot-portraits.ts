// The portraits of the skins Block Party's bots wear (games/blockparty/behavior_pack/scripts/
// bot-skins.ts), for the player cards and the results (heads.ts, botHead): each skin's head and
// shoulders in color at skinTexture(id, "portrait"), the way the build draws the players'. Steve's
// and Alex's come from Minecraft's own textures (the cache tools/build/vanilla-textures.ts keeps), the
// rest from the private skins pack (games/blockparty/private_packs/skins, made by the workshop's
// bot-skins project). They're Mojang's art, so like every skin render they're never in git. A skin
// whose texture isn't here gets no portrait; a bot doesn't wear it either (the scripts leave out a
// private pack's skins when the build hasn't the pack).
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { skinTexture } from "@minecade/minigame-core/config";
import { BOT_SKINS, botSkinTexture, type BotSkin } from "../../games/blockparty/behavior_pack/scripts/bot-skins.ts";
import { encodePng, type Image } from "../skins/png.ts";
import { classicPortrait, slimPortrait } from "../skins/skin-set.ts";
import { decodeAnyPng } from "../viewer/png.ts";
import type { VanillaTextures } from "../build/vanilla-textures.ts";

/** A skin's texture: Minecraft's own, or its private pack's file in `gameDir`; undefined when it isn't here. */
export function botSkinImage(skin: BotSkin, gameDir: string, vanilla: VanillaTextures | undefined): Image | undefined {
  const path = botSkinTexture(skin);
  if (!skin.pack) return vanilla?.picture(path);
  const file = join(gameDir, "private_packs", skin.pack, "resource_pack", `${path}.png`);
  return existsSync(file) ? decodeAnyPng(new Uint8Array(readFileSync(file))) : undefined;
}

/** Every bot skin's portrait whose texture is here, by its file in the pack; the ids of those that aren't. */
export function botPortraits(gameDir: string, vanilla: VanillaTextures | undefined): { files: Map<string, Buffer>; missing: string[] } {
  const files = new Map<string, Buffer>();
  const missing: string[] = [];
  for (const skin of BOT_SKINS) {
    const image = botSkinImage(skin, gameDir, vanilla);
    if (!image) {
      missing.push(skin.id);
      continue;
    }
    files.set(`${skinTexture(skin.id, "portrait")}.png`, encodePng(skin.slim ? slimPortrait(image) : classicPortrait(image)));
  }
  return { files, missing };
}

/** The bot skins' portraits into Block Party's resource pack (out of git, like every render). */
export async function addBotPortraits(pack: string, gameDir: string, vanilla: VanillaTextures | undefined): Promise<void> {
  const { files, missing } = botPortraits(gameDir, vanilla);
  for (const [path, png] of files) {
    await mkdir(dirname(join(pack, path)), { recursive: true });
    await writeFile(join(pack, path), png);
  }
  if (missing.length > 0) {
    const packs = [...new Set(BOT_SKINS.filter((skin) => missing.includes(skin.id)).map((skin) => (skin.pack ? `the private ${skin.pack} pack` : "Minecraft's textures")))];
    console.warn(`blockparty: no portrait for ${missing.length} bot skin${missing.length === 1 ? "" : "s"} (${packs.join(" and ")} not here)`);
  }
}
