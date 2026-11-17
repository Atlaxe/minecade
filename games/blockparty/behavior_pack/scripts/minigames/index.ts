// Block Party's minigames so far (docs/plans/block-party.md, "Minigames"): one of each kind, so every
// format can be played, each with its arena in arenas.ts (in the same order). More come in pass 9.
import { HOT_FLOOR } from "./hot-floor.ts";
import { HUNTER } from "./hunter.ts";
import type { MinigameDef } from "./kit.ts";
import { PAINTERS } from "./painters.ts";

export const MINIGAMES: readonly MinigameDef[] = [HOT_FLOOR, PAINTERS, HUNTER];
