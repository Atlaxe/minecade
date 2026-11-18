// Block Party's items in play (docs/plans/block-party.md, "Items" and "Dice"; pass 7): a seat uses
// one item a turn before its roll (from the board menu's item panel, or a bot's pick), picks a rival
// in the dialogue box where the item needs one, and the item's NPC comes to do it:
//   - Stone Totem and Golden Totem: an extra die this roll (the Golden one's counts double), which is
//     the turn's movement boost, so only the standard die can be rolled with it.
//   - Ender Pearl: the Enderman swaps the user's piece with a rival's.
//   - Cursed Totem: a rival's next roll is halved, rounded up.
//   - Dueling Glove: a duel with a rival for 10 coins (doubled in the last rounds), with bets.
//   - Lightning Strike: the leader (most Stars, then coins) gives 10 coins to last place. A user with
//     a zombie can strike themselves instead: the zombie goes, and they still lose the 10 coins (to
//     last place, or the bank if they're last).
//   - Zombie Spawn: a zombie follows a rival for 3 rounds, taking 3 coins as each of their turns
//     starts; it leaves early when they finish a minigame in the top 2, run out of coins, or use an
//     Iron Golem or a Lightning Strike.
//   - Iron Golem: shakes a rival down for up to 5 coins, or sends the user's zombie away.
//   - Villager: trades a die or an item for half its value (not in the last round).
// Also here: what a roll does with the turn's state (the totem's die, the Cursed Totem's halving, a
// special die used up, a curse's forced die gone), the zombie's bite as a turn starts, handing a seat
// a prize (the Warden's Silenced takes it; full hands pick what to drop), and handing a rival the
// Cursed Die. Everything said is the user's lines (lines.ts).
import { STANDARD, STANDARD_DIE, dieOf, rollDie, type RollOutcome } from "./dice.ts";
import { ITEMS, type ItemId } from "./dice-items.ts";
import type { BoardLoop, LoopHost } from "./board-loop.ts";
import { count } from "./board-rules.ts";
import type { Who } from "./bots.ts";
import { button, line } from "./lines.ts";
import { isDoubled } from "./minigame-rules.ts";
import { forcedDie, mayUseItem, type Seat } from "./seats.ts";
import { GLOVE_STAKE, ZOMBIE_BITE, ZOMBIE_ROUNDS, held, prizeName, put, sellPrice, take, type Prize } from "./space-rules.ts";

/** Coins the Lightning Strike moves, and the most the Iron Golem shakes down. */
export const LIGHTNING = 10;
export const SHAKEDOWN = 5;
/** Where an item's NPC stands on stage while it works. */
const ACTOR = "item";
/** The Cursed Die (the dice file's), which its holder can make a rival roll instead. */
export const CURSED_DIE = "cursed";

export class ItemPlay {
  private readonly loop: BoardLoop;
  private readonly host: LoopHost;

  constructor(loop: BoardLoop, host: LoopHost) {
    this.loop = loop;
    this.host = host;
  }

  /**
   * `who` uses item `id` on their turn, before the roll. Resolves once it's done: true when it was
   * used (it leaves their hands, and Items is spent for the turn), false when it couldn't be (no
   * rival to use it on, the last round for the Villager, a totem already up).
   */
  async use(who: Who, id: ItemId): Promise<boolean> {
    const seat = this.loop.seatOf(who.key);
    const turn = this.loop.turnState;
    if (!seat || !seat.hands.items.includes(id) || turn?.key !== who.key || !mayUseItem(turn)) return false;
    const fills = { player: who.name, item: ITEMS[id].name };
    let used = false;
    try {
      switch (id) {
        case "stone_totem":
        case "golden_totem":
          if (turn.boost) return false;
          // Spent before its line: the menu's dice narrow to the standard die at once.
          take(seat.hands, { kind: "item", id });
          turn.boost = id === "stone_totem" ? "stone" : "golden";
          turn.item = true;
          this.host.changed();
          await this.host.say(id === "stone_totem" ? "items.stone-totem" : "items.golden-totem", fills, false, who);
          return true;
        case "ender_pearl":
          used = await this.enderPearl(who, seat);
          break;
        case "cursed_totem":
          used = await this.cursedTotem(who);
          break;
        case "glove":
          used = await this.glove(who, seat);
          break;
        case "lightning":
          used = await this.lightning(who, seat);
          break;
        case "zombie":
          used = await this.zombieSpawn(who);
          break;
        case "iron_golem":
          used = await this.ironGolem(who, seat);
          break;
        case "villager":
          used = await this.villager(who, seat);
          break;
      }
    } finally {
      this.host.stage.remove(ACTOR);
    }
    return used;
  }

  /** Marks `id` used: out of their hands, and Items spent this turn. */
  private spend(who: Who, seat: Seat, id: ItemId): void {
    take(seat.hands, { kind: "item", id });
    const turn = this.loop.turnState;
    if (turn?.key === who.key) turn.item = true;
    this.host.changed();
  }

  /** The other seats on the board, to use an item on. */
  private rivals(who: Who): Who[] {
    return this.loop.here().filter((other) => other.key !== who.key);
  }

  /**
   * `who` picks a rival in the dialogue box (`lineId`, a Game line by default), with a Never mind
   * button (sneak): undefined for that, or for nobody to pick. A bot picks `botPick`'s rival.
   */
  async pickRival(who: Who, lineId: string, fills: Readonly<Record<string, string | number>>, candidates: readonly Who[], botPick: (candidates: readonly Who[]) => number): Promise<Who | undefined> {
    if (candidates.length === 0) {
      await this.host.say("items.no-rival", fills, false, who);
      return undefined;
    }
    const buttons = candidates.map((other) => {
      const theirs = this.loop.seatOf(other.key);
      return button("items.pick.button", { player: other.name, coins: count(theirs?.coins ?? 0, "coin"), stars: count(theirs?.stars ?? 0, "Star") });
    });
    const picked = await this.host.talk(lineId, fills, { to: who, buttons: [...buttons, button("items.pick.back")], back: candidates.length, botPick: Math.max(0, Math.min(candidates.length - 1, botPick(candidates))) });
    const rival = picked !== undefined && picked < candidates.length ? candidates[picked] : undefined;
    // The rival stays in sight while the item works on them.
    this.loop.feature(rival);
    return rival;
  }

  /** A bot's pick among rivals: the leader if they're one, else the richest. */
  private best(candidates: readonly Who[]): number {
    const leader = this.loop.ends().leader;
    const at = candidates.findIndex((other) => other.key === leader?.key);
    if (at >= 0) return at;
    let best = 0;
    candidates.forEach((other, i) => {
      if ((this.loop.seatOf(other.key)?.coins ?? 0) > (this.loop.seatOf(candidates[best].key)?.coins ?? 0)) best = i;
    });
    return best;
  }

  private async enderPearl(who: Who, seat: Seat): Promise<boolean> {
    const rival = await this.pickRival(who, "items.pick", { player: who.name, item: ITEMS.ender_pearl.name }, this.rivals(who), (candidates) => this.best(candidates));
    if (!rival) return false;
    this.spend(who, seat, "ender_pearl");
    const { stage } = this.host;
    await stage.visit(ACTOR, "enderman", who, this.loop.spaceOf(who), "items.ender-pearl");
    stage.act(ACTOR, "animation.enderman.scary_face");
    await this.host.say("items.ender-pearl", { player: who.name, other: rival.name }, false, who);
    this.loop.swap(who, rival);
    stage.remove(ACTOR);
    await stage.twoSeats(who, rival, "items.ender-pearl");
    return true;
  }

  private async cursedTotem(who: Who): Promise<boolean> {
    const rival = await this.pickRival(who, "items.pick", { player: who.name, item: ITEMS.cursed_totem.name }, this.rivals(who), (candidates) => this.best(candidates));
    const theirs = rival ? this.loop.seatOf(rival.key) : undefined;
    const seat = this.loop.seatOf(who.key);
    if (!rival || !theirs || !seat) return false;
    this.spend(who, seat, "cursed_totem");
    theirs.effects.halved = true;
    await this.host.say("items.cursed-totem", { player: who.name, other: rival.name }, false, who);
    return true;
  }

  private async glove(who: Who, seat: Seat): Promise<boolean> {
    const rival = await this.pickRival(who, "items.pick", { player: who.name, item: ITEMS.glove.name }, this.rivals(who), (candidates) => this.best(candidates));
    if (!rival) return false;
    this.spend(who, seat, "glove");
    const { now, of } = this.loop.rounds;
    await this.loop.duel(who, rival, GLOVE_STAKE * (isDoubled(now, of) ? 2 : 1), "glove");
    return true;
  }

  private async lightning(who: Who, seat: Seat): Promise<boolean> {
    const { leader, last, level } = this.loop.ends();
    // With a zombie on them: strike the leader, or themselves to chase it off.
    let self = false;
    if (seat.effects.zombie > 0) {
      const picked = await this.host.talk("items.lightning.ask", { player: who.name, other: leader?.name ?? "" }, {
        to: who,
        buttons: [button("items.lightning.leader", { player: leader?.name ?? "" }), button("items.lightning.me"), button("items.pick.back")],
        back: 2,
        botPick: 1,
      });
      if (picked === undefined || picked === 2) return false;
      self = picked === 1;
    }
    if (!self && (level || !leader || !last)) {
      await this.host.say("items.lightning.none", { player: who.name }, false, who);
      return false;
    }
    this.spend(who, seat, "lightning");
    this.loop.feature(leader, last);
    const before = this.loop.snapshot();
    if (self) {
      this.host.stage.lightning(who);
      this.zombieOff(who, false);
      let paid: number;
      if (last && last.key !== who.key) paid = this.loop.pay(who.key, last.key, LIGHTNING);
      else {
        paid = Math.min(LIGHTNING, seat.coins);
        seat.coins -= paid;
      }
      this.host.changed();
      await this.host.say("items.lightning.self", { player: who.name, other: last?.name ?? "", coins: count(paid, "coin") }, false, who);
    } else if (leader && last) {
      this.host.stage.lightning(leader);
      const paid = this.loop.pay(leader.key, last.key, LIGHTNING);
      await this.host.say("items.lightning", { player: leader.name, other: last.name, coins: count(paid, "coin") }, false, who);
    }
    await this.loop.showResults(before);
    return true;
  }

  private async zombieSpawn(who: Who): Promise<boolean> {
    const rival = await this.pickRival(who, "items.pick", { player: who.name, item: ITEMS.zombie.name }, this.rivals(who), (candidates) => this.best(candidates));
    const seat = this.loop.seatOf(who.key);
    if (!rival || !seat) return false;
    this.spend(who, seat, "zombie");
    await this.host.say("items.zombie-spawn", { player: who.name, other: rival.name }, false, who);
    await this.zombieOn(rival, who);
    return true;
  }

  private async ironGolem(who: Who, seat: Seat): Promise<boolean> {
    let shakedown = true;
    if (seat.effects.zombie > 0) {
      const picked = await this.host.talk("items.iron-golem.ask", { player: who.name }, { to: who, buttons: [button("items.iron-golem.zombie.button"), button("items.iron-golem.shake"), button("items.pick.back")], back: 2, botPick: 0 });
      if (picked === undefined || picked === 2) return false;
      shakedown = picked === 1;
    }
    const { stage } = this.host;
    if (!shakedown) {
      this.spend(who, seat, "iron_golem");
      await stage.visit(ACTOR, "iron_golem", who, this.loop.spaceOf(who), "items.iron-golem.zombie");
      stage.act(ACTOR, "animation.blockparty.golem_hit");
      this.zombieOff(who, false);
      await this.host.say("items.iron-golem.zombie", { player: who.name }, false, who);
      return true;
    }
    const rival = await this.pickRival(who, "items.pick", { player: who.name, item: ITEMS.iron_golem.name }, this.rivals(who), (candidates) => this.richest(candidates));
    if (!rival) return false;
    this.spend(who, seat, "iron_golem");
    await stage.visit(ACTOR, "iron_golem", rival, this.loop.spaceOf(rival), "items.iron-golem");
    stage.act(ACTOR, "animation.blockparty.golem_hit");
    const before = this.loop.snapshot();
    const took = this.loop.pay(rival.key, who.key, SHAKEDOWN);
    await this.host.say("items.iron-golem", { player: who.name, other: rival.name, coins: count(took, "coin") }, false, who);
    await this.loop.showResults(before);
    return true;
  }

  private richest(candidates: readonly Who[]): number {
    let best = 0;
    candidates.forEach((other, i) => {
      if ((this.loop.seatOf(other.key)?.coins ?? 0) > (this.loop.seatOf(candidates[best].key)?.coins ?? 0)) best = i;
    });
    return best;
  }

  private async villager(who: Who, seat: Seat): Promise<boolean> {
    const { now, of } = this.loop.rounds;
    if (now >= of) {
      await this.host.say("items.villager.final", { player: who.name }, false, who);
      return false;
    }
    // Anything held but this Villager: a die or another item.
    const goods = held(seat.hands);
    goods.splice(
      goods.findIndex((prize) => prize.kind === "item" && prize.id === "villager"),
      1,
    );
    if (goods.length === 0) {
      await this.host.say("items.villager.nothing", { player: who.name }, false, who);
      return false;
    }
    const { stage } = this.host;
    await stage.visit(ACTOR, "villager", who, this.loop.spaceOf(who), "items.villager.ask");
    const picked = await this.host.talk("items.villager.ask", { player: who.name }, {
      to: who,
      buttons: [...goods.map((prize) => button("shop.sell.button", { item: prizeName(prize), coins: count(sellPrice(prize), "coin") })), button("shop.button.back")],
      back: goods.length,
      botPick: goods.length,
    });
    if (picked === undefined || picked >= goods.length) return false;
    const prize = goods[picked];
    this.spend(who, seat, "villager");
    take(seat.hands, prize);
    seat.coins += sellPrice(prize);
    this.host.changed();
    await this.host.say("items.villager", { player: who.name, item: prizeName(prize), coins: count(sellPrice(prize), "coin") }, false, who);
    return true;
  }

  // ---- Zombies --------------------------------------------------------------------------------

  /** A zombie follows `target` for ZOMBIE_ROUNDS rounds (from `by`'s Zombie Spawn, the Warden, or Chance). */
  async zombieOn(target: Who, by?: Who): Promise<void> {
    const seat = this.loop.seatOf(target.key);
    if (!seat) return;
    seat.effects.zombie = ZOMBIE_ROUNDS;
    this.host.zombies.add(target.key);
    await this.host.say("zombie.arrives", { player: target.name }, false, by ?? target);
  }

  /** The zombie on `who` leaves (said in chat unless `quiet`). */
  zombieOff(who: Pick<Who, "key" | "name">, say = true): void {
    const seat = this.loop.seatOf(who.key);
    if (seat) seat.effects.zombie = 0;
    this.host.zombies.remove(who.key);
    if (say) this.host.everyone(line("zombie.leaves", { player: who.name }));
  }

  /** As `who`'s turn starts, their zombie takes its coins (a round of its stay); with nothing left to take, it leaves. */
  async zombieBite(who: Who): Promise<void> {
    const seat = this.loop.seatOf(who.key);
    if (!seat || seat.effects.zombie <= 0) return;
    if (seat.coins <= 0) {
      this.zombieOff(who);
      return;
    }
    this.host.zombies.add(who.key);
    const took = Math.min(ZOMBIE_BITE, seat.coins);
    seat.coins -= took;
    seat.effects.zombie--;
    this.host.changed();
    await this.host.say("zombie.takes", { player: who.name, coins: count(took, "coin") }, false, who);
    this.host.everyone(line("zombie.takes.chat", { player: who.name, coins: count(took, "coin") }));
    if (seat.effects.zombie <= 0 || seat.coins <= 0) this.zombieOff(who);
  }

  /** After a minigame: the zombies leave those who finished in the top 2 (`keys`). */
  shakeOff(keys: readonly string[]): void {
    for (const key of keys) {
      const seat = this.loop.seatOf(key);
      if (seat && seat.effects.zombie > 0) this.zombieOff({ key, name: seat.name });
    }
  }

  // ---- Rolls ----------------------------------------------------------------------------------

  /**
   * What the turn does to a roll (before the dice file's faces): a special die from their hands is
   * used up, a curse's forced die is gone, a totem's extra die is added (doubled for the Golden
   * Totem), and a Cursed Totem halves the total, rounded up. Changes `rolled.move`.
   */
  async afterRoll(who: Who, rolled: RollOutcome): Promise<void> {
    const seat = this.loop.seatOf(who.key);
    // A test's walk (Get star, Go to a space) throws nothing: it goes exactly where it was asked.
    if (!seat || rolled.faces.length === 0) return;
    const turn = this.loop.turnState;
    const forced = forcedDie(seat);
    if (forced !== undefined && rolled.die.id === forced) {
      if (forced === CURSED_DIE && seat.effects.cursedDie) seat.effects.cursedDie = false;
      else seat.effects.slow = false;
    } else if (rolled.die.id !== STANDARD_DIE) take(seat.hands, { kind: "die", id: rolled.die.id });
    if (turn?.key === who.key && turn.boost) {
      const extra = rollDie(STANDARD, this.host.random).move;
      const added = turn.boost === "golden" ? extra * 2 : extra;
      rolled.move += added;
      this.host.title(`${rolled.move}`, line(turn.boost === "golden" ? "items.golden-totem.extra" : "items.totem.extra", { player: who.name, roll: extra, count: added, total: rolled.move }));
      await this.host.scope.wait(30);
    }
    if (seat.effects.halved) {
      seat.effects.halved = false;
      rolled.move = Math.ceil(rolled.move / 2);
      await this.host.say("dice.halved", { player: who.name, roll: rolled.move }, false, who);
    }
    this.host.changed();
  }

  /**
   * The Cursed Die, picked to roll from their own hands: roll it, or make a rival roll it instead (it
   * leaves their hands and is the rival's next roll). True when they handed it on.
   */
  async offerCursedDie(who: Who): Promise<boolean> {
    const seat = this.loop.seatOf(who.key);
    if (!seat || !seat.hands.dice.includes(CURSED_DIE) || forcedDie(seat) !== undefined) return false;
    const picked = await this.host.talk("dice.cursed.ask", { player: who.name }, { to: who, buttons: [button("dice.cursed.self"), button("dice.cursed.give")], back: 0, botPick: 1 });
    if (picked !== 1) return false;
    const rival = await this.pickRival(who, "items.pick", { player: who.name, item: dieOf(CURSED_DIE).name }, this.rivals(who), (candidates) => this.best(candidates));
    const theirs = rival ? this.loop.seatOf(rival.key) : undefined;
    if (!rival || !theirs) return false;
    take(seat.hands, { kind: "die", id: CURSED_DIE });
    theirs.effects.cursedDie = true;
    this.host.changed();
    await this.host.say("dice.cursed.given", { player: who.name, other: rival.name }, false, who);
    return true;
  }

  // ---- Prizes ---------------------------------------------------------------------------------

  /**
   * `who` gets `prize` (an Item space, Lucky Draw, a Happening): the Warden takes it while they're
   * Silenced; with full hands they pick what to drop (or keep what they have). True when they kept it.
   */
  async give(who: Who, prize: Prize): Promise<boolean> {
    const seat = this.loop.seatOf(who.key);
    if (!seat) return false;
    const name = prizeName(prize);
    if (seat.effects.silenced) {
      seat.effects.silenced = false;
      await this.host.say("warden.takes", { player: who.name, item: name }, false, who);
      return false;
    }
    return this.receive(who, seat, prize);
  }

  /** Puts `prize` in a seat's hands; with no room, they pick one of the same kind to drop, or keep what they have. */
  async receive(who: Who, seat: Seat, prize: Prize): Promise<boolean> {
    const name = prizeName(prize);
    if (put(seat.hands, prize)) {
      this.host.changed();
      return true;
    }
    const same = held(seat.hands).filter((other) => other.kind === prize.kind);
    // A bot drops its least worth, unless what came is worth less still.
    let botPick = same.length;
    const worth = (other: Prize) => sellPrice(other);
    same.forEach((other, i) => {
      if (worth(other) < worth(prize) && (botPick === same.length || worth(other) < worth(same[botPick]))) botPick = i;
    });
    const picked = await this.host.talk(prize.kind === "item" ? "items.full" : "dice.full", { player: who.name, item: name, die: name }, {
      to: who,
      buttons: [...same.map((other) => button("items.drop", { item: prizeName(other) })), button("items.keep", { item: name })],
      back: same.length,
      botPick,
    });
    if (picked === undefined || picked >= same.length) {
      this.host.everyone(line("items.kept", { player: who.name, item: name }));
      return false;
    }
    take(seat.hands, same[picked]);
    put(seat.hands, prize);
    this.host.everyone(line("items.dropped", { player: who.name, item: prizeName(same[picked]), other: name }));
    this.host.changed();
    return true;
  }

  // ---- Bots -----------------------------------------------------------------------------------

  /**
   * A bot's turn, before its roll: sometimes it uses an item, the one that suits it best (its zombie
   * sent away first; a rival item on the leader when it isn't the leader; a totem), each after a
   * moment's thought; and it may hand the leader its Cursed Die.
   */
  async botTurn(who: Who): Promise<void> {
    const seat = this.loop.seatOf(who.key);
    if (!seat || who.player) return;
    const leader = this.loop.ends().leader;
    const leading = leader?.key === who.key;
    if (seat.hands.dice.includes(CURSED_DIE) && !leading && this.host.random() < 0.5) {
      await this.host.scope.wait(20);
      await this.offerCursedDie(who);
    }
    if (seat.hands.items.length === 0 || this.host.random() > 0.6) return;
    const items = seat.hands.items;
    const order: ItemId[] = [
      ...(seat.effects.zombie > 0 ? (["iron_golem", "lightning"] as const) : []),
      ...(leading ? [] : (["lightning", "zombie", "cursed_totem", "glove"] as const)),
      "golden_totem",
      "stone_totem",
      "iron_golem",
      ...(leading ? [] : (["ender_pearl"] as const)),
    ];
    const pick = order.find((id) => items.includes(id));
    if (!pick) return;
    await this.host.scope.wait(20);
    await this.loop.useItem(who, pick);
  }
}
