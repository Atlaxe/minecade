// Block Party's space markers (docs/plans/block-party.md, "Space markers"): every space on the board
// is one model, blockparty:space, a pedestal the pieces stand on, 6 pixels tall (the user,
// 2026-11-18: no perimeter plate, and low enough to walk up onto like a slab or a stair).
//
// The model is a Blockbench file, games/blockparty/resource_pack/models/entity/space.geo.json
// (geometry.blockparty.space). It wears its space type's block texture from
// games/blockparty/spaces.json, a 16 x 16 picture, stretched once over each face of each cube (the
// user: one block's texture over the whole top, and over each side, rather than a block's worth every
// 16 pixels). The tool sets every face's mapping so; the faces a cube has stay as Blockbench has them
// (a face taken off there stays off), and a new cube's bottom on the ground (y 0) is left off, since
// nothing sees it.
//
// The pedestal is stood on for real: under it the game puts an invisible block, blockparty:space_floor,
// in each block it covers, as tall as the model's top (in pixels), so the pieces stand on it. Its floor
// is the model's widest reach either way from the middle, the same on both sides. A space lights up
// (blockparty:lit) while a piece stands on it or a cutscene shows it: the lit render controller draws
// it at full light with the highlight's color laid over it.
//
// tools/blockparty/space-pack.ts writes what follows from the two files; this module works it out, so
// the tests can say when the files are out of date. Coordinates: Bedrock files keep x turned over from
// Blockbench's (origin x = -Blockbench's right edge), as dice-model.ts has it; block collision boxes
// mirror x too (paint-blocks.ts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BLOCK_PARTY_BOARD } from "@minecade/minigame-core/config";

/** Block Party's folder, its resource pack and behavior pack. */
export const GAME = fileURLToPath(new URL("../../games/blockparty/", import.meta.url));
export const PACK = join(GAME, "resource_pack");
export const BEHAVIOR = join(GAME, "behavior_pack");
/** The user's file: each type's texture and the highlight. */
export const SPACES_FILE = join(GAME, "spaces.json");
/** The model, in Blockbench. */
export const MODEL_FILE = join(PACK, "models", "entity", "space.geo.json");
/** What the game reads (space-markers.ts): the types' order, the floor and the sizes. */
export const INFO_FILE = join(GAME, "space-model.json");
export const ENTITY_FILE = join(PACK, "entity", "space.entity.json");
export const CONTROLLERS_FILE = join(PACK, "render_controllers", "blockparty.render_controllers.json");
export const FLOOR_FILE = join(BEHAVIOR, "blocks", "space_floor.json");
export const TERRAIN_FILE = join(PACK, "textures", "terrain_texture.json");
/** The floor block's texture: clear, so the block is never seen. */
export const FLOOR_TEXTURE = "textures/blockparty/space_floor";
/** Pictures of the user's own for spaces.json: textures/blockparty/spaces/<name>. */
export const OWN_PICTURES = "textures/blockparty/spaces";

export const GEOMETRY_ID = "geometry.blockparty.space";
export const ENTITY_ID = "blockparty:space";
export const FLOOR_BLOCK = "blockparty:space_floor";
export const FLOOR_TEXTURE_ID = "blockparty_space_floor";
export const CELL_STATE = "blockparty:cell";
export const TYPE_PROPERTY = "blockparty:type";
export const LIT_PROPERTY = "blockparty:lit";
/** Every render controller of the markers' starts so (an old one the tool no longer writes is taken out). */
export const CONTROLLER_PREFIX = "controller.render.blockparty.space";
/** The two render controllers: plain, and lit. */
export const CONTROLLERS: readonly { id: string; lit: boolean }[] = [
  { id: CONTROLLER_PREFIX, lit: false },
  { id: `${CONTROLLER_PREFIX}_lit`, lit: true },
];

/** A block's width in pixels, and how far the marker may reach from its middle: 3 blocks across. */
export const BLOCK = 16;
export const MAX_REACH = 24;
/** How far from a space's middle a piece stands (board.ts, standAt), and half a piece's width, in pixels. */
const PIECE_CORNER = 0.7 * BLOCK;
const PIECE_HALF = 0.3 * BLOCK;
/** The tallest step the walk lifts a piece up (pieces.ts): half a block, a slab's or a stair's. */
export const STEP = 8;

// ---- The model's shapes ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];
export type FaceName = "north" | "south" | "east" | "west" | "up" | "down";
export const FACES: readonly FaceName[] = ["north", "east", "south", "west", "up", "down"];
export interface FaceUv {
  uv: [number, number];
  uv_size: [number, number];
  [key: string]: unknown;
}
export interface Cube {
  origin: Vec3;
  size: Vec3;
  uv?: [number, number] | Partial<Record<FaceName, FaceUv>>;
  pivot?: Vec3;
  rotation?: Vec3;
  inflate?: number;
  [key: string]: unknown;
}
export interface Bone {
  name: string;
  parent?: string;
  pivot?: Vec3;
  rotation?: Vec3;
  cubes?: Cube[];
  [key: string]: unknown;
}
export interface Geometry {
  description: { identifier: string; [key: string]: unknown };
  bones: Bone[];
}
export interface GeometryFile {
  format_version: string;
  "minecraft:geometry": Geometry[];
}

const EPSILON = 1e-6;
const round = (value: number) => Math.round(value * 1e4) / 1e4;
/** The whole texture on a face, stretched over it. */
const WHOLE: FaceUv = { uv: [0, 0], uv_size: [BLOCK, BLOCK] };

/** A cube's faces that are drawn: those Blockbench has (per face), else all but a bottom on the ground. */
function facesOf(cube: Cube): FaceName[] {
  if (cube.uv && !Array.isArray(cube.uv)) return FACES.filter((face) => face in (cube.uv as object));
  return FACES.filter((face) => !(face === "down" && Math.abs(cube.origin[1]) < EPSILON));
}

/** A cube with the block texture stretched once over each of its faces. */
export function fitCube(cube: Cube): Cube {
  return { ...cube, uv: Object.fromEntries(facesOf(cube).map((face) => [face, { ...WHOLE }])) };
}

/** The marker's geometry in the model file, if it's there. */
export function markerGeometry(file: GeometryFile): Geometry | undefined {
  return file["minecraft:geometry"]?.find((geometry) => geometry.description?.identifier === GEOMETRY_ID);
}

/** What the game needs to know of the model, in pixels: how far it reaches from its middle (x and z, the farther side), and its top. */
export interface Measure {
  reach: [number, number];
  top: number;
}

/** The model's size (a turned cube counts as it would stand unturned). */
export function measure(geometry: Geometry): Measure {
  const reach: [number, number] = [0, 0];
  let top = 0;
  for (const bone of geometry.bones)
    for (const cube of bone.cubes ?? []) {
      const [x, y, z] = cube.origin;
      const [w, h, d] = cube.size;
      reach[0] = Math.max(reach[0], Math.abs(x), Math.abs(x + w));
      reach[1] = Math.max(reach[1], Math.abs(z), Math.abs(z + d));
      top = Math.max(top, y + h);
    }
  return { reach: [round(reach[0]), round(reach[1])], top: round(top) };
}

/** What's wrong with the model (nothing is written while there's anything), and what's worth knowing. */
export function modelProblems(file: GeometryFile): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const geometry = markerGeometry(file);
  if (!geometry) return { problems: [`The model has no ${GEOMETRY_ID}.`], warnings };
  if (!Array.isArray(geometry.bones)) return { problems: ["The model has no bones."], warnings };
  const cubes = geometry.bones.flatMap((bone) => bone.cubes ?? []);
  if (cubes.length === 0) problems.push("The model has no cubes, so the pieces have nothing to stand on.");
  if (cubes.some((cube) => cube.size.some((size) => size < 0))) problems.push("The model has a cube of a size under 0.");
  const size = measure(geometry);
  if (size.reach[0] > MAX_REACH + EPSILON || size.reach[1] > MAX_REACH + EPSILON) problems.push(`The marker reaches ${Math.max(...size.reach)} pixels from its middle; keep it within ${MAX_REACH} (3 blocks across), the footprint a space has on the board.`);
  if (size.top > BLOCK) problems.push(`The marker's top is ${size.top} pixels up; keep it within a block (16).`);
  else if (size.top > STEP) warnings.push(`The marker's top is ${size.top} pixels up: the walk lifts a piece up a step of at most ${STEP} (a slab's), so it may stop at the edge.`);
  const room = PIECE_CORNER + PIECE_HALF;
  if (size.reach.some((reach) => reach > 0 && reach < room - EPSILON)) warnings.push(`The marker reaches ${Math.min(...size.reach)} pixels from its middle; four pieces on its corners need ${round(room)}, so they hang over its edge.`);
  return { problems, warnings };
}

/** The model with the texture stretched over every face and its description set (16 x 16 texture, its visible bounds). */
export function fitModel(file: GeometryFile): GeometryFile {
  return {
    ...file,
    "minecraft:geometry": file["minecraft:geometry"].map((geometry) => {
      if (geometry.description.identifier !== GEOMETRY_ID) return geometry;
      const size = measure(geometry);
      return {
        ...geometry,
        description: {
          ...geometry.description,
          texture_width: BLOCK,
          texture_height: BLOCK,
          visible_bounds_width: round((2 * Math.max(...size.reach)) / BLOCK + 0.5),
          visible_bounds_height: round(size.top / BLOCK + 0.5),
          visible_bounds_offset: [0, round(size.top / BLOCK / 2), 0],
        },
        bones: geometry.bones.map((bone) => (bone.cubes ? { ...bone, cubes: bone.cubes.map(fitCube) } : bone)),
      };
    }),
  };
}

// ---- The floor under the marker ------------------------------------------------------------------

/** One block of the marker's floor: where it is from the space's block (east +x, south +z), its cell state, its box. */
export interface FloorCell {
  dx: number;
  dz: number;
  cell: number;
  /** Bedrock's collision box (x mirrored, from the block's bottom middle). */
  origin: Vec3;
  size: Vec3;
}

/** The blocks the marker's floor takes: each of the 3 x 3 around the space's own block it covers. */
export function floorCells(size: Measure): FloorCell[] {
  const [rx, rz] = size.reach;
  const top = size.top;
  const cells: FloorCell[] = [];
  if (top <= 0) return cells;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      // The marker's span in this block, from the block's middle (as the world has it, east +x).
      const x0 = Math.max(-rx, dx * BLOCK - BLOCK / 2) - dx * BLOCK;
      const x1 = Math.min(rx, dx * BLOCK + BLOCK / 2) - dx * BLOCK;
      const z0 = Math.max(-rz, dz * BLOCK - BLOCK / 2) - dz * BLOCK;
      const z1 = Math.min(rz, dz * BLOCK + BLOCK / 2) - dz * BLOCK;
      if (x1 - x0 < EPSILON || z1 - z0 < EPSILON) continue;
      cells.push({ dx, dz, cell: (dz + 1) * 3 + (dx + 1), origin: [round(-x1), 0, round(z0)], size: [round(x1 - x0), round(top), round(z1 - z0)] });
    }
  return cells;
}

/** The floor block: clear, no outline, its collision box picked by its cell state. */
export function floorBlock(cells: readonly FloorCell[]): object {
  return {
    format_version: "1.26.0",
    "minecraft:block": {
      description: {
        identifier: FLOOR_BLOCK,
        menu_category: { category: "none" },
        states: { [CELL_STATE]: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      },
      components: {
        "minecraft:geometry": "minecraft:geometry.full_block",
        "minecraft:material_instances": { "*": { texture: FLOOR_TEXTURE_ID, render_method: "alpha_test" } },
        "minecraft:collision_box": false,
        "minecraft:selection_box": false,
        "minecraft:light_dampening": 0,
        "minecraft:destructible_by_mining": false,
        "minecraft:destructible_by_explosion": false,
      },
      permutations: cells.map((cell) => ({
        condition: `q.block_state('${CELL_STATE}') == ${cell.cell}`,
        components: { "minecraft:collision_box": { origin: cell.origin, size: cell.size } },
      })),
    },
  };
}

// ---- spaces.json --------------------------------------------------------------------------------

export interface Highlight {
  color: string;
  strength: number;
  pulse: number;
  seconds: number;
}
export interface SpacesFile {
  highlight: Highlight;
  /** Each type's texture, by type id. */
  types: Record<string, string>;
}

/** The board's types, Start first (BLOCK_PARTY_BOARD): spaces.json has every one. */
export const TYPE_IDS: readonly string[] = BLOCK_PARTY_BOARD.types.map((type) => type.id);

export function readSpaces(path = SPACES_FILE): SpacesFile {
  return JSON.parse(readFileSync(path, "utf8")) as SpacesFile;
}

const TEXTURE_PATH = /^textures\/[\w./-]+$/;

/** What's wrong with spaces.json (nothing is written while there's anything). */
export function spacesProblems(file: SpacesFile): string[] {
  const problems: string[] = [];
  const types = file.types ?? {};
  for (const id of TYPE_IDS) if (!(id in types)) problems.push(`"types" has no "${id}".`);
  for (const [id, path] of Object.entries(types)) {
    if (!TYPE_IDS.includes(id)) problems.push(`"${id}" isn't a space type (the types are ${TYPE_IDS.join(", ")}).`);
    if (typeof path !== "string" || !TEXTURE_PATH.test(path)) problems.push(`${id}'s texture should be a texture's path, like "textures/blocks/concrete_blue" (no .png).`);
  }
  const highlight = file.highlight;
  if (!highlight || !/^#[0-9a-fA-F]{6}$/.test(highlight.color ?? "")) problems.push('"highlight" needs a "color" like "#FFFFFF".');
  else {
    const { strength, pulse, seconds } = highlight;
    if (![strength, pulse, seconds].every((value) => typeof value === "number" && Number.isFinite(value))) problems.push('"highlight" needs numbers for "strength", "pulse" and "seconds".');
    else {
      if (strength - pulse < 0 || strength + pulse > 1) problems.push(`The highlight goes from ${round(strength - pulse)} to ${round(strength + pulse)}; keep strength minus pulse at 0 or more and strength plus pulse at 1 or less.`);
      if (seconds <= 0) problems.push('The highlight\'s "seconds" must be more than 0.');
    }
  }
  return problems;
}

/** A texture of the user's own in the pack (textures/blockparty/spaces/<name>), as a file, if it's there. */
export function ownPicture(path: string, pack = PACK): string | undefined {
  if (!path.startsWith(`${OWN_PICTURES}/`)) return undefined;
  const file = join(pack, `${path}.png`);
  return existsSync(file) ? file : undefined;
}

// ---- The entity and its render controllers --------------------------------------------------------

const textureKey = (type: string) => `type_${type}`;

/** The client entity: every type's texture, the model, the two render controllers. */
export function clientEntity(file: SpacesFile): object {
  return {
    format_version: "1.10.0",
    "minecraft:client_entity": {
      description: {
        identifier: ENTITY_ID,
        materials: { default: "entity_alphatest" },
        textures: Object.fromEntries(TYPE_IDS.map((type) => [textureKey(type), file.types[type]])),
        geometry: { default: GEOMETRY_ID },
        render_controllers: CONTROLLERS.map((controller) => controller.id),
      },
    },
  };
}

const hexColor = (color: string) => [1, 3, 5].map((at) => round(parseInt(color.slice(at, at + 2), 16) / 255));

/** The two render controllers: the model in its type's texture, plain while the space isn't lit, at full light with the highlight laid over it while it is. */
export function renderControllers(file: SpacesFile): Record<string, object> {
  const type = `q.property('${TYPE_PROPERTY}')`;
  const lit = `q.property('${LIT_PROPERTY}')`;
  const { color, strength, pulse, seconds } = file.highlight;
  const [r, g, b] = hexColor(color);
  const out: Record<string, object> = {};
  for (const controller of CONTROLLERS) {
    out[controller.id] = {
      arrays: { textures: { "Array.types": TYPE_IDS.map((id) => `Texture.${textureKey(id)}`) } },
      geometry: "Geometry.default",
      materials: [{ "*": "Material.default" }],
      textures: [`Array.types[${type}]`],
      part_visibility: [{ "*": controller.lit ? lit : `!${lit}` }],
      ...(controller.lit
        ? {
            ignore_lighting: true,
            overlay_color: { r, g, b, a: pulse > 0 ? `${round(strength)} + ${round(pulse)} * math.sin(q.life_time * ${round(360 / seconds)})` : String(round(strength)) },
          }
        : {}),
    };
  }
  return out;
}

/** The render controllers file with the markers' controllers as they should be (any old one of theirs taken out). */
export function withControllers(file: { render_controllers: Record<string, unknown> }, controllers: Record<string, object>): { render_controllers: Record<string, unknown> } {
  const kept = Object.entries(file.render_controllers).filter(([id]) => id !== CONTROLLER_PREFIX && !id.startsWith(`${CONTROLLER_PREFIX}_`));
  return { ...file, render_controllers: { ...Object.fromEntries(kept), ...controllers } };
}

/** What the game reads (space-markers.ts): the types in the render controllers' order, the floor's blocks and the sizes, in pixels. */
export function modelInfo(size: Measure, cells: readonly FloorCell[]): object {
  return {
    about: "Written by tools/blockparty/space-pack.ts from the space marker model and spaces.json (don't edit it): what the game needs to know of the model, in pixels.",
    types: TYPE_IDS,
    reach: size.reach,
    top: size.top,
    floor: cells.map(({ dx, dz, cell }) => ({ dx, dz, cell })),
  };
}

/** The terrain texture entry for the floor block's clear texture. */
export function terrainTextures(existing: Record<string, unknown> | undefined): object {
  const data = (existing?.texture_data as Record<string, unknown> | undefined) ?? {};
  return {
    resource_pack_name: "minecade_blockparty",
    texture_name: "atlas.terrain",
    padding: 8,
    num_mip_levels: 4,
    ...existing,
    texture_data: { ...data, [FLOOR_TEXTURE_ID]: { textures: FLOOR_TEXTURE } },
  };
}

// ---- Writing JSON ---------------------------------------------------------------------------------

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** JSON with anything that fits in `width` characters on one line (a cube a line). */
export function compact(value: unknown, indent = "", width = 160): string {
  const flat = JSON.stringify(value);
  if (typeof value !== "object" || value === null || flat.length + indent.length <= width) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((item) => inner + compact(item, inner, width)).join(",\n")}\n${indent}]`;
  return `{\n${Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${compact(item, inner, width)}`).join(",\n")}\n${indent}}`;
}

/** The model file's text: a cube a line. */
export function modelText(file: GeometryFile): string {
  return `${compact(file, "", 240)}\n`;
}
