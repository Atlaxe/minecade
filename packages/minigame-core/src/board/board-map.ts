// A board game's spaces on a map (Block Party's boards, docs/plans/block-party.md, "Board maps"):
// pure, so it loads under Node too ("@minecade/minigame-core/config"), for the map editors, the
// build and the game. A space is a marker with an id, linked to the spaces that come after it, so a
// board is a loop with branches. In map.json:
//   "spaces": [{ "id": 1, "at": [x, y, z], "next": [2], "type": "start", "bends": { "2": [[x, y, z]] } }, ...]
// A game turns spaces on with its config's map.board (the space types, their shares and blocks);
// both editors then have the Spaces tool, the checklist has a Spaces row, and the board's checks
// (board-check.ts, /boardcheck) show in it.
// A link's bends (the user, 2026-11-22): a path that curves between two spaces is several straight
// legs, through the blocks its bends are on, in order. The Panel's Spaces tool places them.
// A space's NPC spot and a Shop's Villager (the user, 2026-11-23): where the NPC who comes to a space
// stands ("npc": [x, y, z, yaw, pitch]; without one the game picks a spot beside it), and how a Shop
// space's Villager looks ("villager": { "biome": "desert", "profession": "librarian", "level": "gold" }).
import type { MapPosition, Vec3 } from "../map-config.ts";

/** A Villager's looks (Block Party's NPC menu's, its entity's properties by index): the biome it's dressed for, its profession and its level. */
export const VILLAGER_BIOMES = ["Plains", "Desert", "Jungle", "Savanna", "Snow", "Swamp", "Taiga"] as const;
export const VILLAGER_PROFESSIONS = ["Unskilled", "Farmer", "Fisherman", "Shepherd", "Fletcher", "Librarian", "Cartographer", "Cleric", "Armorer", "Weaponsmith", "Toolsmith", "Butcher", "Leatherworker", "Stonemason", "Nitwit"] as const;
export const VILLAGER_LEVELS = ["Stone", "Iron", "Gold", "Emerald", "Diamond"] as const;

/** A Shop space's Villager (map.json, lower case names from the lists above; what's left out is the first). */
export interface VillagerLook {
  biome?: string;
  profession?: string;
  level?: string;
}

/** Each part of a Villager's looks: its key in VillagerLook, its name, and its choices. */
export const VILLAGER_PARTS = [
  { key: "biome", label: "Biome", values: VILLAGER_BIOMES },
  { key: "profession", label: "Profession", values: VILLAGER_PROFESSIONS },
  { key: "level", label: "Level", values: VILLAGER_LEVELS },
] as const;

/** A Villager's looks as its entity's properties (each the index of its choice; 0 for none or one not in the list). */
export function villagerIndexes(look: VillagerLook | undefined): { biome: number; profession: number; level: number } {
  const index = (values: readonly string[], value: string | undefined) => Math.max(0, values.findIndex((candidate) => candidate.toLowerCase() === value?.toLowerCase()));
  return { biome: index(VILLAGER_BIOMES, look?.biome), profession: index(VILLAGER_PROFESSIONS, look?.profession), level: index(VILLAGER_LEVELS, look?.level) };
}

/** The space types an NPC comes to (Block Party's: the Shop's Villager, the Referee, the Witch, the Warden, the Wandering Trader), by type id. A Star candidate's is Chris. */
export const SPACE_NPCS: Readonly<Record<string, string>> = { shop: "Villager", versus: "Referee", chance: "Witch", warden: "Warden", item: "Wandering Trader" };

/** Who stands at a space's NPC spot: its type's NPC, else Chris on a Star candidate; undefined when nobody comes to it. */
export function spaceNpc(space: Pick<BoardSpace, "type" | "star">): string | undefined {
  return SPACE_NPCS[space.type ?? ""] ?? (space.star ? "Chris" : undefined);
}

/** One space on a board. Ids stay the same when a space moves, so links survive. */
export interface BoardSpace {
  id: number;
  at: MapPosition;
  /** The spaces a piece can go on to: one, or 2-3 at a branch, where the player picks. */
  next?: number[];
  /**
   * Each link's bends, by the id of the space it leads to: the blocks its path goes through on the
   * way there, in order (x, y, z of the block a piece walks through, as a space's "at"). A link
   * without bends is one straight leg.
   */
  bends?: Record<string, Vec3[]>;
  /** The space type's id (BoardConfig.types). */
  type?: string;
  /** Deal again leaves it alone. */
  locked?: boolean;
  /** A spot the Star can be at. */
  star?: boolean;
  /** A Star candidate the first Star can be at (two per board). */
  opening?: boolean;
  /** Where the NPC who comes to this space stands (spaceNpc), and the way it faces; without it, a spot beside the space is picked. */
  npc?: MapPosition;
  /** A Shop space's Villager: how it looks. */
  villager?: VillagerLook;
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
    if (s.bends !== undefined) {
      const next = Array.isArray(s.next) ? s.next : [];
      if (typeof s.bends !== "object" || s.bends === null || Array.isArray(s.bends)) problems.push(`${where}.bends must map the spaces it leads to to lists of [x, y, z]`);
      else {
        for (const [to, list] of Object.entries(s.bends as Record<string, unknown>)) {
          if (!next.includes(Number(to))) problems.push(`${where}.bends.${to}: it doesn't lead to space ${to}`);
          else problems.push(...bendListProblems(list, `${where}.bends.${to}`));
        }
      }
    }
    if (s.npc !== undefined && (!Array.isArray(s.npc) || ![3, 5].includes(s.npc.length) || !s.npc.every((n) => typeof n === "number" && Number.isFinite(n)))) problems.push(`${where}.npc must be [x, y, z] or [x, y, z, yaw, pitch]`);
    if (s.villager !== undefined) problems.push(...villagerProblems(s.villager, `${where}.villager`));
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

/** Removes a space and every link to it (their bends go too). */
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

/** Places a space's NPC spot (where the NPC who comes to it stands), or with none takes it away. */
export function setSpaceNpc(spaces: readonly BoardSpace[], id: number, at: MapPosition | undefined): BoardSpace[] {
  return update(spaces, id, (space) => {
    const { npc: _old, ...rest } = space;
    return at ? { ...rest, npc: [...at] as MapPosition } : rest;
  });
}

/** Sets a Shop space's Villager's looks (what's left out, or the first of its list, is left out of the map), or with none, the plain one. */
export function setVillager(spaces: readonly BoardSpace[], id: number, look: VillagerLook | undefined): BoardSpace[] {
  const problem = look ? villagerProblems(look, "villager")[0] : undefined;
  if (problem) throw new Error(problem);
  return update(spaces, id, (space) => {
    const { villager: _old, ...rest } = space;
    const kept = VILLAGER_PARTS.flatMap((part) => {
      const value = look?.[part.key]?.toLowerCase();
      return value && value !== part.values[0].toLowerCase() ? [[part.key, value] as const] : [];
    });
    return kept.length > 0 ? { ...rest, villager: Object.fromEntries(kept) as VillagerLook } : rest;
  });
}

/** The problems with a Villager's looks: an object of known biome, profession and level names. */
export function villagerProblems(value: unknown, where: string): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${where} must be { "biome", "profession", "level" }`];
  const problems: string[] = [];
  for (const [key, given] of Object.entries(value as Record<string, unknown>)) {
    const part = VILLAGER_PARTS.find((candidate) => candidate.key === key);
    if (!part) problems.push(`${where}.${key} isn't a Villager's look (biome, profession or level)`);
    else if (typeof given !== "string" || !part.values.some((choice) => choice.toLowerCase() === given.toLowerCase())) problems.push(`${where}.${key} must be one of ${part.values.join(", ")}`);
  }
  return problems;
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

/** A space with these links: the bends of a link that's gone go with it. */
function withNext(space: BoardSpace, next: number[]): BoardSpace {
  const { next: _old, bends, ...rest } = space;
  const kept = Object.entries(bends ?? {}).filter(([to]) => next.includes(Number(to)));
  return { ...rest, ...(next.length > 0 ? { next } : {}), ...(kept.length > 0 ? { bends: Object.fromEntries(kept) } : {}) };
}

// ---- Bends ----------------------------------------------------------------------------------

/** The most bends one link (or one golem's walk) can have. */
export const MAX_BENDS = 24;

/** The problems with a list of bends: [x, y, z] each, at most MAX_BENDS. */
export function bendListProblems(list: unknown, where: string): string[] {
  if (!Array.isArray(list)) return [`${where} must be a list of [x, y, z]`];
  if (list.length > MAX_BENDS) return [`${where} has ${list.length} bends; at most ${MAX_BENDS}`];
  return list.every((point) => Array.isArray(point) && point.length === 3 && point.every((n) => typeof n === "number" && Number.isFinite(n))) ? [] : [`${where} must be a list of [x, y, z]`];
}

/** The bends of the link from `from` to `to` (none when it's straight, or isn't a link). */
export function bendsOf(from: BoardSpace | undefined, to: number): Vec3[] {
  return from?.bends?.[String(to)] ?? [];
}

/** The points a link's path goes through: its space, each bend, the space it leads to. */
export function linkPath(spaces: readonly BoardSpace[], from: number, to: number): Vec3[] {
  const a = spaces.find((space) => space.id === from);
  const b = spaces.find((space) => space.id === to);
  if (!a || !b) return [];
  return [xyzOf(a.at), ...bendsOf(a, to).map((bend) => [...bend] as Vec3), xyzOf(b.at)];
}

/**
 * Where a new point goes in a path's bends: before the bend that ends the leg it's nearest (so a
 * bend clicked anywhere along a curve slots into its place). `ends` are the path's two ends.
 */
export function bendSlot(start: Vec3, bends: readonly Vec3[], end: Vec3, at: Vec3): number {
  const points = [start, ...bends, end];
  let best = 0;
  let nearest = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const gap = segmentGap(points[i], points[i + 1], at);
    if (gap < nearest - 1e-9) {
      nearest = gap;
      best = i;
    }
  }
  return best;
}

/** Adds a bend to the link from `from` to `to`, in the leg it's nearest. */
export function addBend(spaces: readonly BoardSpace[], from: number, to: number, at: Vec3): BoardSpace[] {
  const target = find(spaces, to);
  return updateBends(spaces, from, to, (bends, space) => {
    if (bends.length >= MAX_BENDS) throw new Error(`a link can have at most ${MAX_BENDS} bends`);
    const slot = bendSlot(xyzOf(space.at), bends, xyzOf(target.at), at);
    return [...bends.slice(0, slot), [...at] as Vec3, ...bends.slice(slot)];
  });
}

export function moveBend(spaces: readonly BoardSpace[], from: number, to: number, index: number, at: Vec3): BoardSpace[] {
  return updateBends(spaces, from, to, (bends) => {
    checkBend(bends, index);
    return bends.map((bend, i) => (i === index ? ([...at] as Vec3) : bend));
  });
}

export function removeBend(spaces: readonly BoardSpace[], from: number, to: number, index: number): BoardSpace[] {
  return updateBends(spaces, from, to, (bends) => {
    checkBend(bends, index);
    return bends.filter((_, i) => i !== index);
  });
}

/** Makes a link one straight leg again. */
export function clearBends(spaces: readonly BoardSpace[], from: number, to: number): BoardSpace[] {
  return updateBends(spaces, from, to, () => []);
}

function updateBends(spaces: readonly BoardSpace[], from: number, to: number, change: (bends: Vec3[], space: BoardSpace) => Vec3[]): BoardSpace[] {
  return update(spaces, from, (space) => {
    if (!(space.next ?? []).includes(to)) throw new Error(`space ${from} doesn't lead to space ${to}`);
    const bends = change(bendsOf(space, to), space);
    const others = Object.entries(space.bends ?? {}).filter(([key]) => key !== String(to));
    const all = bends.length > 0 ? [...others, [String(to), bends] as [string, Vec3[]]] : others;
    const { bends: _old, ...rest } = space;
    return all.length > 0 ? { ...rest, bends: Object.fromEntries(all) } : rest;
  });
}

function checkBend(bends: readonly Vec3[], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= bends.length) throw new Error(`there's no bend ${index + 1} there`);
}

/** A position's x, y and z. */
export function xyzOf(at: MapPosition | Vec3): Vec3 {
  return [at[0], at[1], at[2]];
}

/** How far `at` is from the segment from `a` to `b`. */
function segmentGap(a: Vec3, b: Vec3, at: Vec3): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((at[0] - a[0]) * d[0] + (at[1] - a[1]) * d[1] + (at[2] - a[2]) * d[2]) / length));
  return Math.hypot(a[0] + d[0] * t - at[0], a[1] + d[1] * t - at[1], a[2] + d[2] * t - at[2]);
}
