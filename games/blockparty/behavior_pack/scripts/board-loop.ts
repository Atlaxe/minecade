// Block Party's board loop (docs/plans/block-party.md, "Core loop"; passes 4 to 6 of "Suggested
// order"):
//   1. The pre-game (pass 6, block-party-ui.md "Cameras"), in the order of the user's Pre-game flow
//      chart (the dialogue tool), a cutscene everyone can vote to skip: the intro over the board
//      while Chris welcomes everyone, the starting podium (everyone on the pre-game podium facing
//      Chris), Chris asking the first player whether to go over the rules (Yes plays the Tutorial
//      scene), how long the game is, and the call to roll.
//   2. Turn order: everyone turns to the camera and rolls at once (their dice open, a jump each),
//      highest first. Then the reveal: the camera goes to each player in turn order as Chris
//      calls their place ("First, {player}."), Chris hands out the starting coins (10; 30 while
//      Block Party is a test game or a server plays it alone, so Stars can be tried without a long
//      game), and the camera goes to each Star's space (two in a 10-turn game, else one, on the
//      board's opening spots) as a Chris drops in beside it. Then everyone is on Start.
//   3. Each round, each in turn opens their dice, rolls by jumping, the faces they threw do what the
//      dice file says (dice.ts: coins, an event, a line), and their piece walks the number:
//      at a branch they pick the way (a form), and passing or landing on a Star, Chris (beside it)
//      offers it for its price (15, 20 or 25 coins by the game's length) in the dialogue box, after
//      which it moves to a candidate far away and a Chris drops in there. Before the roll they may use
//      one item (item-play.ts), and a zombie on them takes its coins. Landing: Blue +3 coins, Red -3
//      (never below 0), Versus a duel with a player the lander picks from the Referee's buttons (the
//      loser pays the winner 5 coins, onlookers bet on it), and Item, Shop, Chance Time, Warden and
//      Happening as space-play.ts plays them; the Wandering Trader stops a walk like a Star. Chris
//      says when the game is halfway, when coins start doubling and when the last round starts.
//   4. After everyone has moved, a minigame (minigame-rules.ts picks the format and the minigame,
//      minigame-runner.ts plays it), and its coins are paid; coins awarded and duel stakes double in
//      the last 2 rounds (the last one in a 10-turn game).
//   5. After the last round, most Stars wins, then coins; a tie still standing goes to chance (the
//      Allay picks, pass 8).
// Seats are players and bots (bots.ts): the game asks each the same things, a player through the
// dice, the dialogue box's buttons and forms, a bot by thinking a moment and picking. A player who isn't there when their turn
// comes is skipped and keeps their place. Someone new comes in at the start of the next round, at
// Start, last in the turn order, with as many coins as last place and no Stars. No timers: the game
// waits for each roll and choice. Everything it says is a line from dialogue.json (lines.ts).
import { world } from "@minecraft/server";
import { describeError, log, type Result, type Scope } from "@minecade/minigame-core";
import { BLOCK_PARTY_BOARD } from "@minecade/minigame-core/config";
import { back, type Space } from "./board.ts";
import { ITEMS, type Holdings, type ItemId } from "./dice-items.ts";
import { ItemPlay } from "./item-play.ts";
import { SpacePlay } from "./space-play.ts";
import { mayUseItem, newSeat, turnDice, type Seat, type TurnState } from "./seats.ts";
import { BETS, GLOVE_STAKE, betResult, trailOf, type Hands } from "./space-rules.ts";
import type { TalkOptions } from "./dialogue.ts";
import type { Stage } from "./stage.ts";
import { activeStars, addCoins, coinsFor, count, firstStars, leaders, nextStar, ranked, starDistance, starPrice, turnOrder, type Standing } from "./board-rules.ts";
import type { Who } from "./bots.ts";
import { thrown, type DieFace, type RollOutcome } from "./dice.ts";
import { button, line, type Fills } from "./lines.ts";
import { VERSUS_STAKE, battleBets, ffaCoins, firstDoubled, fits, formatFor, isDoubled, kindOf, pairingKey, pickMinigame, pickPairs, pickSolo, splitPot, teamCoins, type Format } from "./minigame-rules.ts";
import type { Results, Settle } from "./minigame-runner.ts";
import type { MinigameDef, Outcome } from "./minigames/kit.ts";
import type { Pieces } from "./pieces.ts";
import { placesOf, type ResultSeat } from "./results.ts";

export interface LoopHost {
  scope: Scope;
  spaces(): readonly Space[];
  pieces: Pieces;
  /** The game's length in rounds (the lobby's Length option). */
  turns: number;
  startCoins: number;
  /** Everyone here now: the players online, and the bots. */
  present(): Who[];
  /** The party leader's key (the player who started the game, or who stands in for them), if a player is here. */
  leader(): string | undefined;
  /** Opens their dice and resolves with what they roll (undefined if they leave first); `shot`: everyone watches through the roll camera. */
  roll(who: Who, shot: boolean): Promise<RollOutcome | undefined>;
  /** A choice: a player's form (closed: undefined), or a bot's moment of thought and then `botPick`. */
  choose(who: Who, title: string, body: string, options: readonly string[], botPick: number): Promise<number | undefined>;
  /**
   * A line said to everyone in the dialogue box (dialogue.ts); a skippable one can be voted away.
   * `by`: the player whose turn brought it (a Star, Versus, an NPC's space), who goes on from it;
   * without it (the global cutscenes), or for a bot, the party leader does.
   */
  say(id: string, fills?: Fills, skippable?: boolean, by?: Who): Promise<void>;
  /** A line said to one seat in the dialogue box, with buttons (Next when none): resolves with their pick. */
  talk(id: string, fills: Fills, options: TalkOptions): Promise<number | undefined>;
  /** A stretch everyone can vote to skip (dialogue.ts, cutscene). */
  cutscene<T>(skippable: boolean, work: () => Promise<T>): Promise<T>;
  /** The NPCs and the shots (stage.ts). */
  stage: Stage;
  minigames: readonly MinigameDef[];
  /** Plays a minigame (minigame-runner.ts) and resolves with its outcome once everyone is back. */
  playMinigame(format: Format, def: MinigameDef, sides: Who[][], pool: readonly MinigameDef[], onlookers: readonly Who[], settle: Settle): Promise<Outcome>;
  everyone(text: string): void;
  tell(who: Who, text: string): void;
  /**
   * The game's own words to everyone in the dialogue box with no speaker (the user: no titles or
   * subtitles), the second row under the first when there is one; it stays `ticks` (undefined: until
   * the returned function takes it down, or another notice replaces it).
   */
  notice(text: string, more?: string, ticks?: number): () => void;
  /** Whose turn, coins or Stars changed: the HUD and the cards follow. */
  changed(): void;
  /** The results screen (results.ts) from the standings `before` to `after`; resolves once it's gone. */
  results(before: readonly ResultSeat[], after: readonly ResultSeat[]): Promise<void>;
  /** The zombies that follow seats (zombies.ts): their bodies; how long they stay is the loop's. */
  zombies: { add(key: string): unknown; remove(key: string): void };
  random(): number;
}

/** A seat as its card shows it (block-party-ui.md, "Player cards"), in turn order. */
export interface CardInfo {
  key: string;
  name: string;
  stars: number;
  coins: number;
  /** Their place (ties share one), once the first results have been shown. */
  place?: number;
  turn: boolean;
  /** Revealed yet: the turn order reveal shows the cards one by one. */
  shown: boolean;
}

/** A test's jump (the Tests menu): to a round, straight to its minigame or not, or a minigame played next. */
export type TestJump = { kind: "round"; round: number; minigameOnly: boolean } | { kind: "minigame"; format: Format; def: MinigameDef };

/** Ticks between drawings of the Stars' beams. */
const BEAM_TICKS = 10;
const PLACES = ["1st", "2nd", "3rd", "4th"];
/** Ticks a round's notice stays (the round waits as long before going on), and a Star's or the end's. */
const ROUND_NOTICE = 40;
const STAR_NOTICE = 40;
const END_NOTICE = 100;

export class BoardLoop {
  private readonly seats = new Map<string, Seat>();
  private order: string[] = [];
  private round = 0;
  /** Whose turn it is, by key, and whose was last. */
  private turn: string | undefined;
  private lastTurn: string | undefined;
  /** The spaces the Stars are on, by index. */
  private stars: number[] = [];
  private running = false;
  /** The way a player's next walk takes at each branch (Get star), by key. */
  private readonly steering = new Map<string, number[]>();
  /** How often each minigame, each 1v3 solo and each 2v2 pairing came up, so they rotate. */
  private readonly played = new Map<string, number>();
  private readonly solos = new Map<string, number>();
  private readonly pairings = new Map<string, number>();
  /** A test's jump, waiting for the turn going on to end. */
  private jump: TestJump | undefined;
  /** Tests' hold (/blockparty:hold): the seat whose turns come round again and again, the game going no further. */
  private holder: string | undefined;
  /** What the holder's hands go back to before and after each held turn, by key (a held turn going on keeps its own after the hold moves). */
  private readonly heldHands = new Map<string, Hands>();
  /** The seat whose held turn is going on, by key. */
  private heldNow: string | undefined;
  /** The seats whose cards the turn order reveal has shown, by key. */
  private readonly revealed = new Set<string>();
  /** Places show on the cards once the first results have been shown. */
  private placesKnown = false;
  /** A die's face said the next minigame pays double (the dice file's double_minigame). */
  private doubleNext = false;
  /** Chance Time's Battle Royale: the round's minigame is a Battle. */
  private battleNext = false;
  /** The turn going on: an item used, a totem's die, a bonus roll. */
  private turnNow: TurnState | undefined;
  /** Seats the turn's scene is about besides the player whose turn it is (they don't fade: fade.ts). */
  private readonly featuring = new Set<string>();
  private readonly host: LoopHost;
  /** The items in play, and the spaces past Blue, Red and Versus (pass 7). */
  readonly items: ItemPlay;
  readonly spacePlay: SpacePlay;

  constructor(host: LoopHost) {
    this.host = host;
    this.items = new ItemPlay(this, host);
    this.spacePlay = new SpacePlay(this, host, this.items);
    host.scope.interval(() => this.drawBeams(), BEAM_TICKS);
  }

  // ---- What the items and spaces use (item-play.ts, space-play.ts) ----------------------------

  /** A seat by key. */
  seatOf(key: string): Seat | undefined {
    return this.seats.get(key);
  }

  /** The turn going on, if any. */
  get turnState(): TurnState | undefined {
    return this.turnNow;
  }

  /** The seats the turn's scene is about (a rival an item picked, Chance Time's leader): they stay in sight. */
  get featured(): string[] {
    return [...this.featuring];
  }

  /** Keeps `seats` in sight for the rest of the scene (until unfeature). */
  feature(...seats: (Who | undefined)[]): void {
    for (const who of seats) if (who) this.featuring.add(who.key);
  }

  unfeature(): void {
    this.featuring.clear();
  }

  /** The seats here and on the board now (bodies there, not off in a minigame), in turn order. */
  here(): Who[] {
    const present = this.host.present().filter((who) => this.seats.has(who.key) && who.body.isValid && !this.host.pieces.isOff(who.body));
    const at = (who: Who) => {
      const index = this.order.indexOf(who.key);
      return index < 0 ? this.order.length : index;
    };
    return present.sort((a, b) => at(a) - at(b));
  }

  /** The turn order, by key. */
  turnOrder(): readonly string[] {
    return this.order;
  }

  /** Among those here: the leader (most Stars, then coins), last place, and whether everyone is level. */
  ends(): { leader?: Who; last?: Who; level: boolean } {
    const here = this.here();
    const best = ranked(here.map((who) => ({ name: who.key, stars: this.seats.get(who.key)?.stars ?? 0, coins: this.seats.get(who.key)?.coins ?? 0 })));
    if (best.length === 0) return { level: true };
    const top = best[0];
    const bottom = best[best.length - 1];
    const level = top.stars === bottom.stars && top.coins === bottom.coins;
    return { leader: here.find((who) => who.key === top.name), last: here.find((who) => who.key === bottom.name), level };
  }

  /** How far behind a seat stands among those here: 0 for the leader, 1 for last place (ties share the better place). */
  trailOf(key: string): number {
    const here = this.here();
    const best = ranked(here.map((who) => ({ name: who.key, stars: this.seats.get(who.key)?.stars ?? 0, coins: this.seats.get(who.key)?.coins ?? 0 })));
    const mine = best.find((entry) => entry.name === key);
    if (!mine) return 0.5;
    const place = best.findIndex((entry) => entry.stars === mine.stars && entry.coins === mine.coins);
    return trailOf(place, best.length);
  }

  /** The space a seat's piece is on. */
  spaceOf(who: Who): Space | undefined {
    return this.host.spaces()[this.host.pieces.spaceOf(who.body)];
  }

  /** The spaces the Stars are on. */
  starSpaces(): readonly number[] {
    return this.stars;
  }

  /** Coins from one seat to another, at most `amount` and never more than the payer has: what was paid. */
  pay(from: string, to: string, amount: number): number {
    const payer = this.seats.get(from);
    const payee = this.seats.get(to);
    if (!payer || !payee || from === to) return 0;
    const paid = Math.min(amount, payer.coins);
    payer.coins -= paid;
    payee.coins += paid;
    this.host.changed();
    return paid;
  }

  /** What a seat holds as the board menu shows it: the dice it may roll now, its items, and whether Items is spent this turn. */
  holdingsOf(who: Who): Holdings {
    const seat = this.seats.get(who.key);
    if (!seat) return { dice: turnDice(newSeat(who.name, 0), undefined), items: [] };
    const turn = this.turnNow?.key === who.key ? this.turnNow : undefined;
    return { dice: turnDice(seat, turn), items: [...seat.hands.items], ...(mayUseItem(turn) ? {} : { spent: true }) };
  }

  /** The item letters a seat's card shows. */
  itemLetters(key: string): string[] {
    return (this.seats.get(key)?.hands.items ?? []).map((id) => ITEMS[id].letters);
  }

  /** Tests: sets what a seat holds (special dice and items). */
  setHands(key: string, dice: readonly string[], items: readonly ItemId[]): boolean {
    const seat = this.seats.get(key);
    if (!seat) return false;
    seat.hands = { dice: [...dice], items: [...items] };
    // While held, the hands set are the ones every held turn starts and ends with.
    if (this.heldHands.has(key)) this.heldHands.set(key, copyHands(seat.hands));
    this.host.changed();
    return true;
  }

  /** Who holds the game (Tests), by key, if anybody. */
  get heldBy(): string | undefined {
    return this.holder;
  }

  /**
   * Tests' hold (the user asked, to try dice and items): once the turn or minigame going on ends,
   * every turn is `key`'s, and their dice and items are back as they are now before and after each
   * one, so nothing they roll or use is used up; no other seat's turn, no round's end, no minigame.
   * Undefined lets the game go on from where it stopped. False when `key` isn't seated.
   */
  hold(key: string | undefined): boolean {
    const seat = key === undefined ? undefined : this.seats.get(key);
    if (key !== undefined && !seat) return false;
    this.holder = key;
    for (const held of [...this.heldHands.keys()]) if (held !== this.heldNow) this.heldHands.delete(held);
    if (key !== undefined && seat) this.heldHands.set(key, copyHands(seat.hands));
    return true;
  }

  /** A seat uses an item on its turn (the item panel's jump): resolves once it's done, true if it was used. */
  async useItem(who: Who, id: ItemId): Promise<boolean> {
    try {
      return await this.items.use(who, id);
    } catch (error) {
      log.warn(`blockparty: ${who.name}'s ${id} failed: ${describeError(error)}`);
      return false;
    } finally {
      this.unfeature();
      this.host.stage.clear();
      this.host.changed();
    }
  }

  /** Two seats' pieces swap spaces (an Ender Pearl). */
  swap(a: Who, b: Who): void {
    const at = this.host.pieces.spaceOf(a.body);
    this.host.pieces.moveTo(a.body, this.host.pieces.spaceOf(b.body));
    this.host.pieces.moveTo(b.body, at);
  }

  /** Everyone's spaces dealt out again at random, each to someone else's when that can be (the Mystery Die, Position Shuffle). */
  shuffle(here: readonly Who[]): void {
    const at = here.map((other) => this.host.pieces.spaceOf(other.body));
    const dealt = [...at];
    for (let i = dealt.length - 1; i > 0; i--) {
      const j = Math.floor(this.host.random() * (i + 1));
      [dealt[i], dealt[j]] = [dealt[j], dealt[i]];
    }
    if (dealt.length > 1 && dealt.every((space, i) => space === at[i])) dealt.push(dealt.shift()!);
    here.forEach((other, i) => this.host.pieces.moveTo(other.body, dealt[i]));
  }

  /** The round's minigame is a Battle (Chance Time's Battle Royale). */
  forceBattle(): void {
    this.battleNext = true;
  }

  /** Walks a seat forward (a Happening): branches and Stars on the way as any walk, no landing. */
  async walk(who: Who, steps: number): Promise<void> {
    await this.move(who, steps);
  }

  /** Walks a seat back the way the links came (a Happening), no landing. */
  async walkBack(who: Who, steps: number): Promise<void> {
    const spaces = this.host.spaces();
    const stretch: Space[] = [];
    let at = this.host.pieces.spaceOf(who.body);
    for (let i = 0; i < steps; i++) {
      const before = back(spaces, at, 1);
      if (before === at) break;
      at = before;
      stretch.push(spaces[at]);
    }
    if (stretch.length === 0) return;
    this.host.stage.clear();
    await this.host.pieces.walkThrough(who.body, stretch, { land: true, quiet: true });
  }

  /** A bonus roll now (a Happening's Roll again): the standard die, the walk, and the space it lands on. */
  async bonusRoll(who: Who): Promise<void> {
    if (this.turnNow?.key === who.key) this.turnNow.bonus = true;
    this.host.stage.clear();
    const rolled = await this.host.roll(who, true);
    if (rolled === undefined || !who.body.isValid) return;
    this.host.everyone(line("turn.rolled", { player: who.name, roll: rolled.move }));
    await this.move(who, rolled.move);
    if (!who.body.isValid) return;
    await this.land(who);
  }

  /** Whose turn it is now (by key), if anybody's. */
  get whoseTurn(): string | undefined {
    return this.turn;
  }

  /** Whose turn it is now, or was last (by key); the first in the order before any turn. */
  get focus(): string | undefined {
    return this.turn ?? this.lastTurn ?? this.order[0];
  }

  /** Whether the loop has started (the board is the game's now). */
  get active(): boolean {
    return this.running;
  }

  /**
   * The player cards, in turn order (none before the order is rolled): each seat's Stars, coins,
   * place, whether it's their turn, and whether their card has been revealed yet.
   */
  cards(): CardInfo[] {
    if (!this.running) return [];
    const seats = this.order.flatMap((key) => {
      const seat = this.seats.get(key);
      return seat ? [{ key, ...seat }] : [];
    });
    const places = placesOf(seats);
    return seats.map((seat, i) => ({
      key: seat.key,
      name: seat.name,
      stars: seat.stars,
      coins: seat.coins,
      ...(this.placesKnown ? { place: places[i] } : {}),
      turn: this.turn === seat.key,
      shown: this.revealed.has(seat.key),
    }));
  }

  /** Every seat's standing now, for the results screen. */
  snapshot(): ResultSeat[] {
    return this.order.flatMap((key) => {
      const seat = this.seats.get(key);
      return seat ? [{ key, name: seat.name, stars: seat.stars, coins: seat.coins }] : [];
    });
  }

  /** The results screen from `before` to now; places show on the cards from then on. */
  async showResults(before: readonly ResultSeat[]): Promise<void> {
    this.placesKnown = true;
    this.host.changed();
    try {
      await this.host.results(before, this.snapshot());
    } catch (error) {
      log.warn(`blockparty: the results screen failed: ${describeError(error)}`);
    }
  }

  /** The standings for everyone, best first: "1. Alex: 2 Stars, 14 coins". */
  standings(): string[] {
    if (!this.running) return [];
    return ranked([...this.seats.values()]).map((seat, index) => `${index + 1}. ${seat.name}: ${count(seat.stars, "Star")}, ${count(seat.coins, "coin")}`);
  }

  /** The way from `from` to the nearest Star ahead, by the links (the spaces after `from`, the Star last), if any. */
  pathToStar(from: number): number[] | undefined {
    return this.pathTo(from, (index) => this.stars.includes(index));
  }

  /** The way from `from` to the nearest space ahead that `wanted` picks (the spaces after `from`, that one last), if any. */
  pathTo(from: number, wanted: (index: number, space: Space) => boolean): number[] | undefined {
    const spaces = this.host.spaces();
    const before = new Map<number, number>([[from, -1]]);
    const queue = [from];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const next of spaces[at]?.next ?? []) {
        if (before.has(next)) continue;
        before.set(next, at);
        if (spaces[next] && wanted(next, spaces[next])) {
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

  /** The round now (0 while rolling for turn order) and the game's length. */
  get rounds(): { now: number; of: number } {
    return { now: this.round, of: this.host.turns };
  }

  /** How many are seated and here: what a test minigame's format has to fit. */
  get seated(): number {
    return this.host.present().filter((who) => this.seats.has(who.key)).length;
  }

  /**
   * Tests (the user asked, to try late rounds without playing up to them): jumps to a round (straight
   * to its minigame, or its turns first), or plays a minigame next. It happens when the turn going on
   * ends; a player's roll that's waiting is called off by the caller, and that turn is played again
   * after a test minigame.
   */
  testJump(jump: TestJump): void {
    this.jump = jump;
  }

  async run(): Promise<Result> {
    this.running = true;
    const spaces = this.host.spaces();
    for (const who of this.host.present()) this.seat(who, this.host.startCoins);
    this.stars = firstStars(spaces, activeStars(this.host.turns), this.host.random);
    this.host.changed();
    await this.pregame();

    let next = 1;
    /** False for a round a test jumped straight to the minigame of. */
    let withTurns = true;
    while (next <= this.host.turns) {
      this.round = next;
      this.seatLateJoiners();
      const doubling = this.round === firstDoubled(this.host.turns);
      // The round's notice; under it, coins doubling from now on, and the final round.
      const more = [doubling ? line("round.doubled.subtitle") : "", this.round === this.host.turns ? line("announce.final.title") : ""].filter((text) => text !== "").join("\n");
      this.host.notice(line("round.title", { round: this.round, rounds: this.host.turns }), more, ROUND_NOTICE);
      if (doubling) this.host.everyone(line("announce.doubled"));
      this.host.changed();
      await this.host.scope.wait(ROUND_NOTICE);
      await this.announce(doubling);
      try {
        await this.spacePlay.roundStart();
      } catch (error) {
        log.warn(`blockparty: round ${this.round}'s start failed: ${describeError(error)}`);
      }
      let jumped: { round: number; minigameOnly: boolean } | undefined = withTurns ? undefined : await this.takeJump();
      for (let i = 0; withTurns && i < this.order.length; i++) {
        // While held (Tests), the holder's turns here, over and over; let go, the game goes on from this seat.
        jumped = (await this.takeJump()) ?? (await this.heldTurns());
        if (jumped) break;
        const key = this.order[i];
        const who = this.host.present().find((candidate) => candidate.key === key);
        if (!who) {
          this.host.everyone(line("turn.skipped", { player: this.seats.get(key)?.name ?? key }));
          continue;
        }
        try {
          // A turn called off for a test minigame is played again after it.
          if (await this.playTurn(who)) i--;
        } catch (error) {
          log.warn(`blockparty: ${who.name}'s turn failed: ${describeError(error)}`);
        }
      }
      // Held during the round's last turn: the hold comes before the round's end and its minigame.
      if (withTurns && !jumped) jumped = await this.heldTurns();
      this.turn = undefined;
      this.turnNow = undefined;
      this.host.changed();
      try {
        await this.spacePlay.roundEnd();
      } catch (error) {
        log.warn(`blockparty: round ${this.round}'s end failed: ${describeError(error)}`);
      }
      jumped ??= await this.takeJump();
      if (jumped) {
        this.host.everyone(`Test: on to round ${jumped.round}${jumped.minigameOnly ? ", straight to its minigame" : ""}.`);
        next = jumped.round;
        withTurns = !jumped.minigameOnly;
        continue;
      }
      try {
        await this.minigameRound();
      } catch (error) {
        log.warn(`blockparty: round ${this.round}'s minigame failed: ${describeError(error)}`);
        this.host.everyone(`The minigame failed: ${describeError(error)}`);
      }
      next++;
      withTurns = true;
    }
    this.round = this.host.turns;
    return this.finish();
  }

  /**
   * The pre-game (block-party-ui.md, "Cameras"; the user's Pre-game flow chart): the intro, the
   * podium and Chris's rules question (a cutscene everyone can vote to skip), the order roll (never
   * skipped: everyone jumps), then the reveal of the order, the starting coins and the Stars
   * (skippable too). Skipped or not, everyone ends up on Start, and every Star has its Chris.
   */
  private async pregame(): Promise<void> {
    const { stage } = this.host;
    const spaces = this.host.spaces();
    const seats = this.host.present();
    await stage.loadBoard();
    await this.host.cutscene(true, async () => {
      await Promise.all([stage.intro(), this.host.say("pregame.welcome")]);
      await stage.podium(seats);
      if (await this.wantsRules(seats)) await this.tutorial();
      await this.host.say("pregame.length", { rounds: this.host.turns });
      await this.host.say("pregame.order");
    });

    // Turn order: everyone turns to the camera and rolls at once.
    stage.turnToCamera(seats);
    stage.podiumShot();
    const rolls = await Promise.all(seats.map(async (who) => ({ name: who.key, roll: (await this.host.roll(who, false))?.move ?? 0 })));
    this.order = turnOrder(rolls);
    this.host.changed();

    await this.host.cutscene(true, async () => {
      for (let place = 0; place < this.order.length; place++) {
        const seat = seats.findIndex((who) => who.key === this.order[place]);
        const name = this.seats.get(this.order[place])?.name ?? this.order[place];
        if (seat >= 0) await stage.reveal(seat);
        // Their card comes in as they're shown.
        this.revealed.add(this.order[place]);
        this.host.changed();
        await this.host.say(`pregame.place.${place + 1}`, { player: name });
      }
      await this.host.say("pregame.coins", { coins: count(this.host.startCoins, "coin") });
      for (const star of this.stars) {
        await stage.starReveal(spaces[star]);
        await this.host.say("pregame.star", { space: this.spaceName(spaces[star]) });
      }
    });
    // Skipped or not, every card is out by now.
    for (const key of this.order) this.revealed.add(key);
    this.host.changed();
    stage.toBoard(this.host.present());
  }

  /**
   * Chris asks the party leader whether to go over the rules (pregame.rules; the first player on the
   * podium that isn't a bot if the leader isn't seated): Yes plays the tutorial's lines, No (sneak
   * picks it) skips them. Skipping the pre-game skips the question too.
   */
  private async wantsRules(seats: readonly Who[]): Promise<boolean> {
    const leader = this.host.leader();
    const asked = seats.find((who) => who.key === leader) ?? seats.find((who) => who.player !== undefined) ?? seats[0];
    if (!asked) return false;
    const picked = await this.host.talk("pregame.rules", { player: asked.name }, { to: asked, buttons: [button("pregame.rules.yes"), button("pregame.rules.no")], back: 1, botPick: 1 });
    return picked === 0;
  }

  /** Chris's tutorial: the Tutorial scene's lines, in order. */
  private async tutorial(): Promise<void> {
    const price = count(starPrice(this.host.turns), "coin");
    for (const id of ["tutorial.goal", "tutorial.turns", "tutorial.branches", "tutorial.spaces", "tutorial.stars", "tutorial.items", "tutorial.minigames", "tutorial.end"]) {
      await this.host.say(id, { price });
    }
  }

  /** Chris's announcements as a round starts: halfway, coins doubling from now on, the final round. Each can be skipped. */
  private async announce(doubling: boolean): Promise<void> {
    const turns = this.host.turns;
    if (turns >= 4 && this.round === Math.floor(turns / 2) + 1) await this.host.say("announce.halfway", { left: turns - this.round + 1 }, true);
    if (doubling) await this.host.say("announce.doubling", {}, true);
    if (this.round === turns) {
      await this.host.say("announce.final", {}, true);
    }
  }

  /** Someone sits down with `coins` and no Stars, last in the turn order. */
  private seat(who: Who, coins: number): void {
    if (this.seats.has(who.key)) return;
    this.seats.set(who.key, newSeat(who.name, coins));
    if (this.order.length > 0 && !this.order.includes(who.key)) {
      this.order.push(who.key);
      // A late joiner's card comes in at once.
      this.revealed.add(who.key);
    }
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

  /**
   * While the game is held (Tests): the holder's turns, one after another, until the hold is let go
   * or a test jumps to a round (that jump comes back to be taken; a test minigame is played between
   * two held turns).
   */
  private async heldTurns(): Promise<{ round: number; minigameOnly: boolean } | undefined> {
    let jumped: { round: number; minigameOnly: boolean } | undefined;
    while (this.holder !== undefined && !jumped) {
      await this.heldTurn(this.holder);
      jumped = await this.takeJump();
    }
    return jumped;
  }

  /** One held turn: the seat's hands as the hold keeps them before it and again after it, whatever it rolled or used. */
  private async heldTurn(key: string): Promise<void> {
    const seat = this.seats.get(key);
    const who = this.host.present().find((candidate) => candidate.key === key);
    if (!seat || !who) {
      this.hold(undefined);
      this.host.everyone(`Test: the hold is off (${seat?.name ?? key} isn't here), and the game goes on.`);
      return;
    }
    const keep = () => {
      const hands = this.heldHands.get(key);
      if (hands) seat.hands = copyHands(hands);
      this.host.changed();
    };
    this.heldNow = key;
    keep();
    try {
      await this.playTurn(who);
    } catch (error) {
      log.warn(`blockparty: ${who.name}'s held turn failed: ${describeError(error)}`);
    } finally {
      keep();
      this.heldNow = undefined;
      if (this.holder !== key) this.heldHands.delete(key);
    }
    // Never a turn after a turn in the same tick (a piece off the board ends a turn at once).
    await this.host.scope.wait(1);
  }

  /** A test's jump, if one was asked: a minigame is played here and now; a round jump comes back to be taken. */
  private async takeJump(): Promise<{ round: number; minigameOnly: boolean } | undefined> {
    const jump = this.jump;
    this.jump = undefined;
    if (!jump) return undefined;
    if (jump.kind === "round") return { round: Math.max(1, Math.min(this.host.turns, jump.round)), minigameOnly: jump.minigameOnly };
    this.turn = undefined;
    this.host.changed();
    try {
      await this.minigameRound(jump);
    } catch (error) {
      log.warn(`blockparty: the test minigame failed: ${describeError(error)}`);
      this.host.everyone(`The minigame failed: ${describeError(error)}`);
    }
    return undefined;
  }

  /** A turn; true when it was called off for a test (it's played again). */
  private async playTurn(who: Who): Promise<boolean> {
    this.turn = who.key;
    this.lastTurn = who.key;
    this.turnNow = { key: who.key, item: false, bonus: false };
    this.host.changed();
    // Whose turn, in the dialogue box until they've rolled (a line said meanwhile takes the box for a while).
    const hideTurn = this.host.notice(line("turn.title", { player: who.name }), who.player ? line("turn.subtitle") : "");
    let rolled: RollOutcome | undefined;
    try {
      // A zombie on them takes its coins; a curse says which die they'll roll; a bot may use an item.
      await this.items.zombieBite(who);
      const seat = this.seats.get(who.key);
      if (seat?.effects.cursedDie) await this.host.say("dice.cursed.forced", { player: who.name }, false, who);
      else if (seat?.effects.slow) await this.host.say("dice.slow-curse", { player: who.name }, false, who);
      if (!who.player) await this.items.botTurn(who);
      if (!who.body.isValid) return false;
      rolled = await this.host.roll(who, true);
    } finally {
      hideTurn();
    }
    if (rolled === undefined) return this.jump !== undefined;
    if (!who.body.isValid) return false;
    await this.items.afterRoll(who, rolled);
    this.host.everyone(line("turn.rolled", { player: who.name, roll: rolled.move }));
    await this.rolledFaces(who, rolled);
    if (!who.body.isValid) return false;
    await this.move(who, rolled.move);
    this.steering.delete(who.key);
    if (!who.body.isValid) return false;
    await this.land(who);
    // Back to the board's own camera after any NPC's shot.
    this.host.stage.clear();
    await this.host.scope.wait(20);
    return false;
  }

  /**
   * What the roll does besides moving (the dice file, dice.ts): the die's own line, then each face
   * thrown in turn, its coins for the roller and its event, and its line. All before the walk.
   */
  private async rolledFaces(who: Who, outcome: RollOutcome): Promise<void> {
    const die = outcome.die;
    const fills = { player: who.name, die: die.name, roll: outcome.move };
    if (die.say) await this.host.say(die.say, fills, false, who);
    for (const face of thrown(outcome)) {
      const seat = this.seats.get(who.key);
      if (!seat || !who.body.isValid) return;
      if (face.coins !== 0) seat.coins = addCoins(seat.coins, face.coins);
      const other = face.event ? this.faceEvent(who, face) : undefined;
      this.host.changed();
      if (face.say) await this.host.say(face.say, { ...fills, coins: count(Math.abs(face.coins || face.amount), "coin"), other: other ?? "" }, false, who);
    }
  }

  /**
   * A face's event (dice.ts, FACE_EVENTS), for everyone seated: the name of the player it picked
   * (Coin swap's), if any. Roll again was rolled already (rollDie).
   */
  private faceEvent(who: Who, face: DieFace): string | undefined {
    const here = this.host.present().filter((other) => this.seats.has(other.key) && other.body.isValid && !this.host.pieces.isOff(other.body));
    const spaces = this.host.spaces();
    switch (face.event) {
      case "everyone_coins":
        for (const seat of this.seats.values()) seat.coins = addCoins(seat.coins, face.amount);
        return undefined;
      case "coin_swap": {
        const others = here.filter((other) => other.key !== who.key);
        const other = others[Math.floor(this.host.random() * others.length)];
        const mine = this.seats.get(who.key);
        const theirs = other ? this.seats.get(other.key) : undefined;
        if (!other || !mine || !theirs) return undefined;
        [mine.coins, theirs.coins] = [theirs.coins, mine.coins];
        return other.name;
      }
      case "double_minigame":
        this.doubleNext = true;
        return undefined;
      case "swap_places":
        // Everyone's spaces dealt out again at random (each to someone else's, when that can be).
        this.shuffle(here);
        return undefined;
      case "everyone_back":
        for (const other of here) this.host.pieces.moveTo(other.body, back(spaces, this.host.pieces.spaceOf(other.body), face.amount));
        return undefined;
      default:
        return undefined;
    }
  }

  /** Walks the piece `steps` spaces, stopping to pick a way at each branch and at each Star (and the Wandering Trader) it passes. */
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
        if ((this.stars.includes(here) || this.spacePlay.traderSpace === here) && left > 0) break;
      }
      if (!who.body.isValid) return;
      // The board's camera follows the walk (after the Star's shot, for one).
      this.host.stage.clear();
      await this.host.pieces.walkThrough(who.body, stretch, { land: left === 0, quiet: true });
      at = here;
      if (this.stars.includes(at)) await this.offerStar(who, at);
      if (this.spacePlay.traderSpace === at) await this.spacePlay.trader(who);
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
      return this.stars.includes(next) ? button("branch.button.star", way) : button("branch.button", way);
    });
    const picked = await this.host.choose(who, line("branch.title"), "", options, botPick);
    const next = space.next[picked ?? 0] ?? space.next[0];
    if (!who.player) this.host.everyone(line("branch.bot", { player: who.name, space: this.spaceName(spaces[next]) }));
    return next;
  }

  /**
   * Passing or landing on a Star: Chris, beside it, offers it for its price in the dialogue box (Buy a
   * Star or Not now; sneak is Not now), if they have the coins (a bot always buys). Bought, it flies
   * on: the camera pans to its new space and a Chris drops in there.
   */
  private async offerStar(who: Who, at: number): Promise<void> {
    const seat = this.seats.get(who.key);
    if (!seat) return;
    const spaces = this.host.spaces();
    const { stage } = this.host;
    // Chance Time's Half-price Star: coins off, until they buy one.
    const price = Math.max(0, starPrice(this.host.turns) - seat.effects.discount);
    const money = { player: who.name, price: count(price, "coin"), coins: count(seat.coins, "coin") };
    await stage.starVisit(who, spaces[at]);
    if (seat.effects.discount > 0) await this.host.say("star.chris.half-price", money, false, who);
    if (seat.coins < price) {
      await this.host.say("star.chris.short", money, false, who);
      return;
    }
    const picked = await this.host.talk("star.chris.offer", money, { to: who, buttons: [button("star.form.buy"), button("star.form.skip")], back: 1, botPick: 0 });
    if (picked !== 0) {
      await this.host.say("star.chris.declined", {}, false, who);
      return;
    }
    const before = this.snapshot();
    seat.coins -= price;
    seat.stars++;
    seat.effects.discount = 0;
    const index = this.stars.indexOf(at);
    const moved = nextStar(spaces, at, this.stars.filter((star) => star !== at), starDistance(spaces.length), this.host.random);
    if (index >= 0) this.stars[index] = moved;
    this.host.changed();
    this.host.notice(line("star.bought.title", { player: who.name }), line("star.bought.subtitle", { space: this.spaceName(spaces[moved]) }), STAR_NOTICE);
    this.host.everyone(line("star.bought", { player: who.name, price: count(price, "coin"), starWhere: this.starsText() }));
    // The notice has the box a moment before Chris speaks.
    await this.host.scope.wait(STAR_NOTICE);
    await this.host.say("star.chris.sold", { player: who.name }, false, who);
    await stage.starMoved(spaces[at], spaces[moved]);
    await this.host.say("star.chris.moves", { space: this.spaceName(spaces[moved]) }, false, who);
    await this.showResults(before);
  }

  /** Landing: the space's effect. */
  private async land(who: Who): Promise<void> {
    const seat = this.seats.get(who.key);
    const space = this.host.spaces()[this.host.pieces.spaceOf(who.body)];
    if (!seat || !space) return;
    const change = coinsFor(space.type);
    // Blue and Red pay; every type is said in chat.
    if (change !== 0) seat.coins = addCoins(seat.coins, change);
    if (space.type !== "versus") this.host.everyone(line(`land.${space.type}`, { player: who.name, coins: count(Math.abs(change), "coin") }));
    this.host.changed();
    try {
      if (space.type === "versus") await this.versus(who);
      else if (space.type === "item") await this.spacePlay.itemSpace(who);
      else if (space.type === "shop") await this.spacePlay.shop(who);
      else if (space.type === "chance") await this.spacePlay.chance(who);
      else if (space.type === "warden") await this.spacePlay.warden(who);
      else if (space.type === "happening") await this.spacePlay.happening(who);
    } catch (error) {
      log.warn(`blockparty: ${who.name}'s ${space.type} space failed: ${describeError(error)}`);
    }
    this.unfeature();
    this.host.changed();
  }

  /** A Versus space: the lander picks who to duel (a bot picks the leader) from the Referee's buttons. */
  private async versus(who: Who): Promise<void> {
    const others = this.here().filter((other) => other.key !== who.key);
    if (others.length === 0) {
      this.host.everyone(line("versus.nobody", { player: who.name }));
      return;
    }
    const doubled = isDoubled(this.round, this.host.turns);
    const stake = VERSUS_STAKE * (doubled ? 2 : 1);
    const leader = others.reduce((best, other) => ((this.seats.get(other.key)?.coins ?? 0) > (this.seats.get(best.key)?.coins ?? 0) ? other : best), others[0]);
    // The Referee comes to the lander, and they pick a rival from its buttons.
    await this.host.stage.referee(who, this.spaceOf(who));
    if (doubled) await this.host.say("versus.doubled", { coins: count(stake, "coin") }, false, who);
    const picked = await this.host.talk("versus.announce", { player: who.name }, {
      to: who,
      buttons: others.map((other) => button("versus.form.button", { player: other.name, coins: count(this.seats.get(other.key)?.coins ?? 0, "coin") })),
      botPick: others.indexOf(leader),
    });
    await this.duel(who, others[picked ?? 0], stake, "versus");
  }

  /**
   * A duel (a Versus space, or the Dueling Glove): an FFA minigame for the two, the loser paying the
   * winner `stake` (capped at what they have). The Referee states it, the onlookers bet on it
   * (takeBets), and the bets are paid from the bank or lost to it.
   */
  async duel(who: Who, rival: Who, stake: number, kind: "versus" | "glove"): Promise<void> {
    const pool = this.host.minigames.filter((minigame) => minigame.kind === "ffa");
    const def = pickMinigame(pool, this.played, this.host.random);
    if (!def) return;
    this.played.set(def.id, (this.played.get(def.id) ?? 0) + 1);
    const duel = { player: who.name, other: rival.name, coins: count(stake, "coin") };
    if (kind === "glove") {
      await this.host.stage.referee(who, this.spaceOf(who));
      await this.host.say("versus.glove", duel, false, who);
    }
    this.host.everyone(stake > (kind === "glove" ? GLOVE_STAKE : VERSUS_STAKE) ? line("versus.start.doubled", duel) : line("versus.start", duel));
    await this.host.say("versus.faceoff", duel, false, who);
    const bets = await this.takeBets(who, rival);
    this.host.stage.refereeGone();
    const onlookers = this.host.present().filter((other) => other.key !== who.key && other.key !== rival.key);
    const before = this.snapshot();
    let winnerKey: string | undefined;
    await this.host.playMinigame("duel", def, [[who], [rival]], pool, onlookers, (outcome) => {
      const winners = "places" in outcome ? (outcome.places[0] ?? []) : [];
      winnerKey = winners.length === 1 ? winners[0] : undefined;
      this.settleBets(bets, winnerKey);
      if (winnerKey === undefined) return { title: line("versus.draw.title"), subtitle: line("versus.draw.subtitle") };
      const winner = winnerKey === who.key ? who : rival;
      const loser = winner === who ? rival : who;
      const paid = this.pay(loser.key, winner.key, stake);
      const result = { player: winner.name, other: loser.name, coins: count(paid, "coin") };
      this.host.everyone(line("versus.won", result));
      this.host.changed();
      // One box for everyone: who won, and who paid whom.
      return { title: line("versus.won.title", result), subtitle: line("versus.won.subtitle", result) };
    });
    // A zombie leaves the duel's winner (a win is a top 2 finish).
    if (winnerKey) this.items.shakeOff([winnerKey]);
    await this.showResults(before);
  }

  /**
   * The onlookers' bets (docs/plans/block-party.md, "Versus and the Dueling Glove"): each seat on the
   * board but the duelists, with coins to bet, picks 3 or 5 on either of them, or no bet, from the
   * Referee's buttons one after another (a bot sometimes backs the richer); then the Referee reads
   * the odds. Bets lock as the duel starts.
   */
  private async takeBets(a: Who, b: Who): Promise<{ who: Who; side: string; amount: number }[]> {
    const bets: { who: Who; side: string; amount: number }[] = [];
    const bettors = this.here().filter((other) => other.key !== a.key && other.key !== b.key && (this.seats.get(other.key)?.coins ?? 0) >= BETS[0]);
    if (bettors.length > 0) await this.host.say("versus.bets.open", { player: a.name, other: b.name }, false, a);
    for (const bettor of bettors) {
      const coins = this.seats.get(bettor.key)?.coins ?? 0;
      const options = [a, b].flatMap((side) => BETS.filter((amount) => amount <= coins).map((amount) => ({ side, amount })));
      const favorite = (this.seats.get(a.key)?.coins ?? 0) >= (this.seats.get(b.key)?.coins ?? 0) ? a : b;
      const botPick = this.host.random() < 0.5 ? options.length : Math.max(0, options.findIndex((option) => option.side === favorite));
      const picked = await this.host.talk("versus.bet.ask", { player: bettor.name, other: a.name, coins: count(coins, "coin") }, {
        to: bettor,
        buttons: [...options.map((option) => button("versus.bet.button", { player: option.side.name, coins: count(option.amount, "coin") })), button("versus.bet.none")],
        back: options.length,
        botPick,
      });
      if (picked === undefined || picked >= options.length) continue;
      bets.push({ who: bettor, side: options[picked].side.key, amount: options[picked].amount });
    }
    if (bets.length > 0) {
      const odds = [a, b].map((side) => `${side.name} ${bets.filter((bet) => bet.side === side.key).length}`).join(", ");
      await this.host.say("versus.bets.closed", { odds, player: a.name, other: b.name }, false, a);
    } else if (bettors.length > 0) await this.host.say("versus.bets.none", { player: a.name, other: b.name }, false, a);
    return bets;
  }

  /** Each bet won back as much again from the bank, or lost to it; a draw leaves them be. */
  private settleBets(bets: readonly { who: Who; side: string; amount: number }[], winner: string | undefined): void {
    for (const bet of bets) {
      const seat = this.seats.get(bet.who.key);
      const change = betResult(bet.amount, bet.side, winner);
      if (!seat || change === 0) continue;
      const before = seat.coins;
      seat.coins = addCoins(seat.coins, change);
      this.host.everyone(line(change > 0 ? "versus.bet.won" : "versus.bet.lost", { player: bet.who.name, coins: count(Math.abs(seat.coins - before), "coin") }));
    }
    this.host.changed();
  }

  /** The round's minigame: its format and sides, the pick, and the coins it pays. */
  private async minigameRound(test?: { format: Format; def: MinigameDef }): Promise<void> {
    const here = this.host.present().filter((who) => this.seats.has(who.key));
    if (here.length === 0) return;
    let format = test?.format ?? formatFor(this.round, here.length, this.host.random);
    // Chance Time's Battle Royale makes it a Battle.
    if (!test && this.battleNext && fits("battle", here.length)) format = "battle";
    this.battleNext = false;
    if (!fits(format, here.length)) {
      if (test) this.host.everyone(`Test: ${test.def.name} as ${format} doesn't fit ${here.length} players.`);
      return;
    }
    let pool = this.host.minigames.filter((minigame) => minigame.kind === kindOf(format));
    if (pool.length === 0) {
      format = "ffa";
      pool = this.host.minigames.filter((minigame) => minigame.kind === "ffa");
    }
    const def = test?.def ?? pickMinigame(pool, this.played, this.host.random);
    if (!def) return;
    this.played.set(def.id, (this.played.get(def.id) ?? 0) + 1);
    const sides = this.sidesFor(format, here);
    const doubled = isDoubled(this.round, this.host.turns);
    // A die's face asked for this one to pay double (on top of the last rounds' doubling).
    const bonus = this.doubleNext;
    this.doubleNext = false;
    // The results start from before the Battle's pot is taken.
    const before = this.snapshot();
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
    const outcome = await this.host.playMinigame(format, def, sides, pool, [], (outcome) => this.payOut(format, def, sides, outcome, doubled, pot, bonus));
    // Zombies leave those who finished in the top 2 (the winning side, in a team game).
    this.items.shakeOff(topTwo(outcome, sides));
    await this.showResults(before);
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

  /**
   * Pays a minigame's coins (doubled late on; a Battle's pot to its winners) and says so: the places
   * and coins in chat, and who won over the arena in the dialogue box (short: one name, a team, a
   * tie). The results screen after shows what each player got.
   */
  private payOut(format: Format, def: MinigameDef, sides: readonly Who[][], outcome: Outcome, doubled: boolean, pot: number, bonus = false): Results {
    const names = new Map(sides.flat().map((who) => [who.key, who.name]));
    const nameOf = (key: string) => names.get(key) ?? this.seats.get(key)?.name ?? key;
    let coins: Map<string, number>;
    let title: string;
    if ("places" in outcome) {
      const winners = outcome.places[0] ?? [];
      title = winners.length === 0 ? line("minigame.nobody") : winners.length === 1 ? line("minigame.won.one", { player: nameOf(winners[0]) }) : line("minigame.won.tie", { count: winners.length });
      coins = format === "battle" ? splitPot(pot, winners) : ffaCoins(outcome.places);
      let place = 0;
      const places = outcome.places.map((group) => {
        const name = PLACES[place] ?? `${place + 1}th`;
        place += group.length;
        return `${name}: ${group.map(nameOf).join(", ")}`;
      });
      this.host.everyone(line("minigame.places", { minigame: def.name, places: places.join("; ") }));
    } else {
      const team = format === "2v2" ? "2v2" : "1v3";
      const keys = sides.map((side) => side.map((who) => who.key));
      coins = teamCoins(team, keys, outcome.winner);
      // 2v2's sides are Red and Blue; 1v3's the solo and the rest.
      if (outcome.winner === undefined) title = line("minigame.draw");
      else if (format === "2v2") title = line(outcome.winner === 0 ? "minigame.won.red" : "minigame.won.blue");
      else title = outcome.winner === 0 ? line("minigame.won.one", { player: sides[0][0]?.name ?? "?" }) : line("minigame.won.group", { count: sides[1].length });
    }
    const factor = (doubled && format !== "battle" ? 2 : 1) * (bonus ? 2 : 1);
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
    return { title };
  }

  /** The end: most Stars, then coins; a tie still standing goes to chance. */
  private finish(): Result {
    const standings: Standing[] = [...this.seats.values()];
    const tied = leaders(standings);
    if (tied.length === 0) return { kind: "draw", reason: "nobody played" };
    const winner = tied.length === 1 ? tied[0] : tied[Math.floor(this.host.random() * tied.length)];
    if (tied.length > 1) this.host.everyone(line("end.tie", { players: tied.map((seat) => seat.name).join(" and ") }));
    this.host.notice(line("end.title", { player: winner.name }), line("end.subtitle", { stars: count(winner.stars, "Star"), coins: count(winner.coins, "coin") }), END_NOTICE);
    this.host.everyone(line("end.standings", { standings: this.standings().join("; ") }));
    this.running = false;
    return { kind: "win", players: [winner.name], reason: `${count(winner.stars, "Star")} and ${count(winner.coins, "coin")}` };
  }

  /** A space's name: its id on a map, else its place on the test board. */
  spaceName(space: Space): string {
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

  /** A column of light over each Star (the plan's beacon beam is a model, pass 6), and a green one over the Wandering Trader's space. */
  private drawBeams(): void {
    if (!this.running) return;
    const spaces = this.host.spaces();
    const dimension = world.getDimension("overworld");
    const beams: [number, string][] = this.stars.map((index) => [index, "minecraft:endrod"]);
    const trader = this.spacePlay.traderSpace;
    if (trader !== undefined) beams.push([trader, "minecraft:villager_happy"]);
    for (const [index, particle] of beams) {
      const space = spaces[index];
      if (!space) continue;
      for (let y = 0.5; y <= 8; y += 0.75) {
        try {
          dimension.spawnParticle(particle, { x: space.at[0], y: space.at[1] + y, z: space.at[2] });
        } catch {
          // unloaded
        }
      }
    }
  }
}

function copyHands(hands: Hands): Hands {
  return { dice: [...hands.dice], items: [...hands.items] };
}

/**
 * Who finished a minigame in the top 2 (zombies leave them): the first two places' players (ties
 * share a place, so it can be more), or the winning side of a team game.
 */
export function topTwo(outcome: Outcome, sides: readonly (readonly { key: string }[])[]): string[] {
  if ("places" in outcome) {
    const out: string[] = [];
    for (const group of outcome.places) {
      if (out.length >= 2) break;
      out.push(...group);
    }
    return out;
  }
  return outcome.winner === undefined ? [] : (sides[outcome.winner] ?? []).map((who) => who.key);
}
