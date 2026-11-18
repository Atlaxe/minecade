// Block Party's space markers (docs/plans/block-party.md, "Space markers"): every space on the board
// is one model, blockparty:space, in two parts:
//
//   1. the perimeter: a thin plate, 1 or 2 pixels tall, the marker's whole footprint;
//   2. the pedestal: the raised part on it where the pieces stand, 6 to 8 pixels tall.
//
// The model is a Blockbench file, games/blockparty/resource_pack/models/entity/space.geo.json
// (geometry.blockparty.space). A cube is in the part its bone's name starts with ("perimeter" or
// "pedestal"), or its nearest parent bone's. Each part wears its space type's block texture from
// games/blockparty/spaces.json, a 16 x 16 picture, so the tool cuts every cube on the block grid (16
// pixels, the model's middle on a block's middle) and maps each piece's faces onto the part of the
// texture that block would show there: whatever size the cubes are, the marker looks laid in real
// blocks. Faces a cut leaves inside a cube aren't drawn; a cube's own faces are kept as Blockbench
// has them (a face taken off there stays off), and a new cube's bottom on the ground (y 0) is left
// off, since nothing sees it.
//
// The pedestal is stood on for real: under it the game puts an invisible block, blockparty:space_floor,
// in each block it covers, as tall as the pedestal (its top, in pixels), so the pieces step up onto it
// as onto a slab. Its floor is the pedestal's widest reach either way from the middle, the same on
// both sides. A space lights up (blockparty:lit) while a piece stands on it or a cutscene shows it:
// two of the four render controllers draw it at full light with the highlight's color laid over it.
//
// tools/blockparty/space-pack.ts writes what follows from the two files; this module works it out, so
// the tests can say when the files are out of date. Coordinates: Bedrock files keep x turned over from
// Blockbench's (origin x = -Blockbench's right edge), so the cutting works as Blockbench sees the model
// (east +x, north -z), as dice-model.ts does; block collision boxes mirror x too (paint-blocks.ts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BLOCK_PARTY_BOARD } from "@minecade/minigame-core/config";

/** Block Party's folder, its resource pack and behavior pack. */
export const GAME = fileURLToPath(new URL("../../games/blockparty/", import.meta.url));
export const PACK = join(GAME, "resource_pack");
export const BEHAVIOR = join(GAME, "behavior_pack");
/** The user's file: each type's textures and the highlight. */
export const SPACES_FILE = join(GAME, "spaces.json");
/** The model, in Blockbench. */
export const MODEL_FILE = join(PACK, "models", "entity", "space.geo.json");
/** What the game reads (space-markers.ts): the types' order, the pedestal's floor and the footprint. */
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
export const PARTS = ["perimeter", "pedestal"] as const;
export type Part = (typeof PARTS)[number];
/** The four render controllers: each part, plain and lit. */
export const CONTROLLERS: readonly { id: string; part: Part; lit: boolean }[] = PARTS.flatMap((part) => [
  { id: `controller.render.blockparty.space_${part}`, part, lit: false },
  { id: `controller.render.blockparty.space_${part}_lit`, part, lit: true },
]);

/** A block's width in pixels, and how far the marker may reach from its middle: 3 blocks across. */
export const BLOCK = 16;
export const MAX_REACH = 24;
/** How far from a space's middle a piece stands (board.ts, standAt), and half a piece's width, in pixels. */
const PIECE_CORNER = 0.7 * BLOCK;
const PIECE_HALF = 0.3 * BLOCK;
/** The highest a piece steps up while walking, in pixels (a slab's 8, and a little). */
export const STEP = 9;

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

/** A box as Blockbench sees it: from (low corner) to (high corner). */
interface Box {
  from: Vec3;
  to: Vec3;
}

const EPSILON = 1e-6;
const round = (value: number) => Math.round(value * 1e4) / 1e4;
/** Where `value` is in its block's 16 pixels, 0 to 16 (x and z on blocks centered on the middle, y on blocks from 0). */
const inBlock = (value: number, offset: number) => ((((value + offset) % BLOCK) + BLOCK) % BLOCK);

/** The grid lines strictly inside from..to on an axis: x and z at 8 + 16k (the middle on a block's middle), y at 16k. */
export function gridCuts(from: number, to: number, axis: number): number[] {
  const offset = axis === 1 ? 0 : BLOCK / 2;
  const lines: number[] = [];
  for (let line = Math.floor((from - offset) / BLOCK) * BLOCK + offset; line < to - EPSILON; line += BLOCK) if (line > from + EPSILON) lines.push(line);
  return lines;
}

/** A cube's box as Blockbench sees it (x turned back over). */
function boxOf(cube: Cube): Box {
  const [x, y, z] = cube.origin;
  const [w, h, d] = cube.size;
  return { from: [-(x + w), y, z], to: [-x, y + h, z + d] };
}

/** A cube's faces that are drawn: those Blockbench has (per face), else all but a bottom on the ground. */
function facesOf(cube: Cube): FaceName[] {
  if (cube.uv && !Array.isArray(cube.uv)) return FACES.filter((face) => face in (cube.uv as object));
  return FACES.filter((face) => !(face === "down" && Math.abs(cube.origin[1]) < EPSILON));
}

/**
 * A piece's faces on a 16 x 16 block texture: the part of the texture the block it's in shows there,
 * each face as seen from outside (u to the viewer's right, v down), as a real block's faces are.
 */
export function faceUv(face: FaceName, box: Box): FaceUv {
  const [x0, y0, z0] = box.from;
  const [x1, y1, z1] = box.to;
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const lx0 = inBlock(x0, BLOCK / 2);
  const lz0 = inBlock(z0, BLOCK / 2);
  // The top of the piece in its block (a top exactly on a block's top is 16, not 0).
  const ly1 = y1 - Math.floor((y0 + EPSILON) / BLOCK) * BLOCK;
  const side = (u: number, width: number): FaceUv => ({ uv: [round(u), round(BLOCK - ly1)], uv_size: [round(width), round(h)] });
  switch (face) {
    case "up":
      return { uv: [round(lx0), round(lz0)], uv_size: [round(w), round(d)] };
    case "down":
      return { uv: [round(lx0), round(BLOCK - lz0 - d)], uv_size: [round(w), round(d)] };
    case "north":
      return side(BLOCK - lx0 - w, w);
    case "south":
      return side(lx0, w);
    case "east":
      return side(BLOCK - lz0 - d, d);
    case "west":
      return side(lz0, d);
  }
}

/**
 * A cube cut on the block grid (in its own frame, so a turned cube's pieces turn with it), each
 * piece's faces mapped onto the block texture; faces a cut leaves inside the cube are left out. A
 * cube already inside one block comes back as it was, its faces mapped again.
 */
export function cutCube(cube: Cube): Cube[] {
  const box = boxOf(cube);
  const kept = facesOf(cube);
  const spans = [0, 1, 2].map((axis) => {
    const edges = [box.from[axis], ...gridCuts(box.from[axis], box.to[axis], axis), box.to[axis]];
    return edges.slice(0, -1).map((from, i) => [from, edges[i + 1]] as [number, number]);
  });
  // Whatever else the cube has (a turn, its pivot, inflate) each piece keeps.
  const rest: Record<string, unknown> = { ...cube };
  for (const key of ["origin", "size", "uv"]) delete rest[key];
  const pieces: Cube[] = [];
  for (const [x0, x1] of spans[0])
    for (const [y0, y1] of spans[1])
      for (const [z0, z1] of spans[2]) {
        const piece: Box = { from: [x0, y0, z0], to: [x1, y1, z1] };
        // A face on the cube's own outside (not on a cut) stays, if the cube had it.
        const outside: Record<FaceName, boolean> = {
          west: Math.abs(x0 - box.from[0]) < EPSILON,
          east: Math.abs(x1 - box.to[0]) < EPSILON,
          down: Math.abs(y0 - box.from[1]) < EPSILON,
          up: Math.abs(y1 - box.to[1]) < EPSILON,
          north: Math.abs(z0 - box.from[2]) < EPSILON,
          south: Math.abs(z1 - box.to[2]) < EPSILON,
        };
        const uv = Object.fromEntries(kept.filter((face) => outside[face]).map((face) => [face, faceUv(face, piece)]));
        pieces.push({
          origin: [round(-x1), round(y0), round(z0)],
          size: [round(x1 - x0), round(y1 - y0), round(z1 - z0)],
          uv,
          ...rest,
        });
      }
  return pieces;
}

/** The part a bone is in: its name's, else its nearest parent's. */
export function partOf(bone: Bone, bones: readonly Bone[]): Part | undefined {
  const seen = new Set<string>();
  for (let at: Bone | undefined = bone; at && !seen.has(at.name); at = bones.find((other) => other.name === at!.parent)) {
    seen.add(at.name);
    const part = PARTS.find((name) => at!.name.toLowerCase().startsWith(name));
    if (part) return part;
  }
  return undefined;
}

/** The marker's geometry in the model file, if it's there. */
export function markerGeometry(file: GeometryFile): Geometry | undefined {
  return file["minecraft:geometry"]?.find((geometry) => geometry.description?.identifier === GEOMETRY_ID);
}

/** What the game needs to know of the model, in pixels. */
export interface Measure {
  /** How far the marker reaches from its middle, x and z (the farther side), and its height. */
  reach: [number, number];
  height: number;
  /** The pedestal: how far it reaches from the middle either way (x, z), and its top. */
  pedestal: { reach: [number, number]; top: number };
}

/** The model's size (a turned cube counts as it would stand unturned). */
export function measure(geometry: Geometry): Measure {
  const reach: [number, number] = [0, 0];
  const pedestal = { reach: [0, 0] as [number, number], top: 0 };
  let height = 0;
  for (const bone of geometry.bones) {
    const part = partOf(bone, geometry.bones);
    for (const cube of bone.cubes ?? []) {
      const box = boxOf(cube);
      const x = Math.max(Math.abs(box.from[0]), Math.abs(box.to[0]));
      const z = Math.max(Math.abs(box.from[2]), Math.abs(box.to[2]));
      reach[0] = Math.max(reach[0], x);
      reach[1] = Math.max(reach[1], z);
      height = Math.max(height, box.to[1]);
      if (part !== "pedestal") continue;
      pedestal.reach[0] = Math.max(pedestal.reach[0], x);
      pedestal.reach[1] = Math.max(pedestal.reach[1], z);
      pedestal.top = Math.max(pedestal.top, box.to[1]);
    }
  }
  return { reach: [round(reach[0]), round(reach[1])], height: round(height), pedestal: { reach: [round(pedestal.reach[0]), round(pedestal.reach[1])], top: round(pedestal.top) } };
}

/** What's wrong with the model (nothing is written while there's anything), and what's worth knowing. */
export function modelProblems(file: GeometryFile): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const geometry = markerGeometry(file);
  if (!geometry) return { problems: [`The model has no ${GEOMETRY_ID}.`], warnings };
  if (!Array.isArray(geometry.bones)) return { problems: ["The model has no bones."], warnings };
  for (const bone of geometry.bones) {
    if ((bone.cubes?.length ?? 0) > 0 && !partOf(bone, geometry.bones)) problems.push(`Bone "${bone.name}" has cubes but is in neither part: name it (or a bone it's in) perimeter... or pedestal...`);
    for (const cube of bone.cubes ?? []) if (cube.size.some((size) => size < 0)) problems.push(`Bone "${bone.name}" has a cube of a size under 0.`);
  }
  const size = measure(geometry);
  if (!geometry.bones.some((bone) => partOf(bone, geometry.bones) === "pedestal" && (bone.cubes?.length ?? 0) > 0)) problems.push("The model has no pedestal (a bone named pedestal with cubes), so the pieces have nothing to stand on.");
  if (size.reach[0] > MAX_REACH + EPSILON || size.reach[1] > MAX_REACH + EPSILON) problems.push(`The marker reaches ${Math.max(...size.reach)} pixels from its middle; keep it within ${MAX_REACH} (3 blocks across), the footprint a space has on the board.`);
  if (size.pedestal.top > BLOCK) problems.push(`The pedestal's top is ${size.pedestal.top} pixels up; keep it within a block (16).`);
  else if (size.pedestal.top > STEP) warnings.push(`The pedestal's top is ${size.pedestal.top} pixels up: a walking piece steps up at most about ${STEP} (a slab is 8), so it may stop at the edge.`);
  const room = PIECE_CORNER + PIECE_HALF;
  if (size.pedestal.reach.some((reach) => reach > 0 && reach < room - EPSILON)) warnings.push(`The pedestal reaches ${Math.min(...size.pedestal.reach)} pixels from its middle; four pieces on its corners need ${round(room)}, so they hang over its edge.`);
  return { problems, warnings };
}

/** The model with every cube cut on the block grid and its description set (16 x 16 texture, its visible bounds). */
export function cutModel(file: GeometryFile): GeometryFile {
  return {
    ...file,
    "minecraft:geometry": file["minecraft:geometry"].map((geometry) => {
      if (geometry.description.identifier !== GEOMETRY_ID) return geometry;
      const size = measure(geometry);
      const across = round((2 * Math.max(...size.reach)) / BLOCK + 0.5);
      return {
        ...geometry,
        description: {
          ...geometry.description,
          texture_width: BLOCK,
          texture_height: BLOCK,
          visible_bounds_width: across,
          visible_bounds_height: round(size.height / BLOCK + 0.5),
          visible_bounds_offset: [0, round(size.height / BLOCK / 2), 0],
        },
        bones: geometry.bones.map((bone) => (bone.cubes ? { ...bone, cubes: bone.cubes.flatMap(cutCube) } : bone)),
      };
    }),
  };
}

// ---- The floor under the pedestal ----------------------------------------------------------------

/** One block of the pedestal's floor: where it is from the space's block (east +x, south +z), its cell state, its box. */
export interface FloorCell {
  dx: number;
  dz: number;
  cell: number;
  /** Bedrock's collision box (x mirrored, from the block's bottom middle). */
  origin: Vec3;
  size: Vec3;
}

/** The blocks the pedestal's floor takes: each of the 3 x 3 around the space's own block it covers. */
export function floorCells(size: Measure): FloorCell[] {
  const [rx, rz] = size.pedestal.reach;
  const top = size.pedestal.top;
  const cells: FloorCell[] = [];
  if (top <= 0) return cells;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      // The pedestal's span in this block, from the block's middle (as the world has it, east +x).
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
  types: Record<string, Record<Part, string>>;
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
  for (const id of TYPE_IDS) if (!types[id]) problems.push(`"types" has no "${id}".`);
  for (const [id, textures] of Object.entries(types)) {
    if (!TYPE_IDS.includes(id)) problems.push(`"${id}" isn't a space type (the types are ${TYPE_IDS.join(", ")}).`);
    for (const part of PARTS) {
      const path = textures?.[part];
      if (typeof path !== "string" || !TEXTURE_PATH.test(path)) problems.push(`${id}'s ${part} should be a texture's path, like "textures/blocks/concrete_blue" (no .png).`);
    }
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

const textureKey = (part: Part, type: string) => `${part}_${type}`;

/** The client entity: every type's two textures, the model, the four render controllers. */
export function clientEntity(file: SpacesFile): object {
  const textures: Record<string, string> = {};
  for (const part of PARTS) for (const type of TYPE_IDS) textures[textureKey(part, type)] = file.types[type][part];
  return {
    format_version: "1.10.0",
    "minecraft:client_entity": {
      description: {
        identifier: ENTITY_ID,
        materials: { default: "entity_alphatest" },
        textures,
        geometry: { default: GEOMETRY_ID },
        render_controllers: CONTROLLERS.map((controller) => controller.id),
      },
    },
  };
}

/** The bones of each part (a part's render controllers show only its own). */
export function bonesOf(geometry: Geometry): Record<Part, string[]> {
  const out: Record<Part, string[]> = { perimeter: [], pedestal: [] };
  for (const bone of geometry.bones) {
    const part = partOf(bone, geometry.bones);
    if (part) out[part].push(bone.name);
  }
  return out;
}

const hexColor = (color: string) => [1, 3, 5].map((at) => round(parseInt(color.slice(at, at + 2), 16) / 255));

/** The four render controllers: each part in its type's texture, plain while the space isn't lit, at full light with the highlight laid over it while it is. */
export function renderControllers(file: SpacesFile, bones: Record<Part, string[]>): Record<string, object> {
  const type = `q.property('${TYPE_PROPERTY}')`;
  const lit = `q.property('${LIT_PROPERTY}')`;
  const { color, strength, pulse, seconds } = file.highlight;
  const [r, g, b] = hexColor(color);
  const out: Record<string, object> = {};
  for (const controller of CONTROLLERS) {
    const array = `Array.${controller.part}`;
    out[controller.id] = {
      arrays: { textures: { [array]: TYPE_IDS.map((id) => `Texture.${textureKey(controller.part, id)}`) } },
      geometry: "Geometry.default",
      materials: [{ "*": "Material.default" }],
      textures: [`${array}[${type}]`],
      part_visibility: [{ "*": false }, ...bones[controller.part].map((bone) => ({ [bone]: controller.lit ? lit : `!${lit}` }))],
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

/** What the game reads (space-markers.ts): the types in the render controllers' order, the floor's blocks and the sizes, in pixels. */
export function modelInfo(size: Measure, cells: readonly FloorCell[]): object {
  return {
    about: "Written by tools/blockparty/space-pack.ts from the space marker model and spaces.json (don't edit it): what the game needs to know of the model, in pixels.",
    types: TYPE_IDS,
    reach: size.reach,
    height: size.height,
    pedestal: size.pedestal,
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
