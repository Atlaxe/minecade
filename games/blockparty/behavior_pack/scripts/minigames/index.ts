// Block Party's minigames (docs/plans/block-party-minigames.md), each with its arena in arenas.ts.
// The first three have test arenas of their own; the rest play on test-arenas.ts's while they have no
// arena map.
import { ANVIL_RAIN } from "./anvil-rain.ts";
import { BOMB_DISPOSAL } from "./bomb.ts";
import { BUTTON_MASH } from "./button-mash.ts";
import { CACTUS } from "./cactus.ts";
import { CHICKENS } from "./chickens.ts";
import { COOK } from "./cook.ts";
import { CORE } from "./core.ts";
import { COUNT_MOBS } from "./count-mobs.ts";
import { ENDERMAN } from "./enderman.ts";
import { HILL } from "./hill.ts";
import { HOT_FLOOR } from "./hot-floor.ts";
import { HOT_TNT } from "./hot-tnt.ts";
import { HUNTER } from "./hunter.ts";
import { KIT_BRAWL } from "./kit-brawl.ts";
import type { MinigameDef } from "./kit.ts";
import { LADDER } from "./ladder.ts";
import { LEG_BREAKER } from "./leg-breaker.ts";
import { MINING } from "./mining.ts";
import { MOB_FREEZE } from "./mob-freeze.ts";
import { MONTECARLO } from "./montecarlo.ts";
import { PAINTERS } from "./painters.ts";
import { QUIZ } from "./quiz.ts";
import { SCRAMBLE } from "./scramble.ts";
import { SIMON } from "./simon.ts";
import { SLITHER } from "./slither.ts";
import { SPLEEF } from "./spleef.ts";
import { SUMO_DUEL } from "./sumo-duel.ts";
import { SURVIVAL } from "./survival.ts";
import { TNT_RUN } from "./tnt-run.ts";
import { TOWERS } from "./towers.ts";
import { TRAP_MASTER } from "./trap-master.ts";
import { TUG_OF_WAR } from "./tug-of-war.ts";
import { WOOL_GAME } from "./wool.ts";

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
  // Batch 2: push hits, and a second team game of each kind.
  HILL,
  SUMO_DUEL,
  CACTUS,
  LADDER,
  WOOL_GAME,
  TRAP_MASTER,
  // Batch 3: real damage.
  KIT_BRAWL,
  CORE,
  LEG_BREAKER,
  HOT_TNT,
  // Batch 4: place and break, Survival.
  MINING,
  SPLEEF,
  TOWERS,
  SURVIVAL,
  // Batch 5: files of their own, words for one player, cameras.
  QUIZ,
  SCRAMBLE,
  COUNT_MOBS,
  BUTTON_MASH,
  TUG_OF_WAR,
  BOMB_DISPOSAL,
  // Batch 6: tiled arenas.
  MONTECARLO,
  COOK,
];
