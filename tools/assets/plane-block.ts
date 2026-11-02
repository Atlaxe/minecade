// Writes the map editor's plane block (minecade:plane, editor/behavior_pack/scripts/sheets.ts): its
// definition, a geometry for each axis and pixel, and a see-through texture for each of its 16
// colors (the light fill on its left half, the stronger edge line's color on its right). A plane's
// square is a 3x3 grid of pieces (a one-pixel rim around the middle), and its four edge states pick
// which rim pieces draw the line (bone_visibility), so only a sheet's border shows one. It has a
// permutation per axis and pixel and per color, so it's generated: rerun after changing them, and
// commit the files.
//
//     npx tsx tools/assets/plane-block.ts
//
// A test checks the committed files match (editor/test/sheets.test.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EDGE_STATES, PLANE_BLOCK, PLANE_COLORS, inPlane, type Axis } from "../../editor/behavior_pack/scripts/sheets.ts";
import { encodePng } from "../skins/png.ts";

const editor = (path: string) => fileURLToPath(new URL(`../../editor/${path}`, import.meta.url));

/** The fill's and the edge line's opacity, out of 255. */
const FILL_ALPHA = 80;
const EDGE_ALPHA = 220;
const AXES = [0, 1, 2] as const;
const PIXELS = Array.from({ length: 16 }, (_, i) => i);
/** The grid's pieces along each side: the low rim pixel, the middle, the high rim pixel. */
const SPANS = [
  [0, 1],
  [1, 15],
  [15, 16],
] as const;
/** Where a face takes its color in the texture: the fill's half or the edge's (well inside each, so mipmaps keep them apart). */
const FILL_UV = { uv: [2, 2], uv_size: [4, 12] };
const EDGE_UV = { uv: [10, 2], uv_size: [4, 12] };
/** The faces a plane shows: its two big ones (a one-pixel side isn't drawn). */
const FACES = { 0: ["east", "west"], 1: ["up", "down"], 2: ["north", "south"] } as const;

const geometryId = (axis: number, offset: number) => `geometry.minecade.plane_${axis}_${offset}`;
const textureId = (color: string) => `minecade_plane_${color}`;
const isOn = (bit: number) => `q.block_state('${EDGE_STATES[bit]}') == 'true'`;
const isOff = (bit: number) => `q.block_state('${EDGE_STATES[bit]}') == 'false'`;

/** The rim sides a grid piece is on, as EDGE_STATES' bits (none for the middle). */
function rimBits(i: number, j: number): number[] {
  return [i === 0 ? 0 : -1, i === 2 ? 1 : -1, j === 0 ? 2 : -1, j === 2 ? 3 : -1].filter((bit) => bit >= 0);
}

/** The bones' names: the middle is "fill"; a rim piece has an edge and a fill version, one of them shown. */
const pieceName = (i: number, j: number, kind: "edge" | "fill") => (i === 1 && j === 1 ? "fill" : `${kind}_${i}_${j}`);

/** Which bones show: a rim piece's edge when any side it's on draws the line, else its fill. */
function boneVisibility(): Record<string, string | boolean> {
  const visibility: Record<string, string | boolean> = { fill: true };
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const bits = rimBits(i, j);
      if (bits.length === 0) continue;
      visibility[pieceName(i, j, "edge")] = bits.map(isOn).join(" || ");
      visibility[pieceName(i, j, "fill")] = bits.map(isOff).join(" && ");
    }
  }
  return visibility;
}

/**
 * One plane: its grid's pieces, a pixel thick, `offset` pixels along its axis from the block's low
 * side (west, bottom, north). Block geometry mirrors x, so pixels x0 to x1 from the west are at
 * 8 - x1 in it.
 */
function plane(axis: Axis, offset: number): unknown {
  const [u, v] = inPlane(axis);
  const bones: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const kinds = rimBits(i, j).length === 0 ? (["fill"] as const) : (["edge", "fill"] as const);
      for (const kind of kinds) {
        const from = [0, 0, 0];
        const to = [16, 16, 16];
        [from[axis], to[axis]] = [offset, offset + 1];
        [from[u], to[u]] = SPANS[i];
        [from[v], to[v]] = SPANS[j];
        const uv = Object.fromEntries(FACES[axis].map((face) => [face, kind === "edge" ? EDGE_UV : FILL_UV]));
        const cube = { origin: [8 - to[0], from[1], from[2] - 8], size: [to[0] - from[0], to[1] - from[1], to[2] - from[2]], uv };
        bones.push({ name: pieceName(i, j, kind), pivot: [0, 0, 0], cubes: [cube] });
      }
    }
  }
  return { description: { identifier: geometryId(axis, offset), texture_width: 16, texture_height: 16 }, bones };
}

function material(color: string): unknown {
  // Evenly lit on every side: no darker faces and no corner shadows.
  return { "*": { texture: textureId(color), render_method: "blend", face_dimming: false, ambient_occlusion: false } };
}

export function planeBlockFiles(): Record<string, string | Buffer> {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const visibility = boneVisibility();
  const geometry = (axis: number, offset: number) => ({ identifier: geometryId(axis, offset), bone_visibility: visibility });
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
          ...Object.fromEntries(EDGE_STATES.map((state) => [state, ["false", "true"]])),
        },
      },
      components: {
        "minecraft:geometry": geometry(1, 0),
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
            components: { "minecraft:geometry": geometry(axis, offset) },
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
    // One line per plane: 48 geometries of 17 pieces each.
    "resource_pack/models/blocks/plane.geo.json": `{"format_version":"1.12.0","minecraft:geometry":[\n${AXES.flatMap((axis) => PIXELS.map((offset) => JSON.stringify(plane(axis, offset)))).join(",\n")}\n]}\n`,
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

/** A 16x16 picture in the color: the light fill on the left half, the edge line's on the right. */
function texture(rgb: number): Buffer {
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) data.set([rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff, x < 8 ? FILL_ALPHA : EDGE_ALPHA], (y * 16 + x) * 4);
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
