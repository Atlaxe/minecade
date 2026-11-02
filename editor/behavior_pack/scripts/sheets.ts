// Edit draws boundaries with plane blocks (minecade:plane, editor/behavior_pack/blocks/plane.json),
// the way Axiom and Litematica show a selection: a see-through colored sheet on each side of a box,
// and one across the bounds at each height (kill Y, the build limit). A plane is a 16x16 square one
// pixel thick, in one of 16 colors (Minecraft's dye colors), across any axis at any of the 16 pixels
// of its block, so a sheet sits exactly on a box's side. The block only goes where there's air, and
// never into a map: the editor takes every plane out before the world is saved (planes.ts). Pure
// functions, so they can be tested without a server.
import type { Box, Vec3 } from "@minecade/minigame-core/config";
import { SELECTION_COLOR, heightColor, outlineShown, type HeightLine, type HeightPlane, type OutlineBox, type Rgb } from "./regions.ts";
import type { ToolId } from "./tools.ts";

export const PLANE_BLOCK = "minecade:plane";

/** The plane's colors, in its color state's order: Minecraft's 16 dye colors. */
export const PLANE_COLORS = [
  { id: "white", rgb: 0xf9fffe },
  { id: "orange", rgb: 0xf9801d },
  { id: "magenta", rgb: 0xc74ebd },
  { id: "light_blue", rgb: 0x3ab3da },
  { id: "yellow", rgb: 0xfed83d },
  { id: "lime", rgb: 0x80c71f },
  { id: "pink", rgb: 0xf38baa },
  { id: "gray", rgb: 0x474f52 },
  { id: "light_gray", rgb: 0x9d9d97 },
  { id: "cyan", rgb: 0x169c9c },
  { id: "purple", rgb: 0x8932b8 },
  { id: "blue", rgb: 0x3c44aa },
  { id: "brown", rgb: 0x835432 },
  { id: "green", rgb: 0x5e7c16 },
  { id: "red", rgb: 0xb02e26 },
  { id: "black", rgb: 0x1d1d21 },
] as const;

/** Which axis a plane lies across: 0 is a wall facing east and west, 1 a floor, 2 a wall facing north and south. */
export type Axis = 0 | 1 | 2;

/** A sheet of planes: every block from min to max (one thick along its axis), each with its plane at `offset` pixels along it, in a PLANE_COLORS color. */
export interface Sheet {
  min: Vec3;
  max: Vec3;
  axis: Axis;
  offset: number;
  color: number;
}

/** The block's states for a sheet. */
export function planeStates(sheet: Pick<Sheet, "axis" | "offset" | "color">): Record<string, number> {
  return { "minecade:axis": sheet.axis, "minecade:offset": sheet.offset, "minecade:color": sheet.color };
}

export function sheetKey(sheet: Sheet): string {
  return `${sheet.axis}/${sheet.offset}/${sheet.color}/${sheet.min.join(",")}/${sheet.max.join(",")}`;
}

/** Bedrock's overworld: the lowest block and the highest. */
const BOTTOM = -64;
const TOP = 319;

/**
 * A box's six sides as sheets, each in the blocks just outside it with its plane on the pixel next
 * to the box, so the sides never share a block (the edges and corners stay whole).
 */
export function boxSheets(box: Box, color: number): Sheet[] {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  const sheets: Sheet[] = [
    { min: [x0 - 1, y0, z0], max: [x0 - 1, y1, z1], axis: 0, offset: 15, color },
    { min: [x1 + 1, y0, z0], max: [x1 + 1, y1, z1], axis: 0, offset: 0, color },
    { min: [x0, y0 - 1, z0], max: [x1, y0 - 1, z1], axis: 1, offset: 15, color },
    { min: [x0, y1 + 1, z0], max: [x1, y1 + 1, z1], axis: 1, offset: 0, color },
    { min: [x0, y0, z0 - 1], max: [x1, y1, z0 - 1], axis: 2, offset: 15, color },
    { min: [x0, y0, z1 + 1], max: [x1, y1, z1 + 1], axis: 2, offset: 0, color },
  ];
  return sheets.flatMap((sheet) => inWorld(sheet) ?? []);
}

/**
 * A height (kill Y, a side of the build limit) as a sheet across `over` (the bounds), on the side
 * where it holds: kill Y's and the build limit below's in the blocks just under it, the build limit
 * above's in the blocks just over it (where nothing can be built anyway).
 */
export function heightSheet(y: number, above: boolean, over: Box, color: number): Sheet | undefined {
  const layer = above ? y : y - 1;
  return inWorld({ min: [over.min[0], layer, over.min[2]], max: [over.max[0], layer, over.max[2]], axis: 1, offset: above ? 0 : 15, color });
}

/** The sheet cut to the world's heights, or undefined when none of it is in them. */
function inWorld(sheet: Sheet): Sheet | undefined {
  const min: Vec3 = [sheet.min[0], Math.max(BOTTOM, sheet.min[1]), sheet.min[2]];
  const max: Vec3 = [sheet.max[0], Math.min(TOP, sheet.max[1]), sheet.max[2]];
  return min[1] > max[1] ? undefined : { ...sheet, min, max };
}

/** The sheet in pieces, one per chunk column it crosses (each well under a fill's size limit). */
export function chunkPieces(sheet: Sheet): Sheet[] {
  const pieces: Sheet[] = [];
  for (let cx = Math.floor(sheet.min[0] / 16); cx <= Math.floor(sheet.max[0] / 16); cx++) {
    for (let cz = Math.floor(sheet.min[2] / 16); cz <= Math.floor(sheet.max[2] / 16); cz++) {
      const min: Vec3 = [Math.max(sheet.min[0], cx * 16), sheet.min[1], Math.max(sheet.min[2], cz * 16)];
      const max: Vec3 = [Math.min(sheet.max[0], cx * 16 + 15), sheet.max[1], Math.min(sheet.max[2], cz * 16 + 15)];
      pieces.push({ ...sheet, min, max });
    }
  }
  return pieces;
}

/** Whether a block is in a sheet. */
export function sheetHas(sheet: Sheet, at: Vec3): boolean {
  return [0, 1, 2].every((axis) => at[axis] >= sheet.min[axis] && at[axis] <= sheet.max[axis]);
}

/**
 * The plane color nearest an outline color: by brightness among the grays (white, light gray, gray,
 * black) for a pale one, else by hue first, then brightness and saturation, among the others.
 */
export function planeColor(color: Rgb): number {
  const want = hsv([color.red, color.green, color.blue]);
  let best = 0;
  let bestScore = Infinity;
  PLANE_COLORS.forEach((candidate, i) => {
    const have = hsv([(candidate.rgb >> 16) / 255, ((candidate.rgb >> 8) & 0xff) / 255, (candidate.rgb & 0xff) / 255]);
    const gray = have.s < GRAY_SATURATION;
    if (gray !== want.s < GRAY_SATURATION) return;
    const turn = Math.abs(want.h - have.h);
    const score = gray ? Math.abs(want.v - have.v) : Math.min(turn, 360 - turn) / 60 + Math.abs(want.v - have.v) + Math.abs(want.s - have.s) / 2;
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** Below this saturation a color counts as a gray. */
const GRAY_SATURATION = 0.25;

function hsv([r, g, b]: [number, number, number]): { h: number; s: number; v: number } {
  const v = Math.max(r, g, b);
  const range = v - Math.min(r, g, b);
  const s = v === 0 ? 0 : range / v;
  let h = 0;
  if (range > 0) {
    if (v === r) h = 60 * (((g - b) / range + 6) % 6);
    else if (v === g) h = 60 * ((b - r) / range + 2);
    else h = 60 * ((r - g) / range + 4);
  }
  return { h, s, v };
}

/** What one map editor sees drawn. */
export interface OverlayView {
  /** The tool in hand, or picked in the open map menu. */
  tool?: ToolId;
  /** The boundaries they switched on in the Boundaries view. */
  shown: ReadonlySet<string>;
  /** The Region tool's selection. */
  selection?: Box;
  /** A box being nudged or set up in a screen, and the saved box it changes, if any. */
  nudged?: { box: Box; editing?: string };
  /** The height being set in the Kill Y tool's screen. */
  height?: { line: HeightLine; y: number };
}

/**
 * The sheets one map editor sees: setting a height, only that height's; changing a box, the box as
 * the selection with every other boundary; holding the Region tool, the selection and every
 * boundary; holding the Kill Y tool, only the heights; otherwise the boundaries they switched on.
 * `over` is the box the heights stretch across (the bounds).
 */
export function overlaySheets(view: OverlayView, boxes: OutlineBox[], heights: HeightPlane[], over: Box | undefined): Sheet[] {
  const heightSheets = (list: { line: HeightLine; y: number }[]) =>
    over ? list.flatMap(({ line, y }) => heightSheet(y, line === "above", over, planeColor(heightColor(line))) ?? []) : [];
  if (view.height) return heightSheets([view.height]);
  const selection = (box: Box | undefined) => (box ? boxSheets(box, planeColor(SELECTION_COLOR)) : []);
  const everything = (skip?: string) => [
    ...boxes.filter((outline) => outline.key !== skip).flatMap((outline) => boxSheets(outline.box, planeColor(outline.color))),
    ...heightSheets(heights),
  ];
  if (view.nudged) return [...selection(view.nudged.box), ...everything(view.nudged.editing)];
  if (view.tool === "region") return [...selection(view.selection), ...everything()];
  if (view.tool === "killY") return heightSheets(heights);
  return [
    ...boxes.filter((outline) => outlineShown(outline.group, view.shown)).flatMap((outline) => boxSheets(outline.box, planeColor(outline.color))),
    ...heightSheets(heights.filter((plane) => outlineShown(plane.group, view.shown))),
  ];
}

/** Every sheet once, in the order first given (where two want the same block, the first gets it). */
export function uniqueSheets(sheets: Sheet[]): Sheet[] {
  const seen = new Map<string, Sheet>();
  for (const sheet of sheets) if (!seen.has(sheetKey(sheet))) seen.set(sheetKey(sheet), sheet);
  return [...seen.values()];
}
