// Block Party's items (docs/plans/block-party.md, "Items"), as the board's screens show them
// (docs/plans/block-party-ui.md, "Icons" and "The item panel"): each one's id, its name, the letters
// that stand in for its icon until the user adds a picture, and what it does; and what a seat holds.
// The dice are the dice file's (dice.ts, games/blockparty/dice.json). Pure, so the tests can check it.
//
// The names and what each does are the game's own words for now, like the old bar's; they can move
// to the user's dialogue file when the user wants to word them there.
import { STANDARD_DIE } from "./dice.ts";

interface ItemSpec {
  id: string;
  name: string;
  letters: string;
  /** What it does, under its name in the item panel. */
  what: string;
}

export const ITEMS = {
  stone_totem: { id: "stone_totem", name: "Stone Totem", letters: "ST", what: "Roll an extra die next turn." },
  golden_totem: { id: "golden_totem", name: "Golden Totem", letters: "GT", what: "Roll an extra die that doubles, next turn." },
  ender_pearl: { id: "ender_pearl", name: "Ender Pearl", letters: "EP", what: "Switch places with a player." },
  cursed_totem: { id: "cursed_totem", name: "Cursed Totem", letters: "CT", what: "A rival's next roll is halved." },
  glove: { id: "glove", name: "Dueling Glove", letters: "DG", what: "A 1v1 duel for 10 coins." },
  lightning: { id: "lightning", name: "Lightning Strike", letters: "LS", what: "The leader gives 10 coins to last place." },
  zombie: { id: "zombie", name: "Zombie Spawn", letters: "ZS", what: "A zombie follows a rival and takes 3 coins a round." },
  iron_golem: { id: "iron_golem", name: "Iron Golem", letters: "IG", what: "Shake a player down for 5 coins, or send a zombie away." },
  villager: { id: "villager", name: "Villager", letters: "V", what: "Trade a die or an item for coins." },
} as const satisfies Record<string, ItemSpec>;
export type ItemId = keyof typeof ITEMS;
export type ItemDef = (typeof ITEMS)[ItemId];

/** What a seat holds: the standard die always first, at most 2 special dice (by their ids in the dice file), at most 3 items. */
export interface Holdings {
  dice: readonly string[];
  items: readonly ItemId[];
}

export const MAX_SPECIAL_DICE = 2;
export const MAX_ITEMS = 3;

/** A seat's holdings with the standard die first and the limits kept. */
export function holdings(special: readonly string[], items: readonly ItemId[]): Holdings {
  return { dice: [STANDARD_DIE, ...special.filter((id) => id !== STANDARD_DIE).slice(0, MAX_SPECIAL_DICE)], items: items.slice(0, MAX_ITEMS) };
}
