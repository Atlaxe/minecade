// Particle outlines for a map editor holding the region tool or the Kill Y tool: their selection
// (yellow), the bounds (white), kill regions and the kill Y plane (red), and every other region in
// its own color. Only the player holding the tool sees them. Dots are drawn only near the player,
// within a budget, and get sparser when a box would go over it, so a big map costs no more than a
// small one. A stand-in for the boundary blocks and the Layers form of a later pass.
import { MolangVariableMap, world, type Player } from "@minecraft/server";
import type { Box, EditorRules, MapConfig, Scope } from "@minecade/minigame-core";
import { edgePoints, planePoints, type Point } from "./boxes.ts";
import { KILL_COLOR, SELECTION_COLOR, outlineBoxes, type Rgb } from "./regions.ts";
import { heldTool } from "./tool-host.ts";
import type { ToolId } from "./tools.ts";

/** The editor resource pack's dot (particles/outline.json): it lives a little longer than a refresh. */
const PARTICLE = "minecade:outline";
const REFRESH_TICKS = 10;
/** Edges farther than this from the player's head aren't drawn. */
const RADIUS = 40;
const SELECTION_BUDGET = 240;
/** Dots for the map's boxes, shared between them, with at least BOX_BUDGET each. */
const BOXES_BUDGET = 360;
const BOX_BUDGET = 48;
const PLANE_RADIUS = 24;
const PLANE_SPACING = 3;

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
      const near = player.getHeadLocation();
      const selection = this.source.selection(player);
      if (selection) dots(player, edgePoints(selection.box, near, RADIUS, SELECTION_BUDGET), SELECTION_COLOR);
      const shown = boxes.filter((outline) => outline.key !== selection?.editing);
      const each = Math.max(BOX_BUDGET, Math.floor(BOXES_BUDGET / Math.max(1, shown.length)));
      for (const outline of shown) dots(player, edgePoints(outline.box, near, RADIUS, each), outline.color);
      if (typeof config.killY === "number") dots(player, planePoints(config.killY, bounds, near, PLANE_RADIUS, PLANE_SPACING), KILL_COLOR);
    }
  }
}

function dots(player: Player, points: Point[], color: Rgb): void {
  if (points.length === 0 || !player.isValid) return;
  const molang = new MolangVariableMap();
  molang.setColorRGB("variable.color", color);
  for (const point of points) {
    try {
      player.spawnParticle(PARTICLE, point, molang);
    } catch {
      // Outside the world's height, or the player just left.
      if (!player.isValid) return;
    }
  }
}
