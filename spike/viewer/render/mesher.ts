// Greedy meshing of one 16x16x16 section: faces between a drawn block and an undrawn one only,
// and touching faces of the same block merged into rectangles. Positions are bytes (0 to 255)
// from `offset`, so sections can share one region mesh up to 255 blocks across; colors are the
// face's color times its side's shade.

/** Up, down, north and south, east and west (the plan's shading, before tuning). */
export const SHADE = { up: 1, down: 0.5, z: 0.8, x: 0.6 };

export interface SectionMesh {
  positions: Uint8Array;
  colors: Uint8Array;
  indices: Uint32Array;
  quads: number;
}

/** A section's blocks with a 1-block border from its neighbors: 18 a side, at ((x + 1) * 18 + (z + 1)) * 18 + (y + 1). */
export const PADDED = 18;

/**
 * `drawn[id]` is 1 for blocks that are drawn (air and hidden blocks are 0); `colors` holds 12
 * bytes for each id: up, down and side as RGBA.
 */
export function meshSection(blocks: Uint16Array, drawn: Uint8Array, colors: Uint8Array, offset: [number, number, number]): SectionMesh {
  const positions: number[] = [];
  const out: number[] = [];
  const indices: number[] = [];
  const mask = new Int32Array(256);
  const at = (x: number, y: number, z: number) => blocks[((x + 1) * PADDED + (z + 1)) * PADDED + (y + 1)];
  const coord = [0, 0, 0];
  // Each axis d with the two after it (u, v) in turn, so u x v points along +d.
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    for (const sign of [1, -1]) {
      const face = d === 1 ? (sign > 0 ? 0 : 1) : 2;
      const shade = d === 1 ? (sign > 0 ? SHADE.up : SHADE.down) : d === 2 ? SHADE.z : SHADE.x;
      for (let slice = 0; slice < 16; slice++) {
        // The mask: for each (u, v) in this slice, the block id whose face shows, or 0.
        let any = false;
        for (let j = 0; j < 16; j++) {
          for (let i = 0; i < 16; i++) {
            coord[d] = slice;
            coord[u] = i;
            coord[v] = j;
            const id = at(coord[0], coord[1], coord[2]);
            let shown = 0;
            if (drawn[id]) {
              coord[d] += sign;
              if (!drawn[at(coord[0], coord[1], coord[2])]) shown = id;
            }
            mask[j * 16 + i] = shown;
            if (shown) any = true;
          }
        }
        if (!any) continue;
        for (let j = 0; j < 16; j++) {
          for (let i = 0; i < 16; ) {
            const id = mask[j * 16 + i];
            if (!id) {
              i++;
              continue;
            }
            let width = 1;
            while (i + width < 16 && mask[j * 16 + i + width] === id) width++;
            let height = 1;
            grow: while (j + height < 16) {
              for (let k = 0; k < width; k++) if (mask[(j + height) * 16 + i + k] !== id) break grow;
              height++;
            }
            for (let h = 0; h < height; h++) for (let k = 0; k < width; k++) mask[(j + h) * 16 + i + k] = 0;
            const plane = slice + (sign > 0 ? 1 : 0);
            const base = positions.length / 3;
            for (const [du, dv] of [
              [0, 0],
              [width, 0],
              [width, height],
              [0, height],
            ]) {
              const p = [0, 0, 0];
              p[d] = plane;
              p[u] = i + du;
              p[v] = j + dv;
              positions.push(p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]);
              const c = id * 12 + face * 4;
              out.push(colors[c] * shade, colors[c + 1] * shade, colors[c + 2] * shade, colors[c + 3]);
            }
            if (sign > 0) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
            i += width;
          }
        }
      }
    }
  }
  return { positions: Uint8Array.from(positions), colors: Uint8Array.from(out), indices: Uint32Array.from(indices), quads: indices.length / 6 };
}
