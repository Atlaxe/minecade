// Particle outlines for a map editor holding the region tool or the Kill Y tool: their selection
// (yellow), the bounds (white), kill regions and the kill Y plane (red), and every other region in
// its own color. Only the player holding the tool sees them. Every edge shows from any distance:
// far dots are drawn closer in on the same line of sight, sized and spaced by distance
// (boxes.ts viewDots), so they look alike near and far. Each dot has a dark rim, so it shows on
// bright and dark backgrounds alike. A budget per refresh keeps a big map as cheap as a small one.
import { MolangVariableMap, world, type Player } from "@minecraft/server";
import type { Box, EditorRules, MapConfig, Scope } from "@minecade/minigame-core";
import { nearDots, planePoints, rectDots, viewDots, type Dot, type View } from "./boxes.ts";
import { KILL_COLOR, SELECTION_COLOR, outlineBoxes, type Rgb } from "./regions.ts";
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
  map(): MapConfig;
  readonly rules: EditorRules;
  isEditor(player: Player): boolean;
  /** The player's selection, and the key of the saved box it edits (drawn as the selection only). */
  selection(player: Player): { box: Box; editing?: string } | undefined;
}

export class Outlines {
  private readonly source: OutlineSource;
  private readonly tools: Set<ToolId | undefined>;

  /** Draws for players holding one of `tools`. */
  constructor(scope: Scope, source: OutlineSource, tools: ToolId[]) {
    this.source = source;
    this.tools = new Set(tools);
    scope.interval(() => this.draw(), REFRESH_TICKS);
  }

  private draw(): void {
    const players = world.getAllPlayers().filter((player) => this.tools.has(heldTool(player)) && this.source.isEditor(player));
    if (players.length === 0) return;
    const config = this.source.map();
    const boxes = outlineBoxes(config, this.source.rules);
    const bounds = boxes.find((outline) => outline.key === "bounds")?.box;
    for (const player of players) {
      const view: View = { eye: player.getHeadLocation(), look: player.getViewDirection() };
      const selection = this.source.selection(player);
      if (selection) dots(player, viewDots(selection.box, view, SELECTION_BUDGET), SELECTION_COLOR);
      const shown = boxes.filter((outline) => outline.key !== selection?.editing);
      const each = Math.max(BOX_BUDGET, Math.floor(BOXES_BUDGET / Math.max(1, shown.length)));
      for (const outline of shown) dots(player, viewDots(outline.box, view, each), outline.color);
      if (typeof config.killY === "number") {
        dots(player, nearDots(planePoints(config.killY, bounds, view.eye, PLANE_RADIUS, PLANE_SPACING), view), KILL_COLOR);
        if (bounds) dots(player, rectDots(bounds.min[0], bounds.min[2], bounds.max[0] + 1, bounds.max[2] + 1, config.killY, view, PLANE_EDGE_BUDGET), KILL_COLOR);
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
