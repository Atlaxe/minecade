// Meshing one 16x16x16 section for the viewer page (in its workers): only faces between a drawn
// block and an open spot, touching faces of the same look merged into rectangles (greedy meshing),
// each face's color times its side's shade, and corner darkening (ambient occlusion: each corner
// darker for each of the three blocks around it on the open side). Faces merge only when their
// corners darken the same, so a merged rectangle shades as its blocks would. Positions are bytes
// from `offset`, so the sections of a region (4x4x4 sections, 64 blocks) share one mesh.
import { DOWN, EAST, NORTH, SOUTH, UP, WEST } from "./volume.ts";

/** How bright each side is: tops full, north and south 80%, east and west 60%, bottoms 50%. */
export const SHADE = [1, 0.5, 0.8, 0.8, 0.6, 0.6];

/** A section's blocks with a 1-block border from its neighbors: 18 a side, at ((x + 1) * 18 + (z + 1)) * 18 + (y + 1). */
export const PADDED = 18;

export interface SectionMesh {
  positions: Uint8Array;
  /** RGBA, shaded. */
  tints: Uint8Array;
  /** Each vertex's corner darkening, 0 (darkest) to 255 (none). */
  occlusion: Uint8Array;
  indices: Uint32Array;
  quads: number;
}

const padded = (x: number, y: number, z: number) => ((x + 1) * PADDED + (z + 1)) * PADDED + (y + 1);

/** The face index of an axis (0 x, 1 y, 2 z) and its direction. */
function faceOf(axis: number, sign: number): number {
  if (axis === 1) return sign > 0 ? UP : DOWN;
  if (axis === 2) return sign > 0 ? SOUTH : NORTH;
  return sign > 0 ? EAST : WEST;
}

/**
 * `blocks` holds look ids with the border; `drawn[look]` is 1 for drawn looks; `colors` has 24
 * bytes a look (six faces' RGBA, volume.ts's order).
 */
export function meshSection(blocks: Uint16Array, drawn: Uint8Array, colors: Uint8Array, offset: [number, number, number]): SectionMesh {
  const solid = new Uint8Array(blocks.length);
  for (let i = 0; i < blocks.length; i++) solid[i] = drawn[blocks[i]];
  const positions: number[] = [];
  const tints: number[] = [];
  const occlusion: number[] = [];
  const indices: number[] = [];
  /** For each spot in a slice: look id << 8 | the four corners' darkening (2 bits each), or -1 for no face. */
  const mask = new Int32Array(256);
  const p = [0, 0, 0];
  const q = [0, 0, 0];
  const at = (c: number[]) => solid[padded(c[0], c[1], c[2])];
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
            if (!drawn[look]) continue;
            q[0] = p[0];
            q[1] = p[1];
            q[2] = p[2];
            q[d] += sign;
            if (at(q)) continue;
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
            const color = look * 24 + face * 4;
            const plane = slice + (sign > 0 ? 1 : 0);
            const base = positions.length / 3;
            const levels = [key & 3, (key >> 2) & 3, (key >> 4) & 3, (key >> 6) & 3];
            const spans = [
              [0, 0],
              [width, 0],
              [width, height],
              [0, height],
            ];
            for (let corner = 0; corner < 4; corner++) {
              const c = [0, 0, 0];
              c[d] = plane;
              c[u] = i + spans[corner][0];
              c[v] = j + spans[corner][1];
              positions.push(c[0] + offset[0], c[1] + offset[1], c[2] + offset[2]);
              tints.push(colors[color] * shade, colors[color + 1] * shade, colors[color + 2] * shade, colors[color + 3]);
              occlusion.push(levels[corner] * 85);
            }
            // Split along the diagonal that keeps a darker corner to one triangle.
            const flip = levels[0] + levels[2] < levels[1] + levels[3];
            const triangles = flip ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3];
            for (let t = 0; t < 6; t += 3) {
              if (sign > 0) indices.push(base + triangles[t], base + triangles[t + 1], base + triangles[t + 2]);
              else indices.push(base + triangles[t], base + triangles[t + 2], base + triangles[t + 1]);
            }
            i += width;
          }
        }
      }
    }
  }
  return { positions: Uint8Array.from(positions), tints: Uint8Array.from(tints), occlusion: Uint8Array.from(occlusion), indices: Uint32Array.from(indices), quads: indices.length / 6 };
}

/** A section's blocks with their border, cut from the volume's grid; undefined when the section has no drawn block. */
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
