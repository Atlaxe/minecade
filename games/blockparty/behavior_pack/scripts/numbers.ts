// The numbers over heads: the moves left after a roll (counts.ts) and a transfer's count, "+3" coming
// in and "-3" going out (transfers.ts). The user (2026-11-18) wants them always facing the camera the
// players look through, the board's scripted one; a model's billboard can only turn to the player's
// own look (q.camera_rotation), which the scripted camera isn't. So each number is a particle,
// blockparty:number, which Minecraft always draws facing the camera that draws it: the game sends one
// every tick where the number stands, moving the way it moves, each living a little over a tick.
// Its picture is a cell of one atlas holding every number in Minecraft Ten (textures/blockparty/numbers,
// written by tools/blockparty/dice-pack.ts from the dice file's looks): the moves left 0 to 99 in the
// "number" look, "+1" to "+99" in the "gain" look and "-1" to "-99" in the "loss" look, each with its
// shadow, centered in a cell CELL pixels across, COLUMNS cells to a row. Pure, so the tool and the
// tests read it too.

export const NUMBER_PARTICLE = "blockparty:number";
export const NUMBER_ATLAS = "textures/blockparty/numbers";
/** The biggest number a cell has (a bigger one shows this). */
export const MAX_NUMBER = 99;
/** A cell's size in the atlas's pixels: "+99" with its shadow is 22 across, 11 high. */
export const CELL = { width: 24, height: 12 } as const;
export const COLUMNS = 16;
/** The atlas's cells: the moves left (0 to 99), then the gains, then the losses (1 to 99, at their own 1 to 99). */
export const CELLS = 300;
export const ROWS = Math.ceil(CELLS / COLUMNS);
export const ATLAS = { width: COLUMNS * CELL.width, height: ROWS * CELL.height } as const;

export type NumberKind = "count" | "gain" | "loss";
const FIRST_CELL: Readonly<Record<NumberKind, number>> = { count: 0, gain: 100, loss: 200 };
const SIGN: Readonly<Record<NumberKind, string>> = { count: "", gain: "+", loss: "-" };

/** The cell for `value` (cut to 0 to MAX_NUMBER; a transfer's count from 1). */
export function cellOf(kind: NumberKind, value: number): number {
  const lowest = kind === "count" ? 0 : 1;
  return FIRST_CELL[kind] + Math.max(lowest, Math.min(MAX_NUMBER, Math.round(value)));
}

/** What a cell shows, and in which look: undefined for the unused cells (a transfer's 0). */
export function cellText(cell: number): { kind: NumberKind; text: string } | undefined {
  if (cell < 0 || cell >= CELLS) return undefined;
  const kind: NumberKind = cell < FIRST_CELL.gain ? "count" : cell < FIRST_CELL.loss ? "gain" : "loss";
  const value = cell - FIRST_CELL[kind];
  if (kind !== "count" && value === 0) return undefined;
  return { kind, text: `${SIGN[kind]}${value}` };
}

/** A cell's top left in the atlas, in pixels. */
export function cellAt(cell: number): [number, number] {
  return [(cell % COLUMNS) * CELL.width, Math.floor(cell / COLUMNS) * CELL.height];
}

/**
 * How big a number of each kind is: blocks to a pixel of its cell (the moves left's 1.25 sixteenths of
 * a block, digits 0.78 blocks high; a transfer's count half that, the user asked).
 */
export const PIXEL_BLOCKS: Readonly<Record<NumberKind, number>> = { count: 1.25 / 16, gain: 0.625 / 16, loss: 0.625 / 16 };

/** A number's sprite at `scale`: half its width and height in blocks (a billboard's size is its half-size). */
export function halfSize(kind: NumberKind, scale = 1): [number, number] {
  return [(CELL.width * PIXEL_BLOCKS[kind] * scale) / 2, (CELL.height * PIXEL_BLOCKS[kind] * scale) / 2];
}

/**
 * A number's size as it shows and changes: it grows in over a sixth of a second, and each time it
 * changes it swells to 1.35 and settles back over a quarter of a second (seconds since each).
 */
export function popScale(sinceShown: number, sinceChange: number): number {
  const growing = Math.min(1, Math.max(0, sinceShown) * 6);
  const bump = sinceChange < 0.1 ? 1 + sinceChange * 3.5 : sinceChange < 0.25 ? 1.35 - (sinceChange - 0.1) * 2.33 : 1;
  return growing * bump;
}

/** Seconds a number's particle lives: a little over a tick, so the next one is there before it goes. */
export const SPRITE_LIFE = 0.1;
