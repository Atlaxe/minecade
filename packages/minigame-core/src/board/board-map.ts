// A board game's spaces on a map (Block Party's boards, docs/plans/block-party.md, "Board maps"):
// pure, so it loads under Node too ("@minecade/minigame-core/config"), for the map editors, the
// build and the game. A space is a marker with an id, linked to the spaces that come after it, so a
// board is a loop with branches. In map.json:
//   "spaces": [{ "id": 1, "at": [x, y, z], "next": [2], "type": "start" }, ...]
// A game turns spaces on with its config's map.board (the space types, their shares and blocks);
// both editors then have the Spaces tool, the checklist has a Spaces row, and the board's checks
// (board-check.ts, /boardcheck) show in it.
import type { MapPosition, Vec3 } from "../map-config.ts";

/** One space on a board. Ids stay the same when a space moves, so links survive. */
export interface BoardSpace {
  id: number;
  at: MapPosition;
  /** The spaces a piece can go on to: one, or 2-3 at a branch, where the player picks. */
  next?: number[];
  /** The space type's id (BoardConfig.types). */
  type?: string;
  /** Deal again leaves it alone. */
  locked?: boolean;
  /** A spot the Star can be at. */
  star?: boolean;
  /** A Star candidate the first Star can be at (two per board). */
  opening?: boolean;
}

export interface BoardSpaceType {
  id: string;
  /** Its name in the editors' menus. */
  name: string;
  /** Its share of the board's spaces, Start left out (0 for Start). */
  share: number;
  /** Its color in the map editors (0xRRGGBB). */
  color: number;
}

/**
 * The placement rules the dealer keeps and the board's checks (board-check.ts) warn about, by type
 * id. Distances are in spaces along the links, either way.
 */
export interface BoardRules {
  /** The spaces right after Start that can only be these types ("safe"), and how many. */
  safeStart?: { spaces: number; types: readonly string[] };
  /** Types never linked to one of their own (no two Reds in a row). */
  noPairs?: readonly string[];
  /** The fewest spaces between two of a type (Wardens, Versus, Chance spread out). */
  apart?: Readonly<Record<string, number>>;
  /** Every stretch this long along the loop needs one of `types` (an Item every ~12 spaces). */
  stretch?: { length: number; types: readonly string[] };
  /** How far a type's share may be off its target before a warning. */
  shareSlack?: number;
  /** About how many spaces a board has: fewer or more is a warning. */
  size?: readonly [number, number];
  /** Star candidates: about one per `every` spaces (at least one per the larger), `openings` of them opening spots `openingFrom` spaces after Start, none within `apart` of another, each with another `others` away. */
  stars?: { every: readonly [number, number]; openings: number; openingFrom: readonly [number, number]; apart: number; others: readonly [number, number] };
  /** What a shortcut saves of the loop's length, about: more or less than `slack` off is a warning. */
  shortcut?: { saves: number; slack: number };
  /** How many blocks across each space's marker takes (Block Party's 3, the blocks under its 2.5): two spaces closer than that both ways, on one level, overlap. */
  footprint?: number;
}

/** A game's board (its config's map.board): what its maps' spaces can be, and how many it needs. */
export interface BoardConfig {
  /** The checklist row's name. Default "Spaces". */
  label?: string;
  /** Every type a space can be, in menu order; the first is Start, the first space's type. */
  types: readonly BoardSpaceType[];
  /** The fewest spaces the checklist asks for. */
  minSpaces: number;
  rules?: BoardRules;
}

/** The region of a board's arena background that arenas load into (docs/plans/block-party.md, "Arena backgrounds"), and its size across. */
export const ARENA_SLOT = "arenaSlot";
export const ARENA_SLOT_FOOTPRINT: [number, number] = [40, 60];

/** The most spaces one space can lead to (a branch of three). */
export const MAX_EXITS = 3;

/** Block Party's board: its space types with the plan's shares ("Space types"). How a space looks in game is games/blockparty/spaces.json's (its marker). */
export const BLOCK_PARTY_BOARD: BoardConfig = {
  label: "Spaces",
  minSpaces: 12,
  types: [
    { id: "start", name: "Start", share: 0, color: 0xf0f0f0 },
    { id: "blue", name: "Blue", share: 0.45, color: 0x3c5adc },
    { id: "red", name: "Red", share: 0.12, color: 0xd23c32 },
    { id: "item", name: "Item", share: 0.075, color: 0xf5c832 },
    { id: "shop", name: "Shop", share: 0.055, color: 0x32c864 },
    { id: "chance", name: "Chance Time", share: 0.1, color: 0x9632c8 },
    { id: "warden", name: "Warden", share: 0.09, color: 0x0f5a64 },
    { id: "versus", name: "Versus", share: 0.07, color: 0xf08c1e },
    { id: "happening", name: "Happening", share: 0.04, color: 0xf08cb4 },
  ],
  // The plan's "Placement rules", "Stars" and "Boards".
  rules: {
    safeStart: { spaces: 4, types: ["blue", "item"] },
    noPairs: ["red"],
    apart: { warden: 6, versus: 4, chance: 3 },
    stretch: { length: 12, types: ["item", "shop"] },
    shareSlack: 0.03,
    size: [36, 45],
    stars: { every: [4, 6], openings: 2, openingFrom: [10, 20], apart: 3, others: [10, 25] },
    shortcut: { saves: 0.1, slack: 0.05 },
    // The space markers' footprint (docs/plans/block-party.md, "Space markers").
    footprint: 3,
  },
};

/** A space's name in the editors: "Space 3: Blue", with ", Star" on a Star candidate (", Star, opening" on an opening spot). */
export function spaceLabel(space: BoardSpace, board: BoardConfig | undefined): string {
  const type = board?.types.find((candidate) => candidate.id === space.type)?.name ?? space.type ?? "no type";
  return `Space ${space.id}: ${type}${space.star ? (space.opening ? ", Star, opening" : ", Star") : ""}`;
}

/** The board's Start type: its first. */
export function startType(board: BoardConfig): string {
  return board.types[0].id;
}

/** A map's spaces (map.json "spaces"), well-formed ones only; none when it has none. */
export function spacesOf(config: { spaces?: unknown }): BoardSpace[] {
  const list = config.spaces;
  if (!Array.isArray(list)) return [];
  return list.filter((space): space is BoardSpace => typeof space === "object" && space !== null && Number.isInteger((space as BoardSpace).id) && Array.isArray((space as BoardSpace).at));
}

/** The next id to give a new space: one past the highest. */
export function nextSpaceId(spaces: readonly BoardSpace[]): number {
  return spaces.reduce((most, space) => Math.max(most, space.id), 0) + 1;
}

/** The problems with a map's "spaces" shape and links (the board's own rules are board-check.ts's). */
export function spaceProblems(value: unknown, board: BoardConfig | undefined): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ['"spaces" must be a list of { "id", "at": [x, y, z], "next": [ids] }'];
  const problems: string[] = [];
  const ids = new Set<number>();
  const types = board ? new Set(board.types.map((type) => type.id)) : undefined;
  value.forEach((space: unknown, i) => {
    const where = `spaces[${i}]`;
    if (typeof space !== "object" || space === null) {
      problems.push(`${where} must be { "id", "at": [x, y, z] }`);
      return;
    }
    const s = space as Record<string, unknown>;
    if (!Number.isInteger(s.id) || (s.id as number) < 1) problems.push(`${where}.id must be a whole number from 1`);
    else if (ids.has(s.id as number)) problems.push(`${where}.id ${s.id} is used twice`);
    else ids.add(s.id as number);
    if (!Array.isArray(s.at) || ![3, 5].includes(s.at.length) || !s.at.every((n) => typeof n === "number" && Number.isFinite(n))) problems.push(`${where}.at must be [x, y, z]`);
    if (s.next !== undefined && (!Array.isArray(s.next) || !s.next.every((n) => Number.isInteger(n)))) problems.push(`${where}.next must be a list of space ids`);
    else if (Array.isArray(s.next) && s.next.length > MAX_EXITS) problems.push(`${where} leads to ${s.next.length} spaces; at most ${MAX_EXITS}`);
    if (s.type !== undefined && (typeof s.type !== "string" || (types && !types.has(s.type)))) problems.push(`${where}.type must be one of ${types ? [...types].join(", ") : "the board's types"}`);
    for (const flag of ["locked", "star", "opening"]) if (s[flag] !== undefined && typeof s[flag] !== "boolean") problems.push(`${where}.${flag} must be true or false`);
  });
  for (const [i, space] of value.entries()) {
    const next = (space as Record<string, unknown>)?.next;
    if (Array.isArray(next)) for (const id of next) if (Number.isInteger(id) && !ids.has(id)) problems.push(`spaces[${i}].next names space ${id}, which isn't on the map`);
  }
  return problems;
}

// ---- Edits (pure: each returns a new list) --------------------------------------------------

/** Places a space, linked from `from` when given (the previous one). The first space is always Start. */
export function addSpace(spaces: readonly BoardSpace[], at: MapPosition, type: string, from?: number): { spaces: BoardSpace[]; id: number } {
  const id = nextSpaceId(spaces);
  const added: BoardSpace = { id, at: [...at] as MapPosition, type };
  if (from === undefined) return { spaces: [...spaces, added], id };
  const previous = find(spaces, from);
  if ((previous.next?.length ?? 0) >= MAX_EXITS) throw new Error(`space ${from} already leads to ${MAX_EXITS} spaces`);
  const linked = spaces.map((space) => (space.id === from ? withNext(space, [...(space.next ?? []), id]) : space));
  return { spaces: [...linked, added], id };
}

/** Moves a space (its facing, when it has one, stays). */
export function moveSpace(spaces: readonly BoardSpace[], id: number, at: Vec3): BoardSpace[] {
  return update(spaces, id, (space) => ({ ...space, at: space.at.length === 5 ? [at[0], at[1], at[2], space.at[3], space.at[4]] : [at[0], at[1], at[2]] }));
}

/** Removes a space and every link to it. */
export function removeSpace(spaces: readonly BoardSpace[], id: number): BoardSpace[] {
  find(spaces, id);
  return spaces.filter((space) => space.id !== id).map((space) => (space.next?.includes(id) ? withNext(space, space.next.filter((next) => next !== id)) : space));
}

/** Links `from` to `to` (closing a loop, rejoining a shortcut). */
export function linkSpaces(spaces: readonly BoardSpace[], from: number, to: number): BoardSpace[] {
  if (from === to) throw new Error("a space can't lead to itself");
  find(spaces, to);
  return update(spaces, from, (space) => {
    const next = space.next ?? [];
    if (next.includes(to)) return space;
    if (next.length >= MAX_EXITS) throw new Error(`space ${from} already leads to ${MAX_EXITS} spaces`);
    return withNext(space, [...next, to]);
  });
}

export function unlinkSpaces(spaces: readonly BoardSpace[], from: number, to: number): BoardSpace[] {
  return update(spaces, from, (space) => withNext(space, (space.next ?? []).filter((next) => next !== to)));
}

/** Changes a space's type and flags (what's left out stays as it is; false removes a flag). */
export function setSpace(spaces: readonly BoardSpace[], id: number, change: { type?: string; locked?: boolean; star?: boolean; opening?: boolean }): BoardSpace[] {
  return update(spaces, id, (space) => {
    const next: BoardSpace = { ...space };
    if (change.type !== undefined) next.type = change.type;
    for (const flag of ["locked", "star", "opening"] as const) {
      if (change[flag] === undefined) continue;
      if (change[flag]) next[flag] = true;
      else delete next[flag];
    }
    // An opening spot is a Star candidate.
    if (next.opening && !next.star) delete next.opening;
    return next;
  });
}

/** Gives several spaces new types at once (Deal again's result). */
export function retypeSpaces(spaces: readonly BoardSpace[], types: Readonly<Record<string, string>>): BoardSpace[] {
  return spaces.map((space) => (types[space.id] !== undefined ? { ...space, type: types[space.id] } : space));
}

function find(spaces: readonly BoardSpace[], id: number): BoardSpace {
  const space = spaces.find((candidate) => candidate.id === id);
  if (!space) throw new Error(`space ${id} isn't on the map`);
  return space;
}

function update(spaces: readonly BoardSpace[], id: number, change: (space: BoardSpace) => BoardSpace): BoardSpace[] {
  find(spaces, id);
  return spaces.map((space) => (space.id === id ? change(space) : space));
}

function withNext(space: BoardSpace, next: number[]): BoardSpace {
  const { next: _old, ...rest } = space;
  return next.length > 0 ? { ...rest, next } : rest;
}
