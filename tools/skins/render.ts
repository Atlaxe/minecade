// A small software renderer for the skin renders: draws a model with its skin at an angle, like a
// 3D viewer would, into an image. Bedrock's model space is mirrored on x (like the hologram's
// model), so everything is first flipped to the space Blockbench shows (x becomes -x, rotations
// (-x, -y, z) applied z, then y, then x), where box UV and the face corners below are laid out.
// The camera is orthographic and looks at the model's front (north, -z).
import { blankImage, type Image } from "./png.ts";
import type { Bone, Cube, FaceName, FaceUv, Model, Vec3 } from "./geometry.ts";

/** How much of the model the image shows: the head, head and shoulders down to the waist, or all of it. */
export type Framing = "head" | "bust" | "full";

export interface RenderOptions {
  width: number;
  height: number;
  /** Degrees the model turns so its right side shows, and degrees the camera looks down. */
  yaw?: number;
  pitch?: number;
  framing?: Framing;
  /** Empty space around the model, as a share of the image's size. */
  padding?: number;
  /** Drawn this many times larger, then scaled down, for smooth edges. */
  supersample?: number;
}

/** Bones that aren't the player's body (attachment points and armor); character creator models can carry them. */
const NOT_BODY = /cape|elytra|item|armor|legging|boot|sock|belt|helmet|parrot|shield/i;
/** The bust framing shows the model down to this height (model pixels: the waist is at 12, the shoulders at 24). */
const CHEST = 15;
/** Where the light comes from, in camera space: above, in front and to the viewer's left. */
const LIGHT = normalize([0.35, 0.85, -0.55]);

interface Face {
  bone: string;
  corners: [Vec3, Vec3, Vec3, Vec3];
  normal: Vec3;
  /** Texture rectangle: (u0, v0) at the first corner, (u1, v1) at the third. */
  uv: [number, number, number, number];
}

/** Bones the head framing shows: the head, and whatever a character creator model hangs on it. */
const HEAD = /head|hat|hair|face|eye|mouth/i;

/** The model drawn with `texture` (its skin), on a transparent background. */
export function renderModel(model: Model, texture: Image, options: RenderOptions): Image {
  const { width, height, yaw = 25, pitch = 12, framing = "full", padding = 0.06, supersample = 3 } = options;
  const turn = rotation(-pitch, yaw, 0);
  // Turned toward the camera, then flipped to the image: looking along +z, the viewer's right is
  // -x, and image rows grow downward.
  const toView = (corner: Vec3): Vec3 => {
    const [x, y, z] = apply(turn, corner);
    return [-x, -y, z];
  };
  const faces = modelFaces(model)
    .filter((face) => framing !== "head" || HEAD.test(face.bone))
    .map((face) => ({ ...face, points: face.corners.map(toView), facing: apply(turn, face.normal) }));

  // Fit the framed part of the model in the image. The bust is cut at the chest: points below it
  // count as if they were on that line, and what's below the image's edge isn't drawn.
  const shown = framing === "bust" ? faces.flatMap((face) => face.corners.map(([x, y, z]) => toView([x, Math.max(y, CHEST), z]))) : faces.flatMap((face) => face.points);
  if (shown.length === 0) return blankImage(width, height);
  const xs = shown.map((point) => point[0]);
  const ys = shown.map((point) => point[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const big = blankImage(width * supersample, height * supersample);
  const scale = Math.min((big.width * (1 - 2 * padding)) / (maxX - minX), (big.height * (1 - 2 * padding)) / (maxY - minY));
  const offsetX = (big.width - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (big.height - (maxY - minY) * scale) / 2 - minY * scale;

  const depth = new Float64Array(big.width * big.height).fill(Infinity);
  for (const face of faces) {
    // Faces pointing away from the camera (which sits at -z) can't be seen.
    if (face.facing[2] >= 0) continue;
    const brightness = 0.55 + 0.45 * Math.max(0, dot(face.facing, LIGHT));
    const screen = face.points.map(([x, y, z]) => [x * scale + offsetX, y * scale + offsetY, z] as Vec3);
    const [u0, v0, u1, v1] = face.uv;
    const uvs: [number, number][] = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    // Sampled just inside the face's own rectangle, so its edges never pick up a neighbor's texels.
    const inside = (value: number, a: number, b: number) => Math.min(Math.max(a, b) - 1e-3, Math.max(Math.min(a, b) + 1e-3, value));
    const sample = (u: number, v: number) => texel(texture, model, inside(u, u0, u1), inside(v, v0, v1));
    fillTriangle(big, depth, [screen[0], screen[1], screen[2]], [uvs[0], uvs[1], uvs[2]], sample, brightness);
    fillTriangle(big, depth, [screen[0], screen[2], screen[3]], [uvs[0], uvs[2], uvs[3]], sample, brightness);
  }
  return shrink(big, supersample);
}

/** Every face of the model, in Blockbench space, with its cube's and bones' rotations applied. */
function modelFaces(model: Model): Face[] {
  const bones = new Map(model.bones.map((bone) => [bone.name, bone]));
  const faces: Face[] = [];
  for (const bone of model.bones) {
    if (bone.neverRender || NOT_BODY.test(bone.name)) continue;
    for (const cube of bone.cubes ?? []) {
      const transforms = [cubeTransform(cube), ...boneChain(bone, bones)];
      for (const face of cubeFaces(cube, bone)) {
        faces.push({
          bone: bone.name,
          corners: face.corners.map((corner) => transforms.reduce((point, transform) => transform(point), corner)) as Face["corners"],
          normal: transforms.reduce((normal, transform) => sub(transform(normal), transform([0, 0, 0])), face.normal),
          uv: face.uv,
        });
      }
    }
  }
  return faces;
}

type Transform = (point: Vec3) => Vec3;

/** A rotation (Bedrock degrees) around a Bedrock pivot, in Blockbench space. */
function pivoted(rotationDegrees: Vec3 | undefined, pivot: Vec3 | undefined): Transform {
  if (!rotationDegrees || rotationDegrees.every((angle) => angle === 0)) return (point) => point;
  const matrix = rotation(-rotationDegrees[0], -rotationDegrees[1], rotationDegrees[2]);
  const center: Vec3 = [-(pivot?.[0] ?? 0), pivot?.[1] ?? 0, pivot?.[2] ?? 0];
  return (point) => add(apply(matrix, sub(point, center)), center);
}

function cubeTransform(cube: Cube): Transform {
  return pivoted(cube.rotation, cube.pivot);
}

/** The bone's rotation, then its parent's, and so on up (Bedrock pivots are absolute, not relative). */
function boneChain(bone: Bone, bones: Map<string, Bone>): Transform[] {
  const chain: Transform[] = [];
  const seen = new Set<string>();
  for (let current: Bone | undefined = bone; current && !seen.has(current.name); current = current.parent ? bones.get(current.parent) : undefined) {
    seen.add(current.name);
    chain.push(pivoted(current.rotation, current.pivot));
  }
  return chain;
}

/** Bedrock per-face UV names, to the sides they're on in Blockbench space (x is mirrored). */
const SIDE_OF: Record<FaceName, FaceName> = { north: "north", south: "south", up: "up", down: "down", east: "west", west: "east" };

/**
 * A cube's six faces in Blockbench space, each with its corners as seen from outside (top left,
 * top right, bottom right, bottom left) and its texture rectangle.
 */
function cubeFaces(cube: Cube, bone: Bone): Omit<Face, "bone">[] {
  const inflate = cube.inflate ?? bone.inflate ?? 0;
  const [ox, oy, oz] = cube.origin;
  const [sx, sy, sz] = cube.size;
  const [x0, x1] = [-(ox + sx) - inflate, -ox + inflate];
  const [y0, y1] = [oy - inflate, oy + sy + inflate];
  const [z0, z1] = [oz - inflate, oz + sz + inflate];
  const corners: Record<FaceName, Face["corners"]> = {
    north: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]],
    south: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]],
    east: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]],
    west: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]],
    up: [[x1, y1, z1], [x0, y1, z1], [x0, y1, z0], [x1, y1, z0]],
    down: [[x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [x1, y0, z1]],
  };
  const normals: Record<FaceName, Vec3> = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
  const uvs = faceUvs(cube, bone);
  return (Object.keys(corners) as FaceName[]).flatMap((side) => (uvs[side] ? [{ corners: corners[side], normal: normals[side], uv: uvs[side] }] : []));
}

/** Each face's texture rectangle (u0, v0, u1, v1), by the side it's on in Blockbench space. */
function faceUvs(cube: Cube, bone: Bone): Partial<Record<FaceName, [number, number, number, number]>> {
  const uv = cube.uv ?? [0, 0];
  if (!Array.isArray(uv)) {
    const rects: Partial<Record<FaceName, [number, number, number, number]>> = {};
    for (const [name, face] of Object.entries(uv) as [FaceName, FaceUv][]) {
      const [u, v] = face.uv;
      const [w, h] = face.uv_size ?? [0, 0];
      rects[SIDE_OF[name]] = [u, v, u + w, v + h];
    }
    return rects;
  }
  // Box UV: the box unfolded around (u, v), as in the classic skin layout.
  const [u, v] = uv;
  const [sx, sy, sz] = cube.size;
  const rects: Record<FaceName, [number, number, number, number]> = {
    east: [u, v + sz, u + sz, v + sz + sy],
    north: [u + sz, v + sz, u + sz + sx, v + sz + sy],
    west: [u + sz + sx, v + sz, u + 2 * sz + sx, v + sz + sy],
    south: [u + 2 * sz + sx, v + sz, u + 2 * sz + 2 * sx, v + sz + sy],
    up: [u + sz, v, u + sz + sx, v + sz],
    down: [u + sz + sx, v, u + sz + 2 * sx, v + sz],
  };
  if (!(cube.mirror ?? bone.mirror)) return rects;
  // Mirrored: the sides trade places, and every face is flipped left to right.
  const flip = ([a, b, c, d]: [number, number, number, number]): [number, number, number, number] => [c, b, a, d];
  return { ...Object.fromEntries(Object.entries(rects).map(([side, rect]) => [side, flip(rect)])), east: flip(rects.west), west: flip(rects.east) };
}

/** The skin's texel at (u, v) in the model's texture units, or undefined where it's see-through. */
function texel(texture: Image, model: Model, u: number, v: number): [number, number, number] | undefined {
  const x = Math.min(texture.width - 1, Math.max(0, Math.floor((u * texture.width) / model.textureWidth)));
  const y = Math.min(texture.height - 1, Math.max(0, Math.floor((v * texture.height) / model.textureHeight)));
  const at = (y * texture.width + x) * 4;
  if (texture.data[at + 3] < 128) return undefined;
  return [texture.data[at], texture.data[at + 1], texture.data[at + 2]];
}

/** Fills a triangle, nearest texel and depth-tested (smaller z is closer). */
function fillTriangle(
  image: Image,
  depth: Float64Array,
  [a, b, c]: [Vec3, Vec3, Vec3],
  [ta, tb, tc]: [number, number][],
  sample: (u: number, v: number) => [number, number, number] | undefined,
  brightness: number,
): void {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(area) < 1e-9) return;
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(image.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(image.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const slack = -1e-6;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const wa = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
      const wb = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
      const wc = 1 - wa - wb;
      if (wa < slack || wb < slack || wc < slack) continue;
      const z = wa * a[2] + wb * b[2] + wc * c[2];
      const at = y * image.width + x;
      if (z >= depth[at]) continue;
      const u = wa * ta[0] + wb * tb[0] + wc * tc[0];
      const v = wa * ta[1] + wb * tb[1] + wc * tc[1];
      const color = sample(u, v);
      if (!color) continue;
      depth[at] = z;
      image.data.set([Math.round(color[0] * brightness), Math.round(color[1] * brightness), Math.round(color[2] * brightness), 255], at * 4);
    }
  }
}

/** Scales an image down by a whole factor, averaging (colors weighted by their alpha). */
function shrink(image: Image, factor: number): Image {
  if (factor === 1) return image;
  const out = blankImage(image.width / factor, image.height / factor);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const at = ((y * factor + dy) * image.width + (x * factor + dx)) * 4;
          const alpha = image.data[at + 3];
          r += image.data[at] * alpha;
          g += image.data[at + 1] * alpha;
          b += image.data[at + 2] * alpha;
          a += alpha;
        }
      }
      if (a > 0) out.data.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / (factor * factor))], (y * out.width + x) * 4);
    }
  }
  return out;
}

type Matrix = [Vec3, Vec3, Vec3];

/** Rotation by (x, y, z) degrees, applied z first, then y, then x. */
function rotation(xDegrees: number, yDegrees: number, zDegrees: number): Matrix {
  const [x, y, z] = [xDegrees, yDegrees, zDegrees].map((degrees) => (degrees * Math.PI) / 180);
  const rx: Matrix = [[1, 0, 0], [0, Math.cos(x), -Math.sin(x)], [0, Math.sin(x), Math.cos(x)]];
  const ry: Matrix = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const rz: Matrix = [[Math.cos(z), -Math.sin(z), 0], [Math.sin(z), Math.cos(z), 0], [0, 0, 1]];
  return multiply(rx, multiply(ry, rz));
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [0, 1, 2].map((row) => [0, 1, 2].map((column) => a[row][0] * b[0][column] + a[row][1] * b[1][column] + a[row][2] * b[2][column])) as Matrix;
}

function apply(matrix: Matrix, [x, y, z]: Vec3): Vec3 {
  return [0, 1, 2].map((row) => matrix[row][0] * x + matrix[row][1] * y + matrix[row][2] * z) as Vec3;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}
