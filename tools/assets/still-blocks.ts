// Writes the building games' blocks that stay where they're put (Build Swap's and Guess the Build's:
// games/<id>/behavior_pack/blocks/, and their geometries, names, sounds and textures in the game's
// resource pack): a twin of each vanilla block that falls, listed in minigame-core's
// src/building/still-blocks.ts. Each game gets its own copy, since a server loads only its game's
// packs. Their textures
// are vanilla's own (textures/blocks/...), so no vanilla file is copied. Cubes are full blocks; an
// anvil and the dragon egg are drawn from boxes in Java's block coordinates (0 to 16, x east, z
// south), as vanilla draws them, and an anvil turns with its facing like the vanilla one. Rerun
// after changing them, and commit the files:
//
//     npx tsx tools/assets/still-blocks.ts
//
// A test checks the committed files match (packages/minigame-core/test/still-blocks.test.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ANVIL_FACING, STILL_BLOCKS, type StillBlock, type StillShape } from "../../packages/minigame-core/src/building/still-blocks.ts";

/** The games whose packs get the blocks. */
export const STILL_BLOCK_GAMES = ["buildswap", "guessbuild"] as const;

const gameFile = (game: string, path: string) => fileURLToPath(new URL(`../../games/${game}/${path}`, import.meta.url));

/** A box in Java's block coordinates: x1, y1, z1, x2, y2, z2. */
type Box = readonly [number, number, number, number, number, number];

/** Java's anvil, its long side along z (facing north or south). The last box is the top. */
const ANVIL: Box[] = [
  [2, 0, 2, 14, 4, 14],
  [4, 4, 3, 12, 5, 13],
  [6, 5, 4, 10, 10, 12],
  [3, 10, 0, 13, 16, 16],
];
/** Java's dragon egg, a stack of rounding layers. */
const EGG: Box[] = [
  [6, 15, 6, 10, 16, 10],
  [5, 14, 5, 11, 15, 11],
  [4, 13, 4, 12, 14, 12],
  [3, 11, 3, 13, 13, 13],
  [2, 8, 2, 14, 11, 14],
  [1, 3, 1, 15, 8, 15],
  [2, 1, 2, 14, 3, 14],
  [5, 0, 5, 11, 1, 11],
];
const swapXZ = ([x1, y1, z1, x2, y2, z2]: Box): Box => [z1, y1, x1, z2, y2, x2];
/** An anvil faces along x when it faces east or west. */
const facing = (...sides: string[]) => sides.map((side) => `q.block_state('${ANVIL_FACING}') == '${side}'`).join(" || ");
const ALONG_X = facing("east", "west");
const ALONG_Z = facing("north", "south");

/** A Java-coordinate box as Bedrock's origin and size (block geometry and boxes mirror x). */
const bedrockBox = ([x1, y1, z1, x2, y2, z2]: Box) => ({ origin: [8 - x2, y1, z1 - 8], size: [x2 - x1, y2 - y1, z2 - z1] });

/** A box's cube, each face showing the part of the texture it covers, as Java's automatic UVs; `top` faces up with the "top" material. */
function cube(box: Box, top = false): unknown {
  const [x1, y1, z1, x2, y2, z2] = box;
  const face = (u: number, v: number, w: number, h: number) => ({ uv: [u, v], uv_size: [w, h] });
  return {
    ...bedrockBox(box),
    uv: {
      north: face(16 - x2, 16 - y2, x2 - x1, y2 - y1),
      south: face(x1, 16 - y2, x2 - x1, y2 - y1),
      west: face(z1, 16 - y2, z2 - z1, y2 - y1),
      east: face(16 - z2, 16 - y2, z2 - z1, y2 - y1),
      up: { ...face(x1, z1, x2 - x1, z2 - z1), ...(top ? { material_instance: "top" } : {}) },
      down: face(x1, 16 - z2, x2 - x1, z2 - z1),
    },
  };
}

const geometryId = (shape: StillShape) => `geometry.minecade.still_${shape}`;
const textureId = (block: StillBlock, part: "all" | "side" | "top" = "all") =>
  part === "side" ? "minecade_still_anvil_base" : `${block.still.replace("minecade:", "minecade_")}${part === "top" ? "_top" : ""}`;
const fileName = (block: StillBlock) => block.still.replace("minecade:", "");

function geometry(shape: "anvil" | "egg"): unknown {
  const bones =
    shape === "anvil"
      ? [
          { name: "z", pivot: [0, 0, 0], cubes: ANVIL.map((box, i) => cube(box, i === ANVIL.length - 1)) },
          { name: "x", pivot: [0, 0, 0], cubes: ANVIL.map((box, i) => cube(swapXZ(box), i === ANVIL.length - 1)) },
        ]
      : [{ name: "egg", pivot: [0, 0, 0], cubes: EGG.map((box) => cube(box)) }];
  return { format_version: "1.21.0", "minecraft:geometry": [{ description: { identifier: geometryId(shape), texture_width: 16, texture_height: 16 }, bones }] };
}

const SECONDS: Record<string, number> = { sand: 0.5, gravel: 0.6, anvil: 5, stone: 3 };

function block(entry: StillBlock): unknown {
  const seconds = SECONDS[entry.sound] ?? 0.5;
  const common = {
    "minecraft:destructible_by_mining": { seconds_to_destroy: seconds },
    "minecraft:destructible_by_explosion": { explosion_resistance: seconds },
  };
  if (entry.shape === "cube") {
    return {
      format_version: "1.26.0",
      "minecraft:block": {
        description: { identifier: entry.still, menu_category: { category: "none" } },
        components: {
          "minecraft:geometry": "minecraft:geometry.full_block",
          "minecraft:material_instances": { "*": { texture: textureId(entry), render_method: "opaque" } },
          ...common,
        },
      },
    };
  }
  if (entry.shape === "egg") {
    return {
      format_version: "1.26.0",
      "minecraft:block": {
        description: { identifier: entry.still, menu_category: { category: "none" } },
        components: {
          "minecraft:geometry": geometryId("egg"),
          "minecraft:material_instances": { "*": { texture: textureId(entry), render_method: "opaque" } },
          "minecraft:collision_box": bedrockBox([1, 0, 1, 15, 16, 15]),
          "minecraft:selection_box": bedrockBox([1, 0, 1, 15, 16, 15]),
          "minecraft:light_dampening": 0,
          ...common,
        },
      },
    };
  }
  // An anvil: its long side across the way it was placed, as vanilla's.
  const along = (box: Box) => ({ "minecraft:collision_box": bedrockBox(box), "minecraft:selection_box": bedrockBox(box) });
  return {
    format_version: "1.26.0",
    "minecraft:block": {
      description: {
        identifier: entry.still,
        menu_category: { category: "none" },
        traits: { "minecraft:placement_direction": { enabled_states: [ANVIL_FACING], y_rotation_offset: 90 } },
      },
      components: {
        "minecraft:geometry": { identifier: geometryId("anvil"), bone_visibility: { z: ALONG_Z, x: ALONG_X } },
        "minecraft:material_instances": {
          "*": { texture: textureId(entry, "side"), render_method: "opaque" },
          top: { texture: textureId(entry, "top"), render_method: "opaque" },
        },
        "minecraft:light_dampening": 0,
        ...along([3, 0, 0, 13, 16, 16]),
        ...common,
      },
      permutations: [{ condition: ALONG_X, components: along([0, 0, 3, 16, 16, 13]) }],
    },
  };
}

/** The files for one game, by their path in its folder. */
export function stillBlockFiles(game: string): Record<string, string> {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const files: Record<string, string> = {};
  const sounds: Record<string, unknown> = { format_version: [1, 1, 0] };
  const textures: Record<string, { textures: string }> = {};
  const names: string[] = [];
  for (const entry of STILL_BLOCKS) {
    files[`behavior_pack/blocks/${fileName(entry)}.json`] = json(block(entry));
    sounds[entry.still] = { sound: entry.sound };
    names.push(`tile.${entry.still}.name=${entry.name}`);
    if (entry.textures.all) textures[textureId(entry)] = { textures: entry.textures.all };
    if (entry.textures.side) textures[textureId(entry, "side")] = { textures: entry.textures.side };
    if (entry.textures.top) textures[textureId(entry, "top")] = { textures: entry.textures.top };
  }
  files["resource_pack/models/blocks/still_anvil.geo.json"] = json(geometry("anvil"));
  files["resource_pack/models/blocks/still_egg.geo.json"] = json(geometry("egg"));
  files["resource_pack/blocks.json"] = json(sounds);
  files["resource_pack/textures/terrain_texture.json"] = json({
    resource_pack_name: `minecade_${game}`,
    texture_name: "atlas.terrain",
    padding: 8,
    num_mip_levels: 4,
    texture_data: textures,
  });
  files["resource_pack/texts/en_US.lang"] = `${names.join("\n")}\n`;
  files["resource_pack/texts/languages.json"] = json(["en_US"]);
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const game of STILL_BLOCK_GAMES) {
    for (const [path, content] of Object.entries(stillBlockFiles(game))) {
      mkdirSync(dirname(gameFile(game, path)), { recursive: true });
      writeFileSync(gameFile(game, path), content);
    }
  }
  console.log(`wrote the blocks that stay where they're put for ${STILL_BLOCK_GAMES.join(" and ")}`);
}
