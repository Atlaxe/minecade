// Block Party's spaces in play (docs/plans/block-party.md, "Space types", "Shop, Villager and
// Wandering Trader", "Chance Time (the Witch)", "The Warden", "Happening"; pass 7). Landing on:
//   - Item: a prize from the pool, likelier strong the further behind the lander is (space-rules.ts).
//   - Shop: the Villager who stands at the Shop all game (stage.ts, residents) turns to the lander.
//     Buy (the round's stock of 3) and Sell something (half its value) once each a visit, or Leave,
//     in the dialogue box; once they've bought and sold, the visit is over (the user, 2026-11-18).
//   - Chance Time: the Witch appears in a puff of smoke with three potions, their colors saying what
//     kind of outcome is in each (gold coins, green items, purple the board, white Stars; proposed),
//     each button with its potion's picture: pick one, or pay 3 coins once to brew three new ones. Late in the game the coin amounts grow by half and Coin
//     Swap, Position Shuffle and Shooting Star can come up.
//   - Warden: the Warden comes up out of the ground, roars, and does one of his events to the lander
//     (Sonic Boom: to the leader).
//   - Happening: something small from the shared table, in the board's flavor.
// And the Wandering Trader: every 3 or 4 rounds he comes for one round to a random Item space (he
// walks in with his llamas, stage.ts traderArrives), marked by a beam, and anyone passing or landing there can buy his one rare thing at about 1.5 times its
// value; once it's bought he's gone. Every choice is the dialogue box's (a bot picks after a moment);
// everything said is the user's lines (lines.ts).
import type { BoardLoop, LoopHost } from "./board-loop.ts";
import { addCoins, count } from "./board-rules.ts";
import type { Who } from "./bots.ts";
import type { ButtonIcon } from "./dialogue-codes.ts";
import type { ItemPlay } from "./item-play.ts";
import { button, line } from "./lines.ts";
import {
  CHANCE,
  COIN_RAIN,
  HALF_PRICE,
  HAPPENING_COINS,
  HAPPENING_LOSS,
  HAPPENING_STEPS,
  HUSH_MONEY,
  REROLL_PRICE,
  REVERSE_FORTUNE,
  STAR_TAX,
  betOptions,
  chancePotions,
  drawPrize,
  grown,
  happening,
  hasRoom,
  held,
  lateGame,
  nextTraderRound,
  prizeName,
  put,
  sculkTax,
  sellPrice,
  shopStock,
  take,
  traderGoods,
  traderPrice,
  valueOf,
  wardenEvent,
  type ChanceId,
  type HappeningId,
  type Prize,
  type WardenId,
} from "./space-rules.ts";

/** The NPCs' parts on stage while they work. */
const VILLAGER = "villager";
const WITCH = "witch";
const WARDEN = "warden";
const TRADER = "trader";

/** The Wandering Trader's visit. */
interface TraderVisit {
  space: number;
  goods: Prize;
  price: number;
  round: number;
}

/** Tests: what the next Chance Time, Warden or Happening does, picked in Tests. */
export interface Forced {
  chance?: ChanceId;
  warden?: WardenId;
  happening?: HappeningId;
}

export class SpacePlay {
  private readonly loop: BoardLoop;
  private readonly host: LoopHost;
  private readonly items: ItemPlay;
  /** The Shop's stock this round. */
  private stock: Prize[] = [];
  /** Who keeps the Shop while a seat is in it: the Villager standing there (his key), or one who came. */
  private keeper = VILLAGER;
  /** The Trader while he's on the board, and the round he comes next. */
  private visit: TraderVisit | undefined;
  private traderNext: number;
  /** Tests: the next outcomes. */
  readonly forced: Forced = {};

  constructor(loop: BoardLoop, host: LoopHost, items: ItemPlay) {
    this.loop = loop;
    this.host = host;
    this.items = items;
    this.traderNext = nextTraderRound(0, host.random);
  }

  /** The Trader's space, while he's on the board. */
  get traderSpace(): number | undefined {
    return this.visit?.space;
  }

  private hasType(type: string): boolean {
    return this.host.spaces().some((space) => space.type === type);
  }

  // ---- Rounds -----------------------------------------------------------------------------------

  /** As a round starts: the Shop's new stock (said to everyone), and the Trader if it's his round. */
  async roundStart(): Promise<void> {
    const round = this.loop.rounds.now;
    if (this.hasType("shop")) {
      this.stock = shopStock(this.host.random);
      this.host.everyone(line("shop.stock.today", { items: this.stock.map(prizeName).join(", ") }));
    }
    if (round >= this.traderNext && !this.visit) {
      this.traderNext = nextTraderRound(round, this.host.random);
      await this.traderArrives(round);
    }
  }

  /** As a round ends: the Trader leaves if he's still here. */
  async roundEnd(): Promise<void> {
    const visit = this.visit;
    if (!visit || visit.round !== this.loop.rounds.now) return;
    this.visit = undefined;
    this.host.stage.traderGone(TRADER);
    await this.host.say("trader.leaves", {}, true);
  }

  /** The Trader comes to a random Item space (none on a board without one, or where a Star is). */
  async traderArrives(round = this.loop.rounds.now): Promise<boolean> {
    const spaces = this.host.spaces();
    const stars = this.loop.starSpaces();
    const candidates = spaces.filter((space) => space.type === "item" && !stars.includes(space.index));
    const goods = traderGoods(this.host.random);
    if (candidates.length === 0 || !goods) return false;
    const space = candidates[Math.floor(this.host.random() * candidates.length)];
    this.visit = { space: space.index, goods, price: traderPrice(goods), round };
    const { stage } = this.host;
    await this.host.cutscene(true, async () => {
      // A cut to the space, and he walks in from out of the shot with his llamas.
      await stage.traderArrives(TRADER, space, true);
      await this.host.say("trader.arrives", { space: this.loop.spaceName(space), item: prizeName(goods), price: count(this.visit?.price ?? 0, "coin") }, true);
    });
    // Skipped or not, he stands there.
    if (!stage.get(TRADER)) await stage.traderArrives(TRADER, space, false);
    stage.clear();
    return true;
  }

  /** Passing or landing on the Trader's space: his one rare thing, if they can afford it and have room. */
  async trader(who: Who): Promise<void> {
    const visit = this.visit;
    const seat = this.loop.seatOf(who.key);
    if (!visit || !seat) return;
    const { stage } = this.host;
    await stage.meet(TRADER, who, "trader.offer");
    const fills = { player: who.name, item: prizeName(visit.goods), price: count(visit.price, "coin"), coins: count(seat.coins, "coin") };
    if (seat.coins < visit.price) {
      await this.host.say("trader.short", fills, false, who);
      return;
    }
    if (!hasRoom(seat.hands, visit.goods)) {
      await this.host.say("trader.full", fills, false, who);
      return;
    }
    // A bot buys when it keeps a few coins over.
    const picked = await this.host.talk("trader.offer", fills, { to: who, buttons: [button("trader.button.buy"), button("trader.button.skip")], back: 1, botPick: seat.coins - visit.price >= 5 ? 0 : 1 });
    if (picked !== 0) {
      await this.host.say("trader.declined", fills, false, who);
      return;
    }
    seat.coins -= visit.price;
    this.loop.spent(who.key, visit.price);
    put(seat.hands, visit.goods);
    const trader = stage.get(TRADER);
    void this.loop.transferAll([
      [who, trader, "coin", visit.price],
      [trader, who, visit.goods, 1],
    ]);
    this.host.changed();
    await this.host.say("trader.sold", fills, false, who);
    this.visit = undefined;
    stage.traderGone(TRADER);
    await this.host.say("trader.sold-out", fills, false, who);
  }

  // ---- Item and Shop ----------------------------------------------------------------------------

  /** An Item space: a prize from the pool, by how far behind they are. */
  async itemSpace(who: Who): Promise<void> {
    const prize = drawPrize(this.loop.trailOf(who.key), "space", this.host.random);
    await this.host.say("items.got", { player: who.name, item: prizeName(prize) }, false, who);
    await this.items.give(who, prize);
  }

  /** A Shop space: the Villager's shop, until they leave. */
  async shop(who: Who): Promise<void> {
    const seat = this.loop.seatOf(who.key);
    if (!seat) return;
    if (this.stock.length === 0) this.stock = shopStock(this.host.random);
    const { stage } = this.host;
    // The Villager who stands at the Shop (its NPC spot placed); else one comes in a puff of smoke
    // (the user, 2026-11-23), and goes the same way.
    const space = this.loop.spaceOf(who);
    const resident = await stage.atResident(who, space, "shop.welcome");
    this.keeper = resident ?? VILLAGER;
    if (!resident) await stage.visit(VILLAGER, "villager", who, space, "shop.welcome", "Cut", "smoke");
    // One buy and one sell a visit (the user): each button goes once it's done, and with both done the visit is over.
    let bought = false;
    let sold = false;
    try {
      for (let asked = 0; asked < 20 && !(bought && sold); asked++) {
        // A bot buys one thing it can afford and has room for, keeping a few coins.
        const wanted = this.stock.findIndex((goods) => seat.coins - valueOf(goods) >= 5 && hasRoom(seat.hands, goods));
        const actions = [...(bought ? [] : ["buy" as const]), ...(sold ? [] : ["sell" as const]), "leave" as const];
        const labels = { buy: button("shop.button.buy"), sell: button("shop.form.sell"), leave: button("shop.form.leave") };
        const leave = actions.length - 1;
        const picked = await this.host.talk(bought || sold ? "shop.more" : "shop.welcome", { player: who.name, coins: count(seat.coins, "coin") }, {
          to: who,
          buttons: actions.map((action) => labels[action]),
          back: leave,
          botPick: !bought && wanted >= 0 ? 0 : leave,
        });
        const action = picked === undefined ? "leave" : actions[picked];
        if (action === "buy") bought = (await this.buy(who, wanted)) || bought;
        else if (action === "sell") sold = (await this.sell(who)) || sold;
        else break;
      }
      await this.host.say(bought || sold ? "shop.bye" : "shop.nothing", { player: who.name }, false, who);
    } finally {
      if (resident) stage.backToSpace(resident);
      else stage.leave(VILLAGER);
    }
  }

  /** The Shop's stock to pick from; true when they bought something. */
  private async buy(who: Who, botPick: number): Promise<boolean> {
    const seat = this.loop.seatOf(who.key);
    if (!seat) return false;
    const stock = this.stock;
    const picked = await this.host.talk("shop.stock", { player: who.name, coins: count(seat.coins, "coin") }, {
      to: who,
      buttons: [...stock.map((goods) => button("shop.form.item", { item: prizeName(goods), price: count(valueOf(goods), "coin") })), button("shop.button.back")],
      back: stock.length,
      botPick: botPick >= 0 ? botPick : stock.length,
    });
    if (picked === undefined || picked >= stock.length) return false;
    const goods = stock[picked];
    const price = valueOf(goods);
    const fills = { player: who.name, item: prizeName(goods), price: count(price, "coin") };
    if (seat.coins < price) {
      await this.host.say("shop.short", fills, false, who);
      return false;
    }
    if (!hasRoom(seat.hands, goods)) {
      await this.host.say("shop.full", fills, false, who);
      return false;
    }
    seat.coins -= price;
    this.loop.spent(who.key, price);
    put(seat.hands, goods);
    const villager = this.host.stage.get(this.keeper);
    void this.loop.transferAll([
      [who, villager, "coin", price],
      [villager, who, goods, 1],
    ]);
    this.host.changed();
    await this.host.say("shop.bought", fills, false, who);
    return true;
  }

  /** Selling one thing for half its value; true when they sold something. */
  private async sell(who: Who): Promise<boolean> {
    const seat = this.loop.seatOf(who.key);
    if (!seat) return false;
    const goods = held(seat.hands);
    if (goods.length === 0) {
      await this.host.say("shop.sell.nothing", { player: who.name }, false, who);
      return false;
    }
    const picked = await this.host.talk("shop.sell", { player: who.name }, {
      to: who,
      buttons: [...goods.map((prize) => button("shop.sell.button", { item: prizeName(prize), coins: count(sellPrice(prize), "coin") })), button("shop.button.back")],
      back: goods.length,
      botPick: goods.length,
    });
    if (picked === undefined || picked >= goods.length) return false;
    const prize = goods[picked];
    take(seat.hands, prize);
    seat.coins += sellPrice(prize);
    const villager = this.host.stage.get(this.keeper);
    void this.loop.transferAll([
      [who, villager, prize, 1],
      [villager, who, "coin", sellPrice(prize)],
    ]);
    this.host.changed();
    await this.host.say("shop.sold", { player: who.name, item: prizeName(prize), coins: count(sellPrice(prize), "coin") }, false, who);
    return true;
  }

  // ---- Chance Time ------------------------------------------------------------------------------

  /** Chance Time: the Witch's potions, a reroll once if they can pay, then what's inside. */
  async chance(who: Who): Promise<void> {
    const seat = this.loop.seatOf(who.key);
    if (!seat) return;
    const { now, of } = this.loop.rounds;
    const late = lateGame(now, of);
    const { stage } = this.host;
    await stage.visit(WITCH, "witch", who, this.loop.spaceOf(who), "chance.welcome");
    try {
      await this.host.say("chance.welcome", { player: who.name }, false, who);
      // Tests' pick fills every potion of this visit, new brews too.
      const forced = this.forced.chance;
      this.forced.chance = undefined;
      const brew = () => (forced ? [forced, forced, forced] : chancePotions(this.chanceContext(who, late), this.host.random));
      let potions = brew();
      let rerolled = false;
      let picked: ChanceId | undefined;
      while (!picked) {
        const canReroll = !rerolled && seat.coins >= REROLL_PRICE;
        const buttons = potions.map((id) => button(`chance.potion.${CHANCE[id].potion}`));
        // Each potion's picture left of its name (the user): its color, what kind of outcome is inside.
        const icons: (ButtonIcon | undefined)[] = potions.map((id) => `potion.${CHANCE[id].potion}` as const);
        if (canReroll) buttons.push(button("chance.form.reroll", { price: count(REROLL_PRICE, "coin") }));
        const choice = await this.host.talk("chance.potions", { player: who.name }, { to: who, buttons, icons, botPick: Math.floor(this.host.random() * potions.length) });
        if (canReroll && choice === potions.length) {
          seat.coins -= REROLL_PRICE;
          this.loop.spent(who.key, REROLL_PRICE);
          void this.loop.transfer(who, this.host.stage.get(WITCH), "coin", REROLL_PRICE);
          rerolled = true;
          this.host.changed();
          stage.act(WITCH, "animation.witch.general");
          await this.host.say("chance.reroll.done", { player: who.name, price: count(REROLL_PRICE, "coin") }, false, who);
          potions = brew();
          continue;
        }
        picked = potions[Math.min(potions.length - 1, Math.max(0, choice ?? 0))];
      }
      if (picked) await this.chanceOutcome(who, picked, late);
      await this.host.say("chance.bye", { player: who.name }, false, who);
    } finally {
      stage.leave(WITCH);
    }
  }

  private chanceContext(who: Who, late: boolean) {
    const seat = this.loop.seatOf(who.key);
    const here = this.loop.here();
    const ends = this.loop.ends();
    return {
      late,
      coins: seat?.coins ?? 0,
      others: here.filter((other) => other.key !== who.key).length,
      anyItems: here.some((other) => (this.loop.seatOf(other.key)?.hands.items.length ?? 0) > 0),
      leaderHasStar: (ends.leader ? this.loop.seatOf(ends.leader.key)?.stars ?? 0 : 0) > 0,
      level: ends.level,
    };
  }

  /** What the picked potion does. */
  async chanceOutcome(who: Who, id: ChanceId, late: boolean): Promise<void> {
    const seat = this.loop.seatOf(who.key);
    if (!seat) return;
    const here = this.loop.here();
    const ends = this.loop.ends();
    // Outcomes about the leader and last place keep them in sight; the whole board's keep everyone.
    if (["reverse_fortune", "zombie_outbreak", "half_price", "shooting_star"].includes(id)) this.loop.feature(ends.leader, ends.last);
    if (["coin_rain", "gift_exchange", "position_shuffle"].includes(id)) this.loop.feature(...here);
    const before = this.loop.snapshot();
    let results = false;
    switch (id) {
      case "coin_rain": {
        const coins = grown(COIN_RAIN, late);
        for (const other of here) {
          const theirs = this.loop.seatOf(other.key);
          if (!theirs) continue;
          theirs.coins += coins;
          void this.loop.transfer(this.host.stage.get(WITCH), other, "coin", coins);
        }
        this.host.changed();
        await this.host.say("chance.coin-rain", { player: who.name, coins: count(coins, "coin") }, false, who);
        results = true;
        break;
      }
      case "coin_swap": {
        const others = here.filter((other) => other.key !== who.key);
        const rival = await this.items.pickRival(who, "chance.coin-swap.ask", { player: who.name }, others, (candidates) => this.richest(candidates));
        const target = rival ?? others[0];
        const theirs = target ? this.loop.seatOf(target.key) : undefined;
        if (!target || !theirs) break;
        [seat.coins, theirs.coins] = [theirs.coins, seat.coins];
        // The difference goes from the one who had more to the one who had less (a hand-over, after the line).
        const gained = seat.coins - theirs.coins;
        if (gained > 0) this.loop.pass(target, who, "coin", gained);
        else if (gained < 0) this.loop.pass(who, target, "coin", -gained);
        this.host.changed();
        await this.host.stage.twoSeats(who, target, "chance.coin-swap");
        await this.host.say("chance.coin-swap", { player: who.name, other: target.name }, false, who);
        results = true;
        break;
      }
      case "reverse_fortune": {
        if (!ends.leader || !ends.last || ends.level) break;
        const paid = this.loop.pay(ends.leader.key, ends.last.key, grown(REVERSE_FORTUNE, late));
        await this.host.say("chance.reverse-fortune", { player: ends.leader.name, other: ends.last.name, coins: count(paid, "coin") }, false, who);
        results = true;
        break;
      }
      case "double_or_nothing": {
        await this.host.say("chance.double", { player: who.name }, false, who);
        const options = betOptions(seat.coins, late);
        if (options.length === 0) break;
        const picked = await this.host.talk("chance.double.ask", { player: who.name, coins: count(options[options.length - 1], "coin") }, {
          to: who,
          buttons: options.map((amount) => button("chance.double.bet", { coins: count(amount, "coin") })),
          botPick: Math.min(1, options.length - 1),
        });
        const bet = options[Math.min(options.length - 1, Math.max(0, picked ?? 0))];
        this.loop.stats.risk(who.key);
        const won = this.host.random() < 0.5;
        const was = seat.coins;
        seat.coins = addCoins(seat.coins, won ? bet : -bet);
        const witch = this.host.stage.get(WITCH);
        void (won ? this.loop.transfer(witch, who, "coin", seat.coins - was) : this.loop.transfer(who, witch, "coin", was - seat.coins));
        this.host.changed();
        await this.host.say(won ? "chance.double.won" : "chance.double.lost", { player: who.name, coins: count(bet, "coin") }, false, who);
        results = true;
        break;
      }
      case "gift_exchange": {
        await this.host.say("chance.gift-exchange", { player: who.name }, false, who);
        await this.giftExchange(who, here);
        break;
      }
      case "lucky_draw": {
        const prize = drawPrize(this.loop.trailOf(who.key), "lucky", this.host.random);
        await this.host.say("chance.lucky-draw", { player: who.name, item: prizeName(prize) }, false, who);
        await this.items.give(who, prize, this.host.stage.get(WITCH));
        break;
      }
      case "position_shuffle":
        await this.host.say("chance.shuffle", { player: who.name }, false, who);
        this.loop.shuffle(here);
        break;
      case "battle_royale":
        this.loop.forceBattle();
        await this.host.say("chance.battle-royale", { player: who.name }, false, who);
        break;
      case "zombie_outbreak": {
        const target = ends.leader ?? who;
        await this.host.say("chance.zombie", { player: target.name }, false, who);
        await this.items.zombieOn(target, who);
        break;
      }
      case "half_price": {
        const target = ends.last ?? who;
        const theirs = this.loop.seatOf(target.key);
        if (theirs) theirs.effects.discount = Math.max(theirs.effects.discount, HALF_PRICE);
        await this.host.say("chance.half-price", { player: target.name, coins: count(HALF_PRICE, "coin") }, false, who);
        break;
      }
      case "shooting_star": {
        if (!ends.leader || !ends.last || ends.level) break;
        const from = this.loop.seatOf(ends.leader.key);
        const to = this.loop.seatOf(ends.last.key);
        if (!from || !to || from.stars <= 0) break;
        from.stars--;
        to.stars++;
        this.loop.pass(ends.leader, ends.last, "star", 1);
        this.host.changed();
        await this.host.stage.twoSeats(ends.leader, ends.last, "chance.shooting-star", "Pan");
        await this.host.say("chance.shooting-star", { player: ends.leader.name, other: ends.last.name }, false, who);
        results = true;
        break;
      }
    }
    this.host.changed();
    if (results) await this.loop.showResults(before);
  }

  /**
   * Gift Exchange: each holder passes a random item of theirs to the next in turn order, all at once.
   * Shown as a hand-over (the user, 2026-11-20; handovers.ts): the camera on each giver in turn order
   * as their item leaves, then on its taker as it lands; then back to the Witch and the lander.
   */
  private async giftExchange(lander: Who, here: readonly Who[]): Promise<void> {
    const order = this.loop.turnOrder().flatMap((key) => here.filter((who) => who.key === key));
    const gifts = order.map((who) => {
      const items = this.loop.seatOf(who.key)?.hands.items ?? [];
      return items.length > 0 ? items[Math.floor(this.host.random() * items.length)] : undefined;
    });
    order.forEach((who, i) => {
      const gift = gifts[i];
      if (gift) take(this.loop.seatOf(who.key)!.hands, { kind: "item", id: gift });
    });
    let passed = false;
    order.forEach((who, i) => {
      const gift = gifts[i];
      const next = order[(i + 1) % order.length];
      if (!gift || !next) return;
      put(this.loop.seatOf(next.key)!.hands, { kind: "item", id: gift });
      this.host.everyone(line("chance.gift.passed", { player: who.name, other: next.name, item: prizeName({ kind: "item", id: gift }) }));
      this.loop.pass(who, next, { kind: "item", id: gift }, 1);
      passed = true;
    });
    this.host.changed();
    if (!passed) return;
    await this.loop.handOver();
    await this.host.scope.wait(10);
    await this.host.stage.meet(WITCH, lander, "chance.bye");
  }

  private richest(candidates: readonly Who[]): number {
    let best = 0;
    candidates.forEach((other, i) => {
      if ((this.loop.seatOf(other.key)?.coins ?? 0) > (this.loop.seatOf(candidates[best].key)?.coins ?? 0)) best = i;
    });
    return best;
  }

  // ---- The Warden -------------------------------------------------------------------------------

  /** A Warden space: he comes up, roars, does his event, and digs away. */
  async warden(who: Who): Promise<void> {
    const seat = this.loop.seatOf(who.key);
    if (!seat) return;
    const { stage } = this.host;
    // He's put there hidden, and shows once his emerge has him coming up out of the ground.
    await stage.visit(WARDEN, "warden", who, this.loop.spaceOf(who), "warden.arrives");
    stage.move(WARDEN, "Warden", "Emerge", who.body);
    try {
      await this.host.say("warden.arrives", { player: who.name }, false, who);
      const ends = this.loop.ends();
      const here = this.loop.here();
      const forced = this.forced.warden;
      this.forced.warden = undefined;
      const event =
        forced ??
        wardenEvent(
          {
            stars: seat.stars,
            others: here.filter((other) => other.key !== who.key).length,
            leaderHasStar: (ends.leader ? this.loop.seatOf(ends.leader.key)?.stars ?? 0 : 0) > 0,
          },
          this.host.random,
        );
      const before = this.loop.snapshot();
      let results = false;
      stage.move(WARDEN, "Warden", event === "sonic_boom" ? "Sonic boom" : "Roar", who.body);
      switch (event) {
        case "sculk_tax": {
          const took = Math.min(sculkTax(this.host.random), seat.coins);
          seat.coins -= took;
          void this.loop.transfer(who, stage.get(WARDEN), "coin", took);
          await this.host.say("warden.sculk-tax", { player: who.name, coins: count(took, "coin") }, false, who);
          results = took > 0;
          break;
        }
        case "hush_money": {
          this.loop.feature(...here);
          let paid = 0;
          for (const other of here) if (other.key !== who.key) paid += this.loop.pay(who.key, other.key, HUSH_MONEY);
          await this.host.say("warden.hush-money", { player: who.name, coins: count(HUSH_MONEY, "coin") }, false, who);
          await this.loop.handOver();
          results = paid > 0;
          break;
        }
        case "star_tax": {
          const took = Math.min(STAR_TAX * seat.stars, seat.coins);
          seat.coins -= took;
          void this.loop.transfer(who, stage.get(WARDEN), "coin", took);
          await this.host.say("warden.star-tax", { player: who.name, coins: count(STAR_TAX, "coin") }, false, who);
          results = took > 0;
          break;
        }
        case "silenced":
          seat.effects.silenced = true;
          await this.host.say("warden.silenced", { player: who.name }, false, who);
          break;
        case "slow_curse":
          seat.effects.slow = true;
          await this.host.say("warden.slow-curse", { player: who.name }, false, who);
          break;
        case "zombie_curse":
          await this.host.say("warden.zombie-curse", { player: who.name }, false, who);
          await this.items.zombieOn(who);
          break;
        case "sonic_boom": {
          const target = ends.leader;
          this.loop.feature(target);
          const theirs = target ? this.loop.seatOf(target.key) : undefined;
          if (!target || !theirs || theirs.stars <= 0) break;
          theirs.stars--;
          void this.loop.transfer(target, stage.get(WARDEN), "star", 1);
          await this.host.say("warden.sonic-boom", { player: target.name }, false, who);
          results = true;
          break;
        }
      }
      this.host.changed();
      // He digs away and stays down, hidden, until he's taken away.
      stage.move(WARDEN, "Warden", "Dig away", who.body);
      await this.host.say("warden.leaves", { player: who.name }, false, who);
      if (results) await this.loop.showResults(before);
    } finally {
      stage.remove(WARDEN);
    }
  }

  // ---- Happening --------------------------------------------------------------------------------

  /** A Happening space: the board's flavor, then one thing from the shared table. */
  async happening(who: Who): Promise<void> {
    const seat = this.loop.seatOf(who.key);
    const space = this.loop.spaceOf(who);
    if (!seat || !space) return;
    await this.host.stage.toSpace(space, "happening.flavor", "Cut");
    await this.host.say("happening.flavor", { player: who.name, space: this.loop.spaceName(space) }, false, who);
    const here = this.loop.here();
    const others = here.filter((other) => other.key !== who.key && (this.loop.seatOf(other.key)?.hands.items.length ?? 0) > 0);
    const forced = this.forced.happening;
    this.forced.happening = undefined;
    const id = forced ?? happening({ canSwap: seat.hands.items.length > 0 && others.length > 0, bonus: this.loop.turnState?.bonus === true }, this.host.random);
    const fills = { player: who.name };
    switch (id) {
      case "coins":
        seat.coins += HAPPENING_COINS;
        this.host.changed();
        await this.host.say("happening.coins", { ...fills, coins: count(HAPPENING_COINS, "coin") }, false, who);
        break;
      case "item": {
        const prize = drawPrize(this.loop.trailOf(who.key), "space", this.host.random);
        await this.host.say("happening.item", { ...fills, item: prizeName(prize) }, false, who);
        await this.items.give(who, prize);
        break;
      }
      case "forward":
        await this.host.say("happening.forward", { ...fills, count: HAPPENING_STEPS }, false, who);
        await this.loop.walk(who, HAPPENING_STEPS);
        break;
      case "back":
        await this.host.say("happening.back", { ...fills, count: HAPPENING_STEPS }, false, who);
        await this.loop.walkBack(who, HAPPENING_STEPS);
        break;
      case "lose": {
        const took = Math.min(HAPPENING_LOSS, seat.coins);
        seat.coins -= took;
        this.host.changed();
        await this.host.say("happening.lose", { ...fills, coins: count(took, "coin") }, false, who);
        break;
      }
      case "nothing":
        await this.host.say("happening.nothing", fills, false, who);
        break;
      case "swap_item": {
        const other = others[Math.floor(this.host.random() * others.length)];
        const theirs = other ? this.loop.seatOf(other.key) : undefined;
        if (!other || !theirs || seat.hands.items.length === 0) break;
        this.loop.feature(other);
        const mine = seat.hands.items[Math.floor(this.host.random() * seat.hands.items.length)];
        const got = theirs.hands.items[Math.floor(this.host.random() * theirs.hands.items.length)];
        take(seat.hands, { kind: "item", id: mine });
        take(theirs.hands, { kind: "item", id: got });
        put(seat.hands, { kind: "item", id: got });
        put(theirs.hands, { kind: "item", id: mine });
        this.loop.pass(who, other, { kind: "item", id: mine }, 1);
        this.loop.pass(other, who, { kind: "item", id: got }, 1);
        this.host.changed();
        await this.host.say("happening.swap-item", { ...fills, other: other.name, item: prizeName({ kind: "item", id: got }) }, false, who);
        await this.loop.handOver();
        break;
      }
      case "roll_again":
        await this.host.say("happening.roll-again", fills, false, who);
        await this.loop.bonusRoll(who);
        break;
    }
  }
}
