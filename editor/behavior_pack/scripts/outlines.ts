// Particle outlines for a map editor holding a box tool (in Edit, the region and Kill Y tools; in
// Select, the Select tool): their selection (yellow), and the boxes the source gives with their
// colors (in Edit: the bounds white, kill regions and the kill Y plane red, every other region in
// its own color). Only that player sees them. In Edit, the boundaries a player switched on in the
// Boundaries view also show to them whatever they hold. A box being nudged shows as the selection,
// moved as far as it's gone, whatever the player holds. Every edge shows from any distance:
// far dots are drawn closer in on the same line of sight, sized and spaced by distance
// (boxes.ts viewDots), so they look alike near and far. Each dot has a dark rim, so it shows on
// bright and dark backgrounds alike. A budget per refresh keeps a big map as cheap as a small one.
import { MolangVariableMap, world, type Player } from "@minecraft/server";
import type { Box, Scope } from "@minecade/minigame-core";
import { nearDots, planePoints, rectDots, viewDots, type Dot, type View } from "./boxes.ts";
import { ALL_BOUNDARIES, KILL_COLOR, KILL_Y_GROUP, SELECTION_COLOR, outlineShown, type OutlineBox, type Rgb } from "./regions.ts";
import { killYPreview, nudgePreview } from "./box-picker.ts";
import { heldTool } from "./tool-host.ts";
import type { ToolId } from "./tools.ts";

/** The editor resource pack's dot (particles/outline.json): it lives a little longer than a refresh. */
const PARTICLE = "minecade:outline";
const REFRESH_TICKS = 10;
const SELECTION_BUDGET = 300;
/** Dots for the map's boxes, shared between them, with at least BOX_BUDGET each. */
const BOXES_BUDGET = 450;
const BOX_BUDGET = 60;
/** The kill Y plane: a grid near the player, and the bounds' edge at that height. */
const PLANE_RADIUS = 24;
const PLANE_SPACING = 3;
const PLANE_EDGE_BUDGET = 120;

export interface OutlineSource {
  /** The player's selection, and the key of the saved box it edits (drawn as the selection only). */
  selection(player: Player): { box: Box; editing?: string } | undefined;
  /** Every box to outline, each in its color. */
  boxes(): OutlineBox[];
  /** The kill Y plane, if there is one, and the box it's drawn over (the bounds). */
  killY?(): { y: number; over?: Box } | undefined;
  /** The box a kill Y plane is drawn over, for one being set when the map has none. */
  killYOver?(): Box | undefined;
  /** The boundary groups this player switched on (regions.ts outlineShown), shown whatever they hold. */
  shown?(player: Player): ReadonlySet<string>;
  /** True while this player sees none (looking through a camera). */
  hidden?(player: Player): boolean;
  /** True while this player sees everything as if holding a tool (the map menu open with the Region or Kill Y tool picked). */
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
      if (this.source.hidden?.(player)) continue;
      const holding = this.tools.has(heldTool(player)) || nudgePreview(player) !== undefined || killYPreview(player) !== undefined || this.source.showing?.(player) === true;
      const shown = holding ? EVERYTHING : this.source.shown?.(player);
      if (shown && shown.size > 0) viewers.push([player, shown, holding]);
    }
    if (viewers.length === 0) return;
    const boxes = this.source.boxes();
    const killY = this.source.killY?.();
    for (const [player, groups, holding] of viewers) {
      const view: View = { eye: player.getHeadLocation(), look: player.getViewDirection() };
      const nudged = nudgePreview(player);
      const selection = nudged ? { box: nudged, editing: undefined } : holding ? this.source.selection(player) : undefined;
      if (selection) dots(player, viewDots(selection.box, view, SELECTION_BUDGET), SELECTION_COLOR);
      const shown = boxes.filter((outline) => outline.key !== selection?.editing && outlineShown(outline.group, groups));
      const each = Math.max(BOX_BUDGET, Math.floor(BOXES_BUDGET / Math.max(1, shown.length)));
      for (const outline of shown) dots(player, viewDots(outline.box, view, each), outline.color);
      // The Kill Y tool's screen draws the height being set.
      const setting = killYPreview(player);
      const plane = setting !== undefined ? { y: setting, over: killY?.over ?? this.source.killYOver?.() } : killY && outlineShown(KILL_Y_GROUP, groups) ? killY : undefined;
      if (plane) {
        const { y, over } = plane;
        dots(player, nearDots(planePoints(y, over, view.eye, PLANE_RADIUS, PLANE_SPACING), view), KILL_COLOR);
        if (over) dots(player, rectDots(over.min[0], over.min[2], over.max[0] + 1, over.max[2] + 1, y, view, PLANE_EDGE_BUDGET), KILL_COLOR);
      }
    }
  }
}

function dots(player: Player, list: Dot[], color: Rgb): void {
  if (list.length === 0 || !player.isValid) return;
  const molang = new MolangVariableMap();
  molang.setColorRGB("variable.color", color);
  for (const dot of list) {
    molang.setFloat("variable.size", dot.size);
    try {
      player.spawnParticle(PARTICLE, dot, molang);
    } catch {
      // Outside the world's height, or the player just left.
      if (!player.isValid) return;
    }
  }
}
