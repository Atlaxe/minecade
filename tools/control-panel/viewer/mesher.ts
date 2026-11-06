// Meshing one 16x16x16 section for the viewer page (in its workers). Cubes: only faces between a
// block and an open spot, touching faces of the same look merged into rectangles (greedy meshing),
// each face's color times its side's shade, and corner darkening (ambient occlusion: each corner
// darker for each of the three cubes around it on the open side). Faces merge only when their
// corners darken the same, so a merged rectangle shades as its blocks would. Other shapes
// (shapes.ts): each box's faces, but not where a neighbor covers them; plants as two crossed faces
// seen from both sides; water and lava as a box 14/16 high (full under the same liquid), their faces
// hidden against the same liquid, with the water of waterlogged blocks (layer 1) around them.
// See-through blocks (glass, water) go in a mesh of their own, drawn blended after the rest.
// Positions are sixteenths of a block from `offset` (in blocks), so a region's sections (4x4x4
// sections, 64 blocks) share one mesh scaled by 1/16.
import { BOX_FACES, covered, FACE_AXIS, FACE_SIGN, LAVA, LIQUID_TOP, OCCLUDES, OPPOSITE, PASSABLE, SEE_THROUGH, sideRects, WATER, type Rect, type Shape, type ShapeTable } from "./shapes.ts";
import { DOWN, EAST, NORTH, SOUTH, UP, WEST } from "./volume.ts";

/** How bright each side is: tops full, north and south 80%, east and west 60%, bottoms 50%. */
export const SHADE = [1, 0.5, 0.8, 0.8, 0.6, 0.6];
/** How bright a plant's crossed faces are. */
const CROSS_SHADE = 0.85;

/** A section's blocks with a 1-block border from its neighbors: 18 a side, at ((x + 1) * 18 + (z + 1)) * 18 + (y + 1). */
export const PADDED = 18;

export interface MeshPart {
  /** Sixteenths of a block. */
  positions: Uint16Array;
  /** RGBA, shaded; alpha is how see-through a see-through block is. */
  tints: Uint8Array;
  /** Each vertex's corner darkening, 0 (darkest) to 255 (none). */
  occlusion: Uint8Array;
  indices: Uint32Array;
}

export interface SectionMesh {
  solid: MeshPart;
  /** See-through faces (glass, water), drawn blended. */
  glass: MeshPart;
  quads: number;
}

/** What the mesher knows about the looks, sent to each worker once. */
export interface Looks {
  /** 1 for drawn looks. */
  drawn: Uint8Array;
  /** 24 bytes a look: each face's RGBA (volume.ts's face order). */
  colors: Uint8Array;
  table: ShapeTable;
}

/** The looks with what the mesher works out from them once. */
export interface Prepared extends Looks {
  /** Each shape's rectangles on each side of the block. */
  rects: Rect[][][];
  /** 1 for looks whose boxes hide what's behind them (drawn, not see-through, not a plant or liquid). */
  cover: Uint8Array;
  /** 6 a look: 1 where it covers that whole side of the block. */
  full: Uint8Array;
}

export function prepareLooks(looks: Looks): Prepared {
  const { table, drawn } = looks;
  const rects = table.shapes.map(sideRects);
  const cover = new Uint8Array(drawn.length);
  const full = new Uint8Array(drawn.length * 6);
  for (let look = 0; look < drawn.length; look++) {
    const shape = table.shapes[table.shapeOf[look]];
    if (!drawn[look] || table.flags[look] & SEE_THROUGH || shape.cross || shape.liquid) continue;
    cover[look] = 1;
    for (let face = 0; face < 6; face++) if (covered(rects[table.shapeOf[look]][face], [0, 0, 16, 16])) full[look * 6 + face] = 1;
  }
  return { ...looks, rects, cover, full };
}

const padded = (x: number, y: number, z: number) => ((x + 1) * PADDED + (z + 1)) * PADDED + (y + 1);
/** The padded index's step along each axis. */
const STEP = [PADDED * PADDED, 1, PADDED];
/** Each face's step out of the block. */
const FACE_STEP = [STEP[1], -STEP[1], -STEP[2], STEP[2], -STEP[0], STEP[0]];

/** The face index of an axis (0 x, 1 y, 2 z) and its direction. */
function faceOf(axis: number, sign: number): number {
  if (axis === 1) return sign > 0 ? UP : DOWN;
  if (axis === 2) return sign > 0 ? SOUTH : NORTH;
  return sign > 0 ? EAST : WEST;
}

/** A mesh being built. */
class Builder {
  readonly positions: number[] = [];
  readonly tints: number[] = [];
  readonly occlusion: number[] = [];
  readonly indices: number[] = [];

  /** A quad: four corners in winding order (counterclockwise seen from its front). */
  quad(corners: number[][], color: Uint8Array, at: number, shade: number, levels: number[] | undefined, alpha: number): void {
    const base = this.positions.length / 3;
    for (let corner = 0; corner < 4; corner++) {
      this.positions.push(corners[corner][0], corners[corner][1], corners[corner][2]);
      this.tints.push(color[at] * shade, color[at + 1] * shade, color[at + 2] * shade, alpha);
      this.occlusion.push(levels ? levels[corner] * 85 : 255);
    }
    // Split along the diagonal that keeps a darker corner to one triangle.
    const flip = levels !== undefined && levels[0] + levels[2] < levels[1] + levels[3];
    if (flip) this.indices.push(base, base + 1, base + 3, base + 1, base + 2, base + 3);
    else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  done(): MeshPart {
    return { positions: Uint16Array.from(this.positions), tints: Uint8Array.from(this.tints), occlusion: Uint8Array.from(this.occlusion), indices: Uint32Array.from(this.indices) };
  }
}

/**
 * `blocks` holds look ids with the border, `water` layer 1 the same way (or undefined when there
 * is none near), `offset` the section's corner in its region, in blocks.
 */
export function meshSection(blocks: Uint16Array, water: Uint16Array | undefined, looks: Prepared, offset: [number, number, number]): SectionMesh {
  const { drawn, colors, table, cover, full, rects } = looks;
  const { flags, shapeOf, shapes } = table;
  const solid = new Builder();
  const glass = new Builder();
  const base = [offset[0] * 16, offset[1] * 16, offset[2] * 16];
  /** Which liquid is in a padded spot (in either layer): WATER, LAVA or 0. */
  const liquidAt = (i: number) => (flags[blocks[i]] | (water ? flags[water[i]] : 0)) & (WATER | LAVA);
  /** Whether the cube at a padded spot darkens corners. */
  const occludes = (i: number) => (flags[blocks[i]] & OCCLUDES ? 1 : 0);
  /** Whether a cube's face toward a neighbor is hidden by it. */
  const cubeHidden = (look: number, neighbor: number, face: number) => full[neighbor * 6 + OPPOSITE[face]] === 1 || (neighbor === look && (flags[look] & SEE_THROUGH) !== 0);

  // ---- Cubes, merged.
  /** For each spot in a slice: look id << 8 | the four corners' darkening (2 bits each), or -1 for no face. */
  const mask = new Int32Array(256);
  const p = [0, 0, 0];
  const q = [0, 0, 0];
  const at = (c: number[]) => occludes(padded(c[0], c[1], c[2]));
  for (let d = 0; d < 3; d++) {
    // u and v follow d (x, y, z in turn), so u x v points along +d.
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    for (const sign of [1, -1]) {
      const face = faceOf(d, sign);
      const shade = SHADE[face];
      for (let slice = 0; slice < 16; slice++) {
        let any = false;
        for (let j = 0; j < 16; j++) {
          for (let i = 0; i < 16; i++) {
            p[d] = slice;
            p[u] = i;
            p[v] = j;
            const cell = j * 16 + i;
            mask[cell] = -1;
            const look = blocks[padded(p[0], p[1], p[2])];
            if (!drawn[look] || shapeOf[look] !== 0) continue;
            q[0] = p[0];
            q[1] = p[1];
            q[2] = p[2];
            q[d] += sign;
            if (cubeHidden(look, blocks[padded(q[0], q[1], q[2])], face)) continue;
            // The corners in order (u-, v-), (u+, v-), (u+, v+), (u-, v+).
            let corners = 0;
            for (let corner = 0; corner < 4; corner++) {
              const su = corner === 1 || corner === 2 ? 1 : -1;
              const sv = corner >= 2 ? 1 : -1;
              q[u] += su;
              const side1 = at(q);
              q[u] -= su;
              q[v] += sv;
              const side2 = at(q);
              q[u] += su;
              const across = at(q);
              q[u] -= su;
              q[v] -= sv;
              const level = side1 && side2 ? 0 : 3 - side1 - side2 - across;
              corners |= level << (corner * 2);
            }
            mask[cell] = (look << 8) | corners;
            any = true;
          }
        }
        if (!any) continue;
        for (let j = 0; j < 16; j++) {
          for (let i = 0; i < 16; ) {
            const key = mask[j * 16 + i];
            if (key < 0) {
              i++;
              continue;
            }
            let width = 1;
            while (i + width < 16 && mask[j * 16 + i + width] === key) width++;
            let height = 1;
            grow: while (j + height < 16) {
              for (let k = 0; k < width; k++) if (mask[(j + height) * 16 + i + k] !== key) break grow;
              height++;
            }
            for (let h = 0; h < height; h++) for (let k = 0; k < width; k++) mask[(j + h) * 16 + i + k] = -1;
            const look = key >> 8;
            const plane = slice + (sign > 0 ? 1 : 0);
            const levels = [key & 3, (key >> 2) & 3, (key >> 4) & 3, (key >> 6) & 3];
            const spans = sign > 0 ? [[0, 0], [width, 0], [width, height], [0, height]] : [[0, 0], [0, height], [width, height], [width, 0]];
            const order = sign > 0 ? levels : [levels[0], levels[3], levels[2], levels[1]];
            const corners = spans.map(([su, sv]) => {
              const c = [0, 0, 0];
              c[d] = plane;
              c[u] = i + su;
              c[v] = j + sv;
              return [base[0] + c[0] * 16, base[1] + c[1] * 16, base[2] + c[2] * 16];
            });
            const see = (flags[look] & SEE_THROUGH) !== 0;
            (see ? glass : solid).quad(corners, colors, look * 24 + face * 4, shade, order, see ? colors[look * 24 + face * 4 + 3] : 255);
            i += width;
          }
        }
      }
    }
  }

  // ---- Everything else, block by block.
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (let y = 0; y < 16; y++) {
        const i = padded(x, y, z);
        const look = blocks[i];
        if (!drawn[look] || shapeOf[look] === 0) continue;
        const corner = [base[0] + x * 16, base[1] + y * 16, base[2] + z * 16];
        const shape = shapes[shapeOf[look]];
        if (shape.liquid) continue;
        const see = (flags[look] & SEE_THROUGH) !== 0;
        const builder = see ? glass : solid;
        if (shape.cross) {
          crossFaces(builder, corner, look, see);
          continue;
        }
        boxFaces(builder, shape, corner, i, look, see);
      }
    }
  }

  function boxFaces(builder: Builder, shape: Shape, corner: number[], i: number, look: number, see: boolean): void {
    for (const box of shape.boxes) {
      for (const { face, corners } of BOX_FACES) {
        const axis = FACE_AXIS[face];
        const onSide = FACE_SIGN[face] > 0 ? box[axis + 3] === 16 : box[axis] === 0;
        if (onSide) {
          const neighbor = blocks[i + FACE_STEP[face]];
          if (cover[neighbor] || neighbor === look) {
            const [u, v] = [0, 1, 2].filter((a) => a !== axis);
            const rect: Rect = [box[u], box[v], box[u + 3], box[v + 3]];
            if (covered(rects[shapeOf[neighbor]][OPPOSITE[face]], rect)) continue;
          }
        } else if (insideOther(shape, box, face)) continue;
        const points = corners.map((c) => [corner[0] + (c[0] ? box[3] : box[0]), corner[1] + (c[1] ? box[4] : box[1]), corner[2] + (c[2] ? box[5] : box[2])]);
        builder.quad(points, colors, look * 24 + face * 4, SHADE[face], undefined, see ? colors[look * 24 + face * 4 + 3] : 255);
      }
    }
  }

  function crossFaces(builder: Builder, corner: number[], look: number, see: boolean): void {
    const at = look * 24 + 2 * 4;
    const alpha = see ? colors[at + 3] : 255;
    const [x, y, z] = corner;
    for (const [a, b] of [
      [[2, 2], [14, 14]],
      [[2, 14], [14, 2]],
    ]) {
      const quad = [
        [x + a[0], y, z + a[1]],
        [x + b[0], y, z + b[1]],
        [x + b[0], y + 14, z + b[1]],
        [x + a[0], y + 14, z + a[1]],
      ];
      builder.quad(quad, colors, at, CROSS_SHADE, undefined, alpha);
      builder.quad([quad[0], quad[3], quad[2], quad[1]], colors, at, CROSS_SHADE, undefined, alpha);
    }
  }

  // ---- Water and lava, in either layer.
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (let y = 0; y < 16; y++) {
        const i = padded(x, y, z);
        const kind = liquidAt(i);
        if (!kind) continue;
        const look = flags[blocks[i]] & kind ? blocks[i] : water![i];
        const see = (flags[look] & SEE_THROUGH) !== 0;
        const builder = see ? glass : solid;
        const top = liquidAt(i + STEP[1]) === kind ? 16 : LIQUID_TOP;
        const box = [0, 0, 0, 16, top, 16];
        const corner = [base[0] + x * 16, base[1] + y * 16, base[2] + z * 16];
        for (const { face, corners } of BOX_FACES) {
          const neighbor = i + FACE_STEP[face];
          if (liquidAt(neighbor) === kind) {
            // The same liquid beside or under it hides the face; above, only a full one does.
            if (face !== UP || top === 16) continue;
          }
          if (face !== UP && full[blocks[neighbor] * 6 + OPPOSITE[face]]) continue;
          const points = corners.map((c) => [corner[0] + (c[0] ? box[3] : box[0]), corner[1] + (c[1] ? box[4] : box[1]), corner[2] + (c[2] ? box[5] : box[2])]);
          builder.quad(points, colors, look * 24 + face * 4, SHADE[face], undefined, see ? colors[look * 24 + face * 4 + 3] : 255);
        }
      }
    }
  }
  const solidPart = solid.done();
  const glassPart = glass.done();
  return { solid: solidPart, glass: glassPart, quads: (solidPart.indices.length + glassPart.indices.length) / 6 };
}

/** Whether a box's face lies inside another box of the same shape (a stair's step on its slab), so it's never seen. */
function insideOther(shape: Shape, box: readonly number[], face: number): boolean {
  const axis = FACE_AXIS[face];
  const plane = FACE_SIGN[face] > 0 ? box[axis + 3] : box[axis];
  const [u, v] = [0, 1, 2].filter((a) => a !== axis);
  return shape.boxes.some(
    (other) =>
      other !== box &&
      (FACE_SIGN[face] > 0 ? other[axis] === plane : other[axis + 3] === plane) &&
      other[u] <= box[u] &&
      other[v] <= box[v] &&
      other[u + 3] >= box[u + 3] &&
      other[v + 3] >= box[v + 3],
  );
}

/** A section's blocks with their border, cut from a grid; undefined when the section has no drawn block. */
export function paddedSection(grid: Uint16Array, size: [number, number, number], drawn: Uint8Array, cx: number, cy: number, cz: number): Uint16Array | undefined {
  const [sx, sy, sz] = size;
  const out = new Uint16Array(PADDED ** 3);
  let any = false;
  for (let x = -1; x <= 16; x++) {
    const gx = cx * 16 + x;
    if (gx < 0 || gx >= sx) continue;
    for (let z = -1; z <= 16; z++) {
      const gz = cz * 16 + z;
      if (gz < 0 || gz >= sz) continue;
      const column = (gx * sz + gz) * sy;
      for (let y = -1; y <= 16; y++) {
        const gy = cy * 16 + y;
        if (gy < 0 || gy >= sy) continue;
        const look = grid[column + gy];
        if (look === 0) continue;
        out[padded(x, y, z)] = look;
        if (!any && drawn[look] && x >= 0 && x < 16 && y >= 0 && y < 16 && z >= 0 && z < 16) any = true;
      }
    }
  }
  return any ? out : undefined;
}

/**
 * A section's layer 1 (the water in waterlogged blocks) with its border, from the volume's layer 1
 * sections (by section index), or undefined when none is near.
 */
export function paddedWater(water: Map<number, Uint16Array>, sections: [number, number, number], cx: number, cy: number, cz: number): Uint16Array | undefined {
  const [nx, ny, nz] = sections;
  const near: { key: number; dx: number; dy: number; dz: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const [sx, sy, sz] = [cx + dx, cy + dy, cz + dz];
        if (sx < 0 || sy < 0 || sz < 0 || sx >= nx || sy >= ny || sz >= nz) continue;
        const key = (sx * ny + sy) * nz + sz;
        if (water.has(key)) near.push({ key, dx, dy, dz });
      }
    }
  }
  if (near.length === 0) return undefined;
  const out = new Uint16Array(PADDED ** 3);
  for (const { key, dx, dy, dz } of near) {
    const layer = water.get(key)!;
    for (let x = -1; x <= 16; x++) {
      const lx = x - dx * 16;
      if (lx < 0 || lx >= 16) continue;
      for (let z = -1; z <= 16; z++) {
        const lz = z - dz * 16;
        if (lz < 0 || lz >= 16) continue;
        for (let y = -1; y <= 16; y++) {
          const ly = y - dy * 16;
          if (ly < 0 || ly >= 16) continue;
          const look = layer[(lx * 16 + lz) * 16 + ly];
          if (look) out[padded(x, y, z)] = look;
        }
      }
    }
  }
  return out;
}
