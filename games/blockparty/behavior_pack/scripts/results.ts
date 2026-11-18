// The results screen (docs/plans/block-party-ui.md, "The results screen"), after every minigame and
// when a player gets a Star: the camera's view darkened, Results top left, a row per player best
// first (the place, the head, Stars, coins). First the standings as they were; then the changes play
// out: the Stars and then the coins count up (or down) a step at a time, the rows swap into their
// new order a pair at a time, sliding past each other a quarter of a row at a time (the user: one
// place at a time, no jump cut), and 1st gets its border. Each step plays its event's sound.
// Once the changes have played, a jump goes on (the user, 2026-11-18: skippable after the place
// changes): the party leader's or the turn's player's, while the screen shows the jump prompt (its
// title has GO_ON_WORD); with no jump it goes after its hold, as before.
// A player who drops gets the standings as they are now on this screen, for them alone
// (standings(): the rows under STANDINGS_WORD, ui/hud_screen.json's bp_standings).
// resultFrames() is the pure part (what each step shows); ResultsScreen puts the frames on the game's
// sidebar (sidebar-rows.ts, screen-codes.ts's rows) one after another.
import type { Player } from "@minecraft/server";
import type { Scope } from "@minecade/minigame-core";
import { SCREEN_WORDS, SLIDE_STEPS, STANDINGS_WORD, codesOf, resultRows, type ResultRow } from "./screen-codes.ts";
import type { GameSidebar } from "./sidebar-rows.ts";
import { eventCue, playCue } from "./sounds.ts";

/** A player's standing at one moment. */
export interface ResultSeat {
  key: string;
  name: string;
  stars: number;
  coins: number;
}

/** One step of the screen: its rows top to bottom, how long it stays, the sound it comes in with. */
export interface Frame {
  rows: ResultRow[];
  ticks: number;
  sound?: string;
}

/** In the results' title once a jump can go on: the screen shows its jump prompt (the blockparty_results component's "Go on"). */
export const GO_ON_WORD = "bpj";

/** The screen's events (the user's sound map: event:<id>). */
export const RESULT_EVENTS = { open: "results.open", count: "results.count", swap: "results.swap", first: "results.first", close: "results.close" } as const;

/** Ticks each kind of step stays. */
export const RESULT_TICKS = { open: 30, star: 6, coin: 2, slide: 2, swap: 6, first: 16, hold: 70 } as const;
/** The most steps the coins take to count, however far they go. */
const COIN_STEPS = 20;

/** Each one's place: 1 and up, by Stars then coins, ties sharing one. */
export function placesOf(list: readonly { stars: number; coins: number }[]): number[] {
  return list.map((one) => 1 + list.filter((other) => other.stars > one.stars || (other.stars === one.stars && other.coins > one.coins)).length);
}

/** Best first: Stars, then coins, then name. */
function rank<T extends { stars: number; coins: number; name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => b.stars - a.stars || b.coins - a.coins || a.name.localeCompare(b.name));
}

const toward = (from: number, to: number, step: number) => (from < to ? Math.min(to, from + step) : Math.max(to, from - step));

/**
 * The screen's frames from the standings `before` to `after` (the players in `after`; one missing
 * from `before` starts where they are now). Each player's seat (their rows' own code) is their
 * place in `after`'s list.
 */
export function resultFrames(before: readonly ResultSeat[], after: readonly ResultSeat[]): Frame[] {
  const was = new Map(before.map((seat) => [seat.key, seat]));
  const shown = after.map((seat, index) => ({ seat: index, key: seat.key, name: seat.name, stars: was.get(seat.key)?.stars ?? seat.stars, coins: was.get(seat.key)?.coins ?? seat.coins, target: seat }));
  let order = rank(shown);
  const frames: Frame[] = [];
  const firstPlaces = new Map(order.map((one, i) => [one.key, placesOf(order)[i]]));
  let placesNow: (list: typeof order) => number[] = (list) => list.map((one) => firstPlaces.get(one.key) ?? 1);
  const frame = (ticks: number, sound?: string, border = false, slides?: ReadonlyMap<string, number>) => {
    const places = placesNow(order);
    frames.push({
      rows: order.map((one, i) => {
        const slide = slides?.get(one.key);
        return { seat: one.seat, name: one.name, place: places[i], stars: one.stars, coins: one.coins, border: border && places[i] === 1, ...(slide ? { slide } : {}) };
      }),
      ticks,
      ...(sound ? { sound } : {}),
    });
  };
  frame(RESULT_TICKS.open, RESULT_EVENTS.open);
  // The Stars, a step at a time.
  while (shown.some((one) => one.stars !== one.target.stars)) {
    for (const one of shown) one.stars = toward(one.stars, one.target.stars, 1);
    frame(RESULT_TICKS.star, RESULT_EVENTS.count);
  }
  // The coins, in at most COIN_STEPS steps.
  const far = Math.max(0, ...shown.map((one) => Math.abs(one.target.coins - one.coins)));
  const step = Math.max(1, Math.ceil(far / COIN_STEPS));
  while (shown.some((one) => one.coins !== one.target.coins)) {
    for (const one of shown) one.coins = toward(one.coins, one.target.coins, step);
    frame(RESULT_TICKS.coin, RESULT_EVENTS.count);
  }
  // The new order, a swap of neighbors at a time: the two slide past each other a quarter of a row a
  // step, then trade places. From here each place is what the numbers say.
  placesNow = (list) => placesOf(list);
  const goal = rank(shown).map((one) => one.key);
  for (let swapped = true; swapped; ) {
    swapped = false;
    for (let i = 0; i + 1 < order.length; i++) {
      if (goal.indexOf(order[i].key) > goal.indexOf(order[i + 1].key)) {
        for (let step = 1; step < SLIDE_STEPS; step++) {
          frame(RESULT_TICKS.slide, step === 1 ? RESULT_EVENTS.swap : undefined, false, new Map([[order[i].key, step], [order[i + 1].key, -step]]));
        }
        order = [...order.slice(0, i), order[i + 1], order[i], ...order.slice(i + 2)];
        frame(RESULT_TICKS.swap);
        swapped = true;
      }
    }
  }
  frame(RESULT_TICKS.first, RESULT_EVENTS.first, true);
  frames.at(-1)!.ticks += RESULT_TICKS.hold;
  return frames;
}

/** The standings as the results screen shows them, best first, 1st bordered (a player's own view after a drop). */
export function standingRows(seats: readonly ResultSeat[]): ResultRow[] {
  const order = rank(seats);
  const places = placesOf(order);
  return order.map((one, i) => ({ seat: i, name: one.name, place: places[i], stars: one.stars, coins: one.coins, border: places[i] === 1 }));
}

export interface ResultsHost {
  scope: Scope;
  sidebar: GameSidebar;
  /** A player's head picture (a texture path), if the pack has one. */
  headOf(name: string): string | undefined;
  /** Whether `player`'s jump goes on from the screen once its changes have played (the leader's, the turn's player's). */
  mayGoOn?(player: Player): boolean;
}

export class ResultsScreen {
  private readonly host: ResultsHost;
  private on = false;
  /** The standings someone has up for themselves (standings()), if anyone does. */
  private standing: ResultSeat[] | undefined;
  /** The changes have played and the screen holds: a jump goes on (gone set by jumped()). */
  private holding: { gone: boolean } | undefined;

  constructor(host: ResultsHost) {
    this.host = host;
    host.scope.add(() => host.sidebar.set("results", undefined));
  }

  /** Whether it's up (the cards give way to it). */
  get showing(): boolean {
    return this.on;
  }

  /** Plays the screen from `before` to `after`; resolves once it's gone. */
  async show(before: readonly ResultSeat[], after: readonly ResultSeat[]): Promise<void> {
    if (after.length === 0) return;
    this.on = true;
    const title = codesOf(SCREEN_WORDS.results);
    try {
      const frames = resultFrames(before, after);
      for (const [index, frame] of frames.entries()) {
        const rows = frame.rows.map((row) => ({ ...row, head: this.host.headOf(row.name) }));
        const last = index === frames.length - 1;
        // The last frame holds: its jump prompt shows, and a jump goes on.
        this.host.sidebar.set("results", { title: last ? title + codesOf(GO_ON_WORD) : title, rows: resultRows(rows) });
        if (frame.sound) playCue(eventCue(frame.sound));
        if (!last) {
          await this.host.scope.wait(frame.ticks);
          continue;
        }
        const holding = { gone: false };
        this.holding = holding;
        for (let tick = 0; tick < frame.ticks && !holding.gone && !this.host.scope.disposed; tick++) await this.host.scope.wait(1);
      }
    } finally {
      this.holding = undefined;
      this.on = false;
      if (!this.host.scope.disposed) {
        this.drawStandings();
        playCue(eventCue(RESULT_EVENTS.close));
      }
    }
  }

  /** A jump: while the screen holds after its changes, the leader's (or the turn's player's) goes on. True when the screen took it. */
  jumped(player: Player): boolean {
    const holding = this.holding;
    if (!holding) return false;
    if (holding.gone || !(this.host.mayGoOn?.(player) ?? true)) return true;
    holding.gone = true;
    playCue(eventCue("dialogue.next"));
    return true;
  }

  /**
   * The standings on the sidebar while any player has their own results screen up (none: empty), for
   * them alone (the rows under STANDINGS_WORD); never over the results playing for everyone, and back
   * once those are over.
   */
  standings(seats: readonly ResultSeat[]): void {
    this.standing = seats.length > 0 ? [...seats] : undefined;
    if (!this.on) this.drawStandings();
  }

  private drawStandings(): void {
    if (!this.standing) {
      this.host.sidebar.set("results", undefined);
      return;
    }
    const rows = standingRows(this.standing).map((row) => ({ ...row, head: this.host.headOf(row.name) }));
    this.host.sidebar.set("results", { title: codesOf(STANDINGS_WORD), rows: resultRows(rows) });
  }
}
