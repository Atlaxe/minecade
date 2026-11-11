// A box outlined in particle dots for one player only: the map editor's Select outlines, and a
// game's own (Build Swap's selection). Core's minecade:outline particle (resource_pack/particles/
// outline.json) lives a little longer than a half-second refresh; viewDots (outline-dots.ts) places
// and sizes the dots for where the player looks from, within a budget.
import { MolangVariableMap, type Player } from "@minecraft/server";
import type { Box } from "../map-config.ts";
import { viewDots, type Dot } from "../outline-dots.ts";

export const OUTLINE_PARTICLE = "minecade:outline";
/** How often an outline is drawn again, in ticks: the dots last a little longer. */
export const OUTLINE_REFRESH_TICKS = 10;

/** A color as Molang takes it, each part 0 to 1. */
export interface OutlineColor {
  red: number;
  green: number;
  blue: number;
}

/** A color from 0xrrggbb. */
export function outlineColor(hex: number): OutlineColor {
  return { red: ((hex >> 16) & 0xff) / 255, green: ((hex >> 8) & 0xff) / 255, blue: (hex & 0xff) / 255 };
}

/** Draws `box`'s edges for `player` alone, in `color`, with at most `budget` dots. */
export function drawOutline(player: Player, box: Box, color: OutlineColor, budget: number): void {
  if (!player.isValid) return;
  drawDots(player, viewDots(box, { eye: player.getHeadLocation(), look: player.getViewDirection() }, budget), color);
}

/** Draws dots for `player` alone, in `color`. */
export function drawDots(player: Player, dots: Dot[], color: OutlineColor): void {
  if (dots.length === 0 || !player.isValid) return;
  const molang = new MolangVariableMap();
  molang.setColorRGB("variable.color", color);
  for (const dot of dots) {
    molang.setFloat("variable.size", dot.size);
    try {
      player.spawnParticle(OUTLINE_PARTICLE, dot, molang);
    } catch {
      // Outside the world's height, or the player just left.
      if (!player.isValid) return;
    }
  }
}
