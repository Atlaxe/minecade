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
//      at a fork they pick Left or Right in the fork box (dialogue.ts fork, fork.ts; everyone's
//      camera looks down the way picked), and passing or landing on a Star, Chris (beside it) offers
//      it for its price (15, 20 or 25 coins by the game's length) in the dialogue box, after which
//      the Star over the space fades as the bought one flies to the buyer, it moves to a candidate
//      far away, and a balloon carries Chris there (stage.ts starMoved). Before the roll they may use
//      one item (item-play.ts), and a zombie on them takes its coins. Landing: Blue +3 coins, Red -3
//      (never below 0), Versus a duel with a player the lander picks from the Referee's buttons (the
//      loser pays the winner 5 coins, onlookers bet on it), and Item, Shop, Chance Time, Warden and
//      Happening as space-play.ts plays them; the Wandering Trader stops a walk like a Star. Chris
//      says when the game is halfway, when coins start doubling and when the last round starts.
//   4. After everyone has moved, a minigame (minigame-rules.ts picks the format and the minigame,
//      minigame-runner.ts plays it), and its coins are paid; coins awarded and duel stakes double in
//      the last 2 rounds (the last one in a 10-turn game).
//   5. The end (pass 8, endGame): everyone back on the pre-game podium, Chris saying it's over, and
//      the Allay bringing the bonus Stars (end-game.ts draws them from what the game kept on each
//      seat: stats), then the results screen; a tie for first plays a sudden-death minigame among
//      the tied, and if that decides nothing the Allay picks; then the final podium, best first, the
//      winner celebrating and last place sad, the camera round the winner, and a fade to the lobby.
// Seats are players and bots (bots.ts): the game asks each the same things, a player through the
// dice, the dialogue box's buttons and forms, a bot by thinking a moment and picking. A player who isn't there when their turn
// comes is skipped and keeps their place. Someone new comes in at the start of the next round, at
// Start, last in the turn order, with as many coins as last place and no Stars. No timers: the game
// waits for each roll and choice. Everything it says is a line from dialogue.json (lines.ts).
import { world, type Entity } from "@minecraft/server";
import { describeError, log, type Result, type Scope } from "@minecade/minigame-core";
import { BLOCK_PARTY_BOARD } from "@minecade/minigame-core/config";
import { back, type Space } from "./board.ts";
import { ITEMS, type Holdings, type ItemId } from "./dice-items.ts";
import { ItemPlay } from "./item-play.ts";
import { SpacePlay } from "./space-play.ts";
import { mayUseItem, newSeat, turnDice, type Seat, type TurnState } from "./seats.ts";
import { BETS, GLOVE_STAKE, betResult, trailOf, type Hands } from "./space-rules.ts";
import type { ForkOptions, TalkOptions } from "./dialogue.ts";
import { forkLabelIds, forkOrder, headingInto, wayAhead } from "./fork.ts";
import type { Stage } from "./stage.ts";
import { activeStars, addCoins, coinsFor, count, firstStars, nextStar, ranked, starDistance, starPrice, turnOrder } from "./board-rules.ts";
import { bonusStarCount, drawBonusStars, finalPlaces, GameStats, RISKY_DICE, tiebreakFormat, tiebreakPlaces, tiebreakPool, withWinner, type BonusStar, type DrawSeat } from "./end-game.ts";
import { moodOf, type CoinsAndStars, type PlayerSet } from "./animations.ts";
import { isSeat, type Party, type Token } from "./tokens.ts";
import { beatsOf, type Pass } from "./handovers.ts";
import type { Who } from "./bots.ts";
import { thrown, type DieFace, type RollOutcome } from "./dice.ts";
import { button, line, type Fills } from "./lines.ts";
import { VERSUS_STAKE, battleBets, ffaCoins, firstDoubled, fits, formatFor, isDoubled, kindOf, minigameMoods, pairingKey, pickMinigame, pickPairs, pickSolo, splitPot, teamCoins, type Format } from "./minigame-rules.ts";
import type { PlayOptions, Results, Settle } from "./minigame-runner.ts";
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
  /**
   * Opens their dice and resolves with what they roll (undefined if they leave first); `shot`:
   * everyone watches through the roll camera. The die bursts, leaving its number over their head.
   */
  roll(who: Who, shot: boolean): Promise<RollOutcome | undefined>;
  /** The moves left over a seat's head (counts.ts): the number, or undefined to take it away. */
  count?(who: Who, left: number | undefined): void;
  /** A fork in the path: the fork box (dialogue.ts fork), its ways side by side; undefined when the player leaves first. */
  fork(options: ForkOptions): Promise<number | undefined>;
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
  playMinigame(format: Format, def: MinigameDef, sides: Who[][], pool: readonly MinigameDef[], onlookers: readonly Who[], settle: Settle, options?: PlayOptions): Promise<Outcome>;
  everyone(text: string): void;
  tell(who: Who, text: string): void;
  /**
   * The game's own words to everyone in the dialogue box with no speaker (the user: no titles or
   * subtitles), the second row under the first when there is one; it stays `ticks` (undefined: until
   * the returned function takes it down, or another notice replaces it).
   */
  notice(text: string, more?: string, ticks?: number): () => void;
  /**
   * A title (and a subtitle under it) on everyone's screen for `ticks`. Only a round's start shows
   * this way (the user, 2026-11-18); everything else the game says is a notice.
   */
  headline(title: string, subtitle: string, ticks: number): void;
  /**
   * Words above the hotbar (the action bar's own place) on everyone's screen for `ticks`: a turn's
   * start, "Alex's turn" (the user, 2026-11-18, in place of its title and subtitle).
   */
  barText(text: string, ticks: number): void;
  /** Whose turn, coins or Stars changed: the HUD and the cards follow. */
  changed(): void;
  /** The results screen (results.ts) from the standings `before` to `after`; resolves once it's gone. */
  results(before: readonly ResultSeat[], after: readonly ResultSeat[]): Promise<void>;
  /** The zombies that follow seats (zombies.ts): their bodies; how long they stay is the loop's. */
  zombies: { add(key: string): unknown; remove(key: string): void; of?(key: string): Entity | undefined };
  random(): number;
  /**
   * A seat's player (or bot) plays one of the players' animation sets (moves.ts): Celebration on
   * the turn order reveal, a minigame won, a Star gained; Sad on a minigame lost, a Star or coins
   * lost; Select when they're picked as a rival. `hold`: they hold its pose until the game lets them
   * go (the final podium's).
   */
  react?(who: Who, set: PlayerSet, hold?: boolean): void;
  /**
   * Shows `count` of `token` going from one to another (transfers.ts: a seat, an NPC, or nobody for
   * the bank), like Super Mario Party's coins: they fly head to head with a count over the heads.
   * Resolves once the last has landed.
   */
  transfer?(from: Party, to: Party, token: Token, count: number): Promise<void>;
  /**
   * A hand-over's halves (handovers.ts, transfers.ts): `token` leaving a seat's head toward each of
   * its takers, "-X" over it, and landing on a taker from their giver's side, "+X". Each resolves once
   * the last has gone, or landed.
   */
  leave?(from: Who, ways: readonly { to: Who | undefined; count: number }[], token: Token): Promise<void>;
  arrive?(to: Who, from: Who | undefined, token: Token, count: number): Promise<void>;
  /** Confetti bursts over a seat's head (the user, 2026-11-18): a Star gained, a minigame, duel or the game won. */
  confetti?(who: Who): void;
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

/** A test's jump (the Tests menu): to a round, straight to its minigame or not, a minigame played next, or the end of the game. */
export type TestJump = { kind: "round"; round: number; minigameOnly: boolean } | { kind: "minigame"; format: Format; def: MinigameDef } | { kind: "end" };

/** Tests: the end's tie (to try the tiebreaker): after the bonus Stars the top `tie` seats are level; `stillTied`: its minigame decides nothing, so the Allay picks. */
export interface EndTest {
  tie: number;
  stillTied: boolean;
}

/** Ticks between drawings of the Stars' beams. */
const BEAM_TICKS = 10;
/** How often the loop looks for coins and Stars won or lost, to make their players celebrate or look sad. */
const MOOD_TICKS = 2;
/** A hand-over (handOver): ticks a shot of a seat is up before anything flies, and ticks it stays once the last has gone or landed. */
const HAND_OVER_LEAD = 5;
const HAND_OVER_HOLD = 10;
const PLACES = ["1st", "2nd", "3rd", "4th"];
/** Ticks a round's title stays (the round waits as long before going on), a turn's words above the hotbar, and a Star's or the end's notice. */
const ROUND_NOTICE = 40;
const TURN_BAR = 50;
const STAR_NOTICE = 40;
/** The champion's confetti on the final podium: how many bursts, and the ticks between them. */
const CHAMPION_BURSTS = 3;
const BURST_GAP = 14;
/** Ticks the screen takes to go black at the very end, and how long it stays black (the lobby takes everyone back behind it). */
const END_FADE_TICKS = 20;
const END_BLACK = 6;

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
  /** Each seat's coins and Stars as watchMoods last saw them, and the coins each has spent of its own accord since. */
  private readonly seen = new Map<string, CoinsAndStars>();
  private readonly spentSince = new Map<string, number>();
  /** Each seat's coins and Stars a transfer has shown coming in (above 0) or going out since watchMoods last looked: it shows only the rest. */
  private readonly shownSince = new Map<string, CoinsAndStars>();
  /** Each seat's coins a hand-over has taken in (above 0) or given since watchMoods last looked: the hand-over plays their moods, not the watcher. */
  private readonly handedSince = new Map<string, number>();
  /** Seat to seat passes made and not yet shown (handOver). */
  private readonly passes: Pass[] = [];
  private readonly host: LoopHost;
  /** The items in play, and the spaces past Blue, Red and Versus (pass 7). */
  readonly items: ItemPlay;
  readonly spacePlay: SpacePlay;
  /** What the game keeps on each seat for the bonus Stars (end-game.ts). */
  readonly stats = new GameStats();
  /** Tests: the end's tie, if one is asked for. */
  private endTest: EndTest = { tie: 0, stillTied: false };

  constructor(host: LoopHost) {
    this.host = host;
    this.items = new ItemPlay(this, host);
    this.spacePlay = new SpacePlay(this, host, this.items);
    host.scope.interval(() => this.drawBeams(), BEAM_TICKS);
    host.scope.interval(() => this.watchMoods(), MOOD_TICKS);
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

  /**
   * Coins from one seat to another, at most `amount` and never more than the payer has: what was
   * paid. Shown as a hand-over (pass) when both are here, unless `now`: flown at once from the
   * payer's head to the payee's in the shot that's up (a duel's stake, on the minigame podium).
   */
  pay(from: string, to: string, amount: number, now = false): number {
    const payer = this.seats.get(from);
    const payee = this.seats.get(to);
    if (!payer || !payee || from === to) return 0;
    const paid = Math.min(amount, payer.coins);
    payer.coins -= paid;
    payee.coins += paid;
    // A hand-over (the camera on the payer, then on the payee) when both are here, else the bank's way.
    const giver = this.whoOf(from);
    const taker = this.whoOf(to);
    if (giver && taker && !now) this.pass(giver, taker, "coin", paid);
    else void this.transfer(giver, taker, "coin", paid);
    this.host.changed();
    return paid;
  }

  /**
   * Coins, Stars or an item going from one seat to another (the user, 2026-11-20): call it as the
   * change is made. Both stay in sight (the turn fade leaves them), the change is marked as shown so
   * the watcher doesn't show it coming from the bank, and it waits for the next handOver, after the
   * line that tells of it (or the results screen, which shows any still waiting).
   */
  pass(from: Who, to: Who, token: Token, count: number): void {
    if (count <= 0 || from.key === to.key) return;
    this.markShown(from, to, token, count);
    if (token === "coin") {
      this.handedSince.set(from.key, (this.handedSince.get(from.key) ?? 0) - count);
      this.handedSince.set(to.key, (this.handedSince.get(to.key) ?? 0) + count);
    }
    this.feature(from, to);
    this.passes.push({ from: from.key, to: to.key, token, count });
  }

  /**
   * The passes made since the last hand-over, shown now (the user, 2026-11-20; handovers.ts): giver
   * by giver, the camera on the giver as what they lose leaves their head (sad if it's coins or a
   * Star), then a cut to each of their takers in turn as theirs lands (a Star with a celebration and
   * confetti), then a cut back to the scene's own shot (or the board's own camera). Nothing while a
   * cutscene is skipped. Resolves once it's done.
   */
  async handOver(): Promise<void> {
    const passes = this.passes.splice(0);
    if (passes.length > 0 && !this.host.stage.skipping) await this.playPasses(passes);
  }

  /** Passes played as handOver plays them, changing nothing (it's done when they're made: pass). Tests show them this way too. */
  async playPasses(passes: readonly Pass[]): Promise<void> {
    const { stage } = this.host;
    // The scene's own shot, to go back to after (none: the board's own camera takes it back).
    const back = stage.shotNow;
    let onNow: string | undefined;
    // The camera to a seat, if it isn't on them already: a moment to see them before anything flies.
    const onSeat = async (who: Who) => {
      if (onNow === who.key) return;
      onNow = who.key;
      stage.onSeat(who);
      await this.host.scope.wait(HAND_OVER_LEAD);
    };
    for (const beat of beatsOf(passes)) {
      if (stage.skipping || this.host.scope.disposed) return;
      const giver = this.whoOf(beat.from);
      if (giver?.body.isValid) {
        await onSeat(giver);
        if (beat.out.some((flow) => flow.token === "coin" || flow.token === "star")) this.react(giver.key, "Sad");
        for (const flow of beat.out) await this.host.leave?.(giver, flow.ways.map((way) => ({ to: this.whoOf(way.to), count: way.count })), flow.token);
        await this.host.scope.wait(HAND_OVER_HOLD);
      }
      for (const taker of beat.takers) {
        const who = this.whoOf(taker.to);
        if (stage.skipping || !who?.body.isValid) continue;
        await onSeat(who);
        for (const land of taker.lands) {
          await this.host.arrive?.(who, giver, land.token, land.count);
          if (land.token === "star") {
            this.react(who.key, "Celebration");
            this.confetti(who.key);
          }
        }
        await this.host.scope.wait(HAND_OVER_HOLD);
      }
    }
    // The scene goes on from where it was.
    if (onNow !== undefined && !stage.skipping) stage.backTo(back);
  }

  /** A seat by key, if they're here (else undefined: a transfer to or from them shows the bank's way). */
  whoOf(key: string): Who | undefined {
    return this.host.present().find((one) => one.key === key);
  }

  /**
   * Shows `count` of `token` going from one to another (transfers.ts: a seat, an NPC's entity, or
   * nobody for the bank), and marks the seats' coins and Stars it shows going in and out so the
   * watcher (watchMoods) doesn't show them again: call it as the change is made, before anything
   * waits. `gift`: shown only, for coins or Stars already in hand (the starting coins). Resolves once
   * the last has landed.
   */
  transfer(from: Party, to: Party, token: Token, count: number, gift = false): Promise<void> {
    if (count <= 0) return Promise.resolve();
    if (!gift) this.markShown(from, to, token, count);
    return this.fly(from, to, token, count);
  }

  /**
   * Transfers one after another (a Star's coins to Chris, then the Star to the buyer), all marked at
   * once: call it as the changes are made. `onStep` is told each step's index as it starts.
   */
  async transferAll(steps: readonly (readonly [Party, Party, Token, number])[], onStep?: (index: number) => void): Promise<void> {
    for (const [from, to, token, count] of steps) if (count > 0) this.markShown(from, to, token, count);
    for (const [index, [from, to, token, count]] of steps.entries()) {
      if (count <= 0) continue;
      onStep?.(index);
      await this.fly(from, to, token, count);
    }
  }

  /**
   * A transfer's tokens flying (the host's), and a Star's moods with it: a seat it leaves is sad as
   * it goes, and the seat it flies to celebrates as it lands (the watcher leaves a shown Star's to it).
   */
  private async fly(from: Party, to: Party, token: Token, count: number): Promise<void> {
    if (token === "star" && isSeat(from)) this.react(from.key, "Sad");
    await (this.host.transfer?.(from, to, token, count) ?? Promise.resolve());
    if (token === "star" && isSeat(to)) {
      this.react(to.key, "Celebration");
      this.confetti(to.key);
    }
  }

  /** A transfer's coins or Stars as shown for the seats on each side. */
  private markShown(from: Party, to: Party, token: Token, count: number): void {
    if (token !== "coin" && token !== "star") return;
    const field = token === "coin" ? "coins" : "stars";
    for (const [party, sign] of [[from, -1], [to, 1]] as const) {
      if (!isSeat(party)) continue;
      const shown = this.shownSince.get(party.key) ?? { coins: 0, stars: 0 };
      shown[field] += sign * count;
      this.shownSince.set(party.key, shown);
    }
  }

  /** Coins a seat spends of its own accord (a shop, a reroll, a Battle's pot): losing them doesn't make them sad. */
  spent(key: string, amount: number): void {
    if (amount > 0) this.spentSince.set(key, (this.spentSince.get(key) ?? 0) + amount);
  }

  /**
   * Every seat's coins and Stars against what they were (animations.ts, moodOf): a Star gained is a
   * Celebration, a Star or coins lost (but not spent) Sad. Watching them catches every change,
   * whichever space, item, duel or event made it.
   */
  private watchMoods(): void {
    for (const [key, seat] of this.seats) {
      const now = { coins: seat.coins, stars: seat.stars };
      const before = this.seen.get(key);
      const spent = this.spentSince.get(key) ?? 0;
      const shown = this.shownSince.get(key) ?? { coins: 0, stars: 0 };
      const handed = this.handedSince.get(key) ?? 0;
      this.seen.set(key, now);
      this.spentSince.delete(key);
      this.shownSince.delete(key);
      this.handedSince.delete(key);
      if (!before) continue;
      // The biggest coin swing (the bonus Stars): what came or went at once, less what they spent.
      if (now.coins !== before.coins) this.stats.coins(key, now.coins - before.coins + spent);
      // A Star a transfer shows brings its mood as it flies (fly), and a hand-over's coins as they go (playPasses), not here.
      const mood = moodOf(before, { coins: now.coins - handed, stars: now.stars - shown.stars }, spent);
      if (mood) this.react(key, mood);
      // What no transfer showed (a Blue or Red space, a minigame's coins, a die's face): from the
      // bank, dropping in over their head, or off their head into the air.
      this.fromBank(key, "coin", now.coins - before.coins - shown.coins);
      this.fromBank(key, "star", now.stars - before.stars - shown.stars);
    }
  }

  /** Coins or Stars a seat gained (above 0) from the bank, or lost to it, shown dropping in or flying off; a Star gained brings confetti as it lands. */
  private fromBank(key: string, token: "coin" | "star", change: number): void {
    const who = this.whoOf(key);
    if (change === 0 || !who?.body.isValid) return;
    if (change < 0) {
      void this.host.transfer?.(who, undefined, token, -change);
      return;
    }
    const landing = this.host.transfer?.(undefined, who, token, change) ?? Promise.resolve();
    if (token === "star") void landing.then(() => this.confetti(key));
  }

  /** Confetti over a seat's head, if they're here (a Star gained, a win). */
  private confetti(key: string): void {
    const who = this.whoOf(key);
    if (who?.body.isValid) this.host.confetti?.(who);
  }

  /** A seat's player or bot plays one of the players' sets, if they're here (`hold`: holding its pose till the game lets them go). */
  private react(key: string, set: PlayerSet, hold?: boolean): void {
    const who = this.host.present().find((one) => one.key === key);
    if (who?.body.isValid) this.host.react?.(who, set, hold);
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
      const used = await this.items.use(who, id);
      if (used) this.stats.item(who.key);
      await this.handOver();
      return used;
    } catch (error) {
      log.warn(`blockparty: ${who.name}'s ${id} failed: ${describeError(error)}`);
      return false;
    } finally {
      // Passes an item that failed left unshown are dropped (the change itself stands).
      this.passes.length = 0;
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
    this.stats.rolled(who.key, rolled.move);
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

  /** The results screen from `before` to now, after any hand-over still waiting; places show on the cards from then on. */
  async showResults(before: readonly ResultSeat[]): Promise<void> {
    await this.handOver();
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

  /** Tests: the end's tie (to try the tiebreaker), as it's set now, or set anew. */
  get endTestNow(): EndTest {
    return { ...this.endTest };
  }

  setEndTest(test: EndTest): void {
    this.endTest = { ...test };
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
      // The round's title, alone (the user: no subtitle); Chris's announcements say when coins start
      // doubling and when it's the final round.
      this.host.headline(line("round.title", { round: this.round, rounds: this.host.turns }), "", ROUND_NOTICE);
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
        this.host.everyone(jumped.round > this.host.turns ? "Test: on to the end of the game." : `Test: on to round ${jumped.round}${jumped.minigameOnly ? ", straight to its minigame" : ""}.`);
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
      this.placesAfterRound();
      next++;
      withTurns = true;
    }
    this.round = this.host.turns;
    return this.endGame();
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
        // Their card comes in as they're shown, and they celebrate.
        this.revealed.add(this.order[place]);
        this.host.changed();
        if (!stage.skipping) this.react(this.order[place], "Celebration");
        await this.host.say(`pregame.place.${place + 1}`, { player: name });
        // Their roll's number over their head goes once their place is said.
        if (seat >= 0) this.host.count?.(seats[seat], undefined);
      }
      // Chris hands everyone their starting coins (shown only: the seats have them already).
      const chris = stage.speaker("chris");
      if (!stage.skipping) for (const who of seats) void this.transfer(chris, who, "coin", this.host.startCoins, true);
      await this.host.say("pregame.coins", { coins: count(this.host.startCoins, "coin") });
      for (const star of this.stars) {
        await stage.starReveal(spaces[star]);
        await this.host.say("pregame.star", { space: this.spaceName(spaces[star]) });
      }
    });
    // Skipped or not, every card is out by now, and every roll's number gone.
    for (const who of seats) this.host.count?.(who, undefined);
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
    // Past the last round: the end of the game.
    if (jump.kind === "end") return { round: this.host.turns + 1, minigameOnly: true };
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
    // Whose turn, above the hotbar: "Alex's turn" (the user's words: turn.bar).
    this.host.barText(line("turn.bar", { player: who.name }), TURN_BAR);
    // A zombie on them takes its coins; a curse says which die they'll roll; a bot may use an item.
    await this.items.zombieBite(who);
    const seat = this.seats.get(who.key);
    if (seat?.effects.cursedDie) await this.host.say("dice.cursed.forced", { player: who.name }, false, who);
    else if (seat?.effects.slow) await this.host.say("dice.slow-curse", { player: who.name }, false, who);
    if (!who.player) await this.items.botTurn(who);
    if (!who.body.isValid) return false;
    const rolled = await this.host.roll(who, true);
    if (rolled === undefined) return this.jump !== undefined;
    if (!who.body.isValid) return false;
    if (RISKY_DICE.includes(rolled.die.id)) this.stats.risk(who.key);
    await this.items.afterRoll(who, rolled);
    await this.rolledFaces(who, rolled);
    if (!who.body.isValid) return false;
    this.stats.rolled(who.key, rolled.move);
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
      await this.handOver();
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
        // The difference goes from the one who had more to the one who had less, after the face's line.
        const gained = mine.coins - theirs.coins;
        if (gained > 0) this.pass(other, who, "coin", gained);
        else if (gained < 0) this.pass(who, other, "coin", -gained);
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

  /**
   * Walks the piece `steps` spaces, stopping to pick a way at each branch and at each Star (and the
   * Wandering Trader) it passes. The moves left ride over their head (the roll's burst put them
   * there), one fewer at each space reached, gone as they land.
   */
  private async move(who: Who, steps: number): Promise<void> {
    const spaces = this.host.spaces();
    let left = steps;
    let shown = steps;
    let at = this.host.pieces.spaceOf(who.body);
    this.host.count?.(who, steps);
    const reached = () => {
      shown--;
      this.host.count?.(who, shown > 0 ? shown : undefined);
    };
    // The space the piece came from (which way it faces at a fork).
    let before: number | undefined;
    try {
      while (left > 0 && who.body.isValid) {
        const stretch: Space[] = [];
        let here = at;
        while (left > 0) {
          const space = spaces[here];
          if (space.next.length > 1 && stretch.length > 0) break;
          const next = space.next.length > 1 ? await this.choosePath(who, space, before) : (space.next[0] ?? here);
          before = here;
          here = next;
          stretch.push(spaces[here]);
          left--;
          if ((this.stars.includes(here) || this.spacePlay.traderSpace === here) && left > 0) break;
        }
        if (!who.body.isValid) return;
        // The board's camera follows the walk (after the Star's shot, for one).
        this.host.stage.clear();
        await this.host.pieces.walkThrough(who.body, stretch, { land: left === 0, quiet: true, reached });
        at = here;
        if (this.stars.includes(at)) await this.offerStar(who, at);
        if (this.spacePlay.traderSpace === at) await this.spacePlay.trader(who);
      }
    } finally {
      this.host.count?.(who, undefined);
    }
  }

  /**
   * A fork (the user, 2026-11-18): the way Get star set, or the fork box, its ways Left and Right as
   * the piece faces arriving (fork.ts), everyone's camera looking down the way picked now (the first
   * when they leave); a bot heads for the Star.
   */
  private async choosePath(who: Who, space: Space, from?: number): Promise<number> {
    const steered = this.steering.get(who.key)?.find((index) => space.next.includes(index));
    if (steered !== undefined) return steered;
    const spaces = this.host.spaces();
    const heading = headingInto(spaces, space, from);
    // Each button's way (an index into space.next), left to right.
    const ways = forkOrder(spaces, space, heading);
    const toStar = this.pathToStar(space.index);
    const botWay = toStar ? space.next.indexOf(toStar[0]) : Math.floor(this.host.random() * space.next.length);
    const picked = await this.host.fork({
      to: who,
      labels: forkLabelIds(ways.length).map((id) => button(id)),
      botPick: Math.max(0, ways.indexOf(botWay)),
      focus: (index) => this.host.stage.forkView(space, heading, wayAhead(spaces, space.next[ways[index]])),
    });
    const next = space.next[ways[picked ?? 0] ?? 0] ?? space.next[0];
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
    this.spent(who.key, price);
    // The coins fly to Chris; then the Star over the space fades as the bought one flies from it to
    // them (the user, 2026-11-18), and they celebrate as it lands.
    const chris = stage.speaker("chris");
    const model = stage.starModelAt(spaces[at]);
    const paying = this.transferAll(
      [
        [who, chris, "coin", price],
        [model ?? chris, who, "star", 1],
      ],
      (step) => {
        if (step === 1) stage.starTaken(spaces[at]);
      },
    );
    const index = this.stars.indexOf(at);
    const moved = nextStar(spaces, at, this.stars.filter((star) => star !== at), starDistance(spaces.length), this.host.random);
    if (index >= 0) this.stars[index] = moved;
    this.host.changed();
    this.host.notice(line("star.bought.title", { player: who.name }), line("star.bought.subtitle", { space: this.spaceName(spaces[moved]) }), STAR_NOTICE);
    this.host.everyone(line("star.bought", { player: who.name, price: count(price, "coin"), starWhere: this.starsText() }));
    // The notice has the box a moment before Chris speaks (and the Star is theirs by then).
    await Promise.all([this.host.scope.wait(STAR_NOTICE), paying]);
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
    // The bonus Stars: a Red or Warden space is a hazard hit, and what Chance Time or a Happening
    // brings anyone is luck.
    if (space.type === "red" || space.type === "warden") this.stats.hazard(who.key);
    const luck = space.type === "chance" || space.type === "happening" ? new Map([...this.seats].map(([key, one]) => [key, { coins: one.coins, stars: one.stars }])) : undefined;
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
    await this.handOver();
    for (const [key, was] of luck ?? []) {
      const now = this.seats.get(key);
      if (now) this.stats.lucky(key, Math.max(0, now.coins - was.coins) + Math.max(0, now.stars - was.stars) * starPrice(this.host.turns));
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
    this.react(others[picked ?? 0].key, "Select");
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
      this.stats.duel(winnerKey);
      this.settleBets(bets, winnerKey);
      if (winnerKey === undefined) return { title: line("versus.draw.title"), subtitle: line("versus.draw.subtitle") };
      const winner = winnerKey === who.key ? who : rival;
      const loser = winner === who ? rival : who;
      this.react(winner.key, "Celebration");
      this.confetti(winner.key);
      this.react(loser.key, "Sad");
      // The stake flies from the loser to the winner on the minigame podium, not as a hand-over
      // back on the board (the user, 2026-11-20: the podium is where a minigame's results show).
      const paid = this.pay(loser.key, winner.key, stake, true);
      const result = { player: winner.name, other: loser.name, coins: count(paid, "coin") };
      this.host.everyone(line("versus.won", result));
      this.host.changed();
      // One box for everyone: who won, and who paid whom.
      return { title: line("versus.won.title", result), subtitle: line("versus.won.subtitle", result) };
    });
    await this.showResults(before);
    // A zombie leaves the duel's winner (a win is a top 2 finish), once the results have gone.
    if (winnerKey) await this.items.shakeOff([winnerKey]);
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
      this.stats.risk(bettor.key);
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
        this.spent(key, bet);
        pot += bet;
      }
      this.host.everyone(line("minigame.battle.pot", { coins: count(pot, "coin") }));
      this.host.changed();
    }
    const outcome = await this.host.playMinigame(format, def, sides, pool, [], (outcome) => this.payOut(format, def, sides, outcome, doubled, pot, bonus));
    await this.showResults(before);
    // Zombies leave those who finished in the top 2 (the winning side, in a team game), once the results have gone.
    await this.items.shakeOff(topTwo(outcome, sides));
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
    this.stats.minigame(
      sides.map((side) => side.map((who) => who.key)),
      outcome,
    );
    // The winners celebrate and those who came away with nothing are sad, there over the arena.
    for (const [key, mood] of minigameMoods(format, sides.map((side) => side.map((who) => who.key)), outcome)) {
      this.react(key, mood);
      if (mood === "Celebration") this.confetti(key);
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

  /** Every seat's place after this round's minigame (ties share a place), for the bonus Stars. */
  private placesAfterRound(): void {
    const seats = this.snapshot();
    const places = placesOf(seats);
    this.stats.roundOver(this.round, new Map(seats.map((seat, i) => [seat.key, places[i]])));
  }

  /**
   * The end of the game (pass 8; docs/plans/block-party.md, "End-of-game bonus Stars" and
   * "Tiebreaker"), in the order of the user's End of game scene:
   *   1. Behind a fade to black everyone is back on the pre-game podium, Chris at his spot, and he
   *      says the game is over (end.chris.over); the bonus Stars (end.bonus.intro), the Allay flying
   *      in (end.allay.hello) and over to each winner in turn, the Star flying from it to them as it
   *      says what for (end.bonus.award). A cutscene everyone can vote to skip: skipped, every bonus
   *      Star is still given. Then the results screen, from before the bonus Stars to after.
   *   2. A tie for first (Stars, then coins): Chris calls a sudden death (end.tie.chris), a minigame
   *      from the tiebreaker's pool for the tied alone (a duel for two), the rest watching, played
   *      from the podium's shot. If that decides nothing, everyone is back on the podium and the
   *      Allay flies round the tied and lands on the one it picks (end.tie.allay).
   *   3. The final podium, best first: the camera eases slowly in, the winner celebrates and last
   *      place is sad, each holding the pose, Chris names the champion (end.podium), the camera goes
   *      round the winner, Chris thanks everyone (end.thanks), and the screen fades to black for the
   *      lobby. A cutscene too.
   * Only the seats here at the end are ranked: someone who left isn't on the podium.
   */
  private async endGame(): Promise<Result> {
    const { stage } = this.host;
    this.turn = undefined;
    this.turnNow = undefined;
    this.unfeature();
    // No zombie follows anyone onto the podium.
    for (const key of this.seats.keys()) {
      const seat = this.seats.get(key);
      if (seat) seat.effects.zombie = 0;
      this.host.zombies.remove(key);
    }
    this.host.changed();
    const here = this.here();
    if (here.length === 0) {
      this.running = false;
      return { kind: "draw", reason: "nobody was left at the end" };
    }
    const before = this.snapshot();
    const draws = this.drawBonus(here);
    await stage.endLineup(here);
    await this.host.cutscene(true, async () => {
      await this.host.say("end.chris.over");
      if (draws.length === 0) return;
      await this.host.say("end.bonus.intro", { stars: count(draws.length, "Star") });
      await stage.allayArrives();
      await this.host.say("end.allay.hello");
      for (const draw of draws) await this.giveBonus(draw);
      await stage.allayBack();
    });
    await this.showResults(before);
    this.tieForTests(this.here());
    let places = finalPlaces(this.standingsOf(this.here()));
    if ((places[0]?.length ?? 0) > 1) places = await this.tiebreak(places);
    return this.finalPodium(places);
  }

  /** The bonus Stars for those here (end-game.ts): what the game kept on each, and where they stand now. */
  private drawBonus(here: readonly Who[]): BonusStar[] {
    const standings = here.flatMap((who) => {
      const seat = this.seats.get(who.key);
      return seat ? [{ key: who.key, seat }] : [];
    });
    const places = placesOf(standings.map((one) => one.seat));
    const worst = Math.max(0, ...places);
    const seats: DrawSeat[] = standings.map((one, i) => ({
      key: one.key,
      stats: this.stats.of(one.key),
      end: { place: places[i], last: places[i] === worst && worst > 1, held: one.seat.hands.items.length + one.seat.hands.dice.length, rounds: this.host.turns },
    }));
    return drawBonusStars(seats, bonusStarCount(standings.length), this.host.random);
  }

  /**
   * One bonus Star: the Allay flies over to its winner (the camera easing to the two of them), the
   * Star flies from it to them as it says what for, and they celebrate as it lands. Skipped, it's
   * just theirs (it drops in over their head).
   */
  private async giveBonus(draw: BonusStar): Promise<void> {
    const { stage } = this.host;
    const seat = this.seats.get(draw.key);
    if (!seat) return;
    const who = this.whoOf(draw.key);
    if (who) await stage.allayTo(who, true);
    seat.stars++;
    const landing = who && !stage.skipping ? this.transfer(stage.allay(), who, "star", 1) : Promise.resolve();
    this.host.changed();
    await Promise.all([this.host.say("end.bonus.award", { award: line(`bonus.${draw.award}`), player: seat.name }), landing]);
  }

  /** The standings of those here, as the end ranks them. */
  private standingsOf(here: readonly Who[]): { key: string; stars: number; coins: number }[] {
    return here.flatMap((who) => {
      const seat = this.seats.get(who.key);
      return seat ? [{ key: who.key, stars: seat.stars, coins: seat.coins }] : [];
    });
  }

  /** Tests' end tie: the top seats made level with the leader, after the bonus Stars. */
  private tieForTests(here: readonly Who[]): void {
    const tie = Math.min(this.endTest.tie, here.length);
    if (tie < 2) return;
    const top = ranked(this.standingsOf(here).map((one) => ({ name: one.key, stars: one.stars, coins: one.coins }))).slice(0, tie);
    const leader = top[0];
    for (const one of top) {
      const seat = this.seats.get(one.name);
      if (!seat) continue;
      seat.stars = leader.stars;
      seat.coins = leader.coins;
    }
    this.host.changed();
    this.host.everyone(`Test: the top ${tie} are tied at ${count(leader.stars, "Star")} and ${count(leader.coins, "coin")}${this.endTest.stillTied ? ", and the sudden death will decide nothing" : ""}.`);
  }

  /**
   * A tie for first: Chris calls a sudden death, a minigame from the tiebreaker's pool for the tied
   * alone (end-game.ts), played from the podium's shot, the rest watching; if it decides nothing, the
   * Allay flies round the tied and picks one. Resolves with the final places, the tie decided.
   */
  private async tiebreak(places: readonly (readonly string[])[]): Promise<string[][]> {
    const { stage } = this.host;
    const tiedKeys = places[0] ?? [];
    const tied = tiedKeys.flatMap((key) => this.here().filter((who) => who.key === key));
    const names = tied.map((who) => who.name);
    stage.lineupShot();
    await this.host.say("end.tie.chris", { players: names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "") });
    let top: string[][] = [tied.map((who) => who.key)];
    const pool = tiebreakPool(this.host.minigames);
    const def = pickMinigame(pool, this.played, this.host.random);
    if (def && tied.length >= 2) {
      const keys = tied.map((who) => who.key);
      const onlookers = this.here().filter((who) => !keys.includes(who.key));
      const nameOf = (key: string) => tied.find((who) => who.key === key)?.name ?? key;
      await this.host.playMinigame(
        tiebreakFormat(tied.length),
        def,
        tied.map((who) => [who]),
        pool,
        onlookers,
        (outcome) => {
          top = this.endTest.stillTied ? [keys] : tiebreakPlaces(keys, outcome);
          const winners = top[0] ?? [];
          for (const key of keys) this.react(key, winners.length === 1 && winners[0] === key ? "Celebration" : "Sad");
          if (winners.length === 1) this.confetti(winners[0]);
          return { title: winners.length === 1 ? line("minigame.won.one", { player: nameOf(winners[0]) }) : line("minigame.won.tie", { count: winners.length }) };
        },
        { label: line("format.sudden"), here: true },
      );
    }
    if ((top[0]?.length ?? 0) > 1) {
      // Still tied: back on the podium, the Allay flies round them and lands on the one it picks.
      const still = (top[0] ?? []).flatMap((key) => this.here().filter((who) => who.key === key));
      const pick = still[Math.floor(this.host.random() * still.length)];
      if (pick) {
        await stage.endLineup(this.here());
        await this.host.cutscene(true, async () => {
          if (!stage.allay()) await stage.allayArrives();
          // Round them twice (once for three or more, so it doesn't drag), then to the pick.
          for (let lap = 0; lap < (still.length > 2 ? 1 : 2); lap++) for (const who of still) await stage.allayTo(who, false);
          await stage.allayTo(pick, true);
          this.react(pick.key, "Celebration");
          this.confetti(pick.key);
          await this.host.say("end.tie.allay", { player: pick.name });
        });
        top = withWinner(top, pick.key);
      }
    }
    return finalPlaces(this.standingsOf(this.here()), top);
  }

  /**
   * The final podium, best first (`places`, groups tied for a place): the camera eases in, the winner
   * celebrates and last place is sad, each holding the pose, Chris names the champion, the camera
   * goes round the winner, Chris thanks everyone, and the screen fades to black for the lobby.
   */
  private async finalPodium(places: readonly (readonly string[])[]): Promise<Result> {
    const { stage } = this.host;
    const here = this.here();
    const groups = places.map((group) => group.flatMap((key) => here.filter((who) => who.key === key))).filter((group) => group.length > 0);
    const winner = groups[0]?.[0];
    const seat = winner ? this.seats.get(winner.key) : undefined;
    await this.host.cutscene(true, async () => {
      await stage.finalPodium(groups);
      if (winner) {
        this.react(winner.key, "Celebration", true);
        for (let burst = 0; burst < CHAMPION_BURSTS; burst++) this.host.scope.timeout(() => this.confetti(winner.key), burst * BURST_GAP);
      }
      if (groups.length > 1) for (const who of groups[groups.length - 1]) this.react(who.key, "Sad", true);
      await this.host.say("end.podium", { player: winner?.name ?? "" });
      if (winner) await stage.orbit(winner);
      stage.finalShot();
      await this.host.say("end.thanks");
    });
    this.host.everyone(line("end.standings", { standings: this.standings().join("; ") }));
    stage.fadeOut(END_FADE_TICKS / 20, END_BLACK);
    await this.host.scope.wait(END_FADE_TICKS + 2);
    this.running = false;
    if (!winner || !seat) return { kind: "draw", reason: "nobody was left at the end" };
    return { kind: "win", players: [winner.name], reason: `${count(seat.stars, "Star")} and ${count(seat.coins, "coin")}` };
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
