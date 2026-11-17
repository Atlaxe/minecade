// Block Party's board loop (docs/plans/block-party.md, "Core loop"; passes 4 and 5 of "Suggested
// order"):
//   1. Everyone gets their starting coins (10; 30 while Block Party is a test game or a server plays
//      it alone, so Stars can be tried without a long game; Chris hands them out in pass 6), and the
//      Stars go to the board's opening spots (two in a 10-turn game, else one).
//   2. Turn order: everyone rolls at once (their dice open, a jump each), highest first.
//   3. Each round, each in turn opens their dice, rolls by jumping, and their piece walks the number:
//      at a branch they pick the way (a form), and passing or landing on a Star they're offered it
//      for its price (15, 20 or 25 coins by the game's length), after which it moves to a candidate
//      far away. Landing: Blue +3 coins, Red -3 (never below 0), Versus a duel with a player the
//      lander picks (the loser pays the winner 5 coins); the other types say what they'll do, as their
//      passes come.
//   4. After everyone has moved, a minigame (minigame-rules.ts picks the format and the minigame,
//      minigame-runner.ts plays it), and its coins are paid; coins awarded and duel stakes double in
//      the last 2 rounds (the last one in a 10-turn game).
//   5. After the last round, most Stars wins, then coins; a tie still standing goes to chance (the
//      Allay picks, pass 8).
// Seats are players and bots (bots.ts): the game asks each the same things, a player through the
// dice and forms, a bot by thinking a moment and picking. A player who isn't there when their turn
// comes is skipped and keeps their place. Someone new comes in at the start of the next round, at
// Start, last in the turn order, with as many coins as last place and no Stars. No timers: the game
// waits for each roll and choice. Everything it says is a line from dialogue.json (lines.ts).
import { world, type Player } from "@minecraft/server";
import { describeError, log, type Result, type Scope } from "@minecade/minigame-core";
import { BLOCK_PARTY_BOARD } from "@minecade/minigame-core/config";
import type { Space } from "./board.ts";
import { activeStars, addCoins, coinsFor, count, firstStars, leaders, nextStar, ranked, starDistance, starPrice, turnOrder, type Standing } from "./board-rules.ts";
import type { Who } from "./bots.ts";
import { line } from "./lines.ts";
import { VERSUS_STAKE, battleBets, ffaCoins, firstDoubled, formatFor, isDoubled, kindOf, pairingKey, pickMinigame, pickPairs, pickSolo, splitPot, teamCoins, type Format } from "./minigame-rules.ts";
import type { Settle } from "./minigame-runner.ts";
import type { MinigameDef, Outcome } from "./minigames/kit.ts";
import type { Pieces } from "./pieces.ts";

export interface LoopHost {
  scope: Scope;
  spaces(): readonly Space[];
  pieces: Pieces;
  /** The game's length in rounds (the lobby's Length option). */
  turns: number;
  startCoins: number;
  /** Everyone here now: the players online, and the bots. */
  present(): Who[];
  /** Opens their dice and resolves with what they roll (undefined if they leave first); `shot`: everyone watches through the roll camera. */
  roll(who: Who, shot: boolean): Promise<number | undefined>;
  /** A choice: a player's form (closed: undefined), or a bot's moment of thought and then `botPick`. */
  choose(who: Who, title: string, body: string, options: readonly string[], botPick: number): Promise<number | undefined>;
  minigames: readonly MinigameDef[];
  /** Plays a minigame (minigame-runner.ts) and resolves with its outcome once everyone is back. */
  playMinigame(format: Format, def: MinigameDef, sides: Who[][], pool: readonly MinigameDef[], onlookers: readonly Who[], settle: Settle): Promise<Outcome>;
  everyone(text: string): void;
  tell(who: Who, text: string): void;
  /** A big line on everyone's screen. */
  title(text: string, subtitle?: string): void;
  /** Whose turn, coins or Stars changed: the HUD and the standings follow. */
  changed(): void;
  random(): number;
}

interface Seat {
  name: string;
  coins: number;
  stars: number;
}

/** Ticks between drawings of the Stars' beams. */
const BEAM_TICKS = 10;
const PLACES = ["1st", "2nd", "3rd", "4th"];

export class BoardLoop {
  private readonly seats = new Map<string, Seat>();
  private order: string[] = [];
  private round = 0;
  /** Whose turn it is, by key. */
  private turn: string | undefined;
  /** The spaces the Stars are on, by index. */
  private stars: number[] = [];
  private running = false;
  /** The way a player's next walk takes at each branch (Get star), by key. */
  private readonly steering = new Map<string, number[]>();
  /** How often each minigame, each 1v3 solo and each 2v2 pairing came up, so they rotate. */
  private readonly played = new Map<string, number>();
  private readonly solos = new Map<string, number>();
  private readonly pairings = new Map<string, number>();
  private readonly host: LoopHost;

  constructor(host: LoopHost) {
    this.host = host;
    host.scope.interval(() => this.drawBeams(), BEAM_TICKS);
  }

  /** Whether the loop has started (the board is the game's now). */
  get active(): boolean {
    return this.running;
  }

  /** The HUD's line for a player: the round, whose turn it is, and what they have. */
  hudText(player: Player): string {
    if (!this.running) return "";
    const seat = this.seats.get(player.name.toLowerCase());
    const turn = this.turn ? (this.turn === player.name.toLowerCase() ? "your turn" : `${this.seats.get(this.turn)?.name ?? this.turn}'s turn`) : this.round === 0 ? "rolling for turns" : "everyone's moved";
    const round = this.round === 0 ? "" : `Round ${this.round} of ${this.host.turns}, `;
    return seat ? `${round}${turn}. You: ${count(seat.coins, "coin")}, ${count(seat.stars, "Star")}` : `${round}${turn}`;
  }

  /** The standings for everyone, best first: "1. Alex: 2 Stars, 14 coins". */
  standings(): string[] {
    if (!this.running) return [];
    return ranked([...this.seats.values()]).map((seat, index) => `${index + 1}. ${seat.name}: ${count(seat.stars, "Star")}, ${count(seat.coins, "coin")}`);
  }

  /** The way from `from` to the nearest Star ahead, by the links (the spaces after `from`, the Star last), if any. */
  pathToStar(from: number): number[] | undefined {
    const spaces = this.host.spaces();
    const before = new Map<number, number>([[from, -1]]);
    const queue = [from];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const next of spaces[at]?.next ?? []) {
        if (before.has(next)) continue;
        before.set(next, at);
        if (this.stars.includes(next)) {
          const path = [next];
          for (let back = at; back !== from; back = before.get(back)!) path.unshift(back);
          return path;
        }
        queue.push(next);
      }
    }
    return undefined;
  }

  /** The way a player's next walk takes at each branch (the spaces in order). */
  steer(key: string, path: number[]): void {
    this.steering.set(key, path);
  }

  async run(): Promise<Result> {
    this.running = true;
    const spaces = this.host.spaces();
    for (const who of this.host.present()) this.seat(who, this.host.startCoins);
    this.stars = firstStars(spaces, activeStars(this.host.turns), this.host.random);
    this.host.everyone(line("board.start", { coins: count(this.host.startCoins, "coin"), starWhere: this.starsText() }));
    this.host.changed();

    // Turn order: everyone rolls at once.
    this.host.title(line("order.title"), line("order.subtitle"));
    const rolls = await Promise.all(this.host.present().map(async (who) => ({ name: who.key, roll: (await this.host.roll(who, false)) ?? 0 })));
    this.order = turnOrder(rolls);
    this.host.everyone(line("order.result", { order: this.order.map((key) => `${this.seats.get(key)?.name ?? key} (${rolls.find((entry) => entry.name === key)?.roll})`).join(", ") }));

    for (this.round = 1; this.round <= this.host.turns; this.round++) {
      this.seatLateJoiners();
      const doubling = this.round === firstDoubled(this.host.turns);
      this.host.title(line("round.title", { round: this.round, rounds: this.host.turns }), doubling ? line("round.doubled.subtitle") : "");
      if (doubling) this.host.everyone(line("announce.doubled"));
      this.host.changed();
      await this.host.scope.wait(30);
      for (const key of [...this.order]) {
        const who = this.host.present().find((candidate) => candidate.key === key);
        if (!who) {
          this.host.everyone(line("turn.skipped", { player: this.seats.get(key)?.name ?? key }));
          continue;
        }
        try {
          await this.playTurn(who);
        } catch (error) {
          log.warn(`blockparty: ${who.name}'s turn failed: ${describeError(error)}`);
        }
      }
      this.turn = undefined;
      this.host.changed();
      try {
        await this.minigameRound();
      } catch (error) {
        log.warn(`blockparty: round ${this.round}'s minigame failed: ${describeError(error)}`);
        this.host.everyone(`The minigame failed: ${describeError(error)}`);
      }
    }
    this.round = this.host.turns;
    return this.finish();
  }

  /** Someone sits down with `coins` and no Stars, last in the turn order. */
  private seat(who: Who, coins: number): void {
    if (this.seats.has(who.key)) return;
    this.seats.set(who.key, { name: who.name, coins, stars: 0 });
    if (this.order.length > 0 && !this.order.includes(who.key)) this.order.push(who.key);
  }

  /** Anyone new comes in at Start, last in the turn order, with as many coins as last place. */
  private seatLateJoiners(): void {
    const last = Math.min(...[...this.seats.values()].map((seat) => seat.coins), this.host.startCoins);
    for (const who of this.host.present()) {
      if (this.seats.has(who.key)) continue;
      this.seat(who, last);
      this.host.pieces.reset(who.body);
      this.host.everyone(line("join.late", { player: who.name, coins: count(last, "coin") }));
    }
  }

  private async playTurn(who: Who): Promise<void> {
    this.turn = who.key;
    this.host.changed();
    this.host.title(line("turn.title", { player: who.name }), who.player ? line("turn.subtitle") : "");
    const rolled = await this.host.roll(who, true);
    if (rolled === undefined || !who.body.isValid) return;
    this.host.everyone(line("turn.rolled", { player: who.name, roll: rolled }));
    await this.move(who, rolled);
    this.steering.delete(who.key);
    if (!who.body.isValid) return;
    await this.land(who);
    for (const watcher of world.getAllPlayers()) watcher.camera.clear();
    await this.host.scope.wait(20);
  }

  /** Walks the piece `steps` spaces, stopping to pick a way at each branch and at each Star it passes. */
  private async move(who: Who, steps: number): Promise<void> {
    const spaces = this.host.spaces();
    let left = steps;
    let at = this.host.pieces.spaceOf(who.body);
    while (left > 0 && who.body.isValid) {
      const stretch: Space[] = [];
      let here = at;
      while (left > 0) {
        const space = spaces[here];
        if (space.next.length > 1 && stretch.length > 0) break;
        const next = space.next.length > 1 ? await this.choosePath(who, space) : (space.next[0] ?? here);
        here = next;
        stretch.push(spaces[here]);
        left--;
        if (this.stars.includes(here) && left > 0) break;
      }
      if (!who.body.isValid) return;
      await this.host.pieces.walkThrough(who.body, stretch, { land: left === 0, quiet: true });
      at = here;
      if (this.stars.includes(at)) await this.offerStar(who, at);
    }
  }

  /** A branch: the way Get star set, or the player picks (the first when they close the form); a bot heads for the Star. */
  private async choosePath(who: Who, space: Space): Promise<number> {
    const steered = this.steering.get(who.key)?.find((index) => space.next.includes(index));
    if (steered !== undefined) return steered;
    const spaces = this.host.spaces();
    const toStar = this.pathToStar(space.index);
    const botPick = Math.max(0, toStar ? space.next.indexOf(toStar[0]) : Math.floor(this.host.random() * space.next.length));
    const options = space.next.map((next) => {
      const way = { space: this.spaceName(spaces[next]), type: this.typeName(spaces[next].type) };
      return this.stars.includes(next) ? line("branch.button.star", way) : line("branch.button", way);
    });
    const picked = await this.host.choose(who, line("branch.title"), "", options, botPick);
    const next = space.next[picked ?? 0] ?? space.next[0];
    if (!who.player) this.host.everyone(line("branch.bot", { player: who.name, space: this.spaceName(spaces[next]) }));
    return next;
  }

  /** Passing or landing on a Star: buy it for its price, if they have the coins and want it (a bot always does). */
  private async offerStar(who: Who, at: number): Promise<void> {
    const seat = this.seats.get(who.key);
    if (!seat) return;
    const price = starPrice(this.host.turns);
    const money = { player: who.name, price: count(price, "coin"), coins: count(seat.coins, "coin") };
    if (seat.coins < price) {
      if (who.player) this.host.tell(who, line("star.short", money));
      else this.host.everyone(line("star.short.bot", money));
      return;
    }
    const picked = await this.host.choose(who, line("star.form.title"), line("star.form.body", money), [line("star.form.buy"), line("star.form.skip")], 0);
    if (picked !== 0) return;
    seat.coins -= price;
    seat.stars++;
    const spaces = this.host.spaces();
    const index = this.stars.indexOf(at);
    const moved = nextStar(spaces, at, this.stars.filter((star) => star !== at), starDistance(spaces.length), this.host.random);
    if (index >= 0) this.stars[index] = moved;
    this.host.title(line("star.bought.title", { player: who.name }), line("star.bought.subtitle", { space: this.spaceName(spaces[moved]) }));
    this.host.everyone(line("star.bought", { player: who.name, price: count(price, "coin"), starWhere: this.starsText() }));
    this.host.changed();
  }

  /** Landing: the space's effect. */
  private async land(who: Who): Promise<void> {
    const seat = this.seats.get(who.key);
    const space = this.host.spaces()[this.host.pieces.spaceOf(who.body)];
    if (!seat || !space) return;
    const change = coinsFor(space.type);
    if (space.type === "versus") {
      await this.versus(who);
    } else {
      // Blue and Red pay; the other types say what they'll do, as their passes come.
      if (change !== 0) seat.coins = addCoins(seat.coins, change);
      this.host.everyone(line(`land.${space.type}`, { player: who.name, coins: count(Math.abs(change), "coin") }));
    }
    this.host.changed();
  }

  /** A Versus space: the lander picks who to duel (a bot picks the leader), and the loser pays the winner. */
  private async versus(who: Who): Promise<void> {
    const others = this.host.present().filter((other) => other.key !== who.key && this.seats.has(other.key));
    if (others.length === 0) {
      this.host.everyone(line("versus.nobody", { player: who.name }));
      return;
    }
    const doubled = isDoubled(this.round, this.host.turns);
    const stake = VERSUS_STAKE * (doubled ? 2 : 1);
    const leader = others.reduce((best, other) => ((this.seats.get(other.key)?.coins ?? 0) > (this.seats.get(best.key)?.coins ?? 0) ? other : best), others[0]);
    const picked = await this.host.choose(
      who,
      line("versus.form.title"),
      line("versus.form.body", { coins: count(stake, "coin") }),
      others.map((other) => line("versus.form.button", { player: other.name, coins: count(this.seats.get(other.key)?.coins ?? 0, "coin") })),
      others.indexOf(leader),
    );
    const rival = others[picked ?? 0];
    const pool = this.host.minigames.filter((minigame) => minigame.kind === "ffa");
    const def = pickMinigame(pool, this.played, this.host.random);
    if (!def) return;
    this.played.set(def.id, (this.played.get(def.id) ?? 0) + 1);
    const duel = { player: who.name, other: rival.name, coins: count(stake, "coin") };
    this.host.everyone(doubled ? line("versus.start.doubled", duel) : line("versus.start", duel));
    const onlookers = this.host.present().filter((other) => other.key !== who.key && other.key !== rival.key);
    await this.host.playMinigame("duel", def, [[who], [rival]], pool, onlookers, (outcome) => {
      const winners = "places" in outcome ? (outcome.places[0] ?? []) : [];
      if (winners.length !== 1) return { title: line("versus.draw.title"), subtitle: line("versus.draw.subtitle") };
      const winner = winners[0] === who.key ? who : rival;
      const loser = winner === who ? rival : who;
      const loserSeat = this.seats.get(loser.key);
      const winnerSeat = this.seats.get(winner.key);
      const paid = Math.min(stake, loserSeat?.coins ?? 0);
      if (loserSeat) loserSeat.coins -= paid;
      if (winnerSeat) winnerSeat.coins += paid;
      const result = { player: winner.name, other: loser.name, coins: count(paid, "coin") };
      this.host.everyone(line("versus.won", result));
      this.host.changed();
      return { title: line("versus.won.title", result), subtitle: line("versus.won.subtitle", result) };
    });
  }

  /** The round's minigame: its format and sides, the pick, and the coins it pays. */
  private async minigameRound(): Promise<void> {
    const here = this.host.present().filter((who) => this.seats.has(who.key));
    if (here.length === 0) return;
    let format = formatFor(this.round, here.length, this.host.random);
    let pool = this.host.minigames.filter((minigame) => minigame.kind === kindOf(format));
    if (pool.length === 0) {
      format = "ffa";
      pool = this.host.minigames.filter((minigame) => minigame.kind === "ffa");
    }
    const def = pickMinigame(pool, this.played, this.host.random);
    if (!def) return;
    this.played.set(def.id, (this.played.get(def.id) ?? 0) + 1);
    const sides = this.sidesFor(format, here);
    const doubled = isDoubled(this.round, this.host.turns);
    // A Battle's pot: 5 coins from each, capped at what they have.
    let pot = 0;
    if (format === "battle") {
      const bets = battleBets(new Map(here.map((who) => [who.key, this.seats.get(who.key)?.coins ?? 0])));
      for (const [key, bet] of bets) {
        const seat = this.seats.get(key);
        if (seat) seat.coins -= bet;
        pot += bet;
      }
      this.host.everyone(line("minigame.battle.pot", { coins: count(pot, "coin") }));
      this.host.changed();
    }
    await this.host.playMinigame(format, def, sides, pool, [], (outcome) => this.pay(format, def, sides, outcome, doubled, pot));
  }

  /** The sides a format plays in: each alone, the 2v2 pairs, or the 1v3 solo and the rest, rotating so everyone gets a share. */
  private sidesFor(format: Format, here: readonly Who[]): Who[][] {
    const keys = here.map((who) => who.key);
    const byKey = new Map(here.map((who) => [who.key, who]));
    if (format === "2v2" && here.length === 4) {
      const pairs = pickPairs(keys, this.pairings, this.host.random);
      this.pairings.set(pairingKey(pairs), (this.pairings.get(pairingKey(pairs)) ?? 0) + 1);
      return pairs.map((pair) => pair.map((key) => byKey.get(key)!));
    }
    if (format === "1v3") {
      const solo = pickSolo(keys, this.solos, this.host.random);
      this.solos.set(solo, (this.solos.get(solo) ?? 0) + 1);
      return [[byKey.get(solo)!], here.filter((who) => who.key !== solo)];
    }
    return here.map((who) => [who]);
  }

  /** Pays a minigame's coins (doubled late on; a Battle's pot to its winners) and says so. */
  private pay(format: Format, def: MinigameDef, sides: readonly Who[][], outcome: Outcome, doubled: boolean, pot: number): { title: string; subtitle: string } {
    const names = new Map(sides.flat().map((who) => [who.key, who.name]));
    const nameOf = (key: string) => names.get(key) ?? this.seats.get(key)?.name ?? key;
    let coins: Map<string, number>;
    let title: string;
    if ("places" in outcome) {
      const winners = outcome.places[0] ?? [];
      title = winners.length === 0 ? line("minigame.nobody") : this.wonTitle(winners.map(nameOf));
      coins = format === "battle" ? splitPot(pot, winners) : ffaCoins(outcome.places);
      if (format !== "battle") {
        let place = 0;
        const places = outcome.places.map((group) => {
          const entry = `${PLACES[place] ?? `${place + 1}th`}: ${group.map(nameOf).join(", ")}`;
          place += group.length;
          return entry;
        });
        this.host.everyone(line("minigame.places", { minigame: def.name, places: places.join("; ") }));
      }
    } else {
      const team = format === "2v2" ? "2v2" : "1v3";
      const keys = sides.map((side) => side.map((who) => who.key));
      coins = teamCoins(team, keys, outcome.winner);
      title = outcome.winner === undefined ? line("minigame.draw") : this.wonTitle(sides[outcome.winner].map((who) => who.name));
    }
    const factor = doubled && format !== "battle" ? 2 : 1;
    const paid: string[] = [];
    for (const [key, amount] of coins) {
      const seat = this.seats.get(key);
      if (!seat || amount <= 0) continue;
      seat.coins += amount * factor;
      paid.push(`${nameOf(key)} +${amount * factor}`);
    }
    if (paid.length > 0) {
      const list = { paid: paid.join(", ") };
      this.host.everyone(format === "battle" ? line("minigame.pot", list) : factor > 1 ? line("minigame.coins.doubled", list) : line("minigame.coins", list));
    }
    this.host.changed();
    return { title, subtitle: paid.join(", ") };
  }

  /** The results' title: one winner, or several (a team, a tie). */
  private wonTitle(names: readonly string[]): string {
    return names.length === 1 ? line("minigame.won.one", { player: names[0] }) : line("minigame.won.many", { players: names.join(" and ") });
  }

  /** The end: most Stars, then coins; a tie still standing goes to chance. */
  private finish(): Result {
    const standings: Standing[] = [...this.seats.values()];
    const tied = leaders(standings);
    if (tied.length === 0) return { kind: "draw", reason: "nobody played" };
    const winner = tied.length === 1 ? tied[0] : tied[Math.floor(this.host.random() * tied.length)];
    if (tied.length > 1) this.host.everyone(line("end.tie", { players: tied.map((seat) => seat.name).join(" and ") }));
    this.host.title(line("end.title", { player: winner.name }), line("end.subtitle", { stars: count(winner.stars, "Star"), coins: count(winner.coins, "coin") }));
    this.host.everyone(line("end.standings", { standings: this.standings().join("; ") }));
    this.running = false;
    return { kind: "win", players: [winner.name], reason: `${count(winner.stars, "Star")} and ${count(winner.coins, "coin")}` };
  }

  /** A space's name: its id on a map, else its place on the test board. */
  private spaceName(space: Space): string {
    return `space ${space.id ?? space.index + 1}`;
  }

  private typeName(type: string): string {
    return BLOCK_PARTY_BOARD.types.find((candidate) => candidate.id === type)?.name ?? type;
  }

  private starsText(): string {
    const spaces = this.host.spaces();
    const at = this.stars.map((index) => this.spaceName(spaces[index]));
    return at.length === 1 ? line("star.where.one", { space: at[0] }) : line("star.where.two", { space: at[0], space2: at.slice(1).join(" and ") });
  }

  /** A column of light over each Star (the plan's beacon beam is a model, pass 6). */
  private drawBeams(): void {
    if (!this.running) return;
    const spaces = this.host.spaces();
    const dimension = world.getDimension("overworld");
    for (const index of this.stars) {
      const space = spaces[index];
      if (!space) continue;
      for (let y = 0.5; y <= 8; y += 0.75) {
        try {
          dimension.spawnParticle("minecraft:endrod", { x: space.at[0], y: space.at[1] + y, z: space.at[2] });
        } catch {
          // unloaded
        }
      }
    }
  }
}
