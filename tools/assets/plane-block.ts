// Writes the map editor's plane block (minecade:plane, editor/behavior_pack/scripts/sheets.ts): its
// definition, a geometry for each axis and pixel, and a see-through texture for each of its 16
// colors (a light fill inside a stronger edge, so a sheet's blocks show as a grid). It has a
// permutation per axis and pixel and per color, so it's generated: rerun after changing them, and
// commit the files.
//
//     npx tsx tools/assets/plane-block.ts
//
// A test checks the committed files match (editor/test/sheets.test.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANE_BLOCK, PLANE_COLORS } from "../../editor/behavior_pack/scripts/sheets.ts";
import { encodePng } from "../skins/png.ts";

const editor = (path: string) => fileURLToPath(new URL(`../../editor/${path}`, import.meta.url));

/** The fill's and the edge's opacity, out of 255. */
const FILL_ALPHA = 80;
const EDGE_ALPHA = 190;
const AXES = [0, 1, 2] as const;
const PIXELS = Array.from({ length: 16 }, (_, i) => i);

const geometryId = (axis: number, offset: number) => `geometry.minecade.plane_${axis}_${offset}`;
const textureId = (color: string) => `minecade_plane_${color}`;

/**
 * One plane's cube: 16 by 16 and a pixel thick, `offset` pixels along its axis from the block's low
 * side (west, bottom, north). Block geometry mirrors x, so a pixel from the west sits at 7 - offset.
 */
function plane(axis: number, offset: number): unknown {
  const origin = axis === 0 ? [7 - offset, 0, -8] : axis === 1 ? [-8, offset, -8] : [-8, 0, -8 + offset];
  const size = axis === 0 ? [1, 16, 16] : axis === 1 ? [16, 1, 16] : [16, 16, 1];
  const face = (width: number, height: number) => ({ uv: [0, 0], uv_size: [width, height] });
  const uv =
    axis === 0
      ? { north: face(1, 16), south: face(1, 16), east: face(16, 16), west: face(16, 16), up: face(1, 16), down: face(1, 16) }
      : axis === 1
        ? { north: face(16, 1), south: face(16, 1), east: face(16, 1), west: face(16, 1), up: face(16, 16), down: face(16, 16) }
        : { north: face(16, 16), south: face(16, 16), east: face(1, 16), west: face(1, 16), up: face(16, 1), down: face(16, 1) };
  return {
    description: { identifier: geometryId(axis, offset), texture_width: 16, texture_height: 16 },
    bones: [{ name: "plane", pivot: [0, 0, 0], cubes: [{ origin, size, uv }] }],
  };
}

function material(color: string): unknown {
  return { "*": { texture: textureId(color), render_method: "blend" } };
}

export function planeBlockFiles(): Record<string, string | Buffer> {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const block = {
    format_version: "1.21.100",
    "minecraft:block": {
      description: {
        identifier: PLANE_BLOCK,
        menu_category: { category: "none" },
        states: {
          "minecade:axis": { values: { min: 0, max: 2 } },
          "minecade:offset": { values: { min: 0, max: 15 } },
          "minecade:color": { values: { min: 0, max: PLANE_COLORS.length - 1 } },
        },
      },
      components: {
        "minecraft:geometry": geometryId(1, 0),
        "minecraft:material_instances": material(PLANE_COLORS[0].id),
        "minecraft:collision_box": false,
        "minecraft:selection_box": false,
        "minecraft:light_dampening": 0,
        "minecraft:replaceable": {},
        "minecraft:destructible_by_explosion": false,
      },
      permutations: [
        ...AXES.flatMap((axis) =>
          PIXELS.map((offset) => ({
            condition: `q.block_state('minecade:axis') == ${axis} && q.block_state('minecade:offset') == ${offset}`,
            components: { "minecraft:geometry": geometryId(axis, offset) },
          })),
        ),
        ...PLANE_COLORS.map((color, i) => ({
          condition: `q.block_state('minecade:color') == ${i}`,
          components: { "minecraft:material_instances": material(color.id) },
        })),
      ],
    },
  };
  const files: Record<string, string | Buffer> = {
    "behavior_pack/blocks/plane.json": json(block),
    "resource_pack/models/blocks/plane.geo.json": json({ format_version: "1.12.0", "minecraft:geometry": AXES.flatMap((axis) => PIXELS.map((offset) => plane(axis, offset))) }),
    "resource_pack/blocks.json": json({ format_version: [1, 1, 0], [PLANE_BLOCK]: { sound: "glass" } }),
    "resource_pack/textures/terrain_texture.json": json({
      resource_pack_name: "minecade_editor",
      texture_name: "atlas.terrain",
      padding: 8,
      num_mip_levels: 4,
      texture_data: Object.fromEntries(PLANE_COLORS.map((color) => [textureId(color.id), { textures: `textures/minecade/planes/${color.id}` }])),
    }),
  };
  for (const color of PLANE_COLORS) files[`resource_pack/textures/minecade/planes/${color.id}.png`] = texture(color.rgb);
  return files;
}

/** A 16x16 square in the color: the light fill inside a stronger one-pixel edge. */
function texture(rgb: number): Buffer {
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      data.set([rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff, edge ? EDGE_ALPHA : FILL_ALPHA], (y * 16 + x) * 4);
    }
  }
  return encodePng({ width: 16, height: 16, data });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [path, content] of Object.entries(planeBlockFiles())) {
    mkdirSync(dirname(editor(path)), { recursive: true });
    writeFileSync(editor(path), content);
  }
  console.log("wrote the plane block's files");
}
