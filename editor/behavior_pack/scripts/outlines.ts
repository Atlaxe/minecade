// Particle outlines for Select mode (Edit draws its boundaries with plane blocks, planes.ts), for a
// player holding the Select tool: their selection (yellow), and the boxes the source gives with
// their colors (the maps boxed so far). Only that player sees them. A box being nudged shows as the
// selection, moved as far as it's gone, with every box. Every edge shows from any distance:
// far dots are drawn closer in on the same line of sight, sized and spaced by distance
// (boxes.ts viewDots), so they look alike near and far. Each dot has a dark rim, so it shows on
// bright and dark backgrounds alike. A budget per refresh keeps a big map as cheap as a small one.
import { world, type Player } from "@minecraft/server";
import { drawDots, type Box, type Scope } from "@minecade/minigame-core";
import { viewDots, type Dot, type View } from "./boxes.ts";
import { ALL_BOUNDARIES, SELECTION_COLOR, outlineShown, type OutlineBox, type Rgb } from "./regions.ts";
import { nudgePreview, previewEditing } from "./box-picker.ts";
import { heldTool } from "./tool-host.ts";
import type { ToolId } from "./tools.ts";

/** Core's dot (particles/outline.json) lives a little longer than a refresh. */
const REFRESH_TICKS = 10;
const SELECTION_BUDGET = 300;
/** Dots for the map's boxes, shared between them, with at least BOX_BUDGET each. */
const BOXES_BUDGET = 450;
const BOX_BUDGET = 60;

export interface OutlineSource {
  /** The player's selection. */
  selection(player: Player): { box: Box } | undefined;
  /** Every box to outline, each in its color. */
  boxes(): OutlineBox[];
  /** True while this player sees everything as if holding the tool (a side menu open). */
  showing?(player: Player): boolean;
}

/** Everything: what a player holding one of the tools sees. */
const EVERYTHING: ReadonlySet<string> = new Set([ALL_BOUNDARIES]);

export class Outlines {
  private readonly source: OutlineSource;
  private readonly tools: Set<ToolId | undefined>;

  /** Draws everything for players holding one of `tools`, and what each other player switched on. */
  constructor(scope: Scope, source: OutlineSource, tools: ToolId[]) {
    this.source = source;
    this.tools = new Set(tools);
    scope.interval(() => this.draw(), REFRESH_TICKS);
  }

  private draw(): void {
    const viewers: [Player, ReadonlySet<string>, boolean][] = [];
    for (const player of world.getAllPlayers()) {
      const holding = this.tools.has(heldTool(player)) || nudgePreview(player) !== undefined || this.source.showing?.(player) === true;
      if (holding) viewers.push([player, EVERYTHING, holding]);
    }
    if (viewers.length === 0) return;
    const boxes = this.source.boxes();
    for (const [player, groups, holding] of viewers) {
      const view: View = { eye: player.getHeadLocation(), look: player.getViewDirection() };
      const nudged = nudgePreview(player);
      const selection = nudged ? { box: nudged } : holding ? this.source.selection(player) : undefined;
      if (selection) dots(player, viewDots(selection.box, view, SELECTION_BUDGET), SELECTION_COLOR);
      // A saved box being changed shows only as the selection.
      const editing = nudged ? previewEditing(player) : undefined;
      const shown = boxes.filter((outline) => outline.key !== editing && outlineShown(outline.group, groups));
      const each = Math.max(BOX_BUDGET, Math.floor(BOXES_BUDGET / Math.max(1, shown.length)));
      for (const outline of shown) dots(player, viewDots(outline.box, view, each), outline.color);
    }
  }
}

function dots(player: Player, list: Dot[], color: Rgb): void {
  drawDots(player, list, color);
}
