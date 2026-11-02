// The fake player (editor/preview/): a preview's fake players and Edit's mannequins. Its skins are
// a plain color and Minecraft's own default skins (minigame-core fake-looks.ts FAKE_SKINS), which
// are Mojang's, so they never go in git: each template build copies them from the Minecraft install
// on this PC (its vanilla skin pack) into the pack it builds. A skin this PC doesn't have shows as
// Minecraft's Steve or Alex (the client's own textures/entity/), on the same model.
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_SKINS } from "@minecade/minigame-core/config";
import { VANILLA_PACK } from "../build/vanilla-textures.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const PREVIEW = join(root, "editor", "preview");
/** Minecraft's default skins: the vanilla skin pack beside its vanilla resource pack. */
export const VANILLA_SKINS = process.env.MINECRAFT_SKINS ?? join(dirname(dirname(VANILLA_PACK)), "skin_packs", "vanilla");
/** Where a pack has them (fake_player.entity.json points there). */
const SKINS_DIR = "textures/minecade/fake/skins";
const ENTITY = "entity/fake_player.entity.json";
/** What Edit's packs take from the preview's: the entity and how it's drawn (not the hearts' font). */
const ENTITY_FILES = { bp: ["entities/fake_player.json"], rp: [ENTITY, "animations/fake_player.animation.json", "render_controllers/fake_player.render_controllers.json", "textures/minecade/fake"] };

/**
 * Copies Minecraft's default skins into a resource pack that has the fake player's client entity;
 * the ones this PC lacks point at Steve or Alex instead. Returns how many it copied.
 */
export async function addFakeSkins(pack: string, from = VANILLA_SKINS): Promise<number> {
  const entityPath = join(pack, ENTITY);
  const entity = JSON.parse(await readFile(entityPath, "utf8"));
  const textures: Record<string, string> = entity["minecraft:client_entity"].description.textures;
  await mkdir(join(pack, SKINS_DIR), { recursive: true });
  let copied = 0;
  for (const skin of FAKE_SKINS) {
    if (skin.id === "color") continue;
    const source = join(from, `${skin.id}.png`);
    if (existsSync(source)) {
      await copyFile(source, join(pack, SKINS_DIR, `${skin.id}.png`));
      textures[skin.id] = `${SKINS_DIR}/${skin.id}`;
      copied++;
    } else {
      textures[skin.id] = skin.slim ? "textures/entity/alex" : "textures/entity/steve";
    }
  }
  await writeFile(entityPath, `${JSON.stringify(entity, null, 2)}\n`);
  return copied;
}

/** Adds the fake player to Edit's packs, for its mannequins: the entity, how it's drawn, and its skins. */
export async function addFakePlayer(bp: string, rp: string): Promise<void> {
  for (const path of ENTITY_FILES.bp) await cp(join(PREVIEW, "behavior_pack", path), join(bp, path), { recursive: true });
  for (const path of ENTITY_FILES.rp) await cp(join(PREVIEW, "resource_pack", path), join(rp, path), { recursive: true });
  await addFakeSkins(rp);
}
