// Block Party's board rules (docs/plans/block-party.md: "Core loop", "Space types", "Stars"), pure
// so the tests can check them: what a space pays, a Star's price, where the Stars start and move,
// the turn order, the standings and the winner. The loop (board-loop.ts) plays them out.

/** What a game needs of a space here: where it leads, its type, and whether the Star can be there. */
export interface RuleSpace {
  index: number;
  type: string;
  next: number[];
  star?: boolean;
  opening?: boolean;
}

/** Coins everyone starts with (Chris hands them out). */
export const START_COINS = 10;

/** What landing on a space does to the lander's coins (Blue +3, Red -3; the rest come with their passes). */
export function coinsFor(type: string): number {
  return type === "blue" ? 3 : type === "red" ? -3 : 0;
}

/** Coins after a change: never below 0 (a payment is capped at what the payer has). */
export function addCoins(coins: number, change: number): number {
  return Math.max(0, coins + change);
}

/** The game's lengths (the lobby's Length option), the first the default. */
export const LENGTHS = [15, 10, 20] as const;

/** The lobby's Bots option: how many bots join a game one player starts (bots.ts), the first the default. */
export const BOT_COUNTS = [3, 2, 1, 0] as const;

/** A Star's price by the game's length: 15 coins in 10 turns, 20 in 15, 25 in 20. */
export function starPrice(turns: number): number {
  return turns <= 10 ? 15 : turns <= 15 ? 20 : 25;
}

/** How many Stars are out at once: two in a 10-turn game, else one. */
export function activeStars(turns: number): number {
  return turns <= 10 ? 2 : 1;
}

/** Steps between spaces whichever way the links go (for how far a Star moves). */
export function apartFrom(spaces: readonly RuleSpace[], from: number): Map<number, number> {
  const before = new Map<number, number[]>();
  for (const space of spaces) for (const next of space.next) before.set(next, [...(before.get(next) ?? []), space.index]);
  const seen = new Map<number, number>([[from, 0]]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const other of [...(spaces[at]?.next ?? []), ...(before.get(at) ?? [])]) {
      if (seen.has(other)) continue;
      seen.set(other, seen.get(at)! + 1);
      queue.push(other);
    }
  }
  return seen;
}

/**
 * Where the Stars start: the opening spots (all of them, when as many Stars are out), else at random
 * among them; a board without enough opening spots fills in with Star candidates, then any space but
 * Start. `random` gives 0 to 1.
 */
export function firstStars(spaces: readonly RuleSpace[], count: number, random: () => number): number[] {
  const pools = [spaces.filter((space) => space.opening), spaces.filter((space) => space.star && !space.opening), spaces.filter((space) => !space.star && space.type !== "start")];
  const out: number[] = [];
  for (const pool of pools) {
    const left = pool.map((space) => space.index);
    while (out.length < count && left.length > 0) out.push(left.splice(Math.floor(random() * left.length), 1)[0]);
  }
  return out;
}

/**
 * Where a bought Star goes: a random Star candidate at least `far` spaces from where it was (the
 * plan's ~12, or about 30% of the loop on bigger boards), not where another Star is; the furthest
 * candidates when none is that far; any other space when the board has no other candidate.
 */
export function nextStar(spaces: readonly RuleSpace[], from: number, taken: readonly number[], far: number, random: () => number): number {
  const apart = apartFrom(spaces, from);
  const candidates = spaces.filter((space) => space.star && space.index !== from && !taken.includes(space.index));
  const pool = candidates.length > 0 ? candidates : spaces.filter((space) => space.index !== from && space.type !== "start" && !taken.includes(space.index));
  if (pool.length === 0) return from;
  const distant = pool.filter((space) => (apart.get(space.index) ?? 0) >= far);
  const most = Math.max(...pool.map((space) => apart.get(space.index) ?? 0));
  const choices = distant.length > 0 ? distant : pool.filter((space) => (apart.get(space.index) ?? 0) === most);
  return choices[Math.floor(random() * choices.length)].index;
}

/** How far a bought Star moves at least: about 12 spaces, or 30% of the loop on a bigger board. */
export function starDistance(loopLength: number): number {
  return Math.max(Math.min(12, Math.floor(loopLength / 2)), Math.round(loopLength * 0.3));
}

/** A player's standing: Stars first, then coins. */
export interface Standing {
  name: string;
  stars: number;
  coins: number;
}

/** Best first: most Stars, then most coins, then name (so the order is the same every time). */
export function ranked(players: readonly Standing[]): Standing[] {
  return [...players].sort((a, b) => b.stars - a.stars || b.coins - a.coins || a.name.localeCompare(b.name));
}

/** The winners: everyone tied for the top on Stars and coins (the tiebreaker picks among them). */
export function leaders(players: readonly Standing[]): Standing[] {
  const [top] = ranked(players);
  return top ? players.filter((player) => player.stars === top.stars && player.coins === top.coins) : [];
}

/** The turn order from everyone's roll: highest first; a tie keeps the order the players came in. */
export function turnOrder(rolls: readonly { name: string; roll: number }[]): string[] {
  return rolls
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.roll - a.roll || a.index - b.index)
    .map((entry) => entry.name);
}

/** "1 Star", "2 Stars"; "1 coin", "12 coins". */
export function count(amount: number, word: string): string {
  return `${amount} ${word}${amount === 1 ? "" : "s"}`;
}
