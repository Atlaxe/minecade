// Block Party's minigame rules (docs/plans/block-party.md: "Minigame formats", "Coins awarded",
// "Versus and the Dueling Glove"), pure so the tests can check them: which format a round plays,
// who's on which side, which minigame comes up, and what everyone is paid.
import type { Outcome } from "./minigames/kit.ts";

/** A round's format. A Battle plays an FFA minigame with a pot; a duel plays one with two players. */
export type Format = "ffa" | "battle" | "2v2" | "1v3" | "duel";

/** What a minigame is made for: Battles and duels play the FFA ones. */
export type Kind = "ffa" | "2v2" | "1v3";

export function kindOf(format: Format): Kind {
  return format === "2v2" || format === "1v3" ? format : "ffa";
}

/** About 1 FFA round in 8 is played as a Battle. */
export const BATTLE_CHANCE = 1 / 8;

/**
 * A round's format: every 3rd round is a team game, taking turns between 2v2 and 1v3 (with 3
 * players always 1v3, played 1v2); the others are FFA, about 1 in 8 a Battle. 2 players play FFA
 * only.
 */
export function formatFor(round: number, players: number, random: () => number): Format {
  if (players >= 3 && round % 3 === 0) return players === 3 || (round / 3) % 2 === 0 ? "1v3" : "2v2";
  return players >= 2 && random() < BATTLE_CHANCE ? "battle" : "ffa";
}

/** Whether a format can be played by `players`: 2v2 needs 4, 1v3 (1v2) at least 3, a Battle or a duel 2. */
export function fits(format: Format, players: number): boolean {
  if (format === "2v2") return players === 4;
  if (format === "1v3") return players >= 3;
  if (format === "battle" || format === "duel") return players >= 2;
  return players >= 1;
}

/** Picks one of `choices` at random; ties broken by `random`. */
function anyOf<T>(choices: readonly T[], random: () => number): T {
  return choices[Math.floor(random() * choices.length)];
}

/** The 1v3 solo: whoever has been the solo least so far (at random among them). */
export function pickSolo(names: readonly string[], soloCounts: ReadonlyMap<string, number>, random: () => number): string {
  const least = Math.min(...names.map((name) => soloCounts.get(name) ?? 0));
  return anyOf(
    names.filter((name) => (soloCounts.get(name) ?? 0) === least),
    random,
  );
}

/** A 2v2 pairing's key, the same whichever way round it's written: "a+b|c+d". */
export function pairingKey(sides: readonly (readonly string[])[]): string {
  return sides
    .map((side) => [...side].sort().join("+"))
    .sort()
    .join("|");
}

/** The 2v2 pairs for four players: the pairing played least so far (at random among them). */
export function pickPairs(names: readonly string[], used: ReadonlyMap<string, number>, random: () => number): [string[], string[]] {
  const [a, b, c, d] = names;
  const pairings: [string[], string[]][] = [
    [
      [a, b],
      [c, d],
    ],
    [
      [a, c],
      [b, d],
    ],
    [
      [a, d],
      [b, c],
    ],
  ];
  const least = Math.min(...pairings.map((pairing) => used.get(pairingKey(pairing)) ?? 0));
  return anyOf(
    pairings.filter((pairing) => (used.get(pairingKey(pairing)) ?? 0) === least),
    random,
  );
}

/** One played already this game is about a twentieth as likely to come up as a fresh one. */
export const PLAYED_WEIGHT = 1 / 20;

/** A minigame for the round, at random from `pool`, the ones played already much less likely. */
export function pickMinigame<T extends { id: string }>(pool: readonly T[], played: ReadonlyMap<string, number>, random: () => number): T | undefined {
  const weights = pool.map((minigame) => ((played.get(minigame.id) ?? 0) > 0 ? PLAYED_WEIGHT : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** FFA payouts by place, by how many play. */
const FFA_PAYOUTS: Record<number, readonly number[]> = { 1: [10], 2: [10, 3], 3: [10, 5, 2], 4: [10, 6, 3, 1] };

/**
 * FFA coins: `places` best first, each a group tied for that place. A tie shares the places it
 * covers, each paid their average (2 tied for 1st of 4 get (10 + 6) / 2 = 8), rounded.
 */
export function ffaCoins(places: readonly (readonly string[])[]): Map<string, number> {
  const players = places.reduce((sum, group) => sum + group.length, 0);
  const payouts = FFA_PAYOUTS[Math.min(4, Math.max(1, players))] ?? [];
  const coins = new Map<string, number>();
  let place = 0;
  for (const group of places) {
    const covered = payouts.slice(place, place + group.length);
    const average = group.length === 0 ? 0 : Math.round(covered.reduce((sum, value) => sum + value, 0) / group.length);
    for (const name of group) coins.set(name, average);
    place += group.length;
  }
  return coins;
}

/**
 * Team coins: 2v2 winners 7 each, losers 2; 1v3 (sides[0] the solo) a solo win pays the solo 10 and
 * each of the trio 1, a trio win pays each of the trio 6 and the solo 2. `winner` is the winning
 * side's index, or undefined for a draw (everyone paid as the losing side).
 */
export function teamCoins(format: "2v2" | "1v3", sides: readonly (readonly string[])[], winner: number | undefined): Map<string, number> {
  const coins = new Map<string, number>();
  sides.forEach((side, index) => {
    const won = index === winner;
    const amount = format === "2v2" ? (won ? 7 : 2) : index === 0 ? (won ? 10 : 2) : won ? 6 : 1;
    for (const name of side) coins.set(name, amount);
  });
  return coins;
}

/**
 * Who celebrates and who's sad after a minigame (block-party-ui.md, "Player animations"), by key:
 * the winners celebrate, and those who come away with nothing are sad (the user: last place, the
 * losing side of a team minigame; in a Battle everyone but its winners, whose bets are gone). A
 * draw moves nobody, and a tie for first with nobody behind is everyone's win.
 */
export function minigameMoods(format: Format, sides: readonly (readonly string[])[], outcome: Outcome): Map<string, "Celebration" | "Sad"> {
  const moods = new Map<string, "Celebration" | "Sad">();
  if ("places" in outcome) {
    const winners = outcome.places[0] ?? [];
    if (winners.length === 0) return moods;
    const behind = format === "battle" ? outcome.places.slice(1).flat() : outcome.places.length > 1 ? outcome.places[outcome.places.length - 1] : [];
    for (const key of behind) moods.set(key, "Sad");
    for (const key of winners) moods.set(key, "Celebration");
    return moods;
  }
  if (outcome.winner === undefined) return moods;
  sides.forEach((side, index) => {
    for (const key of side) moods.set(key, index === outcome.winner ? "Celebration" : "Sad");
  });
  return moods;
}

/** A Battle's bet: 5 coins each, capped at what they have. */
export const BATTLE_BET = 5;

/** What each puts in a Battle's pot. */
export function battleBets(coins: ReadonlyMap<string, number>): Map<string, number> {
  return new Map([...coins].map(([name, have]) => [name, Math.min(BATTLE_BET, Math.max(0, have))]));
}

/** The pot split among the winners (ties split it; what doesn't divide goes back to the bank). */
export function splitPot(pot: number, winners: readonly string[]): Map<string, number> {
  const share = winners.length === 0 ? 0 : Math.floor(pot / winners.length);
  return new Map(winners.map((name) => [name, share]));
}

/** Coins awarded (and duel stakes) double in the last 2 rounds, the last one only in a 10-turn game. */
export function isDoubled(round: number, turns: number): boolean {
  return turns <= 10 ? round >= turns : round > turns - 2;
}

/** The first round that doubles. */
export function firstDoubled(turns: number): number {
  return turns <= 10 ? turns : turns - 1;
}

/** A Versus space's stake: the loser pays the winner this (capped at what they have). */
export const VERSUS_STAKE = 5;

/**
 * Who a name typed into /minigame win means, out of `names` (case aside): the name itself, else the
 * only one that starts with it, else the only one that has it in it (a gamertag with spaces needs
 * only its first word). undefined for none, or more than one.
 */
export function pickName(names: readonly string[], typed: string): string | undefined {
  const want = typed.trim().toLowerCase();
  if (want === "") return undefined;
  const exact = names.find((name) => name.toLowerCase() === want);
  if (exact !== undefined) return exact;
  for (const matches of [(name: string) => name.toLowerCase().startsWith(want), (name: string) => name.toLowerCase().includes(want)]) {
    const found = names.filter(matches);
    if (found.length === 1) return found[0];
    if (found.length > 1) return undefined;
  }
  return undefined;
}

/**
 * A minigame ended by /minigame win (testing), with `winner` (a key in `sides`) winning: an FFA
 * minigame (a Battle and a duel too) places them first and everyone else tied second; a team
 * minigame is won by their side. undefined when they aren't on a side.
 */
export function forcedOutcome(kind: Kind, sides: readonly (readonly string[])[], winner: string): Outcome | undefined {
  const side = sides.findIndex((members) => members.includes(winner));
  if (side < 0) return undefined;
  if (kind !== "ffa") return { winner: side };
  const rest = sides.flat().filter((key) => key !== winner);
  return { places: rest.length > 0 ? [[winner], rest] : [[winner]] };
}
