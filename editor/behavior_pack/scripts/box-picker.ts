// Picking a box by hitting and using, shared by the region tool (Edit mode) and the Select tool
// (Select mode): a hit starts a one-block box, each use on a block up to REACH away grows the box to
// it (so any box can be picked without placing blocks), and Back one step undoes changes.
import type { Block, Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import type { Box, Vec3 } from "@minecade/minigame-core/config";
import { nudgeBox, type Sides } from "./boxes.ts";
import type { ToolHost } from "./tool-host.ts";

/** How far a use reaches to grow the box, in blocks. */
export const REACH = 64;
/** How many steps Back one step can go. */
const HISTORY = 50;
/** How far one nudge can move a side, in blocks. */
const NUDGE = 16;

const SIDES: [keyof Sides, string][] = [
  ["west", "West side (x -). Above 0 moves a side out, below 0 in"],
  ["east", "East side (x +)"],
  ["down", "Bottom"],
  ["up", "Top"],
  ["north", "North side (z -)"],
  ["south", "South side (z +)"],
];

/** A box being picked, with its earlier boxes for Back one step. */
export interface Picking {
  box: Box;
  /** Earlier boxes, newest last. */
  history: Box[];
}

/** The block a use is aimed at, within reach, or undefined (the sky). */
export function blockInView(player: Player): Block | undefined {
  return player.getBlockFromViewDirection({ maxDistance: REACH, includeLiquidBlocks: true, includePassableBlocks: true })?.block;
}

/** Moves a selection to a new box, keeping the old one for Back one step. */
export function change(selection: Picking, box: Box): void {
  selection.history.push(selection.box);
  if (selection.history.length > HISTORY) selection.history.shift();
  selection.box = box;
}

/** Asks how far to move each side; the moved box, or undefined (and a message) when it doesn't work. */
export async function nudgeForm(host: Pick<ToolHost, "show" | "tell">, player: Player, box: Box, title: string): Promise<Box | undefined> {
  const form = new ModalFormData().title(title);
  for (const [, label] of SIDES) form.slider(label, -NUDGE, NUDGE, { valueStep: 1, defaultValue: 0 });
  form.submitButton("Nudge");
  const response = await host.show(player, form);
  const values = response?.formValues;
  if (!values || !player.isValid) return undefined;
  const sides = Object.fromEntries(SIDES.map(([side], i) => [side, Number(values[i]) || 0])) as unknown as Sides;
  const nudged = nudgeBox(box, sides);
  if (!nudged) host.tell(player, "§cThat would turn the box inside out: a side can't pass the one across from it.");
  return nudged;
}

export function xyz(block: Block): Vec3 {
  return [block.location.x, block.location.y, block.location.z];
}

export function keyOf(player: Player): string {
  return player.name.toLowerCase();
}
