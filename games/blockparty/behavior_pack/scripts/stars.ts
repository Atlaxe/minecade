// The star field the minigame announcement fades in over everyone's view, and out again on the far
// side (docs/plans/block-party-ui.md, "The minigame announcement"): flying through the stars, as out
// of a ship's front window (the user, 2026-11-18, after the first look: zooming through the stars,
// not falling through them). Minecade's own star field stands still far behind, and ZOOM_LAYERS
// pictures of streaked stars (tools/assets/blockparty-stars.ts) grow from the middle of the screen,
// each fading in small and out large, a quarter of a life apart, so stars always rush outward.
//
// It's HUD (the HUD draws over a camera fade, which is why), ridden on the action bar's codes
// (bar-codes.ts) like the loading screen it replaces. The client builds the action bar's controls
// anew each time the line is sent, which starts their animations over, so a layer's zoom can't just
// loop: the line carries a phase, and ui/blockparty_hud.json (tools/assets/blockparty-hud-ui.ts) has
// a copy of the layers for each phase and strength, whose animations start where that phase puts
// each layer and loop on from there. Each send puts the layers where they'd have grown to by then,
// so they glide on the client between sends, with no jump when one comes.
//
// Pure (no @minecraft imports), so the HUD's generator and the tests share it.
import { STAR_PHASES, starsCode } from "./bar-codes.ts";

/** Milliseconds from one phase to the next. */
export const PHASE_MS = 100;
/** A zoom layer's life, in milliseconds: from small to large, then small again unseen. */
export const STAR_CYCLE_MS = PHASE_MS * STAR_PHASES;
/** Pictures of streaked stars zooming at once, a quarter of a life apart. */
export const ZOOM_LAYERS = 4;
/** How big a zoom layer is as its life starts and ends, in screens (it's always centered). */
export const ZOOM_FROM = 1;
export const ZOOM_TO = 3.5;
/** The still star field far behind (opaque: at full strength nothing shows through it). */
export const BACK_TEXTURE = "textures/minecade/sky/stars";

export const zoomTexture = (layer: number) => `textures/blockparty/stars/zoom_${layer}`;

export type LifePart = "in" | "full" | "out" | "gone";

/**
 * A zoom layer's life in phases: it fades in, stays, fades out, then is gone a moment, so its jump
 * from large back to small is never seen.
 */
export const LIFE: readonly { part: LifePart; from: number; to: number; alpha: readonly [number, number] }[] = [
  { part: "in", from: 0, to: 8, alpha: [0, 1] },
  { part: "full", from: 8, to: 22, alpha: [1, 1] },
  { part: "out", from: 22, to: 30, alpha: [1, 0] },
  { part: "gone", from: 30, to: STAR_PHASES, alpha: [0, 0] },
];

/** Where in its life a zoom layer is at `phase` (0 to STAR_PHASES - 1). */
export function lifeAt(phase: number, layer: number): number {
  return (((phase + (layer * STAR_PHASES) / ZOOM_LAYERS) % STAR_PHASES) + STAR_PHASES) % STAR_PHASES;
}

/** A zoom layer's size at a point in its life (0 to STAR_PHASES), in screens: it grows steadily. */
export function zoomAt(life: number): number {
  return ZOOM_FROM + ((ZOOM_TO - ZOOM_FROM) * life) / STAR_PHASES;
}

/** The part of its life a zoom layer is in (the part that starts there, at a boundary). */
export function partAt(life: number): (typeof LIFE)[number] {
  return LIFE.find((part) => life >= part.from && life < part.to) ?? LIFE[0];
}

/** A zoom layer's alpha at a point in its life, at full strength (0 to 1). */
export function alphaAt(life: number): number {
  const part = partAt(life);
  const [from, to] = part.alpha;
  return from + ((to - from) * (life - part.from)) / (part.to - part.from);
}

/** Phases a send may be off by and still go (a quarter: 25 ms). */
const NEAR_ENOUGH = 0.25;

/**
 * The star field's state on the server: its strength, and how far the zoom has gone (by the clock,
 * not by ticks: the client's animations run in real time, through a server stall too).
 */
export class StarField {
  private readonly now: () => number;
  private strength = 0;
  /** Milliseconds zoomed up to the last change. */
  private zoomed = 0;
  /** When the last change was, while the field is up. */
  private since: number | undefined;

  constructor(now: () => number) {
    this.now = now;
  }

  get level(): number {
    return this.strength;
  }

  set level(level: number) {
    this.zoomed = this.zoomedNow();
    this.since = this.now();
    this.strength = Math.max(0, level);
  }

  /** The phase now (0 to STAR_PHASES - 1). */
  get phase(): number {
    return Math.round(this.zoomedNow() / PHASE_MS) % STAR_PHASES;
  }

  /** Whether a line sent now puts the layers close enough to where they are (always, with the field down). */
  get exact(): boolean {
    if (this.strength <= 0) return true;
    const steps = this.zoomedNow() / PHASE_MS;
    return Math.abs(steps - Math.round(steps)) <= NEAR_ENOUGH;
  }

  /** The codes that say what changed (the strength, not the phase, which always moves). */
  key(): string {
    return starsCode(this.strength);
  }

  /** The codes for the line sent now. */
  codes(): string {
    return starsCode(this.strength, this.phase);
  }

  private zoomedNow(): number {
    if (this.strength <= 0 || this.since === undefined) return this.zoomed;
    return this.zoomed + (this.now() - this.since);
  }
}
