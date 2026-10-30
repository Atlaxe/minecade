// Player models for the skin renders. Classic skins use vanilla's player models (copied from the
// game's models/mobs.json: geometry.humanoid.custom, geometry.humanoid.customSlim, and
// geometry.humanoid for old 64x32 skins); a character creator skin brings its own model in its
// geometry data. Both geometry file formats are read: the 1.8 one ("geometry.name" keys) and
// the 1.12+ one ("minecraft:geometry").

export type Vec3 = [number, number, number];
export type FaceName = "north" | "south" | "east" | "west" | "up" | "down";
export type FaceUv = { uv: [number, number]; uv_size?: [number, number] };

export interface Cube {
  origin: Vec3;
  size: Vec3;
  /** Box UV (the corner of the unfolded box), or a rectangle per face. */
  uv?: [number, number] | Partial<Record<FaceName, FaceUv>>;
  inflate?: number;
  mirror?: boolean;
  rotation?: Vec3;
  pivot?: Vec3;
}

/**
 * A bone's mesh (character creator models use these instead of cubes): positions in model space,
 * and polygons of 3 or 4 corners, each corner [position, normal, uv] indices. UVs are 0 to 1 with
 * v counted from the bottom when `normalized_uvs` is set, otherwise texture pixels.
 */
export interface PolyMesh {
  normalized_uvs?: boolean;
  positions: Vec3[];
  normals: Vec3[];
  uvs: [number, number][];
  polys: [number, number, number][][];
}

export interface Bone {
  name: string;
  parent?: string;
  pivot?: Vec3;
  rotation?: Vec3;
  mirror?: boolean;
  inflate?: number;
  neverRender?: boolean;
  cubes?: Cube[];
  poly_mesh?: PolyMesh;
}

export interface Model {
  textureWidth: number;
  textureHeight: number;
  bones: Bone[];
}

/** What the watcher saves about a skin (skins/<xuid>/meta.json), as far as choosing its model goes. */
export interface SkinShape {
  width: number;
  height: number;
  persona?: boolean;
  armSize?: string;
  /** The skin's resource patch geometry names, such as { default: "geometry.humanoid.custom" }. */
  geometry?: Record<string, string>;
}

const cube = (origin: Vec3, size: Vec3, uv: [number, number], inflate?: number): Cube => ({ origin, size, uv, ...(inflate ? { inflate } : {}) });

/** geometry.humanoid.custom: classic skins with wide arms (64x64). */
export const WIDE: Model = {
  textureWidth: 64,
  textureHeight: 64,
  bones: [
    { name: "root", pivot: [0, 0, 0] },
    { name: "waist", parent: "root", pivot: [0, 12, 0] },
    { name: "body", parent: "waist", pivot: [0, 24, 0], cubes: [cube([-4, 12, -2], [8, 12, 4], [16, 16])] },
    { name: "jacket", parent: "body", pivot: [0, 24, 0], cubes: [cube([-4, 12, -2], [8, 12, 4], [16, 32], 0.25)] },
    { name: "head", parent: "body", pivot: [0, 24, 0], cubes: [cube([-4, 24, -4], [8, 8, 8], [0, 0])] },
    { name: "hat", parent: "head", pivot: [0, 24, 0], cubes: [cube([-4, 24, -4], [8, 8, 8], [32, 0], 0.5)] },
    { name: "leftArm", parent: "body", pivot: [5, 22, 0], cubes: [cube([4, 12, -2], [4, 12, 4], [32, 48])] },
    { name: "leftSleeve", parent: "leftArm", pivot: [5, 22, 0], cubes: [cube([4, 12, -2], [4, 12, 4], [48, 48], 0.25)] },
    { name: "rightArm", parent: "body", pivot: [-5, 22, 0], cubes: [cube([-8, 12, -2], [4, 12, 4], [40, 16])] },
    { name: "rightSleeve", parent: "rightArm", pivot: [-5, 22, 0], cubes: [cube([-8, 12, -2], [4, 12, 4], [40, 32], 0.25)] },
    { name: "leftLeg", parent: "root", pivot: [1.9, 12, 0], cubes: [cube([-0.1, 0, -2], [4, 12, 4], [16, 48])] },
    { name: "leftPants", parent: "leftLeg", pivot: [1.9, 12, 0], cubes: [cube([-0.1, 0, -2], [4, 12, 4], [0, 48], 0.25)] },
    { name: "rightLeg", parent: "root", pivot: [-1.9, 12, 0], cubes: [cube([-3.9, 0, -2], [4, 12, 4], [0, 16])] },
    { name: "rightPants", parent: "rightLeg", pivot: [-1.9, 12, 0], cubes: [cube([-3.9, 0, -2], [4, 12, 4], [0, 32], 0.25)] },
  ],
};

/** geometry.humanoid.customSlim: classic skins with slim (3 pixel) arms. */
export const SLIM: Model = {
  textureWidth: 64,
  textureHeight: 64,
  bones: WIDE.bones.map((bone) => {
    if (bone.name === "leftArm" || bone.name === "leftSleeve") {
      return { ...bone, pivot: [5, 21.5, 0], cubes: [cube([4, 11.5, -2], [3, 12, 4], bone.name === "leftArm" ? [32, 48] : [48, 48], bone.name === "leftArm" ? 0 : 0.25)] };
    }
    if (bone.name === "rightArm" || bone.name === "rightSleeve") {
      return { ...bone, pivot: [-5, 21.5, 0], cubes: [cube([-7, 11.5, -2], [3, 12, 4], bone.name === "rightArm" ? [40, 16] : [40, 32], bone.name === "rightArm" ? 0 : 0.25)] };
    }
    // As in vanilla's model.
    if (bone.name === "leftLeg") return { ...bone, mirror: true };
    return bone;
  }),
};

/** geometry.humanoid: old 64x32 skins, with no second layer but the hat, and the left limbs mirroring the right ones. */
export const LEGACY: Model = {
  textureWidth: 64,
  textureHeight: 32,
  bones: [
    { name: "body", pivot: [0, 24, 0], cubes: [cube([-4, 12, -2], [8, 12, 4], [16, 16])] },
    { name: "head", pivot: [0, 24, 0], cubes: [cube([-4, 24, -4], [8, 8, 8], [0, 0])] },
    { name: "hat", pivot: [0, 24, 0], cubes: [cube([-4, 24, -4], [8, 8, 8], [32, 0], 0.5)] },
    { name: "rightArm", pivot: [-5, 22, 0], cubes: [cube([-8, 12, -2], [4, 12, 4], [40, 16])] },
    { name: "leftArm", pivot: [5, 22, 0], mirror: true, cubes: [cube([4, 12, -2], [4, 12, 4], [40, 16])] },
    { name: "rightLeg", pivot: [-1.9, 12, 0], cubes: [cube([-3.9, 0, -2], [4, 12, 4], [0, 16])] },
    { name: "leftLeg", pivot: [1.9, 12, 0], mirror: true, cubes: [cube([-0.1, 0, -2], [4, 12, 4], [0, 16])] },
  ],
};

/**
 * The model in a geometry file, picked by identifier (the first one when there's no match). Reads
 * both the 1.12+ format ({ "minecraft:geometry": [{ description, bones }] }) and the 1.8 one
 * ({ "geometry.name": { texturewidth, textureheight, bones } }, where a key can name the
 * geometry it extends after a colon).
 */
export function parseGeometry(file: unknown, identifier?: string, exact = false): Model {
  if (!file || typeof file !== "object") throw new Error("not a geometry file");
  const entries: { id: string; textureWidth: number; textureHeight: number; bones: Bone[] }[] = [];
  const modern = (file as Record<string, unknown>)["minecraft:geometry"];
  if (Array.isArray(modern)) {
    for (const geometry of modern as { description?: { identifier?: string; texture_width?: number; texture_height?: number }; bones?: Bone[] }[]) {
      entries.push({
        id: geometry.description?.identifier ?? "",
        textureWidth: geometry.description?.texture_width ?? 64,
        textureHeight: geometry.description?.texture_height ?? 64,
        bones: geometry.bones ?? [],
      });
    }
  }
  for (const [key, value] of Object.entries(file as Record<string, unknown>)) {
    if (!key.startsWith("geometry.") || !value || typeof value !== "object") continue;
    const legacy = value as { texturewidth?: number; textureheight?: number; bones?: Bone[] };
    entries.push({ id: key.split(":")[0], textureWidth: legacy.texturewidth ?? 64, textureHeight: legacy.textureheight ?? 64, bones: legacy.bones ?? [] });
  }
  const entry = entries.find((candidate) => candidate.id === identifier) ?? (exact ? undefined : entries[0]);
  if (!entry) throw new Error("no geometry in the file");
  return { textureWidth: entry.textureWidth, textureHeight: entry.textureHeight, bones: entry.bones };
}

/**
 * A character creator skin's face model ("animated_face" in its resource patch), drawn with its own
 * texture (the face, then its blink below, of which the model's UVs use the first); undefined for
 * other skins.
 */
export function faceModelFor(skin: SkinShape, geometryFile?: unknown): Model | undefined {
  const name = skin.geometry?.animated_face;
  if (!skin.persona || !name || !geometryFile) return undefined;
  try {
    return parseGeometry(geometryFile, name, true);
  } catch {
    return undefined;
  }
}

/**
 * The model to draw a skin on: a character creator skin's own model (from its geometry data),
 * otherwise vanilla's classic model for its arm size, or the old one for 64x32 skins.
 */
export function modelFor(skin: SkinShape, geometryFile?: unknown): Model {
  const name = skin.geometry?.default ?? "";
  if (geometryFile && (skin.persona || !name.startsWith("geometry.humanoid"))) return parseGeometry(geometryFile, name);
  if (skin.height === 32) return LEGACY;
  return skin.armSize === "slim" || name === "geometry.humanoid.customSlim" ? SLIM : WIDE;
}
