// Block Party's minigames (docs/plans/block-party-minigames.md), each with its arena in arenas.ts.
// The first three have test arenas of their own; the rest play on test-arenas.ts's while they have no
// arena map.
import { ANVIL_RAIN } from "./anvil-rain.ts";
import { CHICKENS } from "./chickens.ts";
import { ENDERMAN } from "./enderman.ts";
import { HOT_FLOOR } from "./hot-floor.ts";
import { HUNTER } from "./hunter.ts";
import type { MinigameDef } from "./kit.ts";
import { MOB_FREEZE } from "./mob-freeze.ts";
import { PAINTERS } from "./painters.ts";
import { SIMON } from "./simon.ts";
import { SLITHER } from "./slither.ts";
import { TNT_RUN } from "./tnt-run.ts";

export const MINIGAMES: readonly MinigameDef[] = [
  HOT_FLOOR,
  PAINTERS,
  HUNTER,
  // Batch 1: plain free for alls.
  MOB_FREEZE,
  SIMON,
  ENDERMAN,
  TNT_RUN,
  ANVIL_RAIN,
  CHICKENS,
  SLITHER,
];
