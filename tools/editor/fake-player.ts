// The fake player (editor/preview/): a preview's fake players and Edit's mannequins. Its skins are
// a plain color and Minecraft's Steve and Alex (minigame-core fake-looks.ts FAKE_SKINS), which are
// Mojang's, so they never go in git: each template build copies them from the Minecraft install on
// this PC (its vanilla skin pack) into the pack it builds. A skin this PC doesn't have shows as the
// client's own Steve or Alex (textures/entity/), on the same model. Edit's pack also gets the
// players' skins the lobby's watcher saved (skins/, gitignored), for its mannequins: classic ones
// only, since a character creator skin needs its own model.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_SKINS, type PlayerSkin } from "@minecade/minigame-core/config";
import { VANILLA_PACK } from "../build/vanilla-textures.ts";
import { encodePng, type Image } from "../skins/png.ts";
import { readSkins, type StoredSkin } from "../skins/store.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const PREVIEW = join(root, "editor", "preview");
/** Minecraft's default skins: the vanilla skin pack beside its vanilla resource pack. */
export const VANILLA_SKINS = process.env.MINECRAFT_SKINS ?? join(dirname(dirname(VANILLA_PACK)), "skin_packs", "vanilla");
/** Where a pack has them (fake_player.entity.json points there). */
const SKINS_DIR = "textures/minecade/fake/skins";
const ENTITY = "entity/fake_player.entity.json";
const CONTROLLERS = "render_controllers/fake_player.render_controllers.json";
const CONTROLLER = "controller.render.minecade.fake_player";
const BP_ENTITY = "entities/fake_player.json";
/** What Edit's packs take from the preview's: the entity and how it's drawn (not the hearts' font). */
const ENTITY_FILES = { bp: [BP_ENTITY], rp: [ENTITY, "animations/fake_player.animation.json", CONTROLLERS, "models/entity/fake_player.geo.json", "textures/minecade/fake"] };

/**
 * Copies Minecraft's Steve and Alex into a resource pack that has the fake player's client entity;
 * the ones this PC lacks point at the client's own instead. Returns how many it copied.
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

/** A player's skin as a mannequin wears it: its entry in Edit's list ("#skins") and its picture. */
export interface MannequinSkin {
  skin: PlayerSkin;
  image: Image;
}

/**
 * The saved players' skins a mannequin can wear, by gamertag: classic ones (wide, slim, or the old
 * 64x32 layout made 64x64), not a character creator skin or any skin with a model of its own. Each
 * is keyed by a hash of the player's xuid, so map.json names no player.
 */
export async function mannequinSkins(dir = join(root, "skins")): Promise<MannequinSkin[]> {
  const skins: MannequinSkin[] = [];
  for (const stored of await readSkins(dir)) {
    const image = classicImage(stored);
    if (!image) continue;
    const { meta } = stored;
    const slim = meta.armSize === "slim" || meta.geometry?.default === "geometry.humanoid.customSlim";
    skins.push({ skin: { name: meta.name, key: skinKey(meta.xuid), slim }, image });
  }
  return skins.sort((a, b) => a.skin.name.localeCompare(b.skin.name));
}

/** A mannequin skin's key: "p" and a short hash of the xuid. */
export function skinKey(xuid: string): string {
  return `p${createHash("sha256").update(xuid).digest("hex").slice(0, 10)}`;
}

/**
 * A classic skin's picture on the 64x64 layout (HD ones at their size), or undefined for any other
 * skin. The watcher saves every skin's model data, a classic skin's too, so it goes by the model's
 * name, as the lobby's renders do (tools/skins/geometry.ts modelFor).
 */
export function classicImage(stored: StoredSkin): Image | undefined {
  const { meta, image } = stored;
  const model = meta.geometry?.default ?? "geometry.humanoid.custom";
  if (meta.persona || !model.startsWith("geometry.humanoid")) return undefined;
  if (image.width === image.height) return image;
  return image.height * 2 === image.width ? fromLegacy(image) : undefined;
}

/**
 * An old 64x32 skin on the 64x64 layout: the top half as it is, and the left leg and arm the right
 * ones mirrored, face by face (as Minecraft converts them).
 */
function fromLegacy(image: Image): Image {
  const scale = image.width / 64;
  const out: Image = { width: image.width, height: image.width, data: new Uint8Array(image.width * image.width * 4) };
  out.data.set(image.data);
  // [x, y, dx, dy, width, height] in 64x64 units: copy (x, y) to (x + dx, y + dy), mirrored across.
  const faces = [
    [4, 16, 16, 32, 4, 4], [8, 16, 16, 32, 4, 4], [0, 20, 24, 32, 4, 12], [4, 20, 16, 32, 4, 12], [8, 20, 8, 32, 4, 12], [12, 20, 16, 32, 4, 12],
    [44, 16, -8, 32, 4, 4], [48, 16, -8, 32, 4, 4], [40, 20, 0, 32, 4, 12], [44, 20, -8, 32, 4, 12], [48, 20, -16, 32, 4, 12], [52, 20, -8, 32, 4, 12],
  ];
  for (const [x, y, dx, dy, width, height] of faces.map((face) => face.map((value) => value * scale))) {
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const from = ((y + row) * image.width + x + column) * 4;
        const to = ((y + dy + row) * out.width + x + dx + width - 1 - column) * 4;
        out.data.set(image.data.subarray(from, from + 4), to);
      }
    }
  }
  return out;
}

/**
 * Adds the fake player to Edit's packs, for its mannequins: the entity, how it's drawn, its skins,
 * and the players' skins after them (in the render controller's lists, and the skin property's
 * range).
 */
export async function addFakePlayer(bp: string, rp: string, players: MannequinSkin[] = []): Promise<void> {
  for (const path of ENTITY_FILES.bp) await cp(join(PREVIEW, "behavior_pack", path), join(bp, path), { recursive: true });
  for (const path of ENTITY_FILES.rp) await cp(join(PREVIEW, "resource_pack", path), join(rp, path), { recursive: true });
  await addFakeSkins(rp);
  if (players.length === 0) return;
  const entityPath = join(rp, ENTITY);
  const entity = JSON.parse(await readFile(entityPath, "utf8"));
  const textures: Record<string, string> = entity["minecraft:client_entity"].description.textures;
  const controllersPath = join(rp, CONTROLLERS);
  const controllers = JSON.parse(await readFile(controllersPath, "utf8"));
  const arrays = controllers.render_controllers[CONTROLLER].arrays;
  for (const { skin, image } of players) {
    await writeFile(join(rp, SKINS_DIR, `${skin.key}.png`), encodePng(image));
    textures[skin.key] = `${SKINS_DIR}/${skin.key}`;
    arrays.textures["Array.skins"].push(`Texture.${skin.key}`);
    arrays.geometries["Array.models"].push(skin.slim ? "Geometry.slim" : "Geometry.default");
  }
  await writeFile(entityPath, `${JSON.stringify(entity, null, 2)}\n`);
  await writeFile(controllersPath, `${JSON.stringify(controllers, null, 2)}\n`);
  const bpPath = join(bp, BP_ENTITY);
  const bpEntity = JSON.parse(await readFile(bpPath, "utf8"));
  bpEntity["minecraft:entity"].description.properties["minecade:skin"].range = [0, FAKE_SKINS.length + players.length - 1];
  await writeFile(bpPath, `${JSON.stringify(bpEntity, null, 2)}\n`);
}
