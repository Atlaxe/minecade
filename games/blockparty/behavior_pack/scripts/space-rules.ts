// Block Party's space rules (docs/plans/block-party.md: "Items", "Dice", "Shop, Villager and
// Wandering Trader", "Chance Time (the Witch)", "The Warden", "Happening"), pure so the tests can
// check them: what each item and die is worth, the Shop's stock and prices, what an Item space (or
// Lucky Draw, or a Happening's free item) gives, weighted by standing, the Wandering Trader's goods
// and rounds, and the Witch's potions, the Warden's events and the Happening table, each weighted and
// left out when it can't do anything. The loop plays them out (space-play.ts, item-play.ts).
import { DICE } from "./dice.ts";
import { ITEMS, MAX_ITEMS, MAX_SPECIAL_DICE, type ItemId } from "./dice-items.ts";

/** Something a seat can hold besides the standard die: an item, or a special die by its id in the dice file. */
export type Prize = { kind: "item"; id: ItemId } | { kind: "die"; id: string };

/** What each item is worth: its Shop price (the plan's table); the Villager item, which no shop sells, 6 (proposed). */
export const ITEM_VALUES: Readonly<Record<ItemId, number>> = {
  stone_totem: 5,
  ender_pearl: 8,
  cursed_totem: 8,
  zombie: 8,
  golden_totem: 10,
  iron_golem: 10,
  glove: 10,
  lightning: 12,
  villager: 6,
};

const item = (id: ItemId): Prize => ({ kind: "item", id });
const die = (id: string): Prize => ({ kind: "die", id });

/** Whether a prize is still in the game (a die the dice file has, a test die never). */
export function exists(prize: Prize): boolean {
  if (prize.kind === "item") return prize.id in ITEMS;
  const def = DICE[prize.id];
  return def !== undefined && !def.test;
}

/** A prize's name: "Ender Pearl", "Golden Die". */
export function prizeName(prize: Prize): string {
  return prize.kind === "item" ? ITEMS[prize.id].name : (DICE[prize.id]?.name ?? prize.id);
}

/** What a prize is worth: an item's Shop price, a die's value in the dice file. */
export function valueOf(prize: Prize): number {
  return prize.kind === "item" ? ITEM_VALUES[prize.id] : (DICE[prize.id]?.value ?? 0);
}

/** What selling it pays (the Villager item, or the Shop): half its value, rounded down. */
export function sellPrice(prize: Prize): number {
  return Math.floor(valueOf(prize) / 2);
}

/** The same prize. */
export function samePrize(a: Prize, b: Prize): boolean {
  return a.kind === b.kind && a.id === b.id;
}

// ---- Holding --------------------------------------------------------------------------------

/** What a seat holds besides the standard die. */
export interface Hands {
  dice: string[];
  items: ItemId[];
}

/** Whether there's room for `prize`: at most 3 items and 2 special dice. */
export function hasRoom(hands: Hands, prize: Prize): boolean {
  return prize.kind === "item" ? hands.items.length < MAX_ITEMS : hands.dice.length < MAX_SPECIAL_DICE;
}

/** Puts `prize` in `hands` (false when there's no room). */
export function put(hands: Hands, prize: Prize): boolean {
  if (!hasRoom(hands, prize)) return false;
  if (prize.kind === "item") hands.items.push(prize.id);
  else hands.dice.push(prize.id);
  return true;
}

/** Takes one `prize` out of `hands` (false when it isn't there). */
export function take(hands: Hands, prize: Prize): boolean {
  const list: string[] = prize.kind === "item" ? hands.items : hands.dice;
  const at = list.indexOf(prize.id);
  if (at < 0) return false;
  list.splice(at, 1);
  return true;
}

/** Everything in `hands`, items first. */
export function held(hands: Hands): Prize[] {
  return [...hands.items.map(item), ...hands.dice.map(die)];
}

// ---- Weighted picks ---------------------------------------------------------------------------

/** One of `entries` by weight (`random` gives 0 to 1); undefined when none has any weight. */
export function weighted<T>(entries: readonly { value: T; weight: number }[], random: () => number): T | undefined {
  const pool = entries.filter((entry) => entry.weight > 0);
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return undefined;
  let left = random() * total;
  for (const entry of pool) {
    left -= entry.weight;
    if (left < 0) return entry.value;
  }
  return pool[pool.length - 1].value;
}

/** Up to `count` different picks of `entries` by weight. */
export function weightedDistinct<T>(entries: readonly { value: T; weight: number }[], count: number, random: () => number): T[] {
  const left = [...entries];
  const out: T[] = [];
  while (out.length < count) {
    const picked = weighted(left, random);
    if (picked === undefined) break;
    out.push(picked);
    left.splice(
      left.findIndex((entry) => entry.value === picked),
      1,
    );
  }
  return out;
}

// ---- The Shop ---------------------------------------------------------------------------------

/** What the Villager's shop can stock (the plan's table): its price is the prize's value. */
export const SHOP_GOODS: readonly Prize[] = [item("stone_totem"), item("ender_pearl"), item("cursed_totem"), item("zombie"), item("golden_totem"), item("iron_golem"), item("glove"), item("lightning"), die("slow"), die("risk")];
/** How many things the Shop has each round. */
export const SHOP_STOCK = 3;

/** The Shop's stock for a round: 3 different goods at random. */
export function shopStock(random: () => number): Prize[] {
  return weightedDistinct(
    SHOP_GOODS.filter(exists).map((value) => ({ value, weight: 1 })),
    SHOP_STOCK,
    random,
  );
}

// ---- Item spaces, Lucky Draw and the Happening's free item --------------------------------------

/** Where a prize is drawn: an Item space (and a Happening's free item), or Chance's Lucky Draw. */
export type DrawFrom = "space" | "lucky";

interface PoolEntry {
  prize: Prize;
  weight: number;
  /** 1 weak, 2 middling, 3 strong: trailing players are likelier to get strong ones. */
  strength: 1 | 2 | 3;
  /** Only last place can get it (the Golden Die, rarely). */
  lastOnly?: boolean;
  /** Only Lucky Draw gives it (the Mystery Die). */
  luckyOnly?: boolean;
}

/** One pool for Item spaces, Lucky Draw and the Happening's free item (the plan's "Dice": where each die comes from). */
export const PRIZE_POOL: readonly PoolEntry[] = [
  { prize: item("stone_totem"), weight: 10, strength: 1 },
  { prize: item("villager"), weight: 6, strength: 1 },
  { prize: die("risk"), weight: 6, strength: 1 },
  { prize: item("ender_pearl"), weight: 8, strength: 2 },
  { prize: item("cursed_totem"), weight: 8, strength: 2 },
  { prize: item("zombie"), weight: 7, strength: 2 },
  { prize: item("iron_golem"), weight: 7, strength: 2 },
  { prize: item("glove"), weight: 6, strength: 2 },
  { prize: item("golden_totem"), weight: 6, strength: 2 },
  { prize: die("cursed"), weight: 4, strength: 2 },
  { prize: item("lightning"), weight: 5, strength: 3 },
  { prize: die("triple"), weight: 5, strength: 3 },
  { prize: die("mystery"), weight: 4, strength: 3, luckyOnly: true },
  { prize: die("golden"), weight: 3, strength: 3, lastOnly: true },
];

/**
 * Where a seat stands, 0 for the leader to 1 for last place, from its place (0 first) among
 * `players` (ties share a place; one player alone is in the middle).
 */
export function trailOf(place: number, players: number): number {
  return players <= 1 ? 0.5 : Math.min(1, Math.max(0, place / (players - 1)));
}

/** A pool entry's weight for a seat `trail` behind: weak things likelier for the leader, strong ones for those behind. */
export function prizeWeight(entry: PoolEntry, trail: number, from: DrawFrom): number {
  if (!exists(entry.prize)) return 0;
  if (entry.luckyOnly && from !== "lucky") return 0;
  if (entry.lastOnly && trail < 1) return 0;
  const lean = entry.strength === 1 ? 1.6 - 1.2 * trail : entry.strength === 3 ? 0.3 + 1.7 * trail : 1;
  return entry.weight * lean;
}

/** A prize from the pool for a seat `trail` behind (trailOf). */
export function drawPrize(trail: number, from: DrawFrom, random: () => number): Prize {
  return weighted(PRIZE_POOL.map((entry) => ({ value: entry.prize, weight: prizeWeight(entry, trail, from) })), random) ?? item("stone_totem");
}

// ---- The Wandering Trader -----------------------------------------------------------------------

/** The Trader's rare goods (the plan's table), one at a time, at about 1.5 times their value. */
export const TRADER_GOODS: readonly Prize[] = [die("golden"), die("mystery"), item("lightning"), die("cursed"), item("golden_totem"), die("triple")];

/** The Trader's price for a prize: its value times 1.5, rounded (Golden Die 20, Mystery Die 18, Lightning Strike 18, and so on). */
export function traderPrice(prize: Prize): number {
  return Math.round(valueOf(prize) * 1.5);
}

/** What the Trader brings this visit. */
export function traderGoods(random: () => number): Prize | undefined {
  return weighted(
    TRADER_GOODS.filter(exists).map((value) => ({ value, weight: 1 })),
    random,
  );
}

/** The round the Trader comes next, 3 or 4 rounds after `round` (the first visit is round 3 or 4). */
export function nextTraderRound(round: number, random: () => number): number {
  return round + (random() < 0.5 ? 3 : 4);
}

// ---- Chance Time --------------------------------------------------------------------------------

/** The last third of the game, when Chance outcomes grow and the late ones can come up. */
export function lateGame(round: number, turns: number): boolean {
  return round > (turns * 2) / 3;
}

/** A coin amount in the late game: half as much again, rounded (5 becomes 8, 3 becomes 5). */
export function grown(amount: number, late: boolean): number {
  return late ? Math.round(amount * 1.5) : amount;
}

/** A potion's color: what kind of outcome is inside (proposed, so a reroll means something). */
export type Potion = "coins" | "items" | "board" | "stars";

export const CHANCE = {
  coin_rain: { name: "Coin Rain", weight: 12, potion: "coins" },
  coin_swap: { name: "Coin Swap", weight: 6, potion: "coins", late: true },
  reverse_fortune: { name: "Reverse Fortune", weight: 10, potion: "coins" },
  double_or_nothing: { name: "Double or Nothing", weight: 10, potion: "coins" },
  gift_exchange: { name: "Gift Exchange", weight: 8, potion: "items" },
  lucky_draw: { name: "Lucky Draw", weight: 12, potion: "items" },
  position_shuffle: { name: "Position Shuffle", weight: 4, potion: "board", late: true },
  battle_royale: { name: "Battle Royale", weight: 8, potion: "board" },
  zombie_outbreak: { name: "Zombie Outbreak", weight: 8, potion: "board" },
  half_price: { name: "Half-price Star", weight: 8, potion: "stars" },
  shooting_star: { name: "Shooting Star", weight: 3, potion: "stars", late: true },
} as const satisfies Record<string, { name: string; weight: number; potion: Potion; late?: boolean }>;
export type ChanceId = keyof typeof CHANCE;

/** What decides which outcomes can come up. */
export interface ChanceContext {
  late: boolean;
  /** The lander's coins (Double or Nothing needs some to bet). */
  coins: number;
  /** Other seats on the board. */
  others: number;
  /** Whether anyone holds an item (Gift Exchange). */
  anyItems: boolean;
  /** Whether the leader has a Star (Shooting Star). */
  leaderHasStar: boolean;
  /** Whether everyone stands level, so there's no leader and last place apart. */
  level: boolean;
}

/** Whether an outcome can do anything now. */
export function chanceFits(id: ChanceId, ctx: ChanceContext): boolean {
  if ("late" in CHANCE[id] && !ctx.late) return false;
  switch (id) {
    case "coin_swap":
    case "position_shuffle":
    case "battle_royale":
      return ctx.others > 0;
    case "reverse_fortune":
      return !ctx.level;
    case "double_or_nothing":
      return ctx.coins > 0;
    case "gift_exchange":
      return ctx.anyItems && ctx.others > 0;
    case "shooting_star":
      return ctx.leaderHasStar && !ctx.level;
    default:
      return true;
  }
}

/** The Witch's three potions: three different outcomes that fit, by weight. */
export function chancePotions(ctx: ChanceContext, random: () => number, count = 3): ChanceId[] {
  return weightedDistinct(
    (Object.keys(CHANCE) as ChanceId[]).filter((id) => chanceFits(id, ctx)).map((id) => ({ value: id, weight: CHANCE[id].weight })),
    count,
    random,
  );
}

/** What a reroll costs (about one Blue space's worth). */
export const REROLL_PRICE = 3;
/** Coin amounts in Chance: Coin Rain's gift, Reverse Fortune's payment, Double or Nothing's biggest bet; Half-price Star's discount. */
export const COIN_RAIN = 5;
export const REVERSE_FORTUNE = 5;
export const MAX_BET = 10;
export const HALF_PRICE = 5;

/** What Double or Nothing lets a player bet: up to MAX_BET (more late), never more than they have. */
export function betOptions(coins: number, late: boolean): number[] {
  const max = grown(MAX_BET, late);
  return [...new Set([2, 5, max].map((amount) => Math.min(amount, coins)))].filter((amount) => amount > 0);
}

// ---- The Warden ---------------------------------------------------------------------------------

export const WARDEN = {
  sculk_tax: { name: "Sculk Tax", weight: 20 },
  hush_money: { name: "Hush Money", weight: 16 },
  star_tax: { name: "Star Tax", weight: 12 },
  silenced: { name: "Silenced", weight: 12 },
  slow_curse: { name: "Slow Curse", weight: 14 },
  zombie_curse: { name: "Zombie Curse", weight: 12 },
  sonic_boom: { name: "Sonic Boom", weight: 4 },
} as const satisfies Record<string, { name: string; weight: number }>;
export type WardenId = keyof typeof WARDEN;

export interface WardenContext {
  /** The lander's Stars (Star Tax). */
  stars: number;
  others: number;
  leaderHasStar: boolean;
}

/** The Slow Die the Slow Curse forces (the dice file's). */
export const SLOW_DIE = "slow";

export function wardenFits(id: WardenId, ctx: WardenContext): boolean {
  switch (id) {
    case "hush_money":
      return ctx.others > 0;
    case "star_tax":
      return ctx.stars > 0;
    case "slow_curse":
      return DICE[SLOW_DIE] !== undefined;
    case "sonic_boom":
      return ctx.leaderHasStar;
    default:
      return true;
  }
}

/** The Warden's event, by weight among those that do something. */
export function wardenEvent(ctx: WardenContext, random: () => number): WardenId {
  return weighted((Object.keys(WARDEN) as WardenId[]).filter((id) => wardenFits(id, ctx)).map((id) => ({ value: id, weight: WARDEN[id].weight })), random) ?? "sculk_tax";
}

/** Sculk Tax: 5 to 10 coins. */
export function sculkTax(random: () => number): number {
  return 5 + Math.min(5, Math.floor(random() * 6));
}
export const HUSH_MONEY = 3;
export const STAR_TAX = 3;
/** Rounds a zombie follows its target. */
export const ZOMBIE_ROUNDS = 3;
/** Coins a zombie takes each round. */
export const ZOMBIE_BITE = 3;

// ---- Happening ----------------------------------------------------------------------------------

export const HAPPENING = {
  coins: { name: "+5 coins", weight: 25 },
  item: { name: "Free item", weight: 20 },
  forward: { name: "Move forward 2", weight: 15 },
  back: { name: "Move back 2", weight: 10 },
  lose: { name: "Lose 3 coins", weight: 10 },
  nothing: { name: "Nothing", weight: 10 },
  swap_item: { name: "Swap an item", weight: 5 },
  roll_again: { name: "Roll again", weight: 5 },
} as const satisfies Record<string, { name: string; weight: number }>;
export type HappeningId = keyof typeof HAPPENING;

export interface HappeningContext {
  /** The lander holds an item, and someone else does too (Swap an item). */
  canSwap: boolean;
  /** This turn's roll is already a bonus (no second one). */
  bonus: boolean;
}

export function happeningFits(id: HappeningId, ctx: HappeningContext): boolean {
  if (id === "swap_item") return ctx.canSwap;
  if (id === "roll_again") return !ctx.bonus;
  return true;
}

export function happening(ctx: HappeningContext, random: () => number): HappeningId {
  return weighted((Object.keys(HAPPENING) as HappeningId[]).filter((id) => happeningFits(id, ctx)).map((id) => ({ value: id, weight: HAPPENING[id].weight })), random) ?? "nothing";
}

export const HAPPENING_COINS = 5;
export const HAPPENING_LOSS = 3;
export const HAPPENING_STEPS = 2;

// ---- Duels --------------------------------------------------------------------------------------

/** The Dueling Glove's stake (a Versus space's is VERSUS_STAKE in minigame-rules.ts). */
export const GLOVE_STAKE = 10;
/** What an onlooker can bet on a duel (0 is no bet). */
export const BETS = [3, 5] as const;

/** A bet's coins after the duel: won back as much again from the bank, lost to it, kept on a draw. */
export function betResult(bet: number, backed: string, winner: string | undefined): number {
  if (winner === undefined) return 0;
  return backed === winner ? bet : -bet;
}
