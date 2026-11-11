// Paintball's own painted blocks: the shapes vanilla concrete doesn't come in (it has stairs, slabs
// and double slabs), one block per team dye and shape, minecade:paint_<dye>_<shape>. Each shape has
// the states the shared blocks pack's blocks of its kind have, so a mod block's states carry over as
// they are, and vanilla's are translated (paint.ts). tools/assets/paint-blocks.ts writes the blocks
// from this file; plain data, so Node can read it too.
import { dyeName, type TeamDef } from "@minecade/minigame-core/config";

export const PAINT_SHAPES = ["wall", "fence", "fence_gate", "pane", "trapdoor", "door", "vertical_slab"] as const;
export type PaintShape = (typeof PAINT_SHAPES)[number];

export const SIDES = ["north", "east", "south", "west"] as const;
export type Side = (typeof SIDES)[number];

const BOOL = ["false", "true"];
const sides = (values: string[]) => Object.fromEntries(SIDES.map((side) => [`minecade:${side}`, values]));

/** Each shape's states and their values (strings, as the blocks pack's). */
export const SHAPE_STATES: Record<PaintShape, Record<string, string[]>> = {
  wall: { "minecade:up": ["true", "false"], ...sides(["none", "low", "tall"]) },
  fence: sides(BOOL),
  fence_gate: { "minecade:facing": [...SIDES], "minecade:open": BOOL, "minecade:in_wall": BOOL },
  pane: sides(BOOL),
  trapdoor: { "minecade:facing": [...SIDES], "minecade:half": ["bottom", "top"], "minecade:open": BOOL },
  door: { "minecade:facing": [...SIDES], "minecade:half": ["lower", "upper"], "minecade:hinge": ["left", "right"], "minecade:open": BOOL },
  // The side the slab fills; a double one is a full block, painted to concrete.
  vertical_slab: { "minecade:type": [...SIDES] },
};

/** The custom component that opens and shuts painted doors, trapdoors and gates (main.ts registers it). */
export const PAINT_USE = "minecade:paint_use";
/** The shapes that open and shut. */
export const OPENING_SHAPES: readonly PaintShape[] = ["door", "trapdoor", "fence_gate"];

/** A painted block's id. */
export const paintBlock = (dye: string, shape: PaintShape) => `minecade:paint_${dye}_${shape}`;

/** A painted block's dye and shape, from its id. */
export function parsePaintBlock(typeId: string): { dye: string; shape: PaintShape } | undefined {
  const match = /^minecade:paint_([a-z_]+?)_(wall|fence_gate|fence|pane|trapdoor|door|vertical_slab)$/.exec(typeId);
  return match ? { dye: match[1], shape: match[2] as PaintShape } : undefined;
}

/** The dyes Paintball paints in: each team's (§c red, §9 blue). */
export const paintDyes = (teams: readonly TeamDef[]): string[] => teams.map((team) => dyeName(team.color));
