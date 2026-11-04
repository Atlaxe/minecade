// Writes the shared armor pack (packs/armor): leather caps, tunics, pants and boots in each of the
// 16 dye colors, as their own items, each looking just like leather armor dyed that color. Bedrock's
// scripts can't dye leather (ItemDyeableComponent does nothing to vanilla leather), so a kit's team
// armor (teamArmor) is the piece in the team's dye instead (minigame-core's teamArmorItem); any
// game can also give one by name (dyedLeather). The textures are Minecraft's own leather ones, tinted
// the way the game tints dyed leather, so they're Mojang's and never go in git: the build writes the
// whole pack (git-ignored) from the cached vanilla textures (tools/build/vanilla-textures.ts) before
// it packs the servers. To write it by hand:
//
//     npx tsx tools/assets/armor.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEATHER_DYES, LEATHER_PIECES, dyedLeather, leatherColor, type LeatherPiece } from "../../packages/minigame-core/src/kit-defs.ts";
import { dyeLeather } from "../build/kit-pictures.ts";
import { VanillaTextures } from "../build/vanilla-textures.ts";
import { encodePng } from "../skins/png.ts";

export const ARMOR_PACK = fileURLToPath(new URL("../../packs/armor/", import.meta.url));

/** Each piece as Minecraft has it: where it's worn, its name, protection and durability, its texture layer, its model. */
const PIECES: Record<LeatherPiece, { slot: string; enchantSlot: string; name: string; protection: number; durability: number; layer: 1 | 2; hides: string }> = {
  helmet: { slot: "slot.armor.head", enchantSlot: "armor_head", name: "Leather Cap", protection: 1, durability: 55, layer: 1, hides: "helmet_layer_visible" },
  chestplate: { slot: "slot.armor.chest", enchantSlot: "armor_torso", name: "Leather Tunic", protection: 3, durability: 80, layer: 1, hides: "chest_layer_visible" },
  leggings: { slot: "slot.armor.legs", enchantSlot: "armor_legs", name: "Leather Pants", protection: 2, durability: 75, layer: 2, hides: "leg_layer_visible" },
  boots: { slot: "slot.armor.feet", enchantSlot: "armor_feet", name: "Leather Boots", protection: 1, durability: 65, layer: 1, hides: "boot_layer_visible" },
};

const TEXTURES = "textures/minecade/armor";
const layerTexture = (dye: string, layer: 1 | 2) => `${TEXTURES}/${dye}_leather_${layer}`;
const iconTexture = (dye: string, piece: LeatherPiece) => `${TEXTURES}/icons/${dye}_leather_${piece}`;
const iconKey = (dye: string, piece: LeatherPiece) => `minecade_${dye}_leather_${piece}`;
const file = (identifier: string) => identifier.replace("minecade:", "");

const MANIFESTS = {
  "behavior_pack/manifest.json": {
    format_version: 2,
    header: {
      name: "Minecade Armor",
      description: "Leather armor in each of the 16 dye colors, for team armor and any game",
      uuid: "9a4da5e5-de97-4226-a63b-70787211517c",
      version: [0, 1, 0],
      min_engine_version: [1, 26, 60],
    },
    modules: [{ type: "data", uuid: "859019cb-0131-40ae-aa88-3ae1b5bda5e9", version: [0, 1, 0] }],
  },
  "resource_pack/manifest.json": {
    format_version: 2,
    header: {
      name: "Minecade Armor",
      description: "Dyed leather armor's looks: Minecraft's leather, tinted",
      uuid: "9da77fb9-611f-46be-b715-2535b66a0ef7",
      version: [1, 0, 0],
      min_engine_version: [1, 26, 60],
    },
    modules: [{ type: "resources", uuid: "05a6a60f-7243-495c-a2f8-3db25bc3d2a5", version: [1, 0, 0] }],
  },
};

function item(piece: LeatherPiece, dye: string): unknown {
  const { slot, enchantSlot, name, protection, durability } = PIECES[piece];
  return {
    format_version: "1.21.120",
    "minecraft:item": {
      description: { identifier: dyedLeather(piece, dye), menu_category: { category: "none" } },
      components: {
        "minecraft:icon": { textures: { default: iconKey(dye, piece) } },
        "minecraft:display_name": { value: name },
        "minecraft:max_stack_size": 1,
        "minecraft:wearable": { slot, protection },
        "minecraft:durability": { max_durability: durability },
        "minecraft:enchantable": { slot: enchantSlot, value: 15 },
      },
    },
  };
}

/**
 * The piece on a body, the way vanilla's leather attachables draw it: one for players (the player
 * model's armor, its offset animation) and one for everything else (armor stands, mobs).
 */
function attachables(piece: LeatherPiece, dye: string): Record<string, unknown> {
  const { layer, hides } = PIECES[piece];
  const identifier = dyedLeather(piece, dye);
  const base = {
    materials: { default: "armor", enchanted: "armor_enchanted" },
    textures: { default: layerTexture(dye, layer), enchanted: "textures/misc/enchanted_actor_glint" },
    render_controllers: ["controller.render.armor"],
  };
  const attachable = (description: Record<string, unknown>) => ({ format_version: "1.10.0", "minecraft:attachable": { description } });
  return {
    [`${file(identifier)}.player.json`]: attachable({
      identifier: `${identifier}.player`,
      item: { [identifier]: "query.owner_identifier == 'minecraft:player'" },
      ...base,
      geometry: { default: `geometry.player.armor.${piece}` },
      scripts: { parent_setup: `variable.${hides} = 0.0;`, animate: ["offset"] },
      animations: { offset: `animation.armor.${piece}.offset` },
    }),
    [`${file(identifier)}.json`]: attachable({
      identifier,
      ...base,
      geometry: { default: `geometry.humanoid.armor.${piece}` },
      scripts: { parent_setup: `variable.${hides} = 0.0;` },
    }),
  };
}

/** Every file of the pack, by path under packs/armor; undefined when Minecraft's leather textures aren't here. */
export function armorPackFiles(textures: VanillaTextures): Record<string, string | Buffer> | undefined {
  const layers = { 1: textures.armor("leather_1"), 2: textures.armor("leather_2") };
  const icons = Object.fromEntries(LEATHER_PIECES.map((piece) => [piece, textures.item(`minecraft:leather_${piece}`)?.image]));
  if (!layers[1] || !layers[2] || LEATHER_PIECES.some((piece) => !icons[piece])) return undefined;
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const dyes = Object.keys(LEATHER_DYES);
  const files: Record<string, string | Buffer> = {
    ...Object.fromEntries(Object.entries(MANIFESTS).map(([path, manifest]) => [path, json(manifest)])),
    "resource_pack/textures/item_texture.json": json({
      resource_pack_name: "minecade_armor",
      texture_name: "atlas.items",
      texture_data: Object.fromEntries(dyes.flatMap((dye) => LEATHER_PIECES.map((piece) => [iconKey(dye, piece), { textures: iconTexture(dye, piece) }]))),
    }),
  };
  for (const dye of dyes) {
    const color = leatherColor(dye);
    for (const layer of [1, 2] as const) files[`resource_pack/${layerTexture(dye, layer)}.png`] = encodePng(dyeLeather(layers[layer]!, color));
    for (const piece of LEATHER_PIECES) {
      files[`behavior_pack/items/${file(dyedLeather(piece, dye))}.json`] = json(item(piece, dye));
      for (const [name, attachable] of Object.entries(attachables(piece, dye))) files[`resource_pack/attachables/${name}`] = json(attachable);
      files[`resource_pack/${iconTexture(dye, piece)}.png`] = encodePng(dyeLeather(icons[piece]!, color));
    }
  }
  return files;
}

/**
 * Writes packs/armor afresh from Minecraft's textures. Returns false (and leaves what's there) when
 * they aren't on this PC or in the cache.
 */
export function writeArmorPack(textures = VanillaTextures.load(), out = ARMOR_PACK): boolean {
  const files = textures && armorPackFiles(textures);
  if (!files) return false;
  for (const half of ["behavior_pack", "resource_pack"]) rmSync(`${out}${half}`, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(`${out}${path}`), { recursive: true });
    writeFileSync(`${out}${path}`, content);
  }
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(writeArmorPack() ? "wrote the armor pack's files" : "Minecraft's leather textures aren't here (see tools/build/vanilla-textures.ts)");
}
