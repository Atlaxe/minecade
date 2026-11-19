// The star field the minigame announcement shows between the board and an arena, both ways
// (docs/plans/block-party-ui.md, "The minigame announcement"): flying through the stars, as out of a
// ship's front window (the user, 2026-11-18). Minecade's own star field stands still far behind, and
// ZOOM_LAYERS pictures of streaked stars (tools/assets/blockparty-stars.ts) grow from the middle of
// the screen, each fading in small and out large, a quarter of a life apart, so stars always rush
// outward.
//
// It comes the way the old loading screen did (the user, after two looks where nothing showed: the
// previous fade, with the stars moving like a gif): the camera fades to black, the star field fades
// in over the black a level a tick (the HUD draws over a camera fade), and at the end the black comes
// back under it, it fades out to the black, and the black lifts on the new place. It rides the action
// bar's codes (bar-codes.ts): its strength, and its frame, which the game steps every tick. Each
// frame is the zoom pictures at set sizes and alphas (ui/blockparty_hud.json, written by
// tools/assets/blockparty-hud-ui.ts): no JSON UI animations, which never showed in game.
//
// Pure (no @minecraft imports), so the HUD's generator and the tests share it.
import { STAR_FRAMES, starsCode } from "./bar-codes.ts";

/** Pictures of streaked stars zooming at once, a quarter of a life apart. */
export const ZOOM_LAYERS = 4;
/** How big a zoom picture is as its life starts and ends, in screens (it's always centered). */
export const ZOOM_FROM = 1;
export const ZOOM_TO = 3.5;
/** The still star field far behind (opaque: at full strength nothing shows through it). */
export const BACK_TEXTURE = "textures/minecade/sky/stars";

export const zoomTexture = (layer: number) => `textures/blockparty/stars/zoom_${layer}`;

export type LifePart = "in" | "full" | "out" | "gone";

/**
 * A zoom picture's life in frames (a frame a tick: 3.2 s): it fades in, stays, fades out, then is
 * gone a moment, so its jump from large back to small is never seen.
 */
export const LIFE: readonly { part: LifePart; from: number; to: number; alpha: readonly [number, number] }[] = [
  { part: "in", from: 0, to: 16, alpha: [0, 1] },
  { part: "full", from: 16, to: 44, alpha: [1, 1] },
  { part: "out", from: 44, to: 60, alpha: [1, 0] },
  { part: "gone", from: 60, to: STAR_FRAMES, alpha: [0, 0] },
];

/** Where in its life a zoom picture is at `frame`. */
export function lifeAt(frame: number, layer: number): number {
  return (((frame + (layer * STAR_FRAMES) / ZOOM_LAYERS) % STAR_FRAMES) + STAR_FRAMES) % STAR_FRAMES;
}

/** A zoom picture's size at a point in its life (0 to STAR_FRAMES), in screens: it grows steadily. */
export function zoomAt(life: number): number {
  return ZOOM_FROM + ((ZOOM_TO - ZOOM_FROM) * life) / STAR_FRAMES;
}

/** A zoom picture's alpha at a point in its life, at full strength (0 to 1). */
export function alphaAt(life: number): number {
  const part = LIFE.find((one) => life >= one.from && life < one.to) ?? LIFE[0];
  const [from, to] = part.alpha;
  return from + ((to - from) * (life - part.from)) / (part.to - part.from);
}

/** The star field's state on the server: its strength and its frame, the same for everyone. */
export class StarField {
  /** 0 (gone) to STAR_LEVELS. */
  level = 0;
  /** The frame now (0 to STAR_FRAMES - 1). */
  frame = 0;

  /** Each tick: on a frame while it's up. */
  tick(): void {
    if (this.level > 0) this.frame = (this.frame + 1) % STAR_FRAMES;
  }

  /** The codes for the line now. */
  codes(): string {
    return starsCode(this.level, this.frame);
  }
}
