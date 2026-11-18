import { describe, expect, it } from "vitest";
import { topTwo } from "../behavior_pack/scripts/board-loop.ts";
import { DICE } from "../behavior_pack/scripts/dice.ts";
import { ITEMS, type ItemId } from "../behavior_pack/scripts/dice-items.ts";
import { forcedDie, mayUseItem, newSeat, turnDice } from "../behavior_pack/scripts/seats.ts";
import {
  CHANCE,
  HAPPENING,
  PRIZE_POOL,
  SHOP_GOODS,
  TRADER_GOODS,
  WARDEN,
  betOptions,
  betResult,
  chanceFits,
  chancePotions,
  drawPrize,
  exists,
  grown,
  happening,
  hasRoom,
  held,
  lateGame,
  nextTraderRound,
  prizeWeight,
  put,
  sculkTax,
  sellPrice,
  shopStock,
  take,
  trailOf,
  traderPrice,
  valueOf,
  wardenEvent,
  wardenFits,
  weighted,
  type ChanceContext,
  type ChanceId,
  type Hands,
  type Prize,
} from "../behavior_pack/scripts/space-rules.ts";

/** A plain random to run many draws. */
function lcg(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const item = (id: ItemId): Prize => ({ kind: "item", id });
const die = (id: string): Prize => ({ kind: "die", id });

const everything: ChanceContext = { late: true, coins: 10, others: 3, anyItems: true, leaderHasStar: true, level: false };

describe("Block Party's prices and values", () => {
  it("prices every item, sells at half rounded down, and values dice from the dice file", () => {
    for (const id of Object.keys(ITEMS) as ItemId[]) expect(ITEMS[id].value).toBeGreaterThan(0);
    expect(valueOf(item("lightning"))).toBe(12);
    expect(sellPrice(item("lightning"))).toBe(6);
    expect(sellPrice(item("stone_totem"))).toBe(2);
    expect(valueOf(die("golden"))).toBe(DICE.golden.value);
    expect(sellPrice(die("golden"))).toBe(Math.floor(DICE.golden.value / 2));
  });

  it("keeps every Shop price under half the cheapest Star (shopping delays a Star but never blocks it)", () => {
    for (const goods of SHOP_GOODS.filter(exists)) expect(valueOf(goods)).toBeLessThan(15 / 2 + 5);
    expect(Math.max(...SHOP_GOODS.filter(exists).map(valueOf))).toBeLessThanOrEqual(12);
  });

  it("prices the Trader's goods at about 1.5 times their value: the plan's table", () => {
    const prices = Object.fromEntries(TRADER_GOODS.filter(exists).map((goods) => [goods.id, traderPrice(goods)]));
    expect(prices).toEqual({ golden: 20, mystery: 18, lightning: 18, cursed: 15, golden_totem: 15, triple: 15 });
  });

  it("never offers a test die (the One Die) anywhere", () => {
    expect(exists(die("one"))).toBe(false);
    expect(exists(die("no_such_die"))).toBe(false);
    for (const entry of PRIZE_POOL) expect(entry.prize.id).not.toBe("one");
  });
});

describe("Block Party's hands", () => {
  it("holds at most 3 items and 2 special dice, and takes one of a kind out", () => {
    const hands: Hands = { dice: [], items: [] };
    for (const id of ["stone_totem", "glove", "lightning"] as const) expect(put(hands, item(id))).toBe(true);
    expect(hasRoom(hands, item("zombie"))).toBe(false);
    expect(put(hands, item("zombie"))).toBe(false);
    expect(put(hands, die("golden"))).toBe(true);
    expect(put(hands, die("golden"))).toBe(true);
    expect(put(hands, die("risk"))).toBe(false);
    expect(take(hands, die("golden"))).toBe(true);
    expect(hands.dice).toEqual(["golden"]);
    expect(take(hands, item("zombie"))).toBe(false);
    expect(held(hands)).toEqual([item("stone_totem"), item("glove"), item("lightning"), die("golden")]);
  });
});

describe("Block Party's draws", () => {
  it("picks by weight and skips what has none", () => {
    const entries = [
      { value: "a", weight: 1 },
      { value: "b", weight: 0 },
      { value: "c", weight: 3 },
    ];
    expect(weighted(entries, () => 0)).toBe("a");
    expect(weighted(entries, () => 0.24)).toBe("a");
    expect(weighted(entries, () => 0.26)).toBe("c");
    expect(weighted(entries, () => 0.999)).toBe("c");
    expect(weighted([{ value: "x", weight: 0 }], () => 0.5)).toBeUndefined();
  });

  it("stocks the Shop with 3 different goods", () => {
    const random = lcg(7);
    for (let i = 0; i < 50; i++) {
      const stock = shopStock(random);
      expect(stock).toHaveLength(3);
      expect(new Set(stock.map((goods) => `${goods.kind}:${goods.id}`)).size).toBe(3);
    }
  });

  it("places a seat from the leader (0) to last place (1)", () => {
    expect(trailOf(0, 4)).toBe(0);
    expect(trailOf(3, 4)).toBe(1);
    expect(trailOf(1, 3)).toBe(0.5);
    expect(trailOf(0, 1)).toBe(0.5);
  });

  it("gives trailing players strong things more often, and the Golden Die only to last place", () => {
    const lightning = PRIZE_POOL.find((entry) => entry.prize.id === "lightning")!;
    const stone = PRIZE_POOL.find((entry) => entry.prize.id === "stone_totem")!;
    const golden = PRIZE_POOL.find((entry) => entry.prize.id === "golden")!;
    expect(prizeWeight(lightning, 1, "space")).toBeGreaterThan(prizeWeight(lightning, 0, "space"));
    expect(prizeWeight(stone, 0, "space")).toBeGreaterThan(prizeWeight(stone, 1, "space"));
    expect(prizeWeight(golden, 0.66, "space")).toBe(0);
    expect(prizeWeight(golden, 1, "space")).toBeGreaterThan(0);
    const strong = (trail: number) => {
      const random = lcg(3);
      let count = 0;
      for (let i = 0; i < 2000; i++) {
        const prize = drawPrize(trail, "space", random);
        if (PRIZE_POOL.find((entry) => entry.prize.id === prize.id)?.strength === 3) count++;
      }
      return count;
    };
    expect(strong(1)).toBeGreaterThan(strong(0) * 2);
  });

  it("gives the Mystery Die only from Lucky Draw", () => {
    const mystery = PRIZE_POOL.find((entry) => entry.prize.id === "mystery")!;
    expect(prizeWeight(mystery, 1, "space")).toBe(0);
    expect(prizeWeight(mystery, 1, "lucky")).toBeGreaterThan(0);
  });

  it("brings the Trader every 3 or 4 rounds", () => {
    expect(nextTraderRound(0, () => 0.1)).toBe(3);
    expect(nextTraderRound(3, () => 0.9)).toBe(7);
  });
});

describe("Block Party's Chance Time", () => {
  it("counts the last third of the game as late, and grows coins by half then", () => {
    expect([1, 6, 7, 10].map((round) => lateGame(round, 10))).toEqual([false, false, true, true]);
    expect(lateGame(10, 15)).toBe(false);
    expect(lateGame(11, 15)).toBe(true);
    expect(grown(5, false)).toBe(5);
    expect(grown(5, true)).toBe(8);
    expect(grown(3, true)).toBe(5);
  });

  it("keeps the late outcomes for late, and leaves out what can't do anything", () => {
    const early = { ...everything, late: false };
    for (const id of ["coin_swap", "position_shuffle", "shooting_star"] as ChanceId[]) {
      expect(chanceFits(id, early)).toBe(false);
      expect(chanceFits(id, everything)).toBe(true);
    }
    expect(chanceFits("shooting_star", { ...everything, leaderHasStar: false })).toBe(false);
    expect(chanceFits("reverse_fortune", { ...everything, level: true })).toBe(false);
    expect(chanceFits("double_or_nothing", { ...everything, coins: 0 })).toBe(false);
    expect(chanceFits("gift_exchange", { ...everything, anyItems: false })).toBe(false);
    expect(chanceFits("battle_royale", { ...everything, others: 0 })).toBe(false);
  });

  it("brews three different potions from what fits", () => {
    const random = lcg(11);
    for (let i = 0; i < 50; i++) {
      const potions = chancePotions({ ...everything, late: false }, random);
      expect(potions).toHaveLength(3);
      expect(new Set(potions).size).toBe(3);
      for (const id of potions) expect("late" in CHANCE[id]).toBe(false);
    }
  });

  it("lets Double or Nothing bet up to 10 (15 late), never more than they have", () => {
    expect(betOptions(20, false)).toEqual([2, 5, 10]);
    expect(betOptions(20, true)).toEqual([2, 5, 15]);
    expect(betOptions(4, false)).toEqual([2, 4]);
    expect(betOptions(1, false)).toEqual([1]);
    expect(betOptions(0, false)).toEqual([]);
  });
});

describe("Block Party's Warden and Happening", () => {
  it("leaves out the Warden's events that can't do anything", () => {
    expect(wardenFits("star_tax", { stars: 0, others: 2, leaderHasStar: true })).toBe(false);
    expect(wardenFits("hush_money", { stars: 1, others: 0, leaderHasStar: true })).toBe(false);
    expect(wardenFits("sonic_boom", { stars: 1, others: 2, leaderHasStar: false })).toBe(false);
    const random = lcg(5);
    for (let i = 0; i < 200; i++) expect(["star_tax", "hush_money", "sonic_boom"]).not.toContain(wardenEvent({ stars: 0, others: 0, leaderHasStar: false }, random));
    expect(Object.keys(WARDEN)).toHaveLength(7);
  });

  it("taxes 5 to 10 coins", () => {
    expect(sculkTax(() => 0)).toBe(5);
    expect(sculkTax(() => 0.999)).toBe(10);
  });

  it("weights the Happening table as the plan does, without a second bonus roll or a swap with nothing to swap", () => {
    expect(Object.values(HAPPENING).reduce((sum, entry) => sum + entry.weight, 0)).toBe(100);
    const random = lcg(9);
    for (let i = 0; i < 300; i++) expect(["roll_again", "swap_item"]).not.toContain(happening({ canSwap: false, bonus: true }, random));
  });
});

describe("Block Party's duel bets", () => {
  it("pays a right bet from the bank, takes a wrong one, and leaves a draw be", () => {
    expect(betResult(5, "alex", "alex")).toBe(5);
    expect(betResult(3, "alex", "sam")).toBe(-3);
    expect(betResult(5, "alex", undefined)).toBe(0);
  });
});

describe("Block Party's seats", () => {
  it("rolls the standard die and the special dice held, the standard alone after a totem or for a bonus roll", () => {
    const seat = newSeat("Alex", 10);
    seat.hands.dice.push("golden");
    expect(turnDice(seat, undefined)).toEqual(["standard", "golden"]);
    expect(turnDice(seat, { key: "alex", item: true, boost: "stone", bonus: false })).toEqual(["standard"]);
    expect(turnDice(seat, { key: "alex", item: false, bonus: true })).toEqual(["standard"]);
  });

  it("makes a cursed seat roll the die its curse says, the Cursed Die before the Slow Die", () => {
    const seat = newSeat("Alex", 10);
    seat.effects.slow = true;
    expect(forcedDie(seat)).toBe("slow");
    expect(turnDice(seat, undefined)).toEqual(["slow"]);
    seat.effects.cursedDie = true;
    expect(turnDice(seat, undefined)).toEqual(["cursed"]);
  });

  it("allows one item a turn and none on a bonus roll", () => {
    expect(mayUseItem(undefined)).toBe(true);
    expect(mayUseItem({ key: "a", item: false, bonus: false })).toBe(true);
    expect(mayUseItem({ key: "a", item: true, bonus: false })).toBe(false);
    expect(mayUseItem({ key: "a", item: false, bonus: true })).toBe(false);
  });

  it("names the top 2 of a minigame (ties share a place), or the winning side", () => {
    expect(topTwo({ places: [["a"], ["b"], ["c"]] }, [])).toEqual(["a", "b"]);
    expect(topTwo({ places: [["a", "b", "c"], ["d"]] }, [])).toEqual(["a", "b", "c"]);
    expect(topTwo({ places: [["a"], ["b", "c"], ["d"]] }, [])).toEqual(["a", "b", "c"]);
    expect(topTwo({ winner: 1 }, [[{ key: "a" }], [{ key: "b" }, { key: "c" }]])).toEqual(["b", "c"]);
    expect(topTwo({ winner: undefined }, [[{ key: "a" }], [{ key: "b" }]])).toEqual([]);
  });
});
