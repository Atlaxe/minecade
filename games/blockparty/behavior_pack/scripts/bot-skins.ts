// The skins Block Party's bots wear (the user, 2026-11-27): Minecraft's default skins and the
// Default Skin Pack of Legacy Console Edition, a different one for each bot in a game while there are
// enough. Steve and Alex are the game's own textures (textures/entity/steve and alex). The rest are
// Mojang's art too, so they come from a private pack (private_packs/skins, made by the workshop's
// bot-skins project) and never go in git: a build without that pack gives the bots only Steve and
// Alex ("#private-packs" says which private packs the build has).
//
// A bot's skin is its entity's blockparty:skin property: the skin's index here. The bot's client
// entity (resource_pack/entity/bot.entity.json) lists every skin's texture and model (slim arms or
// classic) in this same order, and its render controller picks both by the property. The build draws
// each skin's portrait for the player cards (tools/blockparty/bot-portraits.ts, at
// skinTexture(id, "portrait"); heads.ts). Kept free of imports, so the build can read it.

export interface BotSkin {
  /** Its texture's file name, and its portrait's key. */
  id: string;
  name: string;
  /** Slim (3 pixel) arms: Alex's model. Else classic, Steve's. */
  slim: boolean;
  /** The private pack it comes from (private_packs/<pack>/resource_pack), or none: Minecraft's own. */
  pack?: string;
}

/** The private pack the skins that aren't Minecraft's own resource pack's come from. */
export const SKINS_PACK = "skins";

/** Where the private pack keeps its skins: <folder>/<id>.png. */
export const SKINS_FOLDER = "textures/blockparty/skins";

const own = (id: string, name: string, slim: boolean): BotSkin => ({ id, name, slim });
const packed = (id: string, name: string, slim: boolean): BotSkin => ({ id, name, slim, pack: SKINS_PACK });

/** Every skin a bot can wear, in the bot's client entity's order (its blockparty:skin property is the index). */
export const BOT_SKINS: readonly BotSkin[] = [
  // Minecraft's default skins.
  own("steve", "Steve", false),
  own("alex", "Alex", true),
  packed("ari", "Ari", false),
  packed("efe", "Efe", true),
  packed("kai", "Kai", false),
  packed("makena", "Makena", true),
  packed("noor", "Noor", true),
  packed("sunny", "Sunny", true),
  packed("zuri", "Zuri", false),
  // Legacy Console Edition's Default Skin Pack (its plain Steve and Alex are the two above).
  packed("tennis_steve", "Tennis Steve", false),
  packed("tuxedo_steve", "Tuxedo Steve", false),
  packed("athlete_steve", "Athlete Steve", false),
  packed("scottish_steve", "Scottish Steve", false),
  packed("prisoner_steve", "Prisoner Steve", false),
  packed("cyclist_steve", "Cyclist Steve", false),
  packed("boxer_steve", "Boxer Steve", false),
  packed("tennis_alex", "Tennis Alex", true),
  packed("tuxedo_alex", "Tuxedo Alex", true),
  packed("athlete_alex", "Athlete Alex", true),
  packed("swedish_alex", "Swedish Alex", true),
  packed("prisoner_alex", "Prisoner Alex", true),
  packed("cyclist_alex", "Cyclist Alex", true),
  packed("boxer_alex", "Boxer Alex", true),
  packed("developer_alex", "Developer Alex", true),
  packed("developer_steve", "Developer Steve", false),
];

/** A skin's texture path, as the bot's client entity names it. */
export function botSkinTexture(skin: BotSkin): string {
  return skin.pack ? `${SKINS_FOLDER}/${skin.id}` : `textures/entity/${skin.id}`;
}

/** The skins (their indexes in BOT_SKINS) a build can draw: Minecraft's own, and each private pack's when the build has it. */
export function wearableSkins(packs: readonly string[]): number[] {
  return BOT_SKINS.flatMap((skin, index) => (!skin.pack || packs.includes(skin.pack) ? [index] : []));
}

/**
 * A skin for a new bot (its index in BOT_SKINS) from `wearable`, at random: one none of `taken`
 * wears while there is one, else any. Steve's when nothing is wearable.
 */
export function pickSkin(wearable: readonly number[], taken: readonly number[], random: () => number): number {
  const free = wearable.filter((index) => !taken.includes(index));
  const from = free.length > 0 ? free : wearable;
  if (from.length === 0) return 0;
  return from[Math.floor(random() * from.length) % from.length];
}
