// A board's path bends and golems in the map viewer (the user, 2026-11-22: both in the Panel only,
// not in game Edit; docs/viewer.md "Bends" and "Golems"):
//   - Bends: a link between two spaces can bend, so a piece follows a curving path in straight legs.
//     Each bend is a dot on its link's line (Select picks, drags and deletes it like any point); a
//     picked link's panel has Add bends (each click on a block adds one, in the leg it's nearest, until
//     Esc or the button again), Straighten, and each bend with an X.
//   - Golems (Block Party's Golem Gardens): four, each with a post (where it stands while it's active,
//     blocking the path between two spaces), a rest spot (where it stands while it isn't), the spaces
//     before and after it, and the bends of its walk between the two spots. The Board section lists
//     Golems 1 to 4; a golem's panel places each spot (a click on a block, facing the space before it
//     or its post; then the knob turns it), picks its spaces, and bends its walk. Its walk is drawn
//     from its post to its rest spot.
import {
  GOLEMS,
  GOLEMS_ACTIVE,
  checkGolems,
  golemLabel,
  golemsOf,
  hasGolems,
  positionText,
  spacesOf,
  worldPoint,
  xyzOf,
  type BoardConfig,
  type BoardGolem,
  type MapConfig,
  type MapEdit,
  type MapPosition,
  type Vec3,
} from "@minecade/minigame-core/config";
import type { MarkupList, PointMark } from "./markup.ts";
import { el } from "./sidebar.ts";
import type { LinkMark } from "./spaces.ts";

/** The bends' dots, and a golem's walk. */
export const BEND_COLOR = 0xffffff;
export const GOLEM_COLOR = 0xc9c1b2;
export const GOLEM_WALK_COLOR = 0x9fd47a;
/** The Golems list's key, under Board. */
export const GOLEMS_LIST = "golems";

/** A bend's, a golem spot's or a golem bend's point, by its markup key. */
export type BoardPoint = { kind: "bend"; from: number; to: number; index: number } | { kind: "golem"; golem: number; part: "post" | "rest" } | { kind: "golemBend"; golem: number; index: number };

/** What a click on a block places: a link's bend, a golem's bend, or a golem's post or rest spot. */
export type Placing = { kind: "bend"; from: number; to: number } | { kind: "golemBend"; golem: number } | { kind: "golem"; golem: number; part: "post" | "rest" };

/** "bend:3>4#0": the first bend of space 3's link to space 4. */
export const bendKey = (from: number, to: number, index: number) => `bend:${from}>${to}#${index}`;
/** "golem:2": golem 2 (its list entry, and its walk's line). */
export const golemKey = (golem: number) => `golem:${golem}`;
export const golemSpotKey = (golem: number, part: "post" | "rest") => `golem:${golem}.${part}`;
export const golemBendKey = (golem: number, index: number) => `golem:${golem}.bend#${index}`;

/** The bend or golem point a key names. */
export function boardPointOf(key: string | undefined): BoardPoint | undefined {
  if (!key) return undefined;
  const bend = /^bend:(\d+)>(\d+)#(\d+)$/.exec(key);
  if (bend) return { kind: "bend", from: Number(bend[1]), to: Number(bend[2]), index: Number(bend[3]) };
  const spot = /^golem:(\d+)\.(post|rest)$/.exec(key);
  if (spot) return { kind: "golem", golem: Number(spot[1]), part: spot[2] as "post" | "rest" };
  const golemBend = /^golem:(\d+)\.bend#(\d+)$/.exec(key);
  if (golemBend) return { kind: "golemBend", golem: Number(golemBend[1]), index: Number(golemBend[2]) };
  return undefined;
}

/** The golem (1 to 4) any of its keys names: its entry, a spot, a bend. */
export function golemOf(key: string | undefined): number | undefined {
  const match = key ? /^golem:(\d+)(\.|$)/.exec(key) : null;
  const golem = match ? Number(match[1]) : undefined;
  return golem !== undefined && golem >= 1 && golem <= GOLEMS ? golem : undefined;
}

/** A block's position as a bend or a golem's spot keeps it: whole x and z (the block's middle), its floor. */
export function blockPosition(position: MapPosition | Vec3): Vec3 {
  return [Math.floor(position[0]), Math.round(position[1]), Math.floor(position[2])];
}

/** Where a bend or a golem point is in map.json. */
export function boardPointPosition(config: MapConfig, point: BoardPoint): MapPosition | undefined {
  if (point.kind === "bend") return spacesOf(config).find((space) => space.id === point.from)?.bends?.[String(point.to)]?.[point.index];
  const golem = golemsOf(config)[point.golem - 1];
  return point.kind === "golem" ? golem?.[point.part] : golem?.bends?.[point.index];
}

/** The edit that puts a bend or a golem point at `at` (a golem spot keeps its facing unless `at` has one). */
export function boardPointSet(config: MapConfig, point: BoardPoint, at: MapPosition): MapEdit {
  const block = blockPosition(at);
  if (point.kind === "bend") return { op: "moveBend", from: point.from, to: point.to, index: point.index, at: block };
  if (point.kind === "golemBend") return { op: "moveGolemBend", golem: point.golem, index: point.index, at: block };
  const old = boardPointPosition(config, point);
  const yaw = at.length === 5 ? at[3] : old?.length === 5 ? old[3] : 0;
  return { op: "setGolem", golem: point.golem, [point.part]: [...block, yaw, 0] };
}

/** The edit that turns a golem's spot to `yaw` (bends have no facing). */
export function boardPointFace(config: MapConfig, point: BoardPoint, yaw: number): MapEdit | undefined {
  if (point.kind !== "golem") return undefined;
  const old = boardPointPosition(config, point);
  return old ? { op: "setGolem", golem: point.golem, [point.part]: [...xyzOf(old), yaw, 0] } : undefined;
}

export function boardPointRemove(point: BoardPoint): MapEdit {
  if (point.kind === "bend") return { op: "removeBend", from: point.from, to: point.to, index: point.index };
  if (point.kind === "golemBend") return { op: "removeGolemBend", golem: point.golem, index: point.index };
  return { op: "setGolem", golem: point.golem, clear: [point.part] };
}

/** The edit a click on a block makes while placing; a golem's spot faces the space before it (its post) or its post (its rest spot). */
export function placeEdit(config: MapConfig, placing: Placing, position: MapPosition): MapEdit {
  const at = blockPosition(position);
  if (placing.kind === "bend") return { op: "addBend", from: placing.from, to: placing.to, at };
  if (placing.kind === "golemBend") return { op: "addGolemBend", golem: placing.golem, at };
  const golem = golemsOf(config)[placing.golem - 1];
  const toward = placing.part === "post" ? spacesOf(config).find((space) => space.id === golem.before)?.at : golem.post;
  const yaw = toward ? yawFrom(at, xyzOf(toward)) : 0;
  return { op: "setGolem", golem: placing.golem, [placing.part]: [...at, yaw, 0] };
}

/** A link's bends as points: small dots on its line. */
export function bendPoints(config: MapConfig): PointMark[] {
  return spacesOf(config).flatMap((space) =>
    Object.entries(space.bends ?? {}).flatMap(([to, bends]) =>
      bends.map((bend, index) => ({
        key: bendKey(space.id, Number(to), index),
        list: "bends",
        index,
        label: `Bend ${index + 1}, space ${space.id} to ${to}`,
        at: worldPoint(bend),
        yaw: 0,
        pitch: 0,
        faced: false,
        color: BEND_COLOR,
        shape: { kind: "dot" as const },
        noLine: true,
      })),
    ),
  );
}

/** The golems' spots and bends, the lines of their walks, and the Golems list (only on a board's map). */
export function golemMarkup(config: MapConfig, board: BoardConfig | undefined): { points: PointMark[]; walks: LinkMark[]; list?: MarkupList } {
  if (!board) return { points: [], walks: [] };
  const golems = golemsOf(config);
  const points: PointMark[] = [];
  const walks: LinkMark[] = [];
  golems.forEach((golem, i) => {
    const n = i + 1;
    for (const part of ["post", "rest"] as const) {
      const at = golem[part];
      if (!at) continue;
      points.push({
        key: golemSpotKey(n, part),
        list: GOLEMS_LIST,
        index: i,
        label: `${golemLabel(i)} ${part === "post" ? "post" : "rest"}`,
        at: worldPoint(xyzOf(at)),
        yaw: at.length === 5 ? at[3] : 0,
        pitch: 0,
        faced: true,
        color: part === "post" ? GOLEM_COLOR : dimmed(GOLEM_COLOR),
        shape: { kind: "player" },
      });
    }
    (golem.bends ?? []).forEach((bend, index) =>
      points.push({ key: golemBendKey(n, index), list: GOLEMS_LIST, index: i, label: `${golemLabel(i)}, bend ${index + 1}`, at: worldPoint(bend), yaw: 0, pitch: 0, faced: false, color: GOLEM_WALK_COLOR, shape: { kind: "dot" }, noLine: true }),
    );
    if (golem.post && golem.rest) {
      const [from, ...rest] = [golem.post, ...(golem.bends ?? []), golem.rest].map((at) => worldPoint(xyzOf(at)));
      walks.push({ key: golemKey(n), from, to: rest[rest.length - 1], via: rest.slice(0, -1), color: GOLEM_WALK_COLOR });
    }
  });
  const list: MarkupList = {
    key: GOLEMS_LIST,
    label: "Golems",
    kind: "points",
    color: GOLEM_COLOR,
    shape: { kind: "player" },
    entries: golems.map((golem, i) => ({ key: golemKey(i + 1), label: golemLabel(i), detail: golemDetail(golem, i) })),
  };
  return { points, walks, list };
}

/** A golem's line in the list: the path it blocks, and where it starts. */
function golemDetail(golem: BoardGolem, i: number): string {
  if (!Object.keys(golem).length) return "not set";
  const path = golem.before !== undefined && golem.after !== undefined ? `blocks ${golem.before} to ${golem.after}` : "blocks no path yet";
  return `${path}, starts ${i < GOLEMS_ACTIVE ? "on its post" : "resting"}`;
}

export interface BoardPointOptions {
  config: MapConfig;
  edit(change: MapEdit): unknown;
  /** Picks an entry or point by its key and flies to it. */
  showKey(key: string): void;
  /** What a click on a block places now, and starting or stopping that. */
  placing: Placing | undefined;
  place(placing: Placing | undefined): void;
}

/** A picked link's bends: how many, Add bends, Straighten, and each bend (it picks it) with an X. */
export function bendsSection(link: { from: number; to: number }, options: BoardPointOptions): HTMLElement {
  const space = spacesOf(options.config).find((candidate) => candidate.id === link.from);
  const bends = space?.bends?.[String(link.to)] ?? [];
  const on = options.placing?.kind === "bend" && options.placing.from === link.from && options.placing.to === link.to;
  return el(
    "div",
    {},
    el("div", { className: "group-label" }, `Bends (${bends.length})`),
    bends.length > 0 ? pointList(bends, (index) => bendKey(link.from, link.to, index), (index) => options.edit({ op: "removeBend", ...link, index }), options) : null,
    el(
      "div",
      { className: "buttons" },
      el("button", { className: `small${on ? " on" : ""}`, dataset: { tip: "Each block you click is a bend, in the part of the path it's nearest" }, onclick: () => options.place(on ? undefined : { kind: "bend", ...link }) }, on ? "Done adding bends" : "Add bends"),
      bends.length > 0 ? el("button", { className: "small", onclick: () => options.edit({ op: "clearBends", ...link }) }, "Straighten") : null,
    ),
  );
}

/** Golem `golem`'s panel (1 to 4): where it starts, its post and rest spot, the path it blocks, its walk's bends, the checks. */
export function golemPanel(golem: number, options: BoardPointOptions): HTMLElement {
  const { config, edit } = options;
  const index = golem - 1;
  const golems = golemsOf(config);
  const it = golems[index];
  const spaces = spacesOf(config);
  const before = spaces.find((space) => space.id === it.before);
  const spot = (part: "post" | "rest", label: string) => {
    const at = it[part];
    const on = options.placing?.kind === "golem" && options.placing.golem === golem && options.placing.part === part;
    return el(
      "div",
      {},
      el("div", { className: "group-label" }, label),
      el(
        "div",
        { className: "buttons" },
        at ? el("button", { className: "small", onclick: () => options.showKey(golemSpotKey(golem, part)) }, positionText(at)) : el("span", { className: "sub" }, "Not placed"),
        el("button", { className: `small${on ? " on" : ""}`, dataset: { tip: "Then click a block" }, onclick: () => options.place(on ? undefined : { kind: "golem", golem, part }) }, on ? "Click a block" : at ? "Place again" : "Place"),
      ),
    );
  };
  const choose = (label: string, value: number | undefined, choices: readonly number[], set: (id: number | undefined) => void) =>
    el(
      "label",
      { className: "setting" },
      el("span", { className: "group-label" }, label),
      el(
        "select",
        {
          onchange: (event: Event) => {
            const value = (event.target as HTMLSelectElement).value;
            set(value === "" ? undefined : Number(value));
          },
        },
        el("option", { value: "", selected: value === undefined }, "None"),
        choices.map((id) => el("option", { value: String(id), selected: id === value }, `Space ${id}`)),
      ),
    );
  const bends = it.bends ?? [];
  const bending = options.placing?.kind === "golemBend" && options.placing.golem === golem;
  const findings = checkGolems(golems, spaces).filter((finding) => finding.text.includes(golemLabel(index)));
  return el(
    "section",
    {},
    el("h2", {}, golemLabel(index)),
    el("p", { className: "sub" }, index < GOLEMS_ACTIVE ? "Starts on its post." : "Starts at its rest spot."),
    spot("post", "Post (blocking the path)"),
    spot("rest", "Rest spot"),
    el("div", { className: "group-label" }, "The path it blocks"),
    choose(
      "From space",
      it.before,
      spaces.map((space) => space.id),
      (id) => {
        if (id === undefined) return void edit({ op: "setGolem", golem, clear: ["before", "after"] });
        const next = spaces.find((space) => space.id === id)?.next ?? [];
        edit({ op: "setGolem", golem, before: id, ...(it.after !== undefined && next.includes(it.after) ? {} : next.length === 1 ? { after: next[0] } : { clear: ["after"] }) });
      },
    ),
    choose("To space", it.after, before?.next ?? [], (id) => void edit(id === undefined ? { op: "setGolem", golem, clear: ["after"] } : { op: "setGolem", golem, after: id })),
    el("div", { className: "group-label" }, `Walk bends (${bends.length})`),
    bends.length > 0 ? pointList(bends, (i) => golemBendKey(golem, i), (i) => options.edit({ op: "removeGolemBend", golem, index: i }), options) : null,
    el(
      "div",
      { className: "buttons" },
      el("button", { className: `small${bending ? " on" : ""}`, dataset: { tip: "Each block you click is a bend in its walk, in the part it's nearest" }, onclick: () => options.place(bending ? undefined : { kind: "golemBend", golem }) }, bending ? "Done adding bends" : "Add bends"),
      bends.length > 0 ? el("button", { className: "small", onclick: () => edit({ op: "setGolem", golem, clear: ["bends"] }) }, "Straighten") : null,
    ),
    findings.length > 0 ? el("ul", { className: "check-list" }, findings.map((finding) => el("li", {}, el("span", { className: "check" }, el("span", { className: "dot bad" }), el("span", { className: "grow" }, finding.text))))) : null,
    Object.keys(it).length > 0 ? el("div", { className: "buttons" }, el("button", { className: "small danger", onclick: () => edit({ op: "setGolem", golem, clear: ["post", "rest", "before", "after", "bends"] }) }, "Clear golem")) : null,
  );
}

/** The golems' checks for the Spaces tool's board check (none on a map without golems). */
export function golemFindings(config: MapConfig): string[] {
  const golems = golemsOf(config);
  return hasGolems(golems) ? checkGolems(golems, spacesOf(config)).map((finding) => finding.text) : [];
}

/** Bends as a list: each picks its point, with an X that takes it away. */
function pointList(bends: readonly Vec3[], key: (index: number) => string, remove: (index: number) => void, options: BoardPointOptions): HTMLElement {
  return el(
    "ul",
    { className: "check-list" },
    bends.map((bend, index) =>
      el(
        "li",
        { className: "bend-row" },
        el("button", { className: "check", onclick: () => options.showKey(key(index)) }, el("span", { className: "grow" }, `${index + 1}: ${positionText(bend)}`)),
        el("button", { className: "flow-unlink", dataset: { tip: "Take this bend away" }, onclick: () => remove(index) }, "×"),
      ),
    ),
  );
}

/** Yaw 0 faces south (+z), as the game's. */
function yawFrom(from: Vec3, to: Vec3): number {
  const yaw = Math.round((Math.atan2(-(to[0] - from[0]), to[2] - from[2]) * 180) / Math.PI);
  return yaw === -180 ? 180 : yaw;
}

function dimmed(color: number): number {
  return ((((color >> 16) & 0xff) * 0.7) << 16) | ((((color >> 8) & 0xff) * 0.7) << 8) | ((color & 0xff) * 0.7);
}
