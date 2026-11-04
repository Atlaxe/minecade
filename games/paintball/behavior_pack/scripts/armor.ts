// Paintball's armor, as plain logic: each hit colors the leather piece the ball hit (by its height
// on the player), or the nearest piece not yet colored, in its own color mixed with the shooter's.
// Scripts can't dye leather, so the mix is put on as the shared armor pack's piece in the nearest of
// the 16 dyes (dyedLeather).
import { LEATHER_DYES, LEATHER_PIECES, leatherColor, mixDyes, type DyeColor, type LeatherPiece } from "@minecade/minigame-core/config";

/** The heights (blocks over the feet) where each piece starts, head first: a standing player is 1.8 tall. */
const PIECE_FLOORS: readonly [LeatherPiece, number][] = [
  ["helmet", 1.4],
  ["chestplate", 0.75],
  ["leggings", 0.3],
  ["boots", -Infinity],
];

/** The piece a ball hit, by how high over the player's feet it landed. */
export function pieceAt(heightAboveFeet: number): LeatherPiece {
  return PIECE_FLOORS.find(([, floor]) => heightAboveFeet >= floor)![0];
}

/** The piece a hit colors: the one hit, else the nearest not yet colored (upward first). Undefined once all four are. */
export function nextPiece(hit: LeatherPiece, colored: ReadonlySet<LeatherPiece>): LeatherPiece | undefined {
  if (!colored.has(hit)) return hit;
  const index = LEATHER_PIECES.indexOf(hit);
  for (let step = 1; step < LEATHER_PIECES.length; step++) {
    for (const at of [index - step, index + step]) {
      const piece = LEATHER_PIECES[at];
      if (piece !== undefined && !colored.has(piece)) return piece;
    }
  }
  return undefined;
}

/** Minecraft's dye recipes from two dyes, either order: red and yellow make orange. */
const RECIPES: Record<string, string> = {
  "red+yellow": "orange",
  "blue+red": "purple",
  "blue+green": "cyan",
  "red+white": "pink",
  "blue+white": "light_blue",
  "green+white": "lime",
  "black+white": "gray",
  "gray+white": "light_gray",
  "pink+purple": "magenta",
};

/** The dye whose leather color is nearest a color (weighted for how eyes see red and blue). */
export function nearestDye(color: DyeColor): string {
  const [red, green, blue] = [color.red * 255, color.green * 255, color.blue * 255];
  let best = "white";
  let bestDistance = Infinity;
  for (const [dye, rgb] of Object.entries(LEATHER_DYES)) {
    const [r, g, b] = [rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff];
    const mean = (red + r) / 2;
    const distance = (2 + mean / 256) * (red - r) ** 2 + 4 * (green - g) ** 2 + (2 + (255 - mean) / 256) * (blue - b) ** 2;
    if (distance < bestDistance) [best, bestDistance] = [dye, distance];
  }
  return best;
}

/**
 * A piece's dye after a hit: its dye and the shooter's made into one, by Minecraft's recipe for the
 * two when there is one (red and blue make purple), else the nearest dye to the two mixed as
 * leather mixes them (red and green make brown).
 */
export function blend(pieceDye: string, shooterDye: string): string {
  if (pieceDye === shooterDye) return pieceDye;
  const recipe = RECIPES[[pieceDye, shooterDye].sort().join("+")];
  return recipe ?? nearestDye(mixDyes([leatherColor(pieceDye), leatherColor(shooterDye)]));
}
