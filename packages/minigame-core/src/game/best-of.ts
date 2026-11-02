// Best-of rounds, as plain logic: a match played as a series of rounds, each won by one side (a
// player, or a team in team games) or drawn, until a side has won more than half of them (best of
// 5: the first to 3), or the first to a number of wins. Not turn-based rounds, where sides take
// turns, which are a separate system still to come. The Minigame runs the rounds; this keeps the
// count and says how the HUD shows it (hud.ts bestOfCodes).
import type { BestOfConfig } from "../config.ts";

/** The fewest rounds a best-of series can have. */
export const MIN_BEST_OF = 3;
/** The most rounds the icons display has room for, one circle each. */
export const MAX_ROUND_ICONS = 7;
/** The most sides the score display has room for ("R | Y | G | B"). */
export const MAX_SCORE_SIDES = 4;
/** The highest round count the score display shows for a side. */
export const MAX_SHOWN_WINS = 99;

export class BestOf {
  /** The most rounds the series can last, or undefined for first-to series. */
  readonly rounds: number | undefined;
  /** Round wins that take the match. */
  readonly winsNeeded: number;
  /** Each round's winning side, or undefined for a drawn round, in order. */
  private readonly winners: (string | undefined)[] = [];

  constructor(options: { rounds?: number; firstTo?: number }) {
    if (options.firstTo !== undefined) {
      this.rounds = undefined;
      this.winsNeeded = Math.max(1, Math.floor(options.firstTo));
    } else {
      this.rounds = Math.max(MIN_BEST_OF, Math.floor(options.rounds ?? MIN_BEST_OF));
      this.winsNeeded = Math.floor(this.rounds / 2) + 1;
    }
  }

  /** The number of the round being played (or next up). */
  get round(): number {
    return this.winners.length + 1;
  }

  get history(): readonly (string | undefined)[] {
    return this.winners;
  }

  /** Records a round: its winning side, or undefined for a draw. */
  record(side: string | undefined): void {
    this.winners.push(side);
  }

  wins(side: string): number {
    return this.winners.filter((winner) => winner === side).length;
  }

  /**
   * Whether the series is over, and who took it: the first side to the wins needed. Once every
   * round of a best-of series has been played without that, the most round wins takes it, and a
   * tie is a draw.
   */
  outcome(sides: readonly string[]): { over: false } | { over: true; winner?: string } {
    const champion = sides.find((side) => this.wins(side) >= this.winsNeeded);
    if (champion !== undefined) return { over: true, winner: champion };
    if (this.rounds === undefined || this.winners.length < this.rounds) return { over: false };
    return { over: true, winner: this.leader(sides) };
  }

  /** The side with the most round wins, or undefined when it's tied (or nobody has won one). */
  leader(sides: readonly string[]): string | undefined {
    const ranked = sides.map((side) => ({ side, wins: this.wins(side) })).sort((a, b) => b.wins - a.wins);
    if (ranked.length === 0 || ranked[0].wins === 0) return undefined;
    return ranked.length > 1 && ranked[1].wins === ranked[0].wins ? undefined : ranked[0].side;
  }
}

/** The best-of rounds a match plays: the config's, with `rounds` replaced by the lobby option's value when it names one. */
export function bestOfRounds(config: BestOfConfig, settings: Readonly<Record<string, string>> | undefined): { rounds?: number; firstTo?: number } {
  if (config.firstTo !== undefined) return { firstTo: config.firstTo };
  const picked = config.option !== undefined ? Number(settings?.[config.option]) : Number.NaN;
  return { rounds: Number.isInteger(picked) && picked >= MIN_BEST_OF ? picked : (config.rounds ?? MIN_BEST_OF) };
}

/** How the HUD shows a series: the config's choice, else icons when they fit (two sides, up to 7 rounds), else the score. */
export function bestOfDisplay(config: BestOfConfig, series: BestOf, sides: number): "icons" | "score" {
  const fits = sides === 2 && series.rounds !== undefined && series.rounds <= MAX_ROUND_ICONS;
  if (config.display === "icons" && fits) return "icons";
  if (config.display === "score") return "score";
  return fits ? "icons" : "score";
}
