// What a seat holds: the dice and items it has, with the limits kept. The items themselves are the
// items file's (items.ts, games/blockparty/items.json), the dice the dice file's (dice.ts,
// games/blockparty/dice.json). Pure, so the tests can check it.
import { STANDARD_DIE } from "./dice.ts";
import type { ItemId } from "./items.ts";

export { ITEMS, type ItemDef, type ItemId } from "./items.ts";

/** What a seat holds: the standard die always first, at most 2 special dice (by their ids in the dice file), at most 3 items. */
export interface Holdings {
  dice: readonly string[];
  items: readonly ItemId[];
  /** Items can't be used now: one was used this turn already, or it's a bonus roll. */
  spent?: boolean;
}

export const MAX_SPECIAL_DICE = 2;
export const MAX_ITEMS = 3;

/** A seat's holdings with the standard die first and the limits kept. */
export function holdings(special: readonly string[], items: readonly ItemId[]): Holdings {
  return { dice: [STANDARD_DIE, ...special.filter((id) => id !== STANDARD_DIE).slice(0, MAX_SPECIAL_DICE)], items: items.slice(0, MAX_ITEMS) };
}
