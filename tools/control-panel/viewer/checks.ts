// The checks a 3D view makes easy (docs/plans/map-viewer.md, "Checks"), shown as warnings beside
// the game's checklist; Save and Publish still work. A spawn or marker standing in a block, a spawn
// with nothing to stand on (barriers and invisible bedrock count: the viewer doesn't draw them, but
// players stand on them), build areas (the building games' "plot" region) that overlap or whose
// block-thick shell (where liquids are cleared) reaches another; game Edit's boundary blocks left in
// the world; and blocks with no look. Plain TypeScript, tested.
import type { Box } from "@minecade/minigame-core/config";
import type { Markup, PointMark } from "./markup.ts";
import { insideShape, PASSABLE, WATER, LAVA } from "./shapes.ts";
import { lookAtSpot, solidTop, waterAtSpot, type Volume } from "./volume.ts";

export interface MapWarning {
  /** What's wrong, in a line. */
  text: string;
  /** The entry it's about: picked when the warning is clicked. */
  entry?: string;
  /** A block's name: a click shows the first one. */
  block?: string;
}

/** How far below a spawn a floor may be, in blocks. */
export const FALL = 3;
/** Where a standing player's feet and head are, above the spot. */
const FEET = 0.1;
const HEAD = 1.6;
/** Game Edit's boundary blocks (editor/behavior_pack/scripts/sheets.ts). */
export const PLANE_BLOCK = "minecade:plane";
/** The building games' build areas: their "plot" region list. */
const PLOT_LIST = "regions.plot";
/** Hidden blocks that are solid in a game: walls and floors nobody sees. */
const SOLID_HIDDEN = /^minecraft:(barrier|invisible_bedrock)$/;

/** Whether the look at a grid spot is a hidden block that's solid in a game. */
function hiddenWall(volume: Volume, x: number, y: number, z: number): boolean {
  return SOLID_HIDDEN.test(volume.looks[lookAtSpot(volume, x, y, z)]?.name ?? "");
}

/** Whether a world point is inside something a click can land on (a block's box, not a plant or liquid). */
export function solidAt(volume: Volume, x: number, y: number, z: number): boolean {
  const g = [x - volume.origin[0], y - volume.origin[1], z - volume.origin[2]];
  const cell = g.map(Math.floor);
  const look = lookAtSpot(volume, cell[0], cell[1], cell[2]);
  if (hiddenWall(volume, cell[0], cell[1], cell[2])) return true;
  if (!volume.drawn[look] || volume.table.flags[look] & PASSABLE) return false;
  const shape = volume.table.shapes[volume.table.shapeOf[look]];
  return insideShape(shape, g[0] - cell[0], g[1] - cell[1], g[2] - cell[2]);
}

/** Whether a spawn has a floor (a block's top, or water or lava) within FALL blocks under its feet. */
export function hasFloor(volume: Volume, at: { x: number; y: number; z: number }): boolean {
  const [gx, gz] = [Math.floor(at.x - volume.origin[0]), Math.floor(at.z - volume.origin[2])];
  const feet = at.y - volume.origin[1];
  for (let gy = Math.floor(feet + 0.01); gy >= Math.floor(feet - FALL) - 1; gy--) {
    const top = hiddenWall(volume, gx, gy, gz) ? 1 : solidTop(volume, gx, gy, gz);
    if (top !== undefined && gy + top <= feet + 0.01 && gy + top >= feet - FALL - 0.01) return true;
    const liquid = volume.table.flags[lookAtSpot(volume, gx, gy, gz)] | volume.table.flags[waterAtSpot(volume, gx, gy, gz)];
    if (liquid & (WATER | LAVA)) return true;
  }
  return false;
}

const SPAWN_LISTS = /^(spawns|teamSpawns\.|queueSpawn)/;

function pointWarnings(volume: Volume, point: PointMark): MapWarning[] {
  const { x, y, z } = point.at;
  const feet = solidAt(volume, x, y + FEET, z);
  const head = solidAt(volume, x, y + HEAD, z);
  const out: MapWarning[] = [];
  if (feet || head) out.push({ text: `${point.label}: ${feet && head ? "stands inside blocks" : feet ? "its feet are in a block" : "its head is in a block"}`, entry: point.key });
  else if (SPAWN_LISTS.test(point.list) && !hasFloor(volume, point.at)) out.push({ text: `${point.label}: nothing to stand on within ${FALL} blocks`, entry: point.key });
  return out;
}

const overlaps = (a: Box, b: Box) => [0, 1, 2].every((axis) => a.min[axis] <= b.max[axis] && b.min[axis] <= a.max[axis]);
const grown = (box: Box): Box => ({ min: box.min.map((v) => v - 1) as Box["min"], max: box.max.map((v) => v + 1) as Box["max"] });

/**
 * Build areas that overlap, or whose shell reaches another. A building game's map has one, inside
 * its arena (the checklist says when it isn't), but a map can still be given more.
 */
function plotWarnings(markup: Markup): MapWarning[] {
  const plots = markup.boxes.filter((box) => box.list === PLOT_LIST);
  if (plots.length === 0) return [];
  const out: MapWarning[] = [];
  plots.forEach((a, i) =>
    plots.slice(i + 1).forEach((b) => {
      if (overlaps(a.box, b.box)) out.push({ text: `${a.label} and ${b.label} overlap`, entry: b.key });
      else if (overlaps(grown(a.box), b.box)) out.push({ text: `${a.label}'s shell (the block around it) reaches ${b.label}`, entry: b.key });
    }),
  );
  return out;
}

/** Every warning for a map as it is now. */
export function mapWarnings(volume: Volume, markup: Markup): MapWarning[] {
  const out = markup.points.flatMap((point) => pointWarnings(volume, point));
  out.push(...plotWarnings(markup));
  const planes = volume.looks.reduce((sum, look, id) => (look.name === PLANE_BLOCK ? sum + volume.counts[id] : sum), 0);
  if (planes > 0) out.push({ text: `${planes.toLocaleString()} of game Edit's boundary blocks (${PLANE_BLOCK}) are left in the world`, block: PLANE_BLOCK });
  return out;
}

/** Drawn blocks with no look (shown pink), by name, with how many of each. */
export function blocksWithoutLook(volume: Volume): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  volume.looks.forEach((look, id) => {
    if (volume.unknown.includes(look.name) && volume.counts[id] > 0) counts.set(look.name, (counts.get(look.name) ?? 0) + volume.counts[id]);
  });
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}
