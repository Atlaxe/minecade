// Block Party's die model, in two layers (docs/plans/block-party.md, "The dice file"). The die is the
// size of a player head (8 x 8 x 8), spun over the roller's head by blockparty:die (spike.ts, putDie):
//
//   1. its body: the die's texture from the dice file, one 8 x 8 square worn on every face (the
//      "plain" geometry) or six squares, 24 x 16 (faces 1 to 3 on the top row, 4 to 6 under them);
//   2. its faces: each face's value raised off it, half a body pixel deep. A face whose show text has
//      a picture (resource_pack/textures/blockparty/dice/faces/<show>.png, the item panel's face
//      pictures) gets the picture, each pixel a little block of its color; any other face gets its
//      show text in the game's Minecraft Ten font (ten-font.ts), in the die's ink, and its shadow
//      (the dice file's "shadow") a pixel right and down, raised half as far.
//
// Each layer is its own render controller on the one entity (controller.render.blockparty.die and
// .die_faces), both moving the bone "die", so the spin turns them together. The faces are geometry,
// one per die (geometry.blockparty.die_faces.<id>), colored from a palette texture of one pixel per
// color (textures/blockparty/die_palette). A die bursts when it's hit: its burst particle
// (blockparty:die_burst_<id>) throws chips of its body's texture.
//
// The moves left over a walker's head after a roll (blockparty:count, counts.ts) are drawn the same
// way, in the dice file's "number" look: geometry.blockparty.count holds every digit, a bone each
// (a digit alone, and a two-digit number's tens and ones), and its render controller shows the ones
// its count property names. The digits face the camera (animation.blockparty.count_face).
//
// tools/blockparty/dice-pack.ts writes it all; this module plans it (what each die's body and faces
// are) without the font, so the tests can say when the files are out of date (the plan is kept in
// PLAN_FILE).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COUNT_PROPERTY, DICE, NUMBER, burstParticle, modelDice, type DieDef, type DieFace, type NumberLook } from "../../games/blockparty/behavior_pack/scripts/dice.ts";
import { blankImage, type Image } from "../skins/png.ts";
import { decodeAnyPng } from "../viewer/png.ts";
import type { TenFont, TextPixels } from "./ten-font.ts";

/** Block Party's resource pack. */
export const PACK = fileURLToPath(new URL("../../games/blockparty/resource_pack/", import.meta.url));
/** What the last run of the dice tool made the model from. */
export const PLAN_FILE = fileURLToPath(new URL("./dice-model.json", import.meta.url));
/** The face pictures' folder in the pack (the item panel's too): <show>.png. */
export const FACE_PICTURES = "textures/blockparty/dice/faces";
/** The faces' colors, one pixel each (written by the dice tool). */
export const PALETTE = "textures/blockparty/die_palette";
/** The body for no die in particular (property 0). */
export const BLANK_DIE = "textures/blocks/concrete_white";
/** Bumped when the way the faces are made changes, so the tests ask for a new run. */
const MAKER = 2;

/** The body's geometries: one square on every face, or six. */
export const BODY_GEOMETRY = { plain: "geometry.blockparty.die_plain", six: "geometry.blockparty.die" } as const;
export type Layout = keyof typeof BODY_GEOMETRY;
/** The faces' geometry for no die (no faces), and each die's. */
export const BLANK_FACES = "geometry.blockparty.die_faces";
export const facesGeometry = (id: string) => `${BLANK_FACES}.${id}`;
/** A die's burst particle's file in the pack (its effect is dice.ts's burstParticle). */
export const burstFile = (id: string) => `particles/die_burst_${id}.json`;

/** What a face shows: its text in the font and ink (and its shadow's color), its picture (by show text, with the file's hash), or nothing. */
export type FacePlan = { text: string; ink: string; shadow?: string } | { picture: string; hash: string } | Record<string, never>;
export interface DiePlan {
  id: string;
  texture: string;
  layout: Layout;
  faces: FacePlan[];
}
export interface ModelPlan {
  maker: number;
  dice: DiePlan[];
  /** The moves left over a walker's head: its ink and shadow. */
  number: NumberLook;
}

/** A picture's size from its PNG header. */
function pngSize(path: string): { width: number; height: number } {
  const head = readFileSync(path).subarray(0, 24);
  if (head.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

/** The die body's layout for `texture`: from its picture in the pack, or "plain" for one of Minecraft's own (a square). */
function layoutOf(texture: string, pack: string, problem: (text: string) => void): Layout {
  const file = join(pack, `${texture}.png`);
  if (!existsSync(file)) {
    if (texture.startsWith("textures/blockparty/")) problem(`"texture": there's no picture at resource_pack/${texture}.png`);
    return "plain";
  }
  try {
    const { width, height } = pngSize(file);
    if (width === height && width % 8 === 0) return "plain";
    if (width * 2 === height * 3 && width % 24 === 0) return "six";
    problem(`"texture": ${texture}.png is ${width} x ${height}; a die's body is 8 x 8 (every face) or 24 x 16 (six faces), or the same at 2x, 3x...`);
  } catch (error) {
    problem(`"texture": ${texture}.png can't be read (${(error as Error).message})`);
  }
  return "plain";
}

/** A file name can't hold these, so a show text with one never has a picture. */
const NOT_IN_NAMES = /[\\/:*?"<>|]/;

/** The face picture for a show text, if the pack has one: its path. */
export function facePicture(show: string, pack: string = PACK): string | undefined {
  if (show.trim() === "" || NOT_IN_NAMES.test(show)) return undefined;
  const file = join(pack, FACE_PICTURES, `${show}.png`);
  return existsSync(file) ? file : undefined;
}

/** What a face shows: its picture if the pack has one for its show text, else its text (in its ink, with its shadow), or nothing. */
export function facePlan(face: DieFace, pack: string = PACK): FacePlan {
  const picture = facePicture(face.show, pack);
  if (picture) return { picture: face.show, hash: createHash("sha1").update(readFileSync(picture)).digest("hex").slice(0, 12) };
  if (face.show.trim() === "") return {};
  return { text: face.show, ink: face.ink, ...(face.shadow ? { shadow: face.shadow } : {}) };
}

/** The model's plan from the dice file and the pack's pictures, and anything wrong with them. */
export function modelPlan(dice: readonly DieDef[] = modelDice(Object.values(DICE)), pack: string = PACK, number: NumberLook = NUMBER): { plan: ModelPlan; problems: string[] } {
  const problems: string[] = [];
  const plans = dice.map((die): DiePlan => {
    const texture = die.texture ?? BLANK_DIE;
    const layout = layoutOf(texture, pack, (text) => problems.push(`${die.id}: ${text}`));
    return { id: die.id, texture, layout, faces: die.faces.map((face) => facePlan(face, pack)) };
  });
  return { plan: { maker: MAKER, dice: plans, number }, problems };
}

/**
 * What the model's client entity and render controllers list for a plan: the textures and
 * geometries by name (die.entity.json), and the arrays blockparty:die picks from, the blank die
 * first (modelIndex in dice.ts).
 */
export function modelFiles(plan: ModelPlan): {
  textures: Record<string, string>;
  geometry: Record<string, string>;
  bodies: string[];
  dice: string[];
  faces: string[];
} {
  const textures: Record<string, string> = { default: BLANK_DIE, palette: PALETTE };
  const geometry: Record<string, string> = { default: BODY_GEOMETRY.six, plain: BODY_GEOMETRY.plain, faces: BLANK_FACES };
  const bodies = ["Geometry.plain"];
  const dice = ["Texture.default"];
  const faces = ["Geometry.faces"];
  for (const die of plan.dice) {
    textures[`die_${die.id}`] = die.texture;
    geometry[`faces_${die.id}`] = facesGeometry(die.id);
    bodies.push(die.layout === "six" ? "Geometry.default" : "Geometry.plain");
    dice.push(`Texture.die_${die.id}`);
    faces.push(`Geometry.faces_${die.id}`);
  }
  return { textures, geometry, bodies, dice, faces };
}

// ---- The faces' geometry ----------------------------------------------------------------------

/** A face's value as pixels: each a color ("#rrggbb") or undefined (nothing there), rows top to bottom. */
export interface FacePixels {
  width: number;
  height: number;
  colors: (string | undefined)[];
}

/** Half the die's side, and the middle of it (model units: a player head is 8). */
const HALF = 4;
const MIDDLE_Y = 8;
/** How far the values stand off the face, and their shadows. */
export const RELIEF = 0.5;
const SHADOW_RELIEF = 0.25;
/** A value's pixel at most (half a body pixel: Minecraft Ten's 10-pixel digits are 5 units high). */
const PIXEL = 0.5;
/** The room a face's text has across (half a unit spare each side), and a picture's (the whole face). */
const TEXT_ROOM = 7;
const PICTURE_ROOM = 8;
/** How far a shadow sits from its text, right and down, in the text's pixels (Minecraft's one). */
const SHADOW_OFFSET = 1;

type Vector = [number, number, number];
/** The six faces in the dice file's order (1 up, 6 down, opposites adding up to 7): each one's outward direction and which way its value's top points. */
export const SIDES: readonly { name: string; out: Vector; up: Vector }[] = [
  { name: "up", out: [0, 1, 0], up: [0, 0, -1] },
  { name: "north", out: [0, 0, -1], up: [0, 1, 0] },
  { name: "east", out: [1, 0, 0], up: [0, 1, 0] },
  { name: "west", out: [-1, 0, 0], up: [0, 1, 0] },
  { name: "south", out: [0, 0, 1], up: [0, 1, 0] },
  { name: "down", out: [0, -1, 0], up: [0, 0, 1] },
];
const SOUTH = 4;
const FACE_NAMES: Record<string, string> = { "1,0,0": "east", "-1,0,0": "west", "0,1,0": "up", "0,-1,0": "down", "0,0,-1": "north", "0,0,1": "south" };

/**
 * Where a face's pixels stand: `half` out from the middle along the side's direction, `relief` deep,
 * the middle `middle` units up, and the pixels moved `shift` units (right, up) as seen from outside.
 */
export interface Placing {
  half: number;
  relief: number;
  middle: number;
  shift?: [number, number];
}
/** On a die's face: raised off it. */
const ON_FACE: Placing = { half: HALF, relief: RELIEF, middle: MIDDLE_Y };

/** The pixels as rectangles of one color each (fewest cubes): [column, row, width, height, color]. */
export function rectangles(pixels: FacePixels): [number, number, number, number, string][] {
  const { width, height, colors } = pixels;
  const used = new Array<boolean>(colors.length).fill(false);
  const out: [number, number, number, number, string][] = [];
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const color = colors[row * width + column];
      if (color === undefined || used[row * width + column]) continue;
      let wide = 1;
      while (column + wide < width && !used[row * width + column + wide] && colors[row * width + column + wide] === color) wide++;
      let high = 1;
      const rowFits = (r: number) => {
        for (let c = column; c < column + wide; c++) if (used[r * width + c] || colors[r * width + c] !== color) return false;
        return true;
      };
      while (row + high < height && rowFits(row + high)) high++;
      for (let r = row; r < row + high; r++) for (let c = column; c < column + wide; c++) used[r * width + c] = true;
      out.push([column, row, wide, high, color]);
    }
  }
  return out;
}

const round = (value: number) => Math.round(value * 10000) / 10000 + 0;
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const negate = (a: Vector): Vector => [-a[0], -a[1], -a[2]];

/**
 * The cubes standing `pixels` on face `side` (0 to 5), `pixel` units a pixel, centered, each cube's
 * five outer faces showing its color's palette pixel (`uvOf`). Worked out as Blockbench sees a model
 * (east +x, north -z: the right way round from outside) and written as Bedrock files keep it, x
 * turned over (origin x = -right edge), as Blockbench's own export does.
 */
export function faceCubes(pixels: FacePixels, side: number, pixel: number, uvOf: (color: string) => [number, number], place: Placing = ON_FACE): object[] {
  const { out, up } = SIDES[side];
  const right = cross(negate(out), up);
  const [shiftRight, shiftUp] = place.shift ?? [0, 0];
  const cubes: object[] = [];
  for (const [column, row, wide, high, color] of rectangles(pixels)) {
    const across = [(column - pixels.width / 2) * pixel + shiftRight, (column + wide - pixels.width / 2) * pixel + shiftRight];
    const upward = [(pixels.height / 2 - row - high) * pixel + shiftUp, (pixels.height / 2 - row) * pixel + shiftUp];
    const outward = [place.half, place.half + place.relief];
    const corners: Vector[] = [];
    for (const a of across)
      for (const b of upward)
        for (const c of outward) corners.push([0, 1, 2].map((axis) => right[axis] * a + up[axis] * b + out[axis] * c + (axis === 1 ? place.middle : 0)) as Vector);
    const low = [0, 1, 2].map((axis) => Math.min(...corners.map((corner) => corner[axis])));
    const high3 = [0, 1, 2].map((axis) => Math.max(...corners.map((corner) => corner[axis])));
    const [u, v] = uvOf(color);
    const face = { uv: [u + 0.25, v + 0.25], uv_size: [0.5, 0.5] };
    const inward = FACE_NAMES[negate(out).map((n) => n + 0).join(",")];
    const uv = Object.fromEntries(["north", "east", "south", "west", "up", "down"].filter((name) => name !== inward).map((name) => [name, face]));
    cubes.push({ origin: [round(-high3[0]), round(low[1]), round(low[2])], size: [0, 1, 2].map((axis) => round(high3[axis] - low[axis])), uv });
  }
  return cubes;
}

/**
 * Text as pixels in `ink`, and with a shadow color its shadow: the same grid, a pixel wider and
 * taller, the shadow a pixel right and down, only where the text isn't (so the two never share a
 * cube's place).
 */
export function inkPixels(text: TextPixels, ink: string, shadow?: string): { pixels: FacePixels; shadow?: FacePixels } {
  const lift = shadow ? SHADOW_OFFSET : 0;
  const width = text.width + lift;
  const height = text.height + lift;
  const colors = new Array<string | undefined>(width * height).fill(undefined);
  for (let row = 0; row < text.height; row++) for (let column = 0; column < text.width; column++) if (text.filled[row * text.width + column]) colors[row * width + column] = ink;
  if (!shadow) return { pixels: { width, height, colors } };
  const under = new Array<string | undefined>(width * height).fill(undefined);
  for (let row = 0; row < text.height; row++) {
    for (let column = 0; column < text.width; column++) {
      const at = (row + lift) * width + column + lift;
      if (text.filled[row * text.width + column] && colors[at] === undefined) under[at] = shadow;
    }
  }
  return { pixels: { width, height, colors }, shadow: { width, height, colors: under } };
}

/** A face's value as pixels and its pixel size: its text in the font and ink (and its shadow), or its picture. */
export function facePixels(face: FacePlan, font: TenFont, pack: string = PACK): { pixels: FacePixels; pixel: number; shadow?: FacePixels } | undefined {
  if ("text" in face) {
    const text = font.text(face.text);
    if (text.width === 0) return undefined;
    const drawn = inkPixels(text, face.ink, face.shadow);
    const pixel = Math.min(PIXEL, TEXT_ROOM / drawn.pixels.width, TEXT_ROOM / drawn.pixels.height);
    return { ...drawn, pixel };
  }
  if ("picture" in face) {
    const file = facePicture(face.picture, pack);
    if (!file) return undefined;
    const image = decodeAnyPng(readFileSync(file));
    const colors: (string | undefined)[] = [];
    for (let i = 0; i < image.width * image.height; i++) {
      const [r, g, b, a] = image.data.subarray(i * 4, i * 4 + 4);
      colors.push(a < 128 ? undefined : `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`);
    }
    const pixel = Math.min(PIXEL, PICTURE_ROOM / Math.max(image.width, image.height));
    return { pixels: { width: image.width, height: image.height, colors }, pixel };
  }
  return undefined;
}

// ---- The number over a walker's head ---------------------------------------------------------

export const COUNT_GEOMETRY = "geometry.blockparty.count";
export const COUNT_CONTROLLER = "controller.render.blockparty.count";
/** The number's pixel (model units: a digit is 7 of them across, 10 high), its depth, and its shadow's behind it. */
const COUNT_PIXEL = 1.25;
const COUNT_DEPTH = 1;
const COUNT_SHADOW_DEPTH = 0.5;
/** The number's middle over the entity (model units), which it turns about to face the camera. */
const COUNT_MIDDLE = 8;
/** The bone holding every digit (the one the animations move), and each digit's: alone, a two-digit number's tens, its ones. */
export const COUNT_ROOT = "count";
export const countBone = (place: "one" | "tens" | "ones", digit: number) => `${place}_${digit}`;
/** The digits a two-digit number's tens can be (a count over 99 shows 99). */
const TENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * The count's bones: every digit in the number's ink, facing south (the side a camera-facing bone
 * shows), and its shadow behind it. A digit alone is centered; a two-digit number's tens end half a
 * pixel left of the middle and its ones start half a pixel right of it, a pixel apart as the font
 * sets them.
 */
function countBones(look: NumberLook, font: TenFont, uvOf: (color: string) => [number, number]): object[] {
  const bones: object[] = [{ name: COUNT_ROOT, pivot: [0, COUNT_MIDDLE, 0] }];
  const bone = (name: string, digit: number, place: (width: number, grid: number, lift: number) => number) => {
    const text = font.text(String(digit));
    const drawn = inkPixels(text, look.ink, look.shadow);
    const lift = look.shadow ? SHADOW_OFFSET : 0;
    // In pixels: how far right the grid's middle goes, and down by half the shadow's lift, so the text (not its shadow) is where it's meant to be.
    const shift: [number, number] = [place(text.width, drawn.pixels.width, lift) * COUNT_PIXEL, (-lift / 2) * COUNT_PIXEL];
    const cubes = [
      ...faceCubes(drawn.pixels, SOUTH, COUNT_PIXEL, uvOf, { half: 0, relief: COUNT_DEPTH, middle: COUNT_MIDDLE, shift }),
      ...(drawn.shadow ? faceCubes(drawn.shadow, SOUTH, COUNT_PIXEL, uvOf, { half: -COUNT_SHADOW_DEPTH, relief: COUNT_SHADOW_DEPTH, middle: COUNT_MIDDLE, shift }) : []),
    ];
    bones.push({ name, parent: COUNT_ROOT, pivot: [0, COUNT_MIDDLE, 0], ...(cubes.length ? { cubes } : {}) });
  };
  // The grid is centered; the text's columns are its first `width` of `grid`.
  for (const digit of DIGITS) bone(countBone("one", digit), digit, (_width, _grid, lift) => lift / 2);
  for (const digit of TENS) bone(countBone("tens", digit), digit, (width, grid) => grid / 2 - width - 0.5);
  for (const digit of DIGITS) bone(countBone("ones", digit), digit, (_width, grid) => grid / 2 + 0.5);
  return bones;
}

/** The count's render controller: its palette, and only the digits of the number its property holds. */
export function countController(): object {
  const value = `q.property('${COUNT_PROPERTY}')`;
  const parts: Record<string, boolean | string>[] = [{ "*": false }, { [COUNT_ROOT]: true }];
  for (const digit of DIGITS) parts.push({ [countBone("one", digit)]: `${value} == ${digit}` });
  for (const digit of TENS) parts.push({ [countBone("tens", digit)]: `${value} >= 10 && math.floor(${value} / 10) == ${digit}` });
  for (const digit of DIGITS) parts.push({ [countBone("ones", digit)]: `${value} >= 10 && math.mod(${value}, 10) == ${digit}` });
  return { geometry: "Geometry.default", materials: [{ "*": "Material.default" }], textures: ["Texture.default"], part_visibility: parts };
}

// ---- The burst --------------------------------------------------------------------------------

/**
 * A die's burst (the jump that hits it): chips of its body's texture, each a random quarter of the
 * picture, thrown out every way and falling, spinning, shrinking away.
 */
export function burstEffect(die: DiePlan): object {
  const fade = "(1 - math.pow(v.particle_age / v.particle_lifetime, 3))";
  return {
    format_version: "1.10.0",
    particle_effect: {
      description: { identifier: burstParticle(die.id), basic_render_parameters: { material: "particles_alpha", texture: die.texture } },
      components: {
        "minecraft:emitter_rate_instant": { num_particles: 30 },
        "minecraft:emitter_lifetime_once": { active_time: 0.05 },
        "minecraft:emitter_shape_sphere": { radius: 0.25, direction: "outwards" },
        "minecraft:particle_lifetime_expression": { max_lifetime: "0.6 + v.particle_random_4 * 0.5" },
        "minecraft:particle_initial_speed": "math.random(4, 9)",
        "minecraft:particle_initial_spin": { rotation: "math.random(0, 360)", rotation_rate: "math.random(-900, 900)" },
        "minecraft:particle_motion_dynamic": { linear_acceleration: [0, -16, 0], linear_drag_coefficient: 2 },
        "minecraft:particle_appearance_billboard": {
          size: [`(0.06 + v.particle_random_4 * 0.06) * ${fade}`, `(0.06 + v.particle_random_4 * 0.06) * ${fade}`],
          facing_camera_mode: "rotate_xyz",
          uv: { texture_width: 1, texture_height: 1, uv: ["math.floor(v.particle_random_1 * 4) / 4", "math.floor(v.particle_random_2 * 4) / 4"], uv_size: [0.25, 0.25] },
        },
        "minecraft:particle_appearance_lighting": {},
      },
    },
  };
}

// ---- Building ---------------------------------------------------------------------------------

/** The palette's width in pixels (one per color, rows of this many). */
const PALETTE_WIDTH = 16;

/** Every die's faces geometry (and the blank one), the count's geometry, and the palette they're colored from. */
export function buildFaces(plan: ModelPlan, font: TenFont, pack: string = PACK): { geometries: object[]; count: object; palette: Image } {
  const colors: string[] = [];
  const uvOf = (color: string): [number, number] => {
    let at = colors.indexOf(color);
    if (at < 0) at = colors.push(color) - 1;
    return [at % PALETTE_WIDTH, Math.floor(at / PALETTE_WIDTH)];
  };
  const bones = plan.dice.map((die) => {
    const cubes = die.faces.flatMap((face, side) => {
      const value = facePixels(face, font, pack);
      if (!value) return [];
      const shadow = value.shadow ? faceCubes(value.shadow, side, value.pixel, uvOf, { ...ON_FACE, relief: SHADOW_RELIEF }) : [];
      return [...faceCubes(value.pixels, side, value.pixel, uvOf), ...shadow];
    });
    return { id: facesGeometry(die.id), cubes };
  });
  const countBoneList = countBones(plan.number, font, uvOf);
  const rows = Math.max(1, Math.ceil(colors.length / PALETTE_WIDTH));
  const palette = blankImage(PALETTE_WIDTH, rows);
  colors.forEach((color, i) => {
    const rgb = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16));
    palette.data.set([...rgb, 255], i * 4);
  });
  const description = (identifier: string, size: number) => ({
    identifier,
    texture_width: PALETTE_WIDTH,
    texture_height: rows,
    visible_bounds_width: size,
    visible_bounds_height: size,
    visible_bounds_offset: [0, 0.5, 0],
  });
  const geometry = (identifier: string, cubes: object[]) => ({
    description: description(identifier, 2),
    bones: [{ name: "die", pivot: [0, MIDDLE_Y, 0], ...(cubes.length ? { cubes } : {}) }],
  });
  return {
    geometries: [geometry(BLANK_FACES, []), ...bones.map((bone) => geometry(bone.id, bone.cubes))],
    count: { description: description(COUNT_GEOMETRY, 3), bones: countBoneList },
    palette,
  };
}
