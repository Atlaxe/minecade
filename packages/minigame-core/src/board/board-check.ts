// A board's checks (/boardcheck, and the checklist in both map editors) and the dealer that gives
// spaces their types (docs/plans/block-party.md, "Board maps" and "/boardcheck"). Pure: the rules
// are the game's (BoardConfig.rules), the spaces the map's.
//   - checkBoard: errors (Publish refuses them), warnings, and a report (counts by type against the
//     targets, the loop's length, each shortcut).
//   - dealType: the type a new space gets: the one furthest under its share that breaks no rule
//     where it is. Spaces placed before it never change on their own.
//   - dealAgain: every unlocked space dealt again, many tries, keeping the one with the fewest
//     warnings.
import { addSpace, startType, type BoardConfig, type BoardSpace } from "./board-map.ts";

/** Something a check found, and the spaces it's about (the editors fly to the first). */
export interface BoardFinding {
  text: string;
  spaces: number[];
}

export interface BoardReport {
  errors: BoardFinding[];
  warnings: BoardFinding[];
  /** Each type (Start left out): how many the board has, and its target from the share. */
  counts: { type: string; name: string; have: number; target: number }[];
  /** The loop from Start, following each space's first exit: its spaces, and whether it gets back to Start. */
  loop: { spaces: number[]; closed: boolean };
  /** Each way off the loop at a branch: where it leaves and rejoins, its length, and what it saves. */
  shortcuts: { from: number; rejoins: number; length: number; saves: number }[];
}

/** The links of a board, both ways, for the distances the checks use. */
class Graph {
  readonly byId = new Map<number, BoardSpace>();
  private readonly before = new Map<number, number[]>();
  readonly spaces: readonly BoardSpace[];

  constructor(spaces: readonly BoardSpace[]) {
    this.spaces = spaces;
    for (const space of spaces) this.byId.set(space.id, space);
    for (const space of spaces) {
      for (const next of space.next ?? []) {
        if (!this.byId.has(next)) continue;
        const list = this.before.get(next) ?? [];
        list.push(space.id);
        this.before.set(next, list);
      }
    }
  }

  next(id: number): number[] {
    return (this.byId.get(id)?.next ?? []).filter((next) => this.byId.has(next));
  }

  previous(id: number): number[] {
    return this.before.get(id) ?? [];
  }

  /** Steps from `from` along the links, forward (or backward), to every space it reaches. */
  steps(from: number, backward = false): Map<number, number> {
    const seen = new Map<number, number>([[from, 0]]);
    const queue = [from];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const other of backward ? this.previous(id) : this.next(id)) {
        if (seen.has(other)) continue;
        seen.set(other, seen.get(id)! + 1);
        queue.push(other);
      }
    }
    return seen;
  }

  /** Steps between spaces whichever way the links go. */
  apart(from: number): Map<number, number> {
    const seen = new Map<number, number>([[from, 0]]);
    const queue = [from];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const other of [...this.next(id), ...this.previous(id)]) {
        if (seen.has(other)) continue;
        seen.set(other, seen.get(id)! + 1);
        queue.push(other);
      }
    }
    return seen;
  }
}

function startOf(spaces: readonly BoardSpace[], board: BoardConfig): BoardSpace | undefined {
  const start = startType(board);
  return spaces.find((space) => space.type === start);
}

/** The loop from Start: each space's first exit, until it gets back to Start (closed) or can't go on. */
export function boardLoop(spaces: readonly BoardSpace[], board: BoardConfig): { spaces: number[]; closed: boolean } {
  const start = startOf(spaces, board);
  if (!start) return { spaces: [], closed: false };
  const graph = new Graph(spaces);
  const out = [start.id];
  let at = start.id;
  for (;;) {
    const next = graph.next(at)[0];
    if (next === undefined) return { spaces: out, closed: false };
    if (next === start.id) return { spaces: out, closed: true };
    if (out.includes(next)) return { spaces: out, closed: false };
    out.push(next);
    at = next;
  }
}

export function checkBoard(spaces: readonly BoardSpace[], board: BoardConfig): BoardReport {
  const rules = board.rules ?? {};
  const graph = new Graph(spaces);
  const errors: BoardFinding[] = [];
  const warnings: BoardFinding[] = [];
  const start = startType(board);
  const name = (type: string) => board.types.find((candidate) => candidate.id === type)?.name ?? type;
  const playable = spaces.filter((space) => space.type !== start);
  const counts = board.types
    .filter((type) => type.id !== start)
    .map((type) => ({ type: type.id, name: type.name, have: playable.filter((space) => space.type === type.id).length, target: Math.round(type.share * playable.length) }));
  const loop = boardLoop(spaces, board);
  const report: BoardReport = { errors, warnings, counts, loop, shortcuts: [] };
  if (spaces.length === 0) return report;

  // Errors.
  const starts = spaces.filter((space) => space.type === start);
  if (starts.length !== 1) errors.push({ text: `A board needs exactly one ${name(start)}; it has ${starts.length}.`, spaces: starts.map((space) => space.id) });
  const first = starts[0];
  if (first) {
    const reached = graph.steps(first.id);
    const lost = spaces.filter((space) => !reached.has(space.id));
    if (lost.length > 0) errors.push({ text: `${plural(lost.length, "space")} can't be reached from ${name(start)}.`, spaces: ids(lost) });
    const back = graph.steps(first.id, true);
    const stuck = spaces.filter((space) => graph.next(space.id).length > 0 && !back.has(space.id));
    if (stuck.length > 0) errors.push({ text: `No way leads back to the loop from ${plural(stuck.length, "space")}.`, spaces: ids(stuck) });
  }
  const dead = spaces.filter((space) => graph.next(space.id).length === 0);
  if (dead.length > 0) errors.push({ text: `${plural(dead.length, "space")} ${dead.length === 1 ? "leads" : "lead"} nowhere: link ${dead.length === 1 ? "it" : "each"} on.`, spaces: ids(dead) });
  const stars = spaces.filter((space) => space.star);
  if (rules.stars) {
    const needed = Math.ceil(playable.length / rules.stars.every[1]);
    if (stars.length < needed) errors.push({ text: `A board this size needs at least ${plural(needed, "Star candidate")} (about one per ${rules.stars.every[0]} to ${rules.stars.every[1]} spaces); it has ${stars.length}.`, spaces: [] });
    const openings = spaces.filter((space) => space.opening);
    if (openings.length !== rules.stars.openings) errors.push({ text: `A board needs ${plural(rules.stars.openings, "opening spot")} (Star candidates the first Star can be at); it has ${openings.length}.`, spaces: ids(openings) });
  }

  // Warnings.
  if (rules.size && (playable.length + starts.length < rules.size[0] || playable.length + starts.length > rules.size[1])) {
    warnings.push({ text: `The board has ${plural(spaces.length, "space")}; aim for about ${rules.size[0]} to ${rules.size[1]}.`, spaces: [] });
  }
  if (rules.shareSlack !== undefined && playable.length > 0) {
    for (const type of board.types) {
      if (type.id === start || type.share <= 0) continue;
      const share = playable.filter((space) => space.type === type.id).length / playable.length;
      if (Math.abs(share - type.share) > rules.shareSlack) warnings.push({ text: `${type.name} is ${percent(share)} of the board; aim for ${percent(type.share)}.`, spaces: [] });
    }
  }
  for (const type of rules.noPairs ?? []) {
    const pairs = spaces.filter((space) => space.type === type && graph.next(space.id).some((next) => graph.byId.get(next)?.type === type));
    for (const space of pairs) warnings.push({ text: `Two ${name(type)} spaces in a row (space ${space.id}).`, spaces: [space.id, ...graph.next(space.id).filter((next) => graph.byId.get(next)?.type === type)] });
  }
  if (rules.footprint) {
    // Markers that would overlap: closer than a footprint along both x and z, on about one level.
    const across = rules.footprint;
    for (const [i, space] of spaces.entries()) {
      for (const other of spaces.slice(i + 1)) {
        const near = Math.abs(space.at[0] - other.at[0]) < across && Math.abs(space.at[2] - other.at[2]) < across && Math.abs(space.at[1] - other.at[1]) < 2;
        if (near) warnings.push({ text: `Spaces ${space.id} and ${other.id} are closer than ${plural(across, "block")}, so their markers (${across} blocks across) overlap; move them apart.`, spaces: [space.id, other.id] });
      }
    }
  }
  for (const [type, apart] of Object.entries(rules.apart ?? {})) {
    if (type === "chance") continue; // the dealer spreads them; the plan names Wardens and Versus only
    const ofType = spaces.filter((space) => space.type === type);
    for (const [i, space] of ofType.entries()) {
      const near = graph.apart(space.id);
      for (const other of ofType.slice(i + 1)) {
        const steps = near.get(other.id);
        if (steps !== undefined && steps < apart) warnings.push({ text: `${name(type)} spaces ${space.id} and ${other.id} are ${plural(steps, "space")} apart; keep them at least ${apart}.`, spaces: [space.id, other.id] });
      }
    }
  }
  if (rules.stretch && loop.closed && loop.spaces.length > rules.stretch.length) {
    const kinds = new Set(rules.stretch.types);
    const on = loop.spaces.map((id) => kinds.has(graph.byId.get(id)?.type ?? ""));
    const length = rules.stretch.length;
    const wanted = rules.stretch.types.map(name).join(" or ");
    // Whether the stretch starting at each space of the loop has none; each run of such stretches is named once, where it starts.
    const empty = on.map((_, i) => !Array.from({ length }, (_, k) => on[(i + k) % on.length]).some(Boolean));
    if (empty.every(Boolean)) warnings.push({ text: `The loop has no ${wanted}.`, spaces: [] });
    else
      for (const [i, none] of empty.entries()) {
        if (none && !empty[(i - 1 + empty.length) % empty.length]) warnings.push({ text: `${length} spaces in a row from space ${loop.spaces[i]} have no ${wanted}.`, spaces: [loop.spaces[i]] });
      }
  }
  if (loop.closed) {
    const where = new Map(loop.spaces.map((id, i) => [id, i]));
    for (const branch of loop.spaces) {
      for (const exit of graph.next(branch).slice(1)) {
        let length = 1;
        let at = exit;
        const seen = new Set<number>();
        while (!where.has(at) && !seen.has(at)) {
          seen.add(at);
          const next = graph.next(at)[0];
          if (next === undefined) break;
          at = next;
          length++;
        }
        if (!where.has(at)) continue;
        const along = (where.get(at)! - where.get(branch)! + loop.spaces.length) % loop.spaces.length;
        const saves = along - length;
        report.shortcuts.push({ from: branch, rejoins: at, length, saves });
        if (rules.shortcut) {
          const share = saves / loop.spaces.length;
          if (Math.abs(share - rules.shortcut.saves) > rules.shortcut.slack) {
            warnings.push({ text: `The shortcut from space ${branch} saves ${plural(saves, "space")} (${percent(share)} of the loop); aim for about ${percent(rules.shortcut.saves)}.`, spaces: [branch] });
          }
        }
      }
    }
  }
  if (rules.stars && first) {
    const { apart, others, openingFrom } = rules.stars;
    for (const [i, star] of stars.entries()) {
      const near = graph.apart(star.id);
      for (const other of stars.slice(i + 1)) {
        const steps = near.get(other.id);
        if (steps !== undefined && steps < apart) warnings.push({ text: `Star candidates ${star.id} and ${other.id} are bunched together (${plural(steps, "space")} apart).`, spaces: [star.id, other.id] });
      }
      if (stars.length > 1 && !stars.some((other) => other !== star && (near.get(other.id) ?? -1) >= others[0] && (near.get(other.id) ?? Infinity) <= others[1])) {
        warnings.push({ text: `Star candidate ${star.id} has no other ${others[0]} to ${others[1]} spaces away.`, spaces: [star.id] });
      }
    }
    const fromStart = graph.steps(first.id);
    for (const opening of spaces.filter((space) => space.opening)) {
      const steps = fromStart.get(opening.id);
      if (steps === undefined || steps < openingFrom[0] || steps > openingFrom[1]) warnings.push({ text: `Opening spot ${opening.id} is ${steps === undefined ? "not reachable" : plural(steps, "space")} from ${name(start)}; put it ${openingFrom[0]} to ${openingFrom[1]} away.`, spaces: [opening.id] });
    }
  }
  return report;
}

/** Whether `type` breaks a placement rule at space `id` (its neighbors as they are now). */
function breaksRule(graph: Graph, id: number, type: string, board: BoardConfig): boolean {
  const rules = board.rules ?? {};
  const start = graph.spaces.find((space) => space.type === startType(board));
  if (rules.safeStart && start && start.id !== id) {
    const steps = graph.steps(start.id).get(id);
    if (steps !== undefined && steps <= rules.safeStart.spaces && !rules.safeStart.types.includes(type)) return true;
  }
  if (rules.noPairs?.includes(type) && [...graph.next(id), ...graph.previous(id)].some((other) => graph.byId.get(other)?.type === type)) return true;
  const apart = rules.apart?.[type];
  if (apart !== undefined) {
    const near = graph.apart(id);
    if (graph.spaces.some((space) => space.id !== id && space.type === type && (near.get(space.id) ?? Infinity) < apart)) return true;
  }
  return false;
}

/**
 * The type a space gets dealt: the one furthest under its share (counting the board as it is, this
 * space included) that breaks no placement rule where it is, earlier types first on a tie (or by
 * `jitter`). The first space is Start. Falls back to the type with the biggest share.
 */
export function dealType(spaces: readonly BoardSpace[], id: number, board: BoardConfig, jitter: () => number = () => 0): string {
  const start = startType(board);
  const others = spaces.filter((space) => space.id !== id);
  if (!others.some((space) => space.type === start)) return start;
  const graph = new Graph(spaces.map((space) => (space.id === id ? { ...space, type: undefined } : space)));
  const playable = others.filter((space) => space.type !== start).length + 1;
  let best: string | undefined;
  let bestScore = -Infinity;
  for (const type of board.types) {
    if (type.id === start || type.share <= 0) continue;
    if (breaksRule(graph, id, type.id, board)) continue;
    const have = others.filter((space) => space.type === type.id).length;
    const score = type.share * playable - have + jitter() * 0.5;
    if (score > bestScore) {
      best = type.id;
      bestScore = score;
    }
  }
  return best ?? [...board.types].sort((a, b) => b.share - a.share)[0].id;
}

/** The type a space placed at `at` (linked from `from`) would be dealt: what both editors put in their addSpace edit. */
export function typeForNewSpace(spaces: readonly BoardSpace[], at: BoardSpace["at"], board: BoardConfig, from?: number): string {
  if (spaces.length === 0) return startType(board);
  const { spaces: placed, id } = addSpace(spaces, at, "", from);
  return dealType(placed, id, board);
}

/**
 * Deal again: every unlocked space other than Start gets a type again, in the loop's order then the
 * rest, `tries` times with shuffled tie-breaks; the try with the fewest warnings (then errors) wins.
 * Returns the new type of each space that changed, by id.
 */
export function dealAgain(spaces: readonly BoardSpace[], board: BoardConfig, random: () => number = Math.random, tries = 40): Record<number, string> {
  const start = startType(board);
  const loop = boardLoop(spaces, board).spaces;
  const order = [...loop, ...spaces.map((space) => space.id).filter((id) => !loop.includes(id))];
  const free = new Set(spaces.filter((space) => !space.locked && space.type !== start).map((space) => space.id));
  let best: BoardSpace[] | undefined;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < tries; attempt++) {
    let dealt = spaces.map((space) => (free.has(space.id) ? { ...space, type: undefined } : { ...space }));
    for (const id of order) {
      if (!free.has(id)) continue;
      const type = dealType(dealt, id, board, attempt === 0 ? () => 0 : random);
      dealt = dealt.map((space) => (space.id === id ? { ...space, type } : space));
    }
    const report = checkBoard(dealt, board);
    const score = report.errors.length * 1000 + report.warnings.length;
    if (score < bestScore) {
      best = dealt;
      bestScore = score;
    }
  }
  const changed: Record<number, string> = {};
  for (const space of best ?? []) {
    const old = spaces.find((candidate) => candidate.id === space.id);
    if (space.type !== undefined && old?.type !== space.type) changed[space.id] = space.type;
  }
  return changed;
}

/** The report as lines for chat (/boardcheck) or a log: errors, warnings, then the counts and routes. */
export function reportLines(report: BoardReport, where: (id: number) => string = (id) => `space ${id}`): string[] {
  const lines: string[] = [];
  const located = (finding: BoardFinding) => (finding.spaces.length > 0 ? `${finding.text} (${finding.spaces.slice(0, 4).map(where).join("; ")}${finding.spaces.length > 4 ? "; ..." : ""})` : finding.text);
  if (report.errors.length === 0) lines.push("No errors.");
  for (const error of report.errors) lines.push(`Error: ${located(error)}`);
  for (const warning of report.warnings) lines.push(`Warning: ${located(warning)}`);
  lines.push(`Types: ${report.counts.map((count) => `${count.name} ${count.have}/${count.target}`).join(", ")}.`);
  lines.push(report.loop.closed ? `The loop: ${plural(report.loop.spaces.length, "space")}.` : `The loop isn't closed yet (${plural(report.loop.spaces.length, "space")} from Start).`);
  for (const shortcut of report.shortcuts) lines.push(`Shortcut from space ${shortcut.from} to ${shortcut.rejoins}: ${plural(shortcut.length, "space")}, saves ${shortcut.saves}.`);
  return lines;
}

function ids(spaces: readonly BoardSpace[]): number[] {
  return spaces.map((space) => space.id);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}
