// A seat at Block Party's board (docs/plans/block-party.md, "Items", "Dice", "Chance Time", "The
// Warden"): its coins and Stars, what it holds (special dice and items), and what's on it (a coupon,
// a curse, a zombie). And a turn's own state: an item used, a totem's extra die, a bonus roll. Pure,
// so the tests can check which dice a seat may roll.
import { STANDARD_DIE } from "./dice.ts";
import type { Hands } from "./space-rules.ts";
import { SLOW_DIE } from "./space-rules.ts";

/** What's on a seat until it's used up. */
export interface Effects {
  /** Coins off their next Star (Chance Time's Half-price Star), until they buy one. */
  discount: number;
  /** The Warden's Silenced: the next item or die they'd get goes to the Warden instead. */
  silenced: boolean;
  /** The Warden's Slow Curse: their next roll is the Slow Die. */
  slow: boolean;
  /** A rival's Cursed Totem: their next roll is halved, rounded up. */
  halved: boolean;
  /** A rival handed them the Cursed Die: their next roll is it. */
  cursedDie: boolean;
  /** Rounds a zombie still follows them, taking coins at the start of each of their turns (0: no zombie). */
  zombie: number;
}

export interface Seat {
  name: string;
  coins: number;
  stars: number;
  hands: Hands;
  effects: Effects;
}

export function newSeat(name: string, coins: number): Seat {
  return { name, coins, stars: 0, hands: { dice: [], items: [] }, effects: { discount: 0, silenced: false, slow: false, halved: false, cursedDie: false, zombie: 0 } };
}

/** A totem's extra die this turn: the Stone Totem's adds, the Golden Totem's counts double. */
export type Boost = "stone" | "golden";

/** The turn going on. */
export interface TurnState {
  key: string;
  /** An item was used this turn (one a turn). */
  item: boolean;
  /** A totem's extra die (one movement boost a turn: then no special die). */
  boost?: Boost;
  /** This roll is a bonus one (a Happening's Roll again): the standard die only, no items. */
  bonus: boolean;
}

/** The die a curse makes a seat roll next, if any: the Cursed Die handed to them, else the Slow Curse's Slow Die. */
export function forcedDie(seat: Seat): string | undefined {
  if (seat.effects.cursedDie) return "cursed";
  if (seat.effects.slow) return SLOW_DIE;
  return undefined;
}

/**
 * The dice a seat may roll now, the first shown first: a die a curse forces, alone; the standard die
 * alone after a totem or for a bonus roll; else the standard die and the special dice it holds.
 */
export function turnDice(seat: Seat, turn: TurnState | undefined): string[] {
  const forced = forcedDie(seat);
  if (forced) return [forced];
  if (turn?.boost || turn?.bonus) return [STANDARD_DIE];
  return [STANDARD_DIE, ...seat.hands.dice];
}

/** Whether the seat may still use an item this turn. */
export function mayUseItem(turn: TurnState | undefined): boolean {
  return !turn || (!turn.item && !turn.bonus);
}
