// Block Party's dice and items (docs/plans/block-party.md, "Dice" and "Items"), as the board's
// screens show them (docs/plans/block-party-ui.md, "Icons" and "The item panel"): each one's id, its
// name, the letters that stand in for its icon until the user adds a picture, what it does, and for
// a die its six faces. Pure, so the tests can check it.
//
// The names and what each does are the game's own words for now, like the old bar's; they can move
// to the user's dialogue file when the user wants to word them there.

interface DieSpec {
  id: string;
  name: string;
  /** The icon's stand-in: one or two capital letters (the plan's "Icons"). */
  letters: string;
  /** The six faces the item panel shows (a die whose faces do more shows numbers for now). */
  faces: readonly [number, number, number, number, number, number];
  /** What a roll can come up: the faces, unless a die rolls something else. */
  rolls: readonly number[];
}

interface ItemSpec {
  id: string;
  name: string;
  letters: string;
  /** What it does, under its name in the item panel. */
  what: string;
}

export const DICE = {
  standard: { id: "standard", name: "Standard Die", letters: "D", faces: [1, 2, 3, 4, 5, 6], rolls: [1, 2, 3, 4, 5, 6] },
  slow: { id: "slow", name: "Slow Die", letters: "SD", faces: [1, 2, 3, 1, 2, 3], rolls: [1, 2, 3] },
  triple: { id: "triple", name: "Triple Die", letters: "TD", faces: [1, 2, 3, 4, 5, 6], rolls: [1, 2, 3, 4, 5, 6] },
  risk: { id: "risk", name: "Risk Die", letters: "RD", faces: [0, 0, 1, 6, 7, 8], rolls: [0, 0, 1, 6, 7, 8] },
  golden: { id: "golden", name: "Golden Die", letters: "GD", faces: [5, 6, 7, 8, 9, 10], rolls: [5, 6, 7, 8, 9, 10] },
  mystery: { id: "mystery", name: "Mystery Die", letters: "MD", faces: [1, 2, 3, 4, 5, 6], rolls: [1, 2, 3, 4, 5, 6] },
  cursed: { id: "cursed", name: "Cursed Die", letters: "CD", faces: [12, 1, 1, 1, 1, 1], rolls: [12, 1, 1, 1, 1, 1] },
  // The Tests' die (the user asked): always 1, to step up to a space.
  one: { id: "one", name: "One Die", letters: "1D", faces: [1, 1, 1, 1, 1, 1], rolls: [1] },
} as const satisfies Record<string, DieSpec>;
export type DieId = keyof typeof DICE;
export type DieDef = (typeof DICE)[DieId];

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

/** What a seat holds: the standard die always first, at most 2 special dice, at most 3 items. */
export interface Holdings {
  dice: readonly DieId[];
  items: readonly ItemId[];
}

export const MAX_SPECIAL_DICE = 2;
export const MAX_ITEMS = 3;

/** A seat's holdings with the standard die first and the limits kept. */
export function holdings(special: readonly DieId[], items: readonly ItemId[]): Holdings {
  return { dice: ["standard", ...special.filter((id) => id !== "standard").slice(0, MAX_SPECIAL_DICE)], items: items.slice(0, MAX_ITEMS) };
}
