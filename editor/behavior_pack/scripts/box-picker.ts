// Picking a box by hitting and using, shared by the region tool (Edit mode) and the Select tool
// (Select mode): a hit starts a one-block box, each use on a block up to REACH away grows the box to
// it (so any box can be picked without placing blocks), and Back one step undoes changes. Nudge
// sides moves each side a step at a time, and the outline shows the moved box at once.
import { system, type Block, type Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import type { Box, Vec3 } from "@minecade/minigame-core/config";
import { facingOf, nudgeBox, sizeText, type Sides } from "./boxes.ts";
import { sideTitle } from "./marks.ts";
import { NUDGE_STEPS, facingLine, nudgeEntries } from "./menu.ts";
import { actionBar, type ToolHost } from "./tool-host.ts";

/** How far a use reaches to grow the box, in blocks. */
export const REACH = 64;
/** How many steps Back one step can go. */
const HISTORY = 50;
/** How often the facing line goes back on the action bar while Nudge sides is open (it fades). */
const FACING_TICKS = 20;
const UNMOVED: Sides = { west: 0, east: 0, down: 0, up: 0, north: 0, south: 0 };

/** The box each player is nudging, as it would be now: the outlines show it instead of their selection. */
const nudging = new Map<string, Box>();

/** The box this player is nudging, moved as far as they've gone so far (or what a tool screen shows). */
export function nudgePreview(player: Player): Box | undefined {
  return nudging.get(keyOf(player));
}

/** Shows a box as this player's selection while a tool screen is open (a spawn's block, say); none stops. */
export function showPreview(player: Player, box: Box | undefined): void {
  if (box) nudging.set(keyOf(player), box);
  else nudging.delete(keyOf(player));
}

/** The kill Y each player is setting in the Kill Y tool's screen, drawn instead of the map's. */
const killYs = new Map<string, number>();

export function killYPreview(player: Player): number | undefined {
  return killYs.get(keyOf(player));
}

export function showKillY(player: Player, y: number | undefined): void {
  if (y === undefined) killYs.delete(keyOf(player));
  else killYs.set(keyOf(player), y);
}

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

/**
 * Nudge sides: a minus and a plus for each side, a step at a time, with the moved box outlined at
 * once and the way the player faces on the action bar. Nudge keeps it: the moved box, or undefined
 * when they closed the menu (the box stays as it was).
 */
export async function nudgeMenu(host: Pick<ToolHost, "show" | "tell">, player: Player, box: Box, title: string): Promise<Box | undefined> {
  const key = keyOf(player);
  let sides = UNMOVED;
  let step: number = NUDGE_STEPS[0];
  const facing = () => facingOf(player.getRotation().y);
  const showFacing = () => player.isValid && actionBar(player, facingLine(facing()));
  const bar = system.runInterval(showFacing, FACING_TICKS);
  try {
    for (;;) {
      const moved = nudgeBox(box, sides) ?? box;
      nudging.set(key, moved);
      showFacing();
      const entries = nudgeEntries({ sides, step, facing: facing() });
      const form = new ActionFormData().title(sideTitle(title)).body(`${sizeText(moved)} blocks`);
      for (const entry of entries) form.button(entry.text, entry.icon);
      const response = await host.show(player, form);
      const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
      if (!action || !player.isValid) return undefined;
      if (action.kind === "nudge") return moved;
      if (action.kind === "step") step = NUDGE_STEPS[((NUDGE_STEPS as readonly number[]).indexOf(step) + 1) % NUDGE_STEPS.length];
      else if (action.kind === "reset") sides = UNMOVED;
      else if (action.kind === "side") {
        const next = { ...sides, [action.side]: sides[action.side] + action.by * step };
        if (nudgeBox(box, next)) sides = next;
        else host.tell(player, "§cThat would turn the box inside out: a side can't pass the one across from it.");
      }
    }
  } finally {
    nudging.delete(key);
    system.clearRun(bar);
  }
}

export function xyz(block: Block): Vec3 {
  return [block.location.x, block.location.y, block.location.z];
}

export function keyOf(player: Player): string {
  return player.name.toLowerCase();
}
