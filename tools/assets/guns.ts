// Writes the shared guns pack (packs/guns): the pistol, rifle, shotgun and paint grenade as items in
// each of the 16 paint colors, held as 3D models (attachables) that come up to the middle of the
// screen while aiming and kick back when they fire; the ball, thrown grenade and landed grenade
// entities; the pickup that floats over a map spot; and the splash particle. The models are lists of
// boxes below; the generator turns each into a Blockbench-ready geometry (box UV) and a shaded
// texture per paint color (a box painted "paint" takes the color). Each item places a hidden block
// holding its model, so the hotbar shows the model in 3D the way it shows a wall or a banner; the
// kit pictures get icons drawn from the models (packs/guns/icons). Where the models sit in the hand
// is a hand-edited file (HOLD_FILE), which this writes only when it's missing. The guns' names and
// numbers come from packages/guns/src/defs.ts, which the games' scripts read too. Rerun after
// changing either, and commit the files:
//
//     npx tsx tools/assets/guns.ts
//
// A test checks the committed files match (tools/build/test/guns-pack.test.ts).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COLOR_PROPERTY,
  DYES,
  GRENADE,
  GUNS,
  GUN_KINDS,
  GUN_PICKUP,
  KIND_PROPERTY,
  PAINTBALL,
  PAINT_RGB,
  PAINT_SPLASH,
  PICKUP_KINDS,
  PRIMED_GRENADE,
  THROWN_GRENADE,
  AIM_MARKER,
  gunCooldown,
  gunItem,
  gunModelBlock,
  shotMarker,
  type Dye,
  type GunKind,
  type PickupKind,
} from "../../packages/guns/src/defs.ts";
import { blankImage, encodePng } from "../skins/png.ts";

const pack = (path: string) => fileURLToPath(new URL(`../../packs/guns/${path}`, import.meta.url));

/** The models' fixed colors (0xRRGGBB). A box painted "paint" takes the item's paint color instead. */
const PALETTE = {
  body: 0x3b4047,
  metal: 0x9aa3ab,
  grip: 0x232427,
  tank: 0x55636f,
  wood: 0x6b4a2b,
  accent: 0xc9a227,
} as const;
type Paint = keyof typeof PALETTE | "paint";

/** A box in pixels (16 to a block): its low corner, its size, its color. */
interface Box {
  from: Vec3;
  size: Vec3;
  paint: Paint;
}
type Vec3 = [number, number, number];

const box = (from: Vec3, size: Vec3, paint: Paint): Box => ({ from, size, paint });

/**
 * The models, built facing north (-z, the way a model faces in Bedrock), top up, with the top of the
 * grip at the origin: the grip runs down from it, the barrel points north.
 */
const MODELS: Record<PickupKind, Box[]> = {
  pistol: [
    box([-1, -6, -1], [2, 6, 3], "grip"),
    box([-1.5, 0, -7], [3, 3, 10], "body"),
    box([-1, 0.5, -12], [2, 2, 5], "metal"),
    box([-1.5, 3, -5], [3, 4, 4], "paint"),
    box([-0.5, -2, -4], [1, 1, 3], "grip"),
    box([-0.5, -1, -3], [1, 1, 1], "accent"),
    box([-0.5, 3, 1], [1, 1, 1], "metal"),
  ],
  rifle: [
    box([-1, -6, 0], [2, 6, 3], "grip"),
    box([-1.5, 0, -11], [3, 4, 17], "body"),
    box([-1, 1, -23], [2, 2, 12], "metal"),
    box([-1.5, 0.5, -15], [3, 3, 4], "body"),
    box([-2, 4, -8], [4, 6, 6], "paint"),
    box([-1, -4, -9], [2, 4, 2], "grip"),
    box([-0.5, -2, -4], [1, 1, 4], "grip"),
    box([-0.5, -1, -2], [1, 1, 1], "accent"),
    box([-1.5, -1, 6], [3, 4, 9], "tank"),
    box([-1.5, -2, 15], [3, 6, 1], "grip"),
  ],
  shotgun: [
    box([-1, -6, 1], [2, 6, 3], "grip"),
    box([-2, 0, -8], [4, 4, 14], "body"),
    box([-2, 1, -20], [2, 2, 12], "metal"),
    box([0, 1, -20], [2, 2, 12], "metal"),
    box([-2, -1, -17], [4, 2, 6], "wood"),
    box([-1.5, 4, -5], [3, 4, 4], "paint"),
    box([-0.5, -2, -3], [1, 1, 4], "grip"),
    box([-0.5, -1, -1], [1, 1, 1], "accent"),
    box([-1.5, -1, 6], [3, 4, 8], "wood"),
    box([-1.5, -3, 14], [3, 7, 1], "grip"),
  ],
  grenade: [
    box([-2, -3, -2], [4, 5, 4], "paint"),
    box([-2.5, -1, -2.5], [5, 1, 5], "tank"),
    box([-1, 2, -1], [2, 1, 2], "metal"),
    box([2, -1, -0.5], [1, 3, 1], "grip"),
    box([-0.5, 3, -0.5], [1, 1, 1], "accent"),
  ],
};

/** A shot's kick on the "body" bone: back toward the player and the muzzle up, then home, over `seconds`. */
const RECOIL: Record<GunKind, { seconds: number; back: number; lift: number }> = {
  pistol: { seconds: 0.15, back: 1.5, lift: 8 },
  // Just under the rifle's 4 ticks between shots, so each shot's kick starts fresh.
  rifle: { seconds: 0.18, back: 1, lift: 4 },
  shotgun: { seconds: 0.3, back: 2.5, lift: 14 },
};

/**
 * Where each model first sat in the hand, as places on the screen and around the fist (the solver
 * below turns them into the rotations and positions HOLD_FILE starts with; the file is edited by
 * hand since). Pixels, degrees.
 * - scale: its size in first person.
 * - hip: the grip's top this far from the fist (right, up, ahead), the barrel turned in toward the
 *   crosshair and tipped up, so the stock drops out of view.
 * - aim (right click held): centered, its top `under` the crosshair (a fraction of half the
 *   screen's height), the grip's top `depth` pixels ahead of the eye.
 * - third: third person, the grip's top this far from the fist (right, up, ahead), level.
 */
const HOLD: Record<PickupKind, { scale: number; hip: Place; aim?: { under: number; depth: number }; third: Vec3 }> = {
  pistol: { scale: 1.35, hip: { fromFist: [-1, 6, 4], turnIn: 4, tipUp: 10 }, aim: { under: 0.07, depth: 15 }, third: [0, 4.5, 1] },
  rifle: { scale: 1.1, hip: { fromFist: [-1, 5, 4], turnIn: 4, tipUp: 10 }, aim: { under: 0.07, depth: 19 }, third: [0, 4.5, 1] },
  shotgun: { scale: 1.15, hip: { fromFist: [-1, 5.2, 4], turnIn: 4, tipUp: 10 }, aim: { under: 0.07, depth: 18 }, third: [0, 4.5, 1] },
  grenade: { scale: 1.3, hip: { fromFist: [0, 3.2, 2], turnIn: 20, tipUp: 10 }, third: [0, 1.5, 1] },
};

interface Place {
  fromFist: Vec3;
  turnIn: number;
  tipUp: number;
}

const ICON_SIZE = 128;
/** Each icon pixel is the average of this many samples squared, for smooth edges. */
const ICON_SAMPLES = 3;
const TEXTURE_WIDTH = 64;
const BALL_SIZE = 16;
/** A gun's swing on a left click, which fires it: short enough to barely show. */
const GUN_SWING_SECONDS = 0.05;
const GUN_TEXTURES = "textures/minecade/guns";

const heldGeometry = (kind: PickupKind) => `geometry.minecade.gun_${kind}`;
const iconGeometry = (kind: PickupKind) => `geometry.minecade.gun_${kind}_icon`;
const displayGeometry = (kind: PickupKind) => `geometry.minecade.gun_${kind}_display`;
const modelTexturePath = (kind: PickupKind, dye: Dye) => `${GUN_TEXTURES}/${kind}/${dye}`;
const terrainKey = (kind: PickupKind, dye: Dye) => `minecade_gun_${kind}_${dye}`;
const itemFile = (identifier: string) => identifier.replace("minecade:", "");
const isGun = (kind: PickupKind): kind is GunKind => kind !== "grenade";

// ---- Textures --------------------------------------------------------------------------------

/** Where each box's net sits in the model's texture (box UV), and the texture's size. */
function uvLayout(boxes: Box[]): { uvs: [number, number][]; height: number } {
  const uvs: [number, number][] = [];
  let [x, y, rowHeight] = [0, 0, 0];
  for (const { size } of boxes) {
    const [w, h, d] = size;
    const [netWidth, netHeight] = [2 * (w + d), h + d];
    if (x + netWidth > TEXTURE_WIDTH) [x, y, rowHeight] = [0, y + rowHeight, 0];
    uvs.push([x, y]);
    x += netWidth;
    rowHeight = Math.max(rowHeight, netHeight);
  }
  let height = 16;
  while (height < y + rowHeight) height *= 2;
  return { uvs, height };
}

/** A box's six faces: where each sits in its net (box UV), how lit the texture paints it, and its corner and edges in the model. */
function boxFaces({ from, size }: Box, [u, v]: [number, number]): { rect: [number, number, number, number]; light: number; corner: Vec3; across: Vec3; down: Vec3; normal: Vec3 }[] {
  const [w, h, d] = size;
  const [x0, y0, z0] = from;
  const [x1, y1, z1] = [x0 + w, y0 + h, z0 + d];
  return [
    { rect: [u + d, v, w, d], light: 1.18, corner: [x1, y1, z1], across: [-w, 0, 0], down: [0, 0, -d], normal: [0, 1, 0] },
    { rect: [u + d + w, v, w, d], light: 0.66, corner: [x1, y0, z0], across: [-w, 0, 0], down: [0, 0, d], normal: [0, -1, 0] },
    { rect: [u, v + d, d, h], light: 0.86, corner: [x1, y1, z1], across: [0, 0, -d], down: [0, -h, 0], normal: [1, 0, 0] },
    { rect: [u + d, v + d, w, h], light: 1, corner: [x1, y1, z0], across: [-w, 0, 0], down: [0, -h, 0], normal: [0, 0, -1] },
    { rect: [u + d + w, v + d, d, h], light: 0.86, corner: [x0, y1, z0], across: [0, 0, d], down: [0, -h, 0], normal: [-1, 0, 0] },
    { rect: [u + 2 * d + w, v + d, w, h], light: 0.92, corner: [x0, y1, z1], across: [w, 0, 0], down: [0, -h, 0], normal: [0, 0, 1] },
  ];
}

/** A model's texture before it's colored: each pixel's paint and light (its face's, a darker rim, a little grain). */
interface TextureLayers {
  width: number;
  height: number;
  paint: (Paint | undefined)[];
  light: Float32Array;
}

function textureLayers(boxes: Box[]): TextureLayers {
  const { uvs, height } = uvLayout(boxes);
  const layers: TextureLayers = { width: TEXTURE_WIDTH, height, paint: Array(TEXTURE_WIDTH * height).fill(undefined), light: new Float32Array(TEXTURE_WIDTH * height) };
  boxes.forEach((piece, i) => {
    for (const { rect: [x0, y0, w, h], light } of boxFaces(piece, uvs[i])) {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          const rim = (x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1) && w > 2 && h > 2;
          const grain = 1 + (((x * 73 + y * 151) % 17) - 8) / 220;
          layers.paint[y * TEXTURE_WIDTH + x] = piece.paint;
          layers.light[y * TEXTURE_WIDTH + x] = light * (rim ? 0.82 : 1) * grain;
        }
      }
    }
  });
  return layers;
}

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const rgbOf = (paint: Paint, dye: Dye) => (paint === "paint" ? PAINT_RGB[dye] : PALETTE[paint]);

/** The color of texture pixel `at` in a paint color, as [r, g, b] (0 to 255), or undefined where no box is. */
function texel(layers: TextureLayers, at: number, dye: Dye): [number, number, number] | undefined {
  const paint = layers.paint[at];
  if (!paint) return undefined;
  const rgb = rgbOf(paint, dye);
  const light = layers.light[at];
  return [(rgb >> 16) * light, ((rgb >> 8) & 0xff) * light, (rgb & 0xff) * light];
}

function modelTexture(layers: TextureLayers, dye: Dye): Buffer {
  const image = blankImage(layers.width, layers.height);
  for (let at = 0; at < layers.paint.length; at++) {
    const color = texel(layers, at, dye);
    if (color) image.data.set([...color.map(clamp), 255], at * 4);
  }
  return encodePng(image);
}

// ---- Icons: the model drawn in 3D --------------------------------------------------------------

type Matrix = [Vec3, Vec3, Vec3];

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const rotX = (degrees: number): Matrix => {
  const [c, s] = [Math.cos(radians(degrees)), Math.sin(radians(degrees))];
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
};
const rotY = (degrees: number): Matrix => {
  const [c, s] = [Math.cos(radians(degrees)), Math.sin(radians(degrees))];
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
};
const rotZ = (degrees: number): Matrix => {
  const [c, s] = [Math.cos(radians(degrees)), Math.sin(radians(degrees))];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};
const times = (a: Matrix, b: Matrix): Matrix =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j])) as Matrix;
const apply = (m: Matrix, [x, y, z]: Vec3): Vec3 => [m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z];
const transpose = (m: Matrix): Matrix => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]) as Matrix;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** How a kit picture's icon sees its model: from above a front corner, as the hotbar shows a block. */
const ICON_VIEW: Matrix = times(rotX(30), rotY(-45));
/** The icons' light: from the upper left, in front. */
const ICON_LIGHT: Vec3 = [-0.45, 0.75, 0.5];

/** Where each icon sample landed on the model (a texture pixel, -1 for none) and how much light it takes there. */
interface IconSamples {
  texel: Int32Array;
  light: Float32Array;
}

/** Draws the model's faces into ICON_SIZE * ICON_SAMPLES samples a side, nearest face wins (seen from +z, orthographic). */
function iconSamples(boxes: Box[], view: Matrix): IconSamples {
  const size = ICON_SIZE * ICON_SAMPLES;
  const { uvs } = uvLayout(boxes);
  const samples: IconSamples = { texel: new Int32Array(size * size).fill(-1), light: new Float32Array(size * size) };
  const depth = new Float32Array(size * size).fill(-Infinity);
  const corners = boxes.flatMap(({ from, size: [w, h, d] }) =>
    [0, w].flatMap((dx) => [0, h].flatMap((dy) => [0, d].map((dz) => apply(view, [from[0] + dx, from[1] + dy, from[2] + dz])))),
  );
  const [minX, maxX] = [Math.min(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[0]))];
  const [minY, maxY] = [Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[1]))];
  const margin = 3 * ICON_SAMPLES;
  const scale = (size - 2 * margin) / Math.max(maxX - minX, maxY - minY);
  const toSample = ([x, y, z]: Vec3): Vec3 => [size / 2 + (x - (minX + maxX) / 2) * scale, size / 2 - (y - (minY + maxY) / 2) * scale, z];
  const lightLength = Math.hypot(...ICON_LIGHT);
  boxes.forEach((piece, i) => {
    for (const face of boxFaces(piece, uvs[i])) {
      const normal = apply(view, face.normal);
      if (normal[2] <= 1e-6) continue;
      const facing = Math.max(0, (normal[0] * ICON_LIGHT[0] + normal[1] * ICON_LIGHT[1] + normal[2] * ICON_LIGHT[2]) / lightLength);
      const light = 0.7 + 0.45 * facing;
      const at = (a: number, b: number): Vec3 => toSample(apply(view, add(face.corner, add(face.across.map((c) => c * a) as Vec3, face.down.map((c) => c * b) as Vec3))));
      const quad = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
      const params: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const [p, q, r] of [[0, 1, 2], [0, 2, 3]]) {
        const [a, b, c] = [quad[p], quad[q], quad[r]];
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        if (Math.abs(area) < 1e-9) continue;
        const [left, right] = [Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])))];
        const [top, bottom] = [Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])))];
        for (let sy = top; sy <= bottom; sy++) {
          for (let sx = left; sx <= right; sx++) {
            const [px, py] = [sx + 0.5, sy + 0.5];
            const wa = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
            const wb = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
            const wc = 1 - wa - wb;
            if (wa < 0 || wb < 0 || wc < 0) continue;
            const z = wa * a[2] + wb * b[2] + wc * c[2];
            const sample = sy * size + sx;
            if (z <= depth[sample]) continue;
            depth[sample] = z;
            const s = wa * params[p][0] + wb * params[q][0] + wc * params[r][0];
            const t = wa * params[p][1] + wb * params[q][1] + wc * params[r][1];
            const [rx, ry, rw, rh] = face.rect;
            const tx = Math.min(rx + rw - 1, Math.floor(rx + s * rw));
            const ty = Math.min(ry + rh - 1, Math.floor(ry + t * rh));
            samples.texel[sample] = ty * TEXTURE_WIDTH + tx;
            samples.light[sample] = light;
          }
        }
      }
    }
  });
  return samples;
}

/** The icon in a paint color: each pixel the average of its samples, see-through where the model isn't. */
function modelIcon(samples: IconSamples, layers: TextureLayers, dye: Dye): Buffer {
  const image = blankImage(ICON_SIZE, ICON_SIZE);
  const size = ICON_SIZE * ICON_SAMPLES;
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      let [r, g, b, covered] = [0, 0, 0, 0];
      for (let dy = 0; dy < ICON_SAMPLES; dy++) {
        for (let dx = 0; dx < ICON_SAMPLES; dx++) {
          const sample = (y * ICON_SAMPLES + dy) * size + x * ICON_SAMPLES + dx;
          const color = samples.texel[sample] >= 0 ? texel(layers, samples.texel[sample], dye) : undefined;
          if (!color) continue;
          const light = samples.light[sample];
          [r, g, b, covered] = [r + color[0] * light, g + color[1] * light, b + color[2] * light, covered + 1];
        }
      }
      if (covered) image.data.set([clamp(r / covered), clamp(g / covered), clamp(b / covered), clamp((255 * covered) / ICON_SAMPLES ** 2)], (y * ICON_SIZE + x) * 4);
    }
  }
  return encodePng(image);
}

/** A ball: a round blob in the paint color, lit from the top left, like the snowball. */
function ballTexture(rgb: number): Buffer {
  const image = blankImage(BALL_SIZE, BALL_SIZE);
  const [cx, cy, radius] = [7.5, 7.5, 4.6];
  for (let y = 0; y < BALL_SIZE; y++) {
    for (let x = 0; x < BALL_SIZE; x++) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > radius) continue;
      const rim = distance > radius - 1;
      const shine = Math.hypot(x - (cx - 1.6), y - (cy - 1.6)) < 1.3;
      const light = rim ? 0.62 : shine ? 1.55 : 1.1 - ((x - cx + (y - cy)) / radius) * 0.18;
      const grain = 1 + (((x * 73 + y * 151) % 17) - 8) / 220;
      image.data.set([...[rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff].map((channel) => clamp(channel * light * grain)), 255], (y * BALL_SIZE + x) * 4);
    }
  }
  return encodePng(image);
}

/** The splash particle: a soft white drop the particle tints. */
function splashTexture(): Buffer {
  const image = blankImage(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const distance = Math.hypot(x - 3.5, y - 3.5);
      if (distance > 3.6) continue;
      image.data.set([255, 255, 255, distance > 2.6 ? 150 : 255], (y * 8 + x) * 4);
    }
  }
  return encodePng(image);
}

// ---- Where a held model sits ------------------------------------------------------------------
//
// A held model's root bone is bound to the hand (q.item_slot_to_bone_name), and Bedrock draws a
// bound model 24 pixels lower than its coordinates say. The math here works in Blockbench's space
// (a Bedrock file's x mirrored; rotations (-x, -y, z), turned z after y after x), using the setup
// Blockbench's attachable preview draws (js/formats/bedrock/attachable_preview.js) and the vanilla
// arm poses: a bound model's point p lands at SHOULDER + ARM * (p + BIND_OFFSET), the arm turned
// as vanilla's animations turn it. In first person the camera looks along +z; in third person the
// player faces -z with their right hand on +x.

/** From the shoulder to a bound model's origin, before the arm turns: the 24-pixel drop and the hand's place on the arm. */
const BIND_OFFSET: Vec3 = [1, -31, -1];
/** The middle of the fist, the arm's end. */
const FIST: Vec3 = [6, 12.5, 0];
const SHOULDER: Vec3 = [5, 22, 0];
/** First person: vanilla's animation.player.first_person.empty_hand turns the arm (95, -45, 115) and moves it (13.5, -10, 12). */
const FIRST_PERSON = { arm: times(times(rotZ(115), rotY(45)), rotX(-95)), shoulder: add(SHOULDER, [-13.5, -10, 12]) };
/** Third person: vanilla's animation.player.holding raises the arm 18 degrees. */
const THIRD_PERSON = { arm: rotX(18), shoulder: SHOULDER };
/** Blockbench's first-person camera: at the eyes, looking along +z, a 70.25 degree field of view on a 16:9 screen. */
const EYE: Vec3 = [0, 27.41, 0];
const VIEW_SLOPE = Math.tan(radians(70.25 / 2));
const ASPECT = 16 / 9;

interface Transform {
  rotation: Vec3;
  position: Vec3;
}

/** The bone rotation and position (a Bedrock file's, pivot at the origin) that put the model at `place` (a turn, then a point) on `chain`'s arm. */
function solve(turn: Matrix, point: Vec3, chain: { arm: Matrix; shoulder: Vec3 }): Transform {
  const back = transpose(chain.arm);
  const bone = times(back, turn);
  const offset = minus(apply(back, minus(point, chain.shoulder)), BIND_OFFSET);
  // bone = rotZ(c) * rotY(b) * rotX(a)
  const b = Math.asin(Math.max(-1, Math.min(1, -bone[2][0])));
  const a = Math.atan2(bone[2][1], bone[2][2]);
  const c = Math.atan2(bone[1][0], bone[0][0]);
  const round = (value: number) => Math.round(value * 100) / 100 + 0;
  return {
    rotation: [round((-a * 180) / Math.PI), round((-b * 180) / Math.PI), round((c * 180) / Math.PI)],
    position: [round(-offset[0]), round(offset[1]), round(offset[2])],
  };
}

const fistIn = (chain: { arm: Matrix; shoulder: Vec3 }) => add(chain.shoulder, apply(chain.arm, minus(FIST, SHOULDER)));

/** First person from the hip: by the fist, the model turned to face away from the camera, in and up a little. */
function hipHold(kind: PickupKind): Transform {
  const { hip } = HOLD[kind];
  const [right, up, ahead] = hip.fromFist;
  return solve(times(rotY(180 - hip.turnIn), rotX(hip.tipUp)), add(fistIn(FIRST_PERSON), [-right, up, ahead]), FIRST_PERSON);
}

/** First person aiming: in the middle, straight ahead, its top just under the crosshair. */
function aimHold(kind: PickupKind): Transform | undefined {
  const { aim, scale } = HOLD[kind];
  if (!aim) return undefined;
  const top = Math.max(...MODELS[kind].map(({ from, size }) => from[1] + size[1])) * scale;
  const point: Vec3 = add(EYE, [0, -aim.under * VIEW_SLOPE * aim.depth - top, aim.depth]);
  return solve(rotY(180), point, FIRST_PERSON);
}

/** Third person: in the fist, barrel ahead and level. */
function thirdHold(kind: PickupKind): Transform {
  const [right, up, ahead] = HOLD[kind].third;
  return solve(rotX(0), add(fistIn(THIRD_PERSON), [right, up, -ahead]), THIRD_PERSON);
}

// ---- Geometry and animations -----------------------------------------------------------------

/** A box as a Bedrock cube: Blockbench's own coordinates, box UV. */
function cube({ from, size }: Box, uv: [number, number]): unknown {
  return { origin: from, size, uv };
}

/** The most a model block's model spans, in pixels: a block's geometry must fit in 30. */
const ICON_BLOCK_SPAN = 28;
const FACE_NAMES = ["up", "down", "east", "north", "west", "south"] as const;

/**
 * The model for its item's icon (a block's): shrunk to fit a block, centered on it and standing on
 * its floor, each face keeping its own place in the texture (per-face UV, as box UV would shrink).
 */
function iconCubes(boxes: Box[]): unknown[] {
  const { uvs } = uvLayout(boxes);
  const low = [0, 1, 2].map((axis) => Math.min(...boxes.map(({ from }) => from[axis])));
  const high = [0, 1, 2].map((axis) => Math.max(...boxes.map(({ from, size }) => from[axis] + size[axis])));
  const scale = Math.min(1, ICON_BLOCK_SPAN / Math.max(...high.map((value, axis) => value - low[axis])));
  const at = (value: number, axis: number) => Math.round((axis === 1 ? (value - low[1]) * scale + 1 : (value - (low[axis] + high[axis]) / 2) * scale) * 1000) / 1000;
  return boxes.map((piece, i) => ({
    origin: piece.from.map(at),
    size: piece.size.map((value) => Math.round(value * scale * 1000) / 1000),
    uv: Object.fromEntries(boxFaces(piece, uvs[i]).map(({ rect: [u, v, w, h] }, face) => [FACE_NAMES[face], { uv: [u, v], uv_size: [w, h] }])),
  }));
}

function geometries(): unknown {
  const all: unknown[] = [];
  for (const kind of PICKUP_KINDS) {
    const boxes = MODELS[kind];
    const { uvs, height } = uvLayout(boxes);
    const cubes = boxes.map((piece, i) => cube(piece, uvs[i]));
    const description = (identifier: string) => ({
      identifier,
      texture_width: TEXTURE_WIDTH,
      texture_height: height,
      visible_bounds_width: 3,
      visible_bounds_height: 3,
      visible_bounds_offset: [0, 0.75, 0],
    });
    // Held: the root follows the hand; "body" carries the boxes, so the recoil moves them on the hold.
    all.push({
      description: description(heldGeometry(kind)),
      bones: [
        { name: "gun", binding: "q.item_slot_to_bone_name(c.item_slot)", pivot: [0, 0, 0] },
        { name: "body", parent: "gun", pivot: [0, 0, 0], cubes },
      ],
    });
    // Floating, flying or sitting on its own: turns and swells around its middle.
    const middle = middleOf(boxes);
    all.push({
      description: description(displayGeometry(kind)),
      bones: [
        { name: "display", pivot: middle },
        { name: "body", parent: "display", pivot: middle, cubes },
      ],
    });
    // Its model block's, which the game draws as the item's icon.
    all.push({
      description: { identifier: iconGeometry(kind), texture_width: TEXTURE_WIDTH, texture_height: height },
      bones: [{ name: "model", pivot: [0, 0, 0], cubes: iconCubes(boxes) }],
    });
  }
  return { format_version: "1.16.0", "minecraft:geometry": all };
}

function middleOf(boxes: Box[]): Vec3 {
  return [0, 1, 2].map((axis) => {
    const low = Math.min(...boxes.map((piece) => piece.from[axis]));
    const high = Math.max(...boxes.map((piece) => piece.from[axis] + piece.size[axis]));
    return (low + high) / 2;
  }) as Vec3;
}

/** The hold animations: plain poses of the "gun" bone, blended by the attachable (HOLD_FILE). */
const holdAnimation = (kind: PickupKind, pose: HoldPose) => `animation.minecade.gun_${kind}.${pose}`;
type HoldPose = "first_person_hip" | "first_person_aim" | "third_person";
const holdPoses = (kind: PickupKind): HoldPose[] => (isGun(kind) ? ["first_person_hip", "first_person_aim", "third_person"] : ["first_person_hip", "third_person"]);
const recoilAnimation = (kind: GunKind) => `animation.minecade.gun_${kind}.recoil`;
const PICKUP_ANIMATION = "animation.minecade.gun_pickup.float";
const TUMBLE_ANIMATION = "animation.minecade.paint_grenade.tumble";
const SWELL_ANIMATION = "animation.minecade.paint_grenade.swell";
/** How much bigger a landed grenade gets by the end of its fuse. */
const SWELL = 0.8;
/**
 * Where the held models sit: edited by hand (in Blockbench), so the generator writes it only when
 * it's missing, from the solver's poses. Delete it and rerun to start over from those.
 */
export const HOLD_FILE = "resource_pack/animations/guns_hold.animation.json";

const fixed = (value: number) => Number(value.toFixed(2));

/** The hold animations as the solver places them: the first version of HOLD_FILE. */
export function holdAnimationsSeed(): unknown {
  const all: Record<string, unknown> = {};
  for (const kind of PICKUP_KINDS) {
    const { scale } = HOLD[kind];
    all[holdAnimation(kind, "first_person_hip")] = { loop: true, bones: { gun: { ...hipHold(kind), scale } } };
    const aim = aimHold(kind);
    if (aim) all[holdAnimation(kind, "first_person_aim")] = { loop: true, bones: { gun: { ...aim, scale } } };
    all[holdAnimation(kind, "third_person")] = { loop: true, bones: { gun: thirdHold(kind) } };
  }
  return { format_version: "1.8.0", animations: all };
}

/** Every hold animation an attachable names, for the check that HOLD_FILE still has them all. */
export function holdAnimationNames(): string[] {
  return PICKUP_KINDS.flatMap((kind) => holdPoses(kind).map((pose) => holdAnimation(kind, pose)));
}

/** The generated animations: recoil, the pickup's float, and the grenade's tumble and swell. */
function animations(): unknown {
  const all: Record<string, unknown> = {};
  for (const kind of GUN_KINDS) {
    const { back, lift } = RECOIL[kind];
    all[recoilAnimation(kind)] = { loop: true, bones: { body: { position: [0, 0, `v.kick * ${back}`], rotation: [`v.kick * ${-lift}`, 0, 0] } } };
  }
  all[PICKUP_ANIMATION] = {
    loop: true,
    bones: { display: { rotation: [0, "q.life_time * 120", 0], position: [0, "10 + math.sin(q.life_time * 150) * 1.5", 0], scale: 1.6 } },
  };
  all[TUMBLE_ANIMATION] = { loop: true, bones: { display: { rotation: ["q.life_time * 600", 0, "q.life_time * 300"] } } };
  // Sits on the ground as it swells, wobbling harder as the fuse runs out.
  const grenade = MODELS.grenade;
  const [, middle] = middleOf(grenade);
  const below = middle - Math.min(...grenade.map(({ from }) => from[1]));
  all[SWELL_ANIMATION] = {
    loop: true,
    bones: {
      display: {
        scale: "v.swell",
        position: [0, `v.swell * ${fixed(below)} - ${fixed(middle)}`, 0],
        rotation: [0, 0, "math.sin(q.life_time * 1600) * 8 * (v.swell - 1)"],
      },
    },
  };
  return { format_version: "1.8.0", animations: all };
}

/**
 * The attachable's script. v.aim eases toward 1 while the aim marker's cooldown runs (the script
 * keeps restarting it while the player aims), and the hip and aim poses blend by it; v.kick rises
 * fast and falls back over a shot's recoil cooldown.
 */
function attachableScripts(kind: PickupKind): Record<string, unknown> {
  if (!isGun(kind)) return { animate: [{ first_person_hip: "c.is_first_person" }, { third_person: "!c.is_first_person" }] };
  const { seconds } = RECOIL[kind];
  return {
    initialize: ["v.aim = 0;", "v.kick = 0;"],
    pre_animation: [
      `v.aim = math.lerp(v.aim, q.cooldown_time_remaining('${AIM_MARKER.category}') > 0, math.min(q.delta_time * 12, 1));`,
      `v.kick_left = math.clamp(q.cooldown_time_remaining('${shotMarker(kind).category}') / ${seconds}, 0, 1);`,
      "v.kick = v.kick_left > 0.75 ? (1 - v.kick_left) * 4 : v.kick_left / 0.75;",
    ],
    animate: [
      { first_person_hip: "c.is_first_person * (1 - v.aim)" },
      { first_person_aim: "c.is_first_person * v.aim" },
      { third_person: "!c.is_first_person" },
      "recoil",
    ],
  };
}

function attachable(kind: PickupKind, dye: Dye): unknown {
  const animationsOf: Record<string, string> = Object.fromEntries(holdPoses(kind).map((pose) => [pose, holdAnimation(kind, pose)]));
  if (isGun(kind)) animationsOf.recoil = recoilAnimation(kind);
  return {
    format_version: "1.10.0",
    "minecraft:attachable": {
      description: {
        identifier: gunItem(kind, dye),
        materials: { default: "entity_alphatest", enchanted: "entity_alphatest_glint" },
        textures: { default: modelTexturePath(kind, dye), enchanted: "textures/misc/enchanted_item_glint" },
        geometry: { default: heldGeometry(kind) },
        animations: animationsOf,
        scripts: attachableScripts(kind),
        render_controllers: ["controller.render.item_default"],
      },
    },
  };
}

// ---- Behavior pack -----------------------------------------------------------------------------

const ITEM_FORMAT = "1.21.120";

function item(kind: PickupKind, dye: Dye): unknown {
  const model = gunModelBlock(kind, dye);
  const components: Record<string, unknown> = {
    // No icon: an item that places a block shows that block, which is the model drawn in 3D. It
    // can only be placed on that block, which is never in the world, so it places nothing.
    "minecraft:block_placer": { block: model, use_on: [model] },
    "minecraft:display_name": { value: isGun(kind) ? GUNS[kind].name : GRENADE.name },
    "minecraft:max_stack_size": isGun(kind) ? 1 : 16,
    "minecraft:hand_equipped": true,
    "minecraft:can_destroy_in_creative": false,
  };
  if (isGun(kind)) {
    // A left click fires (a swing), so the swing is kept short. Each shot starts this cooldown,
    // which shades the hotbar slot until the gun can fire again.
    components["minecraft:swing_duration"] = { value: GUN_SWING_SECONDS };
    components["minecraft:cooldown"] = { category: gunCooldown(kind), duration: GUNS[kind].everyTicks / 20 };
  }
  return { format_version: ITEM_FORMAT, "minecraft:item": { description: { identifier: gunItem(kind, dye), menu_category: { category: "none" } }, components } };
}

/** A hidden item whose cooldown category the held models read (a shot's recoil, the aim). */
function markerItem(identifier: string, category: string, seconds: number): unknown {
  return {
    format_version: ITEM_FORMAT,
    "minecraft:item": {
      description: { identifier, menu_category: { category: "none" } },
      components: {
        "minecraft:icon": { textures: { default: MARKER_ICON } },
        "minecraft:cooldown": { category, duration: seconds },
      },
    },
  };
}

/** The aim marker's cooldown: a little longer than the script's restarts, so it doesn't run out while aiming. */
const AIM_MARKER_SECONDS = 0.3;
const MARKER_ICON = "minecade_gun_marker";

/** The hidden block an item shows as its icon (iconGeometry). */
function modelBlock(kind: PickupKind, dye: Dye): unknown {
  return {
    format_version: "1.21.60",
    "minecraft:block": {
      description: { identifier: gunModelBlock(kind, dye), menu_category: { category: "none" } },
      components: {
        "minecraft:geometry": iconGeometry(kind),
        "minecraft:material_instances": { "*": { texture: terrainKey(kind, dye), render_method: "alpha_test" } },
      },
    },
  };
}

const colorProperty = { [COLOR_PROPERTY]: { type: "int", range: [0, DYES.length - 1], default: 0, client_sync: true } };
/** Nothing hurts, pushes or burns these: the script places and removes them. */
const UNTOUCHABLE = {
  "minecraft:pushable": { is_pushable: false, is_pushable_by_piston: false },
  "minecraft:damage_sensor": { triggers: [{ cause: "all", deals_damage: "no" }] },
  "minecraft:health": { value: 1, max: 1 },
  "minecraft:knockback_resistance": { value: 1 },
  "minecraft:fire_immune": true,
};

function projectileEntity(identifier: string, size: number, gravity: number, knockback: boolean): unknown {
  return {
    format_version: "1.21.100",
    "minecraft:entity": {
      description: { identifier, is_spawnable: false, is_summonable: true, properties: colorProperty },
      components: {
        "minecraft:collision_box": { width: size, height: size },
        // The script decides what a hit does; a ball only pushes, like a snowball.
        "minecraft:projectile": {
          on_hit: knockback ? { impact_damage: { damage: 0, knockback: true, destroy_on_hit: true }, remove_on_hit: {} } : { remove_on_hit: {} },
          power: 1.5,
          gravity,
          anchor: 1,
          offset: [0, -0.1, 0],
          angle_offset: 0,
        },
        "minecraft:physics": {},
        "minecraft:pushable": { is_pushable: false, is_pushable_by_piston: false },
        "minecraft:conditional_bandwidth_optimization": {
          default_values: { max_optimized_distance: 80, max_dropped_ticks: 5, use_motion_prediction_hints: true },
        },
      },
    },
  };
}

/** A grenade that landed: it falls to the ground and sits there until the script bursts it. */
function primedGrenadeEntity(): unknown {
  return {
    format_version: "1.21.100",
    "minecraft:entity": {
      description: { identifier: PRIMED_GRENADE, is_spawnable: false, is_summonable: true, properties: colorProperty },
      components: { "minecraft:collision_box": { width: 0.3, height: 0.3 }, "minecraft:physics": {}, ...UNTOUCHABLE },
    },
  };
}

function pickupEntity(): unknown {
  return {
    format_version: "1.21.100",
    "minecraft:entity": {
      description: {
        identifier: GUN_PICKUP,
        is_spawnable: false,
        is_summonable: true,
        properties: { [KIND_PROPERTY]: { type: "int", range: [0, PICKUP_KINDS.length - 1], default: 0, client_sync: true } },
      },
      components: {
        "minecraft:collision_box": { width: 0.01, height: 0.01 },
        "minecraft:physics": { has_gravity: false, has_collision: false },
        ...UNTOUCHABLE,
      },
    },
  };
}

// ---- Resource pack client entities and particle ----------------------------------------------

function clientEntities(): Record<string, unknown> {
  const client = (description: Record<string, unknown>) => ({ format_version: "1.10.0", "minecraft:client_entity": { description } });
  const grenadeTextures = Object.fromEntries(DYES.map((dye) => [dye, modelTexturePath("grenade", dye)]));
  return {
    "resource_pack/entity/paintball.entity.json": client({
      identifier: PAINTBALL,
      // The snowball's own setup: a flat sprite that always faces the camera.
      materials: { default: "snowball" },
      textures: Object.fromEntries(DYES.map((dye) => [dye, `${GUN_TEXTURES}/balls/${dye}`])),
      geometry: { default: "geometry.item_sprite" },
      render_controllers: ["controller.render.minecade.paintball"],
      animations: { flying: "animation.actor.billboard" },
      scripts: { animate: ["flying"] },
    }),
    "resource_pack/entity/paint_grenade.entity.json": client({
      identifier: THROWN_GRENADE,
      materials: { default: "entity_alphatest" },
      textures: grenadeTextures,
      geometry: { default: displayGeometry("grenade") },
      render_controllers: ["controller.render.minecade.paint_grenade"],
      animations: { tumble: TUMBLE_ANIMATION },
      scripts: { animate: ["tumble"] },
    }),
    "resource_pack/entity/paint_grenade_primed.entity.json": client({
      identifier: PRIMED_GRENADE,
      materials: { default: "entity_alphatest" },
      textures: grenadeTextures,
      geometry: { default: displayGeometry("grenade") },
      render_controllers: ["controller.render.minecade.paint_grenade_primed"],
      animations: { swell: SWELL_ANIMATION },
      scripts: {
        pre_animation: [`v.swell = 1 + math.min(q.life_time / ${GRENADE.fuseTicks / 20}, 1) * ${SWELL};`],
        animate: ["swell"],
      },
    }),
    "resource_pack/entity/gun_pickup.entity.json": client({
      identifier: GUN_PICKUP,
      materials: { default: "entity_alphatest" },
      textures: Object.fromEntries(PICKUP_KINDS.map((kind) => [kind, modelTexturePath(kind, "white")])),
      geometry: Object.fromEntries(PICKUP_KINDS.map((kind) => [kind, displayGeometry(kind)])),
      render_controllers: ["controller.render.minecade.gun_pickup"],
      animations: { float: PICKUP_ANIMATION },
      scripts: { animate: ["float"] },
    }),
  };
}

function renderControllers(): unknown {
  const pick = (array: string, property: string) => `${array}[q.property('${property}')]`;
  const byColor = { arrays: { textures: { "Array.dyes": DYES.map((dye) => `Texture.${dye}`) } }, geometry: "Geometry.default", materials: [{ "*": "Material.default" }], textures: [pick("Array.dyes", COLOR_PROPERTY)] };
  return {
    format_version: "1.10.0",
    render_controllers: {
      "controller.render.minecade.paintball": byColor,
      "controller.render.minecade.paint_grenade": byColor,
      // Flashes white faster and faster, like lit TNT.
      "controller.render.minecade.paint_grenade_primed": {
        ...byColor,
        overlay_color: { r: 1, g: 1, b: 1, a: "math.mod(q.life_time * (2 + q.life_time * 5), 1) > 0.5 ? 0.55 : 0" },
      },
      "controller.render.minecade.gun_pickup": {
        arrays: {
          textures: { "Array.kinds": PICKUP_KINDS.map((kind) => `Texture.${kind}`) },
          geometries: { "Array.kinds": PICKUP_KINDS.map((kind) => `Geometry.${kind}`) },
        },
        geometry: pick("Array.kinds", KIND_PROPERTY),
        materials: [{ "*": "Material.default" }],
        textures: [pick("Array.kinds", KIND_PROPERTY)],
        ignore_lighting: true,
      },
    },
  };
}

/** Drops thrown out from the hit, falling, in `variable.color`. */
function splashParticle(): unknown {
  return {
    format_version: "1.10.0",
    particle_effect: {
      description: {
        identifier: PAINT_SPLASH,
        basic_render_parameters: { material: "particles_alpha", texture: `${GUN_TEXTURES}/splash` },
      },
      components: {
        "minecraft:emitter_rate_instant": { num_particles: 14 },
        "minecraft:emitter_lifetime_once": { active_time: 0.05 },
        "minecraft:emitter_shape_sphere": { radius: 0.15, direction: "outwards" },
        "minecraft:particle_lifetime_expression": { max_lifetime: "0.35 + v.particle_random_1 * 0.3" },
        "minecraft:particle_initial_speed": "2 + v.particle_random_2 * 2.5",
        "minecraft:particle_motion_dynamic": { linear_acceleration: [0, -14, 0], linear_drag_coefficient: 2.5 },
        "minecraft:particle_motion_collision": { collision_radius: 0.05, coefficient_of_restitution: 0, collision_drag: 6 },
        "minecraft:particle_appearance_billboard": {
          size: ["0.05 + v.particle_random_3 * 0.05", "0.05 + v.particle_random_3 * 0.05"],
          facing_camera_mode: "rotate_xyz",
          uv: { texture_width: 8, texture_height: 8, uv: [0, 0], uv_size: [8, 8] },
        },
        "minecraft:particle_appearance_tinting": { color: ["v.color.r", "v.color.g", "v.color.b", 1] },
        "minecraft:particle_appearance_lighting": {},
      },
    },
  };
}

// ---- The pack ----------------------------------------------------------------------------------

/** Every generated file, by path under packs/guns (the manifests are hand-written). */
export function gunsPackFiles(): Record<string, string | Buffer> {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const files: Record<string, string | Buffer> = {
    "behavior_pack/entities/paintball.json": json(projectileEntity(PAINTBALL, 0.25, 0.03, true)),
    "behavior_pack/entities/paint_grenade.json": json(projectileEntity(THROWN_GRENADE, 0.3, 0.05, false)),
    "behavior_pack/entities/paint_grenade_primed.json": json(primedGrenadeEntity()),
    "behavior_pack/entities/gun_pickup.json": json(pickupEntity()),
    "resource_pack/models/entity/guns.geo.json": json(geometries()),
    "resource_pack/animations/guns.animation.json": json(animations()),
    "resource_pack/render_controllers/guns.render_controllers.json": json(renderControllers()),
    "resource_pack/particles/paint_splash.json": json(splashParticle()),
    // The hidden markers' icon (never seen).
    "resource_pack/textures/item_texture.json": json({
      resource_pack_name: "minecade_guns",
      texture_name: "atlas.items",
      texture_data: { [MARKER_ICON]: { textures: `${GUN_TEXTURES}/splash` } },
    }),
    // The model blocks' textures: the models' own.
    "resource_pack/textures/terrain_texture.json": json({
      resource_pack_name: "minecade_guns",
      texture_name: "atlas.terrain",
      padding: 8,
      num_mip_levels: 4,
      texture_data: Object.fromEntries(PICKUP_KINDS.flatMap((kind) => DYES.map((dye) => [terrainKey(kind, dye), { textures: modelTexturePath(kind, dye) }]))),
    }),
    [`resource_pack/${GUN_TEXTURES}/splash.png`]: splashTexture(),
    ...Object.fromEntries(Object.entries(clientEntities()).map(([path, value]) => [path, json(value)])),
  };
  for (const kind of GUN_KINDS) {
    const marker = shotMarker(kind);
    files[`behavior_pack/items/${itemFile(marker.item)}.json`] = json(markerItem(marker.item, marker.category, RECOIL[kind].seconds));
  }
  files[`behavior_pack/items/${itemFile(AIM_MARKER.item)}.json`] = json(markerItem(AIM_MARKER.item, AIM_MARKER.category, AIM_MARKER_SECONDS));
  for (const kind of PICKUP_KINDS) {
    const layers = textureLayers(MODELS[kind]);
    const samples = iconSamples(MODELS[kind], ICON_VIEW);
    for (const dye of DYES) {
      const file = itemFile(gunItem(kind, dye));
      files[`behavior_pack/items/${file}.json`] = json(item(kind, dye));
      files[`behavior_pack/blocks/${itemFile(gunModelBlock(kind, dye))}.json`] = json(modelBlock(kind, dye));
      files[`resource_pack/attachables/${file}.json`] = json(attachable(kind, dye));
      files[`resource_pack/${modelTexturePath(kind, dye)}.png`] = modelTexture(layers, dye);
      // Kit pictures' icons, beside the packs (the game draws the hotbar's from the model block).
      files[`icons/${file}.png`] = modelIcon(samples, layers, dye);
    }
  }
  for (const dye of DYES) files[`resource_pack/${GUN_TEXTURES}/balls/${dye}.png`] = ballTexture(PAINT_RGB[dye]);
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [path, content] of Object.entries(gunsPackFiles())) {
    mkdirSync(dirname(pack(path)), { recursive: true });
    writeFileSync(pack(path), content);
  }
  if (!existsSync(pack(HOLD_FILE))) {
    writeFileSync(pack(HOLD_FILE), `${JSON.stringify(holdAnimationsSeed(), null, 2)}\n`);
    console.log(`wrote ${HOLD_FILE} from the solver's poses`);
  }
  console.log("wrote the guns pack's files");
}
