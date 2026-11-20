// Hand-overs (the user, 2026-11-20): when a seat loses coins, Stars or an item to another seat, the
// scene shows it in cuts rather than in one shot. The camera is on the one losing them as they leave
// their head ("-X" over it), then it cuts to the one gaining them as they land ("+X"). With several
// gaining from the same one (Hush Money pays each of the others), it cuts to each of them in turn,
// before going on to the next one who loses something.
//   - The board loop queues each pass as the change is made (board-loop.ts, pass and pay) and shows
//     them after the line that tells of them (handOver; the results screen shows any still waiting).
//   - Each shot is a close one of that seat alone (stage-layout.ts, seatShot), so a token's flight is
//     cut in two (transfers.ts, leave and arrive): on the giver's shot it rises off their head toward
//     the taker and out of the top of the shot; on the taker's it comes down from their giver's side
//     into their head. Two shots in a row of the same seat (Gift Exchange: Sam gets Alex's item, then
//     passes their own on) are one shot.
// Pure, so the tests can check the order of the shots and where the tokens go.
import type { Token } from "./tokens.ts";
import { SKY } from "./tokens.ts";

/** One seat's coins, Stars or item going to another's, by key. */
export interface Pass {
  from: string;
  to: string;
  token: Token;
  count: number;
}

/** What leaves a giver in one stream: one token, toward each of its takers. */
export interface Outflow {
  token: Token;
  ways: { to: string; count: number }[];
}

/** One giver's part of a hand-over: the camera on them as all they pass leaves, then on each taker in turn as theirs lands. */
export interface Beat {
  from: string;
  /** What leaves them, a stream for each token (in the order first passed). */
  out: Outflow[];
  /** Each taker in turn (in the order first passed to), and what lands on them from this giver. */
  takers: { to: string; lands: { token: Token; count: number }[] }[];
}

/** Whether two tokens are the same thing: coins, Stars, or the same item or die. */
export function sameToken(a: Token, b: Token): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.kind === b.kind && a.id === b.id;
}

/**
 * The passes as the camera shows them: giver by giver (in the order each first gave), all of a
 * giver's passes leaving at once, then each of their takers. The same thing passed twice between the
 * same two is one pass of both counts; passes of nothing, or to oneself, are left out.
 */
export function beatsOf(passes: readonly Pass[]): Beat[] {
  const beats: Beat[] = [];
  for (const pass of passes) {
    if (pass.count <= 0 || pass.from === pass.to) continue;
    let beat = beats.find((one) => one.from === pass.from);
    if (!beat) {
      beat = { from: pass.from, out: [], takers: [] };
      beats.push(beat);
    }
    let flow = beat.out.find((one) => sameToken(one.token, pass.token));
    if (!flow) {
      flow = { token: pass.token, ways: [] };
      beat.out.push(flow);
    }
    const way = flow.ways.find((one) => one.to === pass.to);
    if (way) way.count += pass.count;
    else flow.ways.push({ to: pass.to, count: pass.count });
    let taker = beat.takers.find((one) => one.to === pass.to);
    if (!taker) {
      taker = { to: pass.to, lands: [] };
      beat.takers.push(taker);
    }
    const land = taker.lands.find((one) => sameToken(one.token, pass.token));
    if (land) land.count += pass.count;
    else taker.lands.push({ token: pass.token, count: pass.count });
  }
  return beats;
}

/** The seats the camera is on, shot by shot: each giver, then each of their takers; a seat shot twice in a row is one shot. */
export function shotsOf(beats: readonly Beat[]): string[] {
  const shots: string[] = [];
  for (const beat of beats) {
    for (const key of [beat.from, ...beat.takers.map((taker) => taker.to)]) {
      if (shots[shots.length - 1] !== key) shots.push(key);
    }
  }
  return shots;
}

type Vec = readonly [number, number, number];

/** How far toward the other seat a half flight's far end is: at most this, and at most half the gap between them. */
export const HALF_AWAY = 1.5;

/**
 * The far end of half a token's flight, over a seat's head (`head`, where tokens leave and land):
 * up off it by SKY and toward the other seat (`other`'s head), so a token leaving goes that way out
 * of the top of the shot, and one landing comes down from that side. Straight up when the two stand
 * together, or when the other isn't known.
 */
export function offToward(head: Vec, other: Vec | undefined): [number, number, number] {
  const up: [number, number, number] = [head[0], head[1] + SKY, head[2]];
  if (!other) return up;
  const dx = other[0] - head[0];
  const dz = other[2] - head[2];
  const gap = Math.hypot(dx, dz);
  if (gap < 0.01) return up;
  const away = Math.min(HALF_AWAY, gap / 2);
  return [head[0] + (dx / gap) * away, up[1], head[2] + (dz / gap) * away];
}
