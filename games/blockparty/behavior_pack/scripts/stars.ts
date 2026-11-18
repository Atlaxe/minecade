// The star field the minigame announcement fades in over everyone's view, and out again on the far
// side (docs/plans/block-party-ui.md, "The minigame announcement"): layers of stars sliding at
// different speeds, so it feels as if the camera is still traveling once it has stopped. They slide
// down while it rises from the board (or from an arena on the way back), and up as it comes down
// into the arena (or onto the board).
//
// It's HUD (the HUD draws over a camera fade, which is why), ridden on the action bar's codes
// (bar-codes.ts) like the loading screen it replaces. The client builds the action bar's controls
// anew each time the line is sent, which starts their animations over, so each layer's slide can't
// just loop: the line carries a phase, and ui/blockparty_hud.json (tools/assets/blockparty-hud-ui.ts)
// has a copy of the layers for each, whose animation starts from where that phase puts them and
// loops on from there. Each send puts the layers where they'd have slid to by then, so they glide on
// the client between sends, with no jump when one comes. Reversing is the other way's copy at the
// same phase.
//
// Pure (no @minecraft imports), so the HUD's generator and the tests share it.
import { STAR_PHASES, type StarDirection, starsCode } from "./bar-codes.ts";

export interface StarLayer {
  id: string;
  texture: string;
  /** The texture's tiled scale: a texture pixel is this many of the screen's GUI pixels. */
  scale: number;
  /** The tile's height on screen, in GUI pixels (the texture's height times its scale). */
  tile: number;
  /** Whole tiles it slides in STAR_PERIOD_MS, so every layer is back where it started together. */
  tiles: number;
}

/** Milliseconds from one phase to the next. */
export const PHASE_MS = 100;
/** Milliseconds the whole field takes to come round to where it started. */
export const STAR_PERIOD_MS = PHASE_MS * STAR_PHASES;

/**
 * Back to front: the far stars are Minecade's own star field (opaque: black between the stars, so
 * at full strength nothing shows through), the nearer ones see-through stars of their own
 * (tools/assets/blockparty-stars.ts), bigger and faster as they come nearer: 20, 40 and 80 GUI
 * pixels a second.
 */
export const STAR_LAYERS: readonly StarLayer[] = [
  { id: "far", texture: "textures/minecade/sky/stars", scale: 1, tile: 512, tiles: 1 },
  { id: "mid", texture: "textures/blockparty/stars/mid", scale: 1, tile: 256, tiles: 4 },
  { id: "near", texture: "textures/blockparty/stars/near", scale: 2, tile: 512, tiles: 4 },
];

/** Seconds a layer takes to slide one tile (its loop). */
export function loopSeconds(layer: StarLayer): number {
  return STAR_PERIOD_MS / 1000 / layer.tiles;
}

/** A layer's speed, in GUI pixels a second. */
export function layerSpeed(layer: StarLayer): number {
  return (layer.tile * layer.tiles) / (STAR_PERIOD_MS / 1000);
}

/**
 * Where a layer stands at `phase` sliding `direction`, as its image's offset down from its resting
 * place (from -tile to 0: the image is a tile taller than the screen, so it always covers it), and
 * the seconds until it's slid to the end of its loop, where the loop takes over: down to 0, or up
 * to -tile.
 */
export function layerStart(layer: StarLayer, phase: number, direction: StarDirection): { from: number; seconds: number } {
  const turn = ((layer.tiles * phase) / STAR_PHASES) % 1;
  const slid = turn * layer.tile;
  const speed = layerSpeed(layer);
  if (direction === "down") return { from: slid - layer.tile, seconds: (layer.tile - slid) / speed };
  // Up from 0 is the same picture as up from -tile: a whole loop to go.
  if (slid === 0) return { from: 0, seconds: layer.tile / speed };
  return { from: slid - layer.tile, seconds: slid / speed };
}

/** Phases a send may be off by and still go (a quarter: the near layer at most 2 pixels out). */
const NEAR_ENOUGH = 0.25;

/**
 * The star field's state on the server: its strength, the way it slides, and how far it has slid
 * (by the clock, not by ticks: the client's animations run in real time, through a server stall too).
 */
export class StarField {
  private readonly now: () => number;
  private strength = 0;
  private way: StarDirection = "down";
  /** Milliseconds slid, down positive, up to the last change. */
  private slid = 0;
  /** When the last change was, while the field is up. */
  private since: number | undefined;

  constructor(now: () => number) {
    this.now = now;
  }

  get level(): number {
    return this.strength;
  }

  set level(level: number) {
    this.settle();
    this.strength = Math.max(0, level);
  }

  get direction(): StarDirection {
    return this.way;
  }

  set direction(direction: StarDirection) {
    this.settle();
    this.way = direction;
  }

  /** The phase now (0 to STAR_PHASES - 1). */
  get phase(): number {
    const steps = Math.round(this.slidNow() / PHASE_MS);
    return ((steps % STAR_PHASES) + STAR_PHASES) % STAR_PHASES;
  }

  /** Whether a line sent now puts the layers close enough to where they are (always, with the field down). */
  get exact(): boolean {
    if (this.strength <= 0) return true;
    const steps = this.slidNow() / PHASE_MS;
    return Math.abs(steps - Math.round(steps)) <= NEAR_ENOUGH;
  }

  /** The codes that say what changed (the strength and the way, not the phase, which always moves). */
  key(): string {
    return starsCode(this.strength, this.way);
  }

  /** The codes for the line sent now. */
  codes(): string {
    return starsCode(this.strength, this.way, this.phase);
  }

  private slidNow(): number {
    if (this.strength <= 0 || this.since === undefined) return this.slid;
    return this.slid + (this.way === "down" ? 1 : -1) * (this.now() - this.since);
  }

  /** Banks the slide so far before a change. */
  private settle(): void {
    this.slid = this.slidNow();
    this.since = this.now();
  }
}
