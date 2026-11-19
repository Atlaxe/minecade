// Block Party's end of the game (docs/plans/block-party.md, "End-of-game bonus Stars" and
// "Tiebreaker"; pass 8), the pure parts, so the tests can check them:
//   - What the game keeps on each seat through the game for the bonus Stars (GameStats): the
//     hazards they hit, their biggest coin swing, their best roll, what luck brought them, their
//     minigame wins, streaks, second places and team wins, the items they used, the times they were
//     out in a minigame, the risks they took, and their place after every round.
//   - The awards in four categories (AWARDS) and the draw (drawBonusStars): 3 bonus Stars with 3 or
//     4 seats, 2 with 2 (bonusStarCount), never two from one category and at most one each. Each
//     goes to whoever did the most of its thing; a tie among those without one yet is picked at
//     random, and an award whose best already has one isn't given (it's never a runner-up's).
//   - The tiebreaker: its minigame pool and format, and the places once it has decided
//     (finalPlaces, tiebreakPlaces).
// board-loop.ts plays the end; stage.ts puts it on stage.
import type { Format } from "./minigame-rules.ts";
import type { MinigameDef, Outcome } from "./minigames/kit.ts";

export type AwardCategory = "chaos" | "skill" | "behavior" | "participation";

export const AWARD_CATEGORIES: readonly AwardCategory[] = ["chaos", "skill", "behavior", "participation"];

/** What the game keeps on a seat through the game for the bonus Stars. */
export interface SeatStats {
  /** Red and Warden spaces landed on, and a zombie's bites. */
  hazards: number;
  /** The most coins won or lost at once (what they spent of their own accord doesn't count). */
  swing: number;
  /** The highest a roll took them. */
  bestRoll: number;
  /** Coins (and Stars, at their price) that came to them while Chance Time or a Happening played. */
  luck: number;
  /** Minigames won (the winning side of a team minigame, everyone tied for first) and duels won. */
  wins: number;
  /** Round minigames won in a row, now and at the most. */
  streak: number;
  bestStreak: number;
  /** Second places in a free-for-all minigame (one player ahead of them). */
  seconds: number;
  /** 2v2 and 1v3 minigames won. */
  teamWins: number;
  itemsUsed: number;
  /** Times they were out in a minigame (fell, were caught). */
  outs: number;
  /** Bets on a duel, Double or Nothing, and Risk and Mystery Dice rolled. */
  risks: number;
  /** Their place after each round's minigame, by round (1 first; ties share a place). */
  places: Map<number, number>;
}

/** Where a seat stands as the game ends, before the bonus Stars. */
export interface SeatEnd {
  /** Their place (1 first; ties share a place). */
  place: number;
  /** In last place, with someone ahead of them. */
  last: boolean;
  /** The special dice and items they still hold. */
  held: number;
  /** The game's last round. */
  rounds: number;
}

export interface AwardDef {
  id: string;
  category: AwardCategory;
  /** A seat's score for it at the end: the highest wins; 0 or less never does. */
  score(stats: SeatStats, end: SeatEnd): number;
}

/** How far a seat climbed from its place after `round` to where it is now (0 when it has no place then). */
function climbSince(stats: SeatStats, round: number, end: SeatEnd): number {
  const then = stats.places.get(round);
  return then === undefined ? 0 : then - end.place;
}

/** How far a seat climbed from its worst place in the game to where it is now. */
function comeback(stats: SeatStats, end: SeatEnd): number {
  const worst = Math.max(0, ...stats.places.values());
  return worst === 0 ? 0 : worst - end.place;
}

/** Rounds before the end the surge award looks back from. */
export const SURGE_ROUNDS = 5;

/**
 * The awards (the plan's list, less what the minigames don't report yet: kills, deaths left
 * standing, and wins decided in a minigame's last seconds). Each one's name is the dialogue file's
 * `bonus.<id>` line, the {award} in end.bonus.award.
 */
export const AWARDS: readonly AwardDef[] = [
  { id: "hazards", category: "chaos", score: (stats) => stats.hazards },
  { id: "swing", category: "chaos", score: (stats) => stats.swing },
  { id: "roll", category: "chaos", score: (stats) => stats.bestRoll },
  { id: "luck", category: "chaos", score: (stats) => stats.luck },
  { id: "wins", category: "skill", score: (stats) => stats.wins },
  // A streak is 2 wins in a row at the least.
  { id: "streak", category: "skill", score: (stats) => (stats.bestStreak >= 2 ? stats.bestStreak : 0) },
  { id: "seconds", category: "skill", score: (stats) => stats.seconds },
  { id: "items", category: "behavior", score: (stats) => stats.itemsUsed },
  { id: "hoard", category: "behavior", score: (_, end) => end.held },
  { id: "tumbles", category: "behavior", score: (stats) => stats.outs },
  { id: "risks", category: "behavior", score: (stats) => stats.risks },
  { id: "comeback", category: "participation", score: comeback },
  { id: "underdog", category: "participation", score: (_, end) => (end.last ? 1 : 0) },
  { id: "improved", category: "participation", score: (stats, end) => climbSince(stats, 1, end) },
  { id: "surge", category: "participation", score: (stats, end) => (end.rounds > SURGE_ROUNDS ? climbSince(stats, end.rounds - SURGE_ROUNDS, end) : 0) },
  { id: "team", category: "participation", score: (stats) => stats.teamWins },
];

/** How many bonus Stars the Allay brings: 3 with 3 or 4 seats, 2 with 2 (at most 1 each), none for one alone. */
export function bonusStarCount(seats: number): number {
  return seats >= 3 ? 3 : seats === 2 ? 2 : 0;
}

/** A bonus Star: the award, and who it goes to (by key). */
export interface BonusStar {
  award: string;
  key: string;
}

/** A seat as the draw sees it. */
export interface DrawSeat {
  key: string;
  stats: SeatStats;
  end: SeatEnd;
}

/** The keys tied for an award's best score (none when the best is 0 or less). */
export function bestFor(award: AwardDef, seats: readonly DrawSeat[]): string[] {
  const scored = seats.map((seat) => ({ key: seat.key, score: award.score(seat.stats, seat.end) }));
  const best = Math.max(0, ...scored.map((one) => one.score));
  return best <= 0 ? [] : scored.filter((one) => one.score === best).map((one) => one.key);
}

/**
 * The bonus Stars, drawn at random each game: the categories in a random order, and in each the
 * first of its awards (in a random order) whose best has no bonus Star yet goes to them (one of the
 * tied best at random). A category with none to give is passed over. Stops at `count`.
 */
export function drawBonusStars(seats: readonly DrawSeat[], count: number, random: () => number): BonusStar[] {
  const out: BonusStar[] = [];
  const awarded = new Set<string>();
  for (const category of shuffled(AWARD_CATEGORIES, random)) {
    if (out.length >= count) break;
    for (const award of shuffled(
      AWARDS.filter((one) => one.category === category),
      random,
    )) {
      const open = bestFor(award, seats).filter((key) => !awarded.has(key));
      if (open.length === 0) continue;
      const key = open[Math.floor(random() * open.length)];
      awarded.add(key);
      out.push({ award: award.id, key });
      break;
    }
  }
  return out;
}

function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A blank record for a seat. */
export function newStats(): SeatStats {
  return { hazards: 0, swing: 0, bestRoll: 0, luck: 0, wins: 0, streak: 0, bestStreak: 0, seconds: 0, teamWins: 0, itemsUsed: 0, outs: 0, risks: 0, places: new Map() };
}

/** The dice whose roll counts as a risk taken. */
export const RISKY_DICE: readonly string[] = ["risk", "mystery"];

/** What the game keeps on every seat through the game, by key. */
export class GameStats {
  private readonly seats = new Map<string, SeatStats>();

  /** A seat's record (a blank one until something happens to it). */
  of(key: string): SeatStats {
    let stats = this.seats.get(key);
    if (!stats) {
      stats = newStats();
      this.seats.set(key, stats);
    }
    return stats;
  }

  hazard(key: string): void {
    this.of(key).hazards++;
  }

  /** Coins won (above 0) or lost at once, less what they spent of their own accord. */
  coins(key: string, change: number): void {
    const stats = this.of(key);
    stats.swing = Math.max(stats.swing, Math.abs(change));
  }

  rolled(key: string, move: number): void {
    const stats = this.of(key);
    stats.bestRoll = Math.max(stats.bestRoll, move);
  }

  /** Coins' worth that came to them from luck (Chance Time, a Happening). */
  lucky(key: string, worth: number): void {
    if (worth > 0) this.of(key).luck += worth;
  }

  item(key: string): void {
    this.of(key).itemsUsed++;
  }

  out(key: string): void {
    this.of(key).outs++;
  }

  risk(key: string): void {
    this.of(key).risks++;
  }

  /**
   * A round's minigame played (`sides` by key, as it was played): its winners' wins and streaks (a
   * team minigame's winning side, everyone tied for first in a free-for-all), its second places (a
   * free-for-all's players with one ahead of them), and a streak gone for everyone else.
   */
  minigame(sides: readonly (readonly string[])[], outcome: Outcome): void {
    let won: readonly string[] = [];
    if ("places" in outcome) {
      won = outcome.places[0] ?? [];
      if (won.length === 1) for (const key of outcome.places[1] ?? []) this.of(key).seconds++;
    } else if (outcome.winner !== undefined) {
      won = sides[outcome.winner] ?? [];
      for (const key of won) this.of(key).teamWins++;
    }
    for (const key of sides.flat()) {
      const stats = this.of(key);
      if (won.includes(key)) {
        stats.wins++;
        stats.streak++;
        stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
      } else stats.streak = 0;
    }
  }

  /** A duel won (a Versus space, the Dueling Glove): a win, outside the round minigames' streaks. */
  duel(winner: string | undefined): void {
    if (winner !== undefined) this.of(winner).wins++;
  }

  /** Everyone's place after round `round`'s minigame. */
  roundOver(round: number, places: ReadonlyMap<string, number>): void {
    for (const [key, place] of places) this.of(key).places.set(round, place);
  }
}

/** The tiebreaker's short pool (the plan's): Quick Draw, Hot Floor and Sumo Duel, as they're built. */
export const TIEBREAK_IDS: readonly string[] = ["quickdraw", "hotfloor", "sumoduel"];

/** The tiebreaker's minigames: the pool's that are built, else every free-for-all one. */
export function tiebreakPool(minigames: readonly MinigameDef[]): MinigameDef[] {
  const ffa = minigames.filter((minigame) => minigame.kind === "ffa");
  const pool = ffa.filter((minigame) => TIEBREAK_IDS.includes(minigame.id));
  return pool.length > 0 ? pool : ffa;
}

/** The tiebreaker's format: a duel for two, a free-for-all for three or more. */
export function tiebreakFormat(tied: number): Format {
  return tied === 2 ? "duel" : "ffa";
}

/** Standings as finalPlaces reads them. */
export interface EndStanding {
  key: string;
  stars: number;
  coins: number;
}

/**
 * The final places, best first, as groups tied for a place: by Stars, then coins. `top` (the
 * tiebreaker's places among those tied for first, best first) replaces the first group; anyone of
 * that group it leaves out comes after it.
 */
export function finalPlaces(seats: readonly EndStanding[], top?: readonly (readonly string[])[]): string[][] {
  const sorted = [...seats].sort((a, b) => b.stars - a.stars || b.coins - a.coins);
  const groups: string[][] = [];
  let last: EndStanding | undefined;
  for (const seat of sorted) {
    if (last && last.stars === seat.stars && last.coins === seat.coins) groups[groups.length - 1].push(seat.key);
    else groups.push([seat.key]);
    last = seat;
  }
  if (!top || groups.length === 0) return groups;
  const first = groups[0];
  const decided = top.map((group) => group.filter((key) => first.includes(key))).filter((group) => group.length > 0);
  const left = first.filter((key) => !decided.some((group) => group.includes(key)));
  return [...decided, ...(left.length > 0 ? [left] : []), ...groups.slice(1)];
}

/**
 * The tiebreaker's places among `tied` from its minigame's outcome, best first: a free-for-all's
 * places (anyone it left out last, together), or everyone together when it decided nothing.
 */
export function tiebreakPlaces(tied: readonly string[], outcome: Outcome): string[][] {
  if (!("places" in outcome)) return [[...tied]];
  const groups = outcome.places.map((group) => group.filter((key) => tied.includes(key))).filter((group) => group.length > 0);
  const left = tied.filter((key) => !groups.some((group) => group.includes(key)));
  const out = [...groups, ...(left.length > 0 ? [left] : [])];
  return out.length > 0 ? out : [[...tied]];
}

/** Places with the first group decided: `winner` alone first, the rest of that group after. */
export function withWinner(places: readonly (readonly string[])[], winner: string): string[][] {
  const [first = [], ...rest] = places;
  const others = first.filter((key) => key !== winner);
  return [[winner], ...(others.length > 0 ? [others] : []), ...rest.map((group) => [...group])];
}
