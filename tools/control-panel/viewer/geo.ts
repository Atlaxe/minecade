// Bedrock geometry files (game Edit's marker shapes, the games' own marker models) as plain faces
// for the viewer's markers: each cube's six faces (or the ones its per-face UV names), with their
// corners in the file's pixels, before any rotation, and their texture coordinates. Box UV lays a
// cube's faces out the usual way from one corner; per-face UV gives each face its own rectangle.
// Plain TypeScript: the overlay (three.js) turns the faces into meshes.

export type FaceName = "up" | "down" | "north" | "south" | "east" | "west";
export type Vec3 = [number, number, number];

export interface GeoFace {
  name: FaceName;
  /** Corners as seen from outside the cube: top left, top right, bottom right, bottom left (pixels). */
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** Texture coordinates of the same corners, 0 to 1 across the texture, v down from its top. */
  uvs: [[number, number], [number, number], [number, number], [number, number]];
}

export interface GeoCube {
  faces: GeoFace[];
  /** The cube's own rotation in degrees (x, y, z) around its pivot, if it has one. */
  rotation?: Vec3;
  pivot?: Vec3;
}

export interface GeoBone {
  name: string;
  parent?: string;
  pivot: Vec3;
  rotation?: Vec3;
  cubes: GeoCube[];
}

export interface Geo {
  bones: GeoBone[];
}

interface RawCube {
  origin?: number[];
  size?: number[];
  inflate?: number;
  mirror?: boolean;
  rotation?: number[];
  pivot?: number[];
  uv?: number[] | Partial<Record<FaceName, { uv?: number[]; uv_size?: number[] }>>;
}

interface RawBone {
  name?: string;
  parent?: string;
  pivot?: number[];
  rotation?: number[];
  mirror?: boolean;
  inflate?: number;
  cubes?: RawCube[];
}

/** A geometry file's first geometry (format 1.12 and later), as bones of faces. */
export function parseGeo(file: unknown): Geo {
  const list = (file as { "minecraft:geometry"?: unknown[] } | null)?.["minecraft:geometry"];
  const geometry = Array.isArray(list) ? (list[0] as { description?: { texture_width?: number; texture_height?: number }; bones?: RawBone[] } | undefined) : undefined;
  if (!geometry) throw new Error('not a geometry file (no "minecraft:geometry" list)');
  const width = geometry.description?.texture_width ?? 16;
  const height = geometry.description?.texture_height ?? 16;
  const bones = (geometry.bones ?? []).map((bone, index): GeoBone => ({
    name: bone.name ?? `bone${index}`,
    ...(bone.parent ? { parent: bone.parent } : {}),
    pivot: vec(bone.pivot),
    ...(bone.rotation ? { rotation: vec(bone.rotation) } : {}),
    cubes: (bone.cubes ?? []).map((cube) => parseCube(cube, width, height, bone)),
  }));
  return { bones };
}

function parseCube(cube: RawCube, width: number, height: number, bone: RawBone): GeoCube {
  const inflate = cube.inflate ?? bone.inflate ?? 0;
  const [ox, oy, oz] = vec(cube.origin);
  const [sx, sy, sz] = vec(cube.size);
  const [x0, y0, z0] = [ox - inflate, oy - inflate, oz - inflate];
  const [x1, y1, z1] = [ox + sx + inflate, oy + sy + inflate, oz + sz + inflate];
  const corners: Record<FaceName, GeoFace["corners"]> = {
    up: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
    down: [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]],
    north: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]],
    south: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]],
    east: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]],
    west: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]],
  };
  const rects = Array.isArray(cube.uv) || cube.uv === undefined ? boxUv(vec(cube.uv ?? [0, 0]), [sx, sy, sz]) : faceUv(cube.uv);
  const mirror = cube.mirror ?? bone.mirror ?? false;
  const faces: GeoFace[] = [];
  for (const name of ["up", "down", "north", "south", "east", "west"] as const) {
    const rect = rects[name];
    if (!rect) continue;
    let [u0, v0, u1, v1] = [rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]];
    if (mirror) [u0, u1] = [u1, u0];
    const uv = (u: number, v: number): [number, number] => [u / width, v / height];
    faces.push({ name, corners: corners[name], uvs: [uv(u0, v0), uv(u1, v0), uv(u1, v1), uv(u0, v1)] });
  }
  return { faces, ...(cube.rotation ? { rotation: vec(cube.rotation), pivot: vec(cube.pivot ?? [0, 0, 0]) } : {}) };
}

/** Box UV: the faces' rectangles (u, v, width, height) laid out from the cube's corner on the texture. */
export function boxUv([u, v]: Vec3 | number[], [w, h, d]: Vec3): Record<FaceName, [number, number, number, number]> {
  return {
    up: [u + d, v, w, d],
    down: [u + d + w, v, w, d],
    east: [u, v + d, d, h],
    north: [u + d, v + d, w, h],
    west: [u + d + w, v + d, d, h],
    south: [u + d + w + d, v + d, w, h],
  };
}

function faceUv(uv: Partial<Record<FaceName, { uv?: number[]; uv_size?: number[] }>>): Partial<Record<FaceName, [number, number, number, number]>> {
  const rects: Partial<Record<FaceName, [number, number, number, number]>> = {};
  for (const [name, face] of Object.entries(uv) as [FaceName, { uv?: number[]; uv_size?: number[] } | undefined][]) {
    if (!face?.uv) continue;
    const [u, v] = face.uv;
    const [w, h] = face.uv_size ?? [0, 0];
    rects[name] = [u, v, w, h];
  }
  return rects;
}

function vec(value: number[] | undefined): Vec3 {
  return [value?.[0] ?? 0, value?.[1] ?? 0, value?.[2] ?? 0];
}

/** The lowest and highest pixel a geometry's faces reach (before rotation): a marker's height. */
export function geoHeight(geo: Geo): { low: number; high: number } {
  let low = Infinity;
  let high = -Infinity;
  for (const bone of geo.bones) {
    for (const cube of bone.cubes) {
      for (const face of cube.faces) {
        for (const corner of face.corners) {
          low = Math.min(low, corner[1]);
          high = Math.max(high, corner[1]);
        }
      }
    }
  }
  return low <= high ? { low, high } : { low: 0, high: 0 };
}
