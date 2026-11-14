// Guess the Build's telephone, as plain logic. Everyone sits in a circle (a shuffled order) and owns
// one chain, which starts from a prompt dealt to them (never one written by anyone else in the
// match) and lives in their copy of the arena. At each step everyone works on the chain of the player
// `step` seats after them: odd steps build (the chain's prompt, then each guess), even steps guess
// what the build before is. A match has one step fewer than players, so everyone works on every
// chain but their own once, and nobody sees their own chain's prompt until the end.

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

/** How many steps a match of `players` has: everyone works once on every chain but their own. At least one. */
export function stepCount(players: number): number {
  return Math.max(1, players - 1);
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
