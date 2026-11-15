// Guess the Build's telephone, as plain logic. Everyone sits in a circle (a shuffled order) and owns
// one chain, which starts from a dealt prompt (never one written by anyone in the match) and lives in
// their copy of the arena. At each step everyone works on the chain of the player `step` seats after
// them: odd steps build (the chain's prompt, then each guess), even steps guess what the build before
// is. Each chain gets 2 builds with 3 players and one more for each player after, 5 at most, with a
// guess between each, so a match always ends on a build (the user's ask, 2026-11-14). That's as many
// steps as players or more, so everyone works on every chain, their own too, and with 4 or more
// players the circle comes round again: the same player works on a chain twice, never in a row.

export type StepKind = "build" | "guess";

/** One build in a chain: who built it, the text they built from, and its snapshot's name. */
export interface BuildEntry {
  kind: "build";
  step: number;
  by: string;
  from: string;
  snapshot: string;
  /** What the showcase's vote gave it; undefined until then, or when it couldn't be voted on. */
  points?: number;
}

/** One guess in a chain: who guessed, and what (undefined when they didn't). */
export interface GuessEntry {
  kind: "guess";
  step: number;
  by: string;
  text: string | undefined;
}

export type ChainEntry = BuildEntry | GuessEntry;

export interface Chain {
  /** Its seat, which is also its arena's place. */
  index: number;
  owner: string;
  prompt: string;
  entries: ChainEntry[];
}

/** Each chain's builds: 2 for 3 players (or fewer), one more for each player after, this many at most. */
export const MIN_BUILDS = 2;
export const MAX_BUILDS = 5;

/** How many builds each chain gets in a match of `players`. */
export function buildCount(players: number): number {
  return Math.min(MAX_BUILDS, Math.max(MIN_BUILDS, players - 1));
}

/** How many steps a match of `players` has: its builds with a guess between each, so it ends on a build. */
export function stepCount(players: number): number {
  return 2 * buildCount(players) - 1;
}

/** Odd steps build, even steps guess (steps count from 1). */
export function stepKind(step: number): StepKind {
  return step % 2 === 1 ? "build" : "guess";
}

/** The seat that works on chain `chain` at `step`: the one `step` seats before it. */
export function workerSeat(chain: number, step: number, seats: number): number {
  return (((chain - step) % seats) + seats) % seats;
}

/** The chain the player in `seat` works on at `step`. */
export function chainOf(seat: number, step: number, seats: number): number {
  return (seat + step) % seats;
}

/**
 * What a chain's next build is built from: its last guess; with no guess given (the guesser left or
 * wrote nothing), what the build before it was built from; with no build yet, its prompt.
 */
export function nextText(chain: Chain): string {
  for (let i = chain.entries.length - 1; i >= 0; i--) {
    const entry = chain.entries[i];
    if (entry.kind === "guess" && entry.text) return entry.text;
    if (entry.kind === "build") return entry.from;
  }
  return chain.prompt;
}

/** The build a chain's guesser looks at in `step`: the one made the step before, if there is one. */
export function buildToGuess(chain: Chain, step: number): BuildEntry | undefined {
  const last = chain.entries.at(-1);
  return last?.kind === "build" && last.step === step - 1 ? last : undefined;
}
