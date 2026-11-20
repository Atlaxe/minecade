import { describe, expect, it, vi } from "vitest";
import type { BoardLoop, LoopHost } from "../behavior_pack/scripts/board-loop.ts";
import { ranked } from "../behavior_pack/scripts/board-rules.ts";
import type { Space } from "../behavior_pack/scripts/board.ts";
import type { Who } from "../behavior_pack/scripts/bots.ts";
import type { ItemId } from "../behavior_pack/scripts/dice-items.ts";
import { STANDARD } from "../behavior_pack/scripts/dice.ts";
import { GameStats } from "../behavior_pack/scripts/end-game.ts";
import { ItemPlay, LIGHTNING, SHAKEDOWN } from "../behavior_pack/scripts/item-play.ts";
import { newSeat, type Seat, type TurnState } from "../behavior_pack/scripts/seats.ts";
import { SpacePlay } from "../behavior_pack/scripts/space-play.ts";
import { CHANCE, HAPPENING, WARDEN, type ChanceId, type HappeningId, type WardenId } from "../behavior_pack/scripts/space-rules.ts";

// Every space and item played against a fake board: the dialogue box answers with each question's
// bot pick (or `answers`, in order), the stage does nothing, and the seats are plain.

interface Fake {
  loop: BoardLoop;
  host: LoopHost;
  items: ItemPlay;
  spaces: SpacePlay;
  seats: Map<string, Seat>;
  who: Record<string, Who>;
  said: string[];
  turn: TurnState;
  /** Answers the dialogue box gives instead of the bot pick, in order. */
  answers: number[];
  zombies: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  calls: Record<string, ReturnType<typeof vi.fn>>;
}

function lcg(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function fake(round = 5, of = 15): Fake {
  const names = ["Alex", "Sam", "Kim"];
  const who: Record<string, Who> = {};
  const seats = new Map<string, Seat>();
  for (const name of names) {
    const key = name.toLowerCase();
    who[key] = { name, key, body: { isValid: true, location: { x: 0, y: 0, z: 0 } } as never };
    seats.set(key, newSeat(name, 10));
  }
  const spaces: Space[] = Array.from({ length: 12 }, (_, index) => ({ index, type: index === 3 ? "item" : "blue", at: [index * 4, 64, 0], next: [(index + 1) % 12] }));
  const said: string[] = [];
  const answers: number[] = [];
  const turn: TurnState = { key: "alex", item: false, bonus: false };
  const zombies = { add: vi.fn(), remove: vi.fn() };
  const calls = {
    swap: vi.fn(),
    shuffle: vi.fn(),
    forceBattle: vi.fn(),
    walk: vi.fn(async () => {}),
    walkBack: vi.fn(async () => {}),
    bonusRoll: vi.fn(async () => {}),
    duel: vi.fn(async () => {}),
    transfer: vi.fn(async () => {}),
    pass: vi.fn(),
    handOver: vi.fn(async () => {}),
    showResults: vi.fn(async () => {}),
  };
  const here = () => names.map((name) => who[name.toLowerCase()]);
  const ends = () => {
    const best = ranked(here().map((one) => ({ name: one.key, stars: seats.get(one.key)!.stars, coins: seats.get(one.key)!.coins })));
    const top = best[0];
    const bottom = best[best.length - 1];
    return { leader: who[top.name], last: who[bottom.name], level: top.stars === bottom.stars && top.coins === bottom.coins };
  };
  const stage = new Proxy({}, { get: () => () => Promise.resolve(undefined) });
  const host = {
    scope: { wait: async () => {} },
    spaces: () => spaces,
    turns: of,
    say: async (id: string) => void said.push(id),
    talk: async (id: string, _fills: unknown, options: { botPick?: number }) => {
      said.push(id);
      return answers.length > 0 ? answers.shift() : (options.botPick ?? 0);
    },
    cutscene: async <T>(_skippable: boolean, work: () => Promise<T>) => work(),
    stage,
    everyone: () => {},
    notice: () => () => {},
    changed: () => {},
    zombies,
    random: lcg(3),
  } as unknown as LoopHost;
  const loop = {
    stats: new GameStats(),
    rounds: { now: round, of },
    get turnState() {
      return turn;
    },
    seatOf: (key: string) => seats.get(key),
    here,
    turnOrder: () => names.map((name) => name.toLowerCase()),
    ends,
    trailOf: () => 0.5,
    spaceOf: () => spaces[0],
    starSpaces: () => [] as number[],
    pay(from: string, to: string, amount: number) {
      const payer = seats.get(from)!;
      const paid = Math.min(amount, payer.coins);
      payer.coins -= paid;
      seats.get(to)!.coins += paid;
      return paid;
    },
    snapshot: () => [],
    spent: () => {},
    transfer: async () => {},
    transferAll: async () => {},
    spaceName: (space: Space) => `space ${space.index + 1}`,
    useItem: (one: Who, id: ItemId) => items.use(one, id),
    feature: () => {},
    unfeature: () => {},
    ...calls,
  } as unknown as BoardLoop;
  const items = new ItemPlay(loop, host);
  const spacePlay = new SpacePlay(loop, host, items);
  return { loop, host, items, spaces: spacePlay, seats, who, said, turn, answers, zombies, calls };
}

describe("Block Party's Chance Time", () => {
  for (const id of Object.keys(CHANCE) as ChanceId[]) {
    it(`plays ${CHANCE[id].name} without failing`, async () => {
      const f = fake(14, 15);
      f.seats.get("sam")!.stars = 2;
      f.seats.get("sam")!.coins = 20;
      f.seats.get("kim")!.coins = 2;
      f.seats.get("alex")!.hands.items.push("glove");
      f.seats.get("sam")!.hands.items.push("lightning");
      f.spaces.forced.chance = id;
      await f.spaces.chance(f.who.alex);
      expect(f.said[0]).toBe("chance.welcome");
      expect(f.said).toContain("chance.potions");
      expect(f.said[f.said.length - 1]).toBe("chance.bye");
    });
  }

  it("takes 3 coins for new potions, once", async () => {
    const f = fake();
    f.spaces.forced.chance = "coin_rain";
    // Brew new ones (the fourth button), then the first potion.
    f.answers.push(3, 0);
    await f.spaces.chance(f.who.alex);
    expect(f.said.filter((id) => id === "chance.potions")).toHaveLength(2);
    expect(f.said).toContain("chance.reroll.done");
    // 10 - 3 for the brew, + 5 from Coin Rain.
    expect(f.seats.get("alex")!.coins).toBe(12);
  });

  it("moves the leader's Star to last place with a Shooting Star", async () => {
    const f = fake(14, 15);
    f.seats.get("sam")!.stars = 2;
    f.seats.get("kim")!.coins = 0;
    await f.spaces.chanceOutcome(f.who.alex, "shooting_star", true);
    expect(f.seats.get("sam")!.stars).toBe(1);
    expect(f.seats.get("kim")!.stars).toBe(1);
    // A hand-over: the camera on Sam as the Star goes, then on Kim as it lands (the results show it).
    expect(f.calls.pass).toHaveBeenCalledWith(f.who.sam, f.who.kim, "star", 1);
    expect(f.calls.transfer).not.toHaveBeenCalled();
  });

  it("hands the difference from the richer to the poorer with a Coin Swap", async () => {
    const f = fake();
    f.seats.get("sam")!.coins = 25;
    f.answers.push(0);
    await f.spaces.chanceOutcome(f.who.alex, "coin_swap", false);
    expect(f.seats.get("alex")!.coins).toBe(25);
    expect(f.seats.get("sam")!.coins).toBe(10);
    expect(f.calls.pass).toHaveBeenCalledWith(f.who.sam, f.who.alex, "coin", 15);
  });

  it("gives last place a coupon with a Half-price Star, and sends a zombie to the leader with Zombie Outbreak", async () => {
    const f = fake();
    f.seats.get("sam")!.coins = 30;
    f.seats.get("kim")!.coins = 1;
    await f.spaces.chanceOutcome(f.who.alex, "half_price", false);
    expect(f.seats.get("kim")!.effects.discount).toBe(5);
    await f.spaces.chanceOutcome(f.who.alex, "zombie_outbreak", false);
    expect(f.seats.get("sam")!.effects.zombie).toBe(3);
    expect(f.zombies.add).toHaveBeenCalledWith("sam");
  });

  it("passes everyone's item on with Gift Exchange, all at once, shown giver by giver", async () => {
    const f = fake();
    f.seats.get("alex")!.hands.items.push("glove");
    f.seats.get("sam")!.hands.items.push("lightning");
    await f.spaces.chanceOutcome(f.who.alex, "gift_exchange", false);
    expect(f.seats.get("alex")!.hands.items).toEqual([]);
    expect(f.seats.get("sam")!.hands.items).toEqual(["glove"]);
    expect(f.seats.get("kim")!.hands.items).toEqual(["lightning"]);
    // A hand-over: the camera on each giver as their item goes, then on its taker as it lands.
    expect(f.calls.pass.mock.calls).toEqual([
      [f.who.alex, f.who.sam, { kind: "item", id: "glove" }, 1],
      [f.who.sam, f.who.kim, { kind: "item", id: "lightning" }, 1],
    ]);
    expect(f.calls.handOver).toHaveBeenCalledTimes(1);
  });
});

describe("Block Party's Warden", () => {
  for (const id of Object.keys(WARDEN) as WardenId[]) {
    it(`plays ${WARDEN[id].name} without failing`, async () => {
      const f = fake();
      f.seats.get("alex")!.stars = 1;
      f.seats.get("sam")!.stars = 2;
      f.spaces.forced.warden = id;
      await f.spaces.warden(f.who.alex);
      expect(f.said[0]).toBe("warden.arrives");
      expect(f.said[f.said.length - 1]).toBe("warden.leaves");
    });
  }

  it("charges Hush Money to each other seat, and Star Tax by the Stars", async () => {
    const f = fake();
    f.spaces.forced.warden = "hush_money";
    await f.spaces.warden(f.who.alex);
    expect(f.seats.get("alex")!.coins).toBe(4);
    expect(f.seats.get("sam")!.coins).toBe(13);
    // Shown after its line, while the Warden is still there.
    expect(f.calls.handOver).toHaveBeenCalled();
    const g = fake();
    g.seats.get("alex")!.stars = 2;
    g.spaces.forced.warden = "star_tax";
    await g.spaces.warden(g.who.alex);
    expect(g.seats.get("alex")!.coins).toBe(4);
  });

  it("takes the next prize of a Silenced seat", async () => {
    const f = fake();
    f.seats.get("alex")!.effects.silenced = true;
    expect(await f.items.give(f.who.alex, { kind: "item", id: "glove" })).toBe(false);
    expect(f.seats.get("alex")!.hands.items).toEqual([]);
    expect(f.seats.get("alex")!.effects.silenced).toBe(false);
    expect(await f.items.give(f.who.alex, { kind: "item", id: "glove" })).toBe(true);
  });
});

describe("Block Party's Happening", () => {
  for (const id of Object.keys(HAPPENING) as HappeningId[]) {
    it(`plays ${HAPPENING[id].name} without failing`, async () => {
      const f = fake();
      f.seats.get("alex")!.hands.items.push("glove");
      f.seats.get("sam")!.hands.items.push("lightning");
      f.spaces.forced.happening = id;
      await f.spaces.happening(f.who.alex);
      expect(f.said[0]).toBe("happening.flavor");
      expect(f.said).toContain(`happening.${id.replace("_", "-")}`);
    });
  }

  it("walks forward and back, and rolls again", async () => {
    const f = fake();
    f.spaces.forced.happening = "forward";
    await f.spaces.happening(f.who.alex);
    expect(f.calls.walk).toHaveBeenCalledWith(f.who.alex, 2);
    f.spaces.forced.happening = "back";
    await f.spaces.happening(f.who.alex);
    expect(f.calls.walkBack).toHaveBeenCalledWith(f.who.alex, 2);
    f.spaces.forced.happening = "roll_again";
    await f.spaces.happening(f.who.alex);
    expect(f.calls.bonusRoll).toHaveBeenCalled();
  });
});

describe("Block Party's Item spaces, Shop and Trader", () => {
  it("gives an Item space's prize, or the pick of what to drop with full hands", async () => {
    const f = fake();
    await f.spaces.itemSpace(f.who.alex);
    const seat = f.seats.get("alex")!;
    expect(seat.hands.items.length + seat.hands.dice.length).toBe(1);
    const g = fake();
    g.seats.get("alex")!.hands.items.push("stone_totem", "villager", "glove");
    // Drop the Stone Totem for a Lightning Strike.
    g.answers.push(0);
    expect(await g.items.give(g.who.alex, { kind: "item", id: "lightning" })).toBe(true);
    expect(g.seats.get("alex")!.hands.items).toEqual(["villager", "glove", "lightning"]);
    // Keep what they have (the last button).
    g.answers.push(3);
    expect(await g.items.give(g.who.alex, { kind: "item", id: "zombie" })).toBe(false);
    expect(g.seats.get("alex")!.hands.items).toEqual(["villager", "glove", "lightning"]);
  });

  it("sells the round's stock, buys back at half, once each a visit, and won't sell what they can't afford", async () => {
    const f = fake();
    const seat = f.seats.get("alex")!;
    seat.coins = 30;
    await f.spaces.roundStart();
    f.said.length = 0;
    // Buy, the first in stock; then Sell (Buy is gone: the first button), the first held. Bought and sold, the visit is over.
    f.answers.push(0, 0, 0, 0);
    await f.spaces.shop(f.who.alex);
    expect(f.said).toEqual(["shop.welcome", "shop.stock", "shop.bought", "shop.more", "shop.sell", "shop.sold", "shop.bye"]);
    expect(f.answers).toEqual([]);
    expect(seat.hands.items.length + seat.hands.dice.length).toBe(0);
    expect(seat.coins).toBeLessThan(30);
    const g = fake();
    g.seats.get("alex")!.coins = 0;
    g.answers.push(0, 0, 2);
    await g.spaces.shop(g.who.alex);
    expect(g.said).toContain("shop.short");
    expect(g.said[g.said.length - 1]).toBe("shop.nothing");
  });

  it("brings the Trader to an Item space, sells his one thing, and goes", async () => {
    const f = fake();
    expect(await f.spaces.traderArrives()).toBe(true);
    expect(f.spaces.traderSpace).toBe(3);
    f.seats.get("alex")!.coins = 40;
    f.answers.push(0);
    await f.spaces.trader(f.who.alex);
    expect(f.said).toContain("trader.sold");
    expect(f.spaces.traderSpace).toBeUndefined();
    expect(f.seats.get("alex")!.coins).toBeLessThan(40);
  });
});

describe("Block Party's items", () => {
  const useOn = async (id: ItemId, setup?: (f: Fake) => void) => {
    const f = fake();
    f.seats.get("alex")!.hands.items.push(id);
    setup?.(f);
    const used = await f.items.use(f.who.alex, id);
    return { f, used };
  };

  it("adds a totem's extra die to the roll, the Golden one's doubled, and spends Items for the turn", async () => {
    const { f, used } = await useOn("golden_totem");
    expect(used).toBe(true);
    expect(f.turn.boost).toBe("golden");
    expect(f.turn.item).toBe(true);
    expect(f.seats.get("alex")!.hands.items).toEqual([]);
    const rolled = { die: STANDARD, faces: [2], move: 3 };
    await f.items.afterRoll(f.who.alex, rolled);
    expect(rolled.move).toBeGreaterThanOrEqual(3 + 2);
    expect((rolled.move - 3) % 2).toBe(0);
  });

  it("halves a cursed seat's next roll, rounded up, once", async () => {
    const { f } = await useOn("cursed_totem");
    expect(f.seats.get("sam")!.effects.halved || f.seats.get("kim")!.effects.halved).toBe(true);
    const target = f.seats.get("sam")!.effects.halved ? f.who.sam : f.who.kim;
    f.turn.key = target.key;
    f.turn.item = false;
    const rolled = { die: STANDARD, faces: [4], move: 5 };
    await f.items.afterRoll(target, rolled);
    expect(rolled.move).toBe(3);
    expect(f.seats.get(target.key)!.effects.halved).toBe(false);
  });

  it("uses up a special die and a curse's forced die", async () => {
    const f = fake();
    const seat = f.seats.get("alex")!;
    seat.hands.dice.push("golden");
    await f.items.afterRoll(f.who.alex, { die: { ...STANDARD, id: "golden" }, faces: [0], move: 5 });
    expect(seat.hands.dice).toEqual([]);
    seat.effects.slow = true;
    await f.items.afterRoll(f.who.alex, { die: { ...STANDARD, id: "slow" }, faces: [0], move: 1 });
    expect(seat.effects.slow).toBe(false);
  });

  it("strikes the leader for last place with Lightning", async () => {
    const { f, used } = await useOn("lightning", (f) => {
      f.seats.get("sam")!.coins = 30;
      f.seats.get("kim")!.coins = 0;
    });
    expect(used).toBe(true);
    expect(f.seats.get("sam")!.coins).toBe(30 - LIGHTNING);
    expect(f.seats.get("kim")!.coins).toBe(LIGHTNING);
  });

  it("lets a user with a zombie strike themselves: the zombie goes, and the coins go to last place", async () => {
    const { f, used } = await useOn("lightning", (f) => {
      f.seats.get("alex")!.coins = 20;
      f.seats.get("kim")!.coins = 0;
      f.seats.get("alex")!.effects.zombie = 2;
    });
    expect(used).toBe(true);
    expect(f.said).toContain("items.lightning.ask");
    expect(f.seats.get("alex")!.coins).toBe(20 - LIGHTNING);
    expect(f.seats.get("kim")!.coins).toBe(LIGHTNING);
    expect(f.seats.get("alex")!.effects.zombie).toBe(0);
    expect(f.zombies.remove).toHaveBeenCalledWith("alex");
  });

  it("won't strike when everyone is level and there's no zombie to chase off", async () => {
    const { f, used } = await useOn("lightning");
    expect(used).toBe(false);
    expect(f.seats.get("alex")!.hands.items).toEqual(["lightning"]);
  });

  it("shakes a rival down with the Iron Golem, or sends the user's zombie away", async () => {
    const { f } = await useOn("iron_golem", (f) => (f.seats.get("kim")!.coins = 3));
    expect(f.seats.get("alex")!.coins).toBe(10 + SHAKEDOWN);
    const { f: g } = await useOn("iron_golem", (g) => (g.seats.get("alex")!.effects.zombie = 3));
    expect(g.seats.get("alex")!.effects.zombie).toBe(0);
  });

  it("swaps with the Ender Pearl, sets a zombie on a rival, and duels with the Glove", async () => {
    const { f: pearl } = await useOn("ender_pearl");
    expect(pearl.calls.swap).toHaveBeenCalled();
    const { f: zombie } = await useOn("zombie");
    expect([...zombie.seats.values()].some((seat) => seat.effects.zombie === 3)).toBe(true);
    const { f: glove } = await useOn("glove");
    expect(glove.calls.duel).toHaveBeenCalledWith(glove.who.alex, expect.anything(), 10, "glove");
  });

  it("lets a rival be picked back out of (Never mind keeps the item)", async () => {
    const { f, used } = await useOn("cursed_totem", (f) => f.answers.push(2));
    expect(used).toBe(false);
    expect(f.seats.get("alex")!.hands.items).toEqual(["cursed_totem"]);
  });

  it("trades a die for half its value with the Villager, but not in the last round", async () => {
    const { f, used } = await useOn("villager", (f) => {
      f.seats.get("alex")!.hands.dice.push("golden");
      f.answers.push(0);
    });
    expect(used).toBe(true);
    expect(f.seats.get("alex")!.hands.dice).toEqual([]);
    expect(f.seats.get("alex")!.coins).toBeGreaterThan(10);
    const last = fake(15, 15);
    last.seats.get("alex")!.hands.items.push("villager");
    expect(await last.items.use(last.who.alex, "villager")).toBe(false);
  });

  it("allows one item a turn", async () => {
    const f = fake();
    f.seats.get("alex")!.hands.items.push("stone_totem", "golden_totem");
    expect(await f.items.use(f.who.alex, "stone_totem")).toBe(true);
    expect(await f.items.use(f.who.alex, "golden_totem")).toBe(false);
  });

  it("bites 3 coins as the zombie's target's turn starts, and leaves after 3 rounds", async () => {
    const f = fake();
    const seat = f.seats.get("alex")!;
    seat.effects.zombie = 3;
    for (let i = 0; i < 3; i++) await f.items.zombieBite(f.who.alex);
    expect(seat.coins).toBe(1);
    expect(seat.effects.zombie).toBe(0);
    expect(f.zombies.remove).toHaveBeenCalledWith("alex");
  });

  it("hands the Cursed Die to a rival, whose next roll it is", async () => {
    const f = fake();
    f.seats.get("alex")!.hands.dice.push("cursed");
    f.answers.push(1, 0);
    expect(await f.items.offerCursedDie(f.who.alex)).toBe(true);
    expect(f.seats.get("alex")!.hands.dice).toEqual([]);
    expect(f.seats.get("sam")!.effects.cursedDie).toBe(true);
  });
});
