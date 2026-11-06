// Select from above's plain data (pass V.10): the box on the picture (drawn from two columns, at
// most 256 across, moved and resized by its edges), its height (the blocks' trim, a floor and a
// ceiling), its picture from the side, a view cut to the floor and ceiling for the 3D look, and a
// map id from a name. Plain TypeScript, tested.
import type { View, ViewSection } from "../../viewer/view-format.ts";

/** The widest a box is, on x and on z. */
export const MAX_SIDE = 256;
export const MIN_Y = -64;
export const MAX_Y = 319;

/** A box's columns, each inclusive: x0 to x1 west to east, z0 to z1 north to south. */
export interface Columns {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const clampSide = (from: number, to: number) => (to >= from ? Math.min(to, from + MAX_SIDE - 1) : Math.max(to, from - MAX_SIDE + 1));

/** The box two columns span (the first stays put), stopping at MAX_SIDE each way. */
export function columnsFrom(a: { x: number; z: number }, b: { x: number; z: number }): Columns {
  const x = clampSide(a.x, b.x);
  const z = clampSide(a.z, b.z);
  return { x0: Math.min(a.x, x), z0: Math.min(a.z, z), x1: Math.max(a.x, x), z1: Math.max(a.z, z) };
}

export function columnsSize(box: Columns): { width: number; depth: number } {
  return { width: box.x1 - box.x0 + 1, depth: box.z1 - box.z0 + 1 };
}

/** Which edges a drag on the box moves: "w", "e", "n", "s", their corners ("nw"), or "move" for the whole box. */
export type Grip = "move" | "n" | "s" | "w" | "e" | "nw" | "ne" | "sw" | "se";

/** The box with its grip dragged by whole columns (never past the other side, never past MAX_SIDE). */
export function dragColumns(box: Columns, grip: Grip, dx: number, dz: number): Columns {
  if (grip === "move") return { x0: box.x0 + dx, z0: box.z0 + dz, x1: box.x1 + dx, z1: box.z1 + dz };
  const next = { ...box };
  if (grip.includes("w")) next.x0 = Math.max(box.x1 - MAX_SIDE + 1, Math.min(box.x1, box.x0 + dx));
  if (grip.includes("e")) next.x1 = Math.min(box.x0 + MAX_SIDE - 1, Math.max(box.x0, box.x1 + dx));
  if (grip.includes("n")) next.z0 = Math.max(box.z1 - MAX_SIDE + 1, Math.min(box.z1, box.z0 + dz));
  if (grip.includes("s")) next.z1 = Math.min(box.z0 + MAX_SIDE - 1, Math.max(box.z0, box.z1 + dz));
  return next;
}

/** Whole columns typed into the box's fields: put in order, and cut down to MAX_SIDE from the first corner. */
export function typedColumns(x0: number, z0: number, x1: number, z1: number): Columns {
  return columnsFrom({ x: Math.round(x0), z: Math.round(z0) }, { x: Math.round(x1), z: Math.round(z1) });
}

/** A floor and a ceiling kept inside the world, the floor never over the ceiling (the one changed wins). */
export function heightRange(floor: number, ceiling: number, changed: "floor" | "ceiling" = "floor"): { floor: number; ceiling: number } {
  const f = Math.max(MIN_Y, Math.min(MAX_Y, Math.round(floor)));
  const c = Math.max(MIN_Y, Math.min(MAX_Y, Math.round(ceiling)));
  if (f <= c) return { floor: f, ceiling: c };
  return changed === "floor" ? { floor: f, ceiling: f } : { floor: c, ceiling: c };
}

/** The look ids nothing in the box shows as (air, and blocks looked through), as a test on a look id. */
export type Hidden = (look: number) => boolean;

/**
 * The box's picture from the side, looking north from the south: for each column x0..x1 and layer
 * low..high, the nearest block's look id (0: none) and how far behind the front it is.
 */
export function sidePicture(view: View, box: Columns, low: number, high: number, hidden: Hidden): { width: number; height: number; looks: Uint16Array; depth: Uint16Array } {
  const width = box.x1 - box.x0 + 1;
  const height = high - low + 1;
  const looks = new Uint16Array(width * height);
  const depth = new Uint16Array(width * height).fill(0xffff);
  for (const section of view.list) eachBlock(section, (x, y, z, look) => {
    if (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1 || y < low || y > high || hidden(look)) return;
    const at = (high - y) * width + (x - box.x0);
    const behind = box.z1 - z;
    if (behind < depth[at]) {
      depth[at] = behind;
      looks[at] = look;
    }
  });
  return { width, height, looks, depth };
}

/** Each block of a section that isn't air, with its world spot and look. */
function eachBlock(section: ViewSection, visit: (x: number, y: number, z: number, look: number) => void): void {
  const { blocks } = section;
  if (typeof blocks === "number") {
    if (blocks === 0) return;
    for (let i = 0; i < 4096; i++) visit(section.x * 16 + (i >> 8), section.y * 16 + (i & 15), section.z * 16 + ((i >> 4) & 15), blocks);
    return;
  }
  for (let i = 0; i < 4096; i++) {
    const look = blocks[i];
    if (look !== 0) visit(section.x * 16 + (i >> 8), section.y * 16 + (i & 15), section.z * 16 + ((i >> 4) & 15), look);
  }
}

/** The view with only the blocks from the floor to the ceiling (for the 3D look), and its box to match. */
export function viewBetween(view: View, floor: number, ceiling: number): View {
  const list: ViewSection[] = [];
  for (const section of view.list) {
    const bottom = section.y * 16;
    if (bottom > ceiling || bottom + 15 < floor) continue;
    if (bottom >= floor && bottom + 15 <= ceiling) {
      list.push(section);
      continue;
    }
    const cut = (layer: Uint16Array | number | undefined): Uint16Array | number | undefined => {
      if (layer === undefined) return undefined;
      const out = new Uint16Array(4096);
      for (let i = 0; i < 4096; i++) {
        const y = bottom + (i & 15);
        out[i] = y < floor || y > ceiling ? 0 : typeof layer === "number" ? layer : layer[i];
      }
      return out;
    };
    const water = cut(section.water);
    list.push({ x: section.x, y: section.y, z: section.z, blocks: cut(section.blocks)!, ...(water !== undefined ? { water } : {}) });
  }
  const box = { min: [view.box.min[0], Math.max(view.box.min[1], floor), view.box.min[2]] as [number, number, number], max: [view.box.max[0], Math.min(view.box.max[1], ceiling), view.box.max[2]] as [number, number, number] };
  return { ...view, box, list, sections: list.length };
}

/** A map id from a name, as Select's form makes one: lower case letters, digits, _ and -. */
export function mapIdFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 48);
}

/** Why a map id can't be used for a game, or undefined: the store's and Select's own rule. */
export function mapIdProblem(map: string, taken: readonly string[]): string | undefined {
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(map)) return "A map id is lower case letters, digits, _ and -, starting with a letter or digit.";
  if (taken.includes(map)) return `The game has a map "${map}" already.`;
  return undefined;
}
