// A board's golems (Block Party's Golem Gardens, the user's design, 2026-11-22; docs/plans/block-party.md
// "Golems"): pure, for the Panel, the checks and the game. In map.json:
//   "golems": [{ "post": [x, y, z, yaw, pitch], "rest": [x, y, z, yaw, pitch], "before": 11, "after": 15, "bends": [[x, y, z]] }, ...]
// Golem 1 is the list's first. Each stands on its post while it's active, blocking the path from the
// space before it to the space after it (a player pays its toll to pass), or at its rest spot while
// it isn't; it walks between the two, through its bends. Golems 1 and 2 start on their posts. A map
// without golems has none; a map with them sets all four (the Panel's Golems, under Board).
import type { MapPosition, Vec3 } from "../map-config.ts";
import { MAX_BENDS, bendListProblems, bendSlot, xyzOf, type BoardSpace } from "./board-map.ts";
import type { BoardFinding } from "./board-check.ts";

export interface BoardGolem {
  /** Where it stands while it's active, and the way it faces there. */
  post?: MapPosition;
  /** Where it stands while it isn't, and the way it faces there. */
  rest?: MapPosition;
  /** The link it blocks: from this space... */
  before?: number;
  /** ...to this one. */
  after?: number;
  /** Its walk from its post to its rest spot goes through these blocks, in order (back the other way). */
  bends?: Vec3[];
}

/** How many golems a board with golems has (the user: four). */
export const GOLEMS = 4;
/** How many are active at once: the first this many start on their posts (the user: two of the four). */
export const GOLEMS_ACTIVE = 2;

/** What a golem's change sets (what's left out stays as it is; `clear` takes parts away). */
export interface GolemChange {
  post?: MapPosition;
  rest?: MapPosition;
  before?: number;
  after?: number;
  clear?: readonly GolemPart[];
}

export type GolemPart = "post" | "rest" | "before" | "after" | "bends";

export const GOLEM_PARTS: readonly GolemPart[] = ["post", "rest", "before", "after", "bends"];

/** A map's golems (map.json "golems"), GOLEMS long, golem 1 first: each as the map has it, or empty. */
export function golemsOf(config: { golems?: unknown }): BoardGolem[] {
  const list = Array.isArray(config.golems) ? config.golems : [];
  return Array.from({ length: GOLEMS }, (_, i) => {
    const golem = list[i];
    return typeof golem === "object" && golem !== null && !Array.isArray(golem) ? (golem as BoardGolem) : {};
  });
}

/** Whether a map has any golem part set. */
export function hasGolems(golems: readonly BoardGolem[]): boolean {
  return golems.some((golem) => GOLEM_PARTS.some((part) => golem[part] !== undefined));
}

/** A golem's name: "Golem 2". */
export function golemLabel(index: number): string {
  return `Golem ${index + 1}`;
}

/** The problems with a map's "golems" shape (the board's own checks are checkGolems'). */
export function golemProblems(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ['"golems" must be a list of { "post", "rest", "before", "after", "bends" }'];
  const problems: string[] = [];
  if (value.length > GOLEMS) problems.push(`"golems" has ${value.length} golems; a board has ${GOLEMS}`);
  value.forEach((golem: unknown, i) => {
    const where = `golems[${i}]`;
    if (typeof golem !== "object" || golem === null || Array.isArray(golem)) {
      problems.push(`${where} must be { "post", "rest", "before", "after", "bends" }`);
      return;
    }
    const g = golem as Record<string, unknown>;
    for (const spot of ["post", "rest"]) {
      const at = g[spot];
      if (at !== undefined && (!Array.isArray(at) || ![3, 5].includes(at.length) || !at.every((n) => typeof n === "number" && Number.isFinite(n)))) problems.push(`${where}.${spot} must be [x, y, z] or [x, y, z, yaw, pitch]`);
    }
    for (const end of ["before", "after"]) if (g[end] !== undefined && (!Number.isInteger(g[end]) || (g[end] as number) < 1)) problems.push(`${where}.${end} must be a space id`);
    if (g.bends !== undefined) problems.push(...bendListProblems(g.bends, `${where}.bends`));
    for (const key of Object.keys(g)) if (!(GOLEM_PARTS as readonly string[]).includes(key)) problems.push(`${where}.${key} isn't a golem's part`);
  });
  return problems;
}

/**
 * The board's golem checks (errors: Publish refuses them; the Panel's Spaces tool lists them): a map
 * with golems sets all four, each with a post, a rest spot, and the spaces before and after it, the
 * space before leading to the space after, and no two golems on one link. Each finding names the
 * spaces it's about.
 */
export function checkGolems(golems: readonly BoardGolem[], spaces: readonly BoardSpace[]): BoardFinding[] {
  if (!hasGolems(golems)) return [];
  const findings: BoardFinding[] = [];
  const byId = new Map(spaces.map((space) => [space.id, space]));
  const taken = new Map<string, number>();
  golems.forEach((golem, i) => {
    const name = golemLabel(i);
    const missing = [!golem.post && "a post", !golem.rest && "a rest spot", golem.before === undefined && "the space before it", golem.after === undefined && "the space after it"].filter((part): part is string => typeof part === "string");
    if (missing.length > 0) findings.push({ text: `${name} needs ${listed(missing)}.`, spaces: [] });
    if (golem.before === undefined || golem.after === undefined) return;
    const before = byId.get(golem.before);
    const gone = [golem.before, golem.after].filter((id) => !byId.has(id));
    if (gone.length > 0) {
      findings.push({ text: `${name}'s space${gone.length === 1 ? "" : "s"} ${gone.join(" and ")} ${gone.length === 1 ? "isn't" : "aren't"} on the map.`, spaces: [] });
      return;
    }
    if (!(before?.next ?? []).includes(golem.after)) {
      findings.push({ text: `${name}: space ${golem.before} doesn't lead to space ${golem.after}.`, spaces: [golem.before, golem.after] });
      return;
    }
    const link = `${golem.before}>${golem.after}`;
    const other = taken.get(link);
    if (other !== undefined) findings.push({ text: `${golemLabel(other)} and ${name} block the same path, space ${golem.before} to ${golem.after}.`, spaces: [golem.before, golem.after] });
    else taken.set(link, i);
  });
  return findings;
}

/** The points a golem's walk goes through, its post to its rest spot (none without both). */
export function golemPath(golem: BoardGolem): Vec3[] {
  if (!golem.post || !golem.rest) return [];
  return [xyzOf(golem.post), ...(golem.bends ?? []).map((bend) => [...bend] as Vec3), xyzOf(golem.rest)];
}

// ---- Edits (pure: each returns a new list, GOLEMS long or empty) ----------------------------

/** Changes golem `index` (0 is golem 1). */
export function setGolem(golems: readonly BoardGolem[], index: number, change: GolemChange): BoardGolem[] {
  return updateGolem(golems, index, (golem) => {
    const next: BoardGolem = { ...golem };
    if (change.post) next.post = [...change.post] as MapPosition;
    if (change.rest) next.rest = [...change.rest] as MapPosition;
    if (change.before !== undefined) next.before = change.before;
    if (change.after !== undefined) next.after = change.after;
    for (const part of change.clear ?? []) delete next[part];
    return next;
  });
}

/** Adds a bend to a golem's walk, in the leg it's nearest (after its post without a rest spot yet). */
export function addGolemBend(golems: readonly BoardGolem[], index: number, at: Vec3): BoardGolem[] {
  return updateGolem(golems, index, (golem) => {
    const bends = golem.bends ?? [];
    if (bends.length >= MAX_BENDS) throw new Error(`a golem's walk can have at most ${MAX_BENDS} bends`);
    const start = golem.post ? xyzOf(golem.post) : undefined;
    const end = golem.rest ? xyzOf(golem.rest) : undefined;
    const slot = start && end ? bendSlot(start, bends, end, at) : bends.length;
    return { ...golem, bends: [...bends.slice(0, slot), [...at] as Vec3, ...bends.slice(slot)] };
  });
}

export function moveGolemBend(golems: readonly BoardGolem[], index: number, bend: number, at: Vec3): BoardGolem[] {
  return updateGolem(golems, index, (golem) => {
    const bends = golem.bends ?? [];
    if (!Number.isInteger(bend) || bend < 0 || bend >= bends.length) throw new Error(`${golemLabel(index)} has no bend ${bend + 1}`);
    return { ...golem, bends: bends.map((point, i) => (i === bend ? ([...at] as Vec3) : point)) };
  });
}

export function removeGolemBend(golems: readonly BoardGolem[], index: number, bend: number): BoardGolem[] {
  return updateGolem(golems, index, (golem) => {
    const bends = golem.bends ?? [];
    if (!Number.isInteger(bend) || bend < 0 || bend >= bends.length) throw new Error(`${golemLabel(index)} has no bend ${bend + 1}`);
    const kept = bends.filter((_, i) => i !== bend);
    const { bends: _old, ...rest } = golem;
    return kept.length > 0 ? { ...rest, bends: kept } : rest;
  });
}

/** A space was removed: a golem that named it as the space before or after it no longer does. */
export function golemsWithoutSpace(golems: readonly BoardGolem[], id: number): BoardGolem[] {
  if (!golems.some((golem) => golem.before === id || golem.after === id)) return [...golems];
  return tidy(golems.map((golem) => withoutEnd(golem, id)));
}

function withoutEnd(golem: BoardGolem, id: number): BoardGolem {
  const next = { ...golem };
  if (next.before === id) delete next.before;
  if (next.after === id) delete next.after;
  return next;
}

function updateGolem(golems: readonly BoardGolem[], index: number, change: (golem: BoardGolem) => BoardGolem): BoardGolem[] {
  if (!Number.isInteger(index) || index < 0 || index >= GOLEMS) throw new Error(`there are golems 1 to ${GOLEMS}`);
  const all = Array.from({ length: GOLEMS }, (_, i) => golems[i] ?? {});
  all[index] = change(all[index]);
  return tidy(all);
}

/** Every golem, or none at all when nothing is set. */
function tidy(golems: readonly BoardGolem[]): BoardGolem[] {
  const all = Array.from({ length: GOLEMS }, (_, i) => golems[i] ?? {});
  return hasGolems(all) ? all : [];
}

function listed(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
