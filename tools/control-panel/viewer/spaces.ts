// A board's spaces in the map viewer (the board kit, a game whose config has map.board: Block
// Party's boards), as game Edit's Spaces tool has them (editor/behavior_pack/scripts/spaces-tool.ts):
//   - markup: each space a post in its type's color (a point the Select tool picks, drags and
//     deletes like any other), an arrow for each link (Select picks one by its line: its panel has
//     Delete, and so does the Delete key), and a Spaces list in a Board section;
//   - the Spaces tool: a click on a block places a space on its middle, linked from the previous
//     space (the one placed or picked last) and dealt its type; its panel has the previous space,
//     Deal again, and the board check (each finding flies to its first space);
//   - a picked space's panel: Type, Lock, Star candidate, Opening spot, then Paths, a flow diagram
//     (the user's idea): the spaces that lead into it, the space, and the spaces it leads to, each a
//     tile that picks its space, each link with an X that takes it away, then Create path (the Spaces
//     tool, the next space placed leading on from this one) and Lead to (then click the space it
//     leads to, in the view or the list) as tiles of their own; then Delete.
// A Star candidate's name says so ("Space 3: Blue, Star"), in the list and over its post. A link's
// bends (board-points.ts) are dots its arrow runs through; a picked link's panel adds and takes them.
import {
  checkBoard,
  dealAgain,
  nextSpaceId,
  positionText,
  reportLines,
  retypeSpaces,
  spaceLabel,
  spacesOf,
  typeForNewSpace,
  worldPoint,
  type BoardConfig,
  type BoardSpace,
  type MapConfig,
  type MapEdit,
  type MapPosition,
} from "@minecade/minigame-core/config";
import { bendPoints, bendsSection, golemFindings, type BoardPointOptions } from "./board-points.ts";
import { colorText, el } from "./sidebar.ts";
import type { MarkupList, PointMark } from "./markup.ts";

/** A space's key in the viewer's markup. */
export const SPACE_KEY = "space:";
/** The Spaces list's key (its checklist row's). */
export const SPACES_LIST = "spaces";

export const spaceKey = (id: number) => `${SPACE_KEY}${id}`;

/** The space a markup key names, if it's a space's. */
export function spaceIdOf(key: string | undefined): number | undefined {
  if (!key?.startsWith(SPACE_KEY)) return undefined;
  const id = Number(key.slice(SPACE_KEY.length));
  return Number.isInteger(id) ? id : undefined;
}

/** A link's key in the viewer's markup: "link:3>4" (space 3 leads to space 4). */
export const LINK_KEY = "link:";

export const linkKey = (from: number, to: number) => `${LINK_KEY}${from}>${to}`;

/** The link a markup key names, if it's a link's. */
export function linkOf(key: string | undefined): { from: number; to: number } | undefined {
  const match = key?.startsWith(LINK_KEY) ? /^(-?\d+)>(-?\d+)$/.exec(key.slice(LINK_KEY.length)) : null;
  return match ? { from: Number(match[1]), to: Number(match[2]) } : undefined;
}

/** A link's name: "Space 3 to space 4". */
export const linkLabel = (link: { from: number; to: number }) => `Space ${link.from} to space ${link.to}`;

/** An arrow from one space toward the next (through its bends), or a golem's walk. */
export interface LinkMark {
  key: string;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  /** The bends it goes through on the way, in order. */
  via?: { x: number; y: number; z: number }[];
  /** Its color, when it isn't a link's white. */
  color?: number;
}

/** The spaces' markers, their list, and the links' arrows (none without a board). */
export function spaceMarkup(config: MapConfig, board: BoardConfig | undefined, need: { need?: number; done?: boolean }): { points: PointMark[]; list?: MarkupList; links: LinkMark[] } {
  if (!board) return { points: [], links: [] };
  const spaces = spacesOf(config);
  const types = new Map(board.types.map((type) => [type.id, type]));
  const points: PointMark[] = spaces.map((space, index) => ({
    key: spaceKey(space.id),
    list: SPACES_LIST,
    index,
    label: spaceLabel(space, board),
    at: worldPoint(space.at),
    yaw: 0,
    pitch: 0,
    faced: false,
    color: types.get(space.type ?? "")?.color ?? 0xffffff,
    shape: { kind: "post" },
    noLine: true,
  }));
  const at = new Map(spaces.map((space) => [space.id, worldPoint(space.at)]));
  const links: LinkMark[] = spaces.flatMap((space) =>
    (space.next ?? []).flatMap((id) => {
      if (!at.has(id)) return [];
      const via = (space.bends?.[String(id)] ?? []).map((bend) => worldPoint(bend));
      return [{ key: linkKey(space.id, id), from: at.get(space.id)!, to: at.get(id)!, ...(via.length > 0 ? { via } : {}) }];
    }),
  );
  const list: MarkupList = {
    key: SPACES_LIST,
    label: board.label ?? "Spaces",
    kind: "points",
    color: types.get("blue")?.color ?? 0x3c5adc,
    shape: { kind: "post" },
    entries: points.map((point, index) => ({ key: point.key, label: point.label, detail: positionText(spaces[index].at) })),
    ...need,
  };
  // The links' bends: dots on their lines, picked and dragged like the spaces (not in the list).
  return { points: [...points, ...bendPoints(config)], list, links };
}

/** A space's position for a spot in the viewer: its block's middle (whole x and z), the spot's floor. */
export function spacePosition(position: MapPosition): [number, number, number] {
  return [Math.floor(position[0]), Math.round(position[1]), Math.floor(position[2])];
}

/** The edit that places a space at `position` after `previous` (dealt its type), and its id. */
export function placeSpace(config: MapConfig, board: BoardConfig, position: MapPosition, previous: number | undefined): { edit: MapEdit; id: number } {
  const spaces = spacesOf(config);
  const at = spacePosition(position);
  const from = spaces.length > 0 && previous !== undefined && spaces.some((space) => space.id === previous) ? previous : undefined;
  const type = typeForNewSpace(spaces, at, board, from);
  return { edit: { op: "addSpace", at, type, ...(from === undefined ? {} : { from }) }, id: nextSpaceId(spaces) };
}

export interface SpacePanelOptions extends BoardPointOptions {
  config: MapConfig;
  board: BoardConfig;
  previous: number | undefined;
  edit(change: MapEdit): unknown;
  /** Create path: the Spaces tool, the next space placed leading on from `id`. */
  createPath(id: number): void;
  /** Lead to: the next space clicked is where `id` leads (or none while nothing waits). */
  leadTo(id: number): void;
  leading: number | undefined;
  /** Picks a space and flies to it. */
  show(id: number): void;
  /** Says something over the view. */
  note(text: string, problem?: boolean): void;
}

/** A picked space's panel. */
export function spacePanel(space: BoardSpace, options: SpacePanelOptions): HTMLElement {
  const { board, previous, edit } = options;
  const id = space.id;
  const type = el(
    "select",
    { onchange: (event: Event) => edit({ op: "setSpace", id, type: (event.target as HTMLSelectElement).value }) },
    board.types.map((candidate) => el("option", { value: candidate.id, selected: candidate.id === space.type }, candidate.name)),
  );
  const flag = (name: "locked" | "star" | "opening", label: string) =>
    el("label", { className: "field-row" }, el("input", { type: "checkbox", checked: space[name] === true, onchange: (event: Event) => edit({ op: "setSpace", id, [name]: (event.target as HTMLInputElement).checked }) }), ` ${label}`);
  return el(
    "section",
    {},
    el("h2", {}, `Space ${id}`),
    el("label", { className: "setting" }, el("span", { className: "group-label" }, "Type"), type),
    flag("locked", "Lock"),
    flag("star", "Star candidate"),
    space.star ? flag("opening", "Opening spot") : null,
    el("div", { className: "group-label" }, "Paths"),
    pathsFlow(space, options),
    el("div", { className: "buttons" }, el("button", { className: "small danger", onclick: () => edit({ op: "removeSpace", id }) }, "Delete space")),
  );
}

/**
 * A space's paths as a flow diagram, top to bottom: the spaces that lead into it, the space, the
 * spaces it leads to. Each is a tile in its type's color that picks its space; each link has an X
 * that takes it away; Create path and Lead to are tiles at the end of the row it leads to.
 */
function pathsFlow(space: BoardSpace, options: SpacePanelOptions): HTMLElement {
  const { config, board, previous, edit } = options;
  const id = space.id;
  const spaces = spacesOf(config);
  const types = new Map(board.types.map((type) => [type.id, type]));
  const byId = new Map(spaces.map((candidate) => [candidate.id, candidate]));
  const colored = <T extends HTMLElement>(node: T, type: string | undefined): T => {
    node.style.setProperty("--node-color", colorText(types.get(type ?? "")?.color ?? 0xffffff));
    return node;
  };
  const tile = (other: BoardSpace | undefined, otherId: number, unlink?: { from: number; to: number }) => {
    const kind = types.get(other?.type ?? "");
    return el(
      "div",
      { className: "flow-tile" },
      colored(
        el(
          "button",
          { className: "flow-node", onclick: () => options.show(otherId) },
          el("b", {}, `Space ${otherId}`),
          el("span", {}, kind?.name ?? "No type"),
          other?.star ? el("span", { className: "flow-star" }, "Star") : null,
        ),
        other?.type,
      ),
      unlink ? el("button", { className: "flow-unlink", dataset: { tip: `Take away ${linkLabel(unlink).toLowerCase()}` }, onclick: () => edit({ op: "unlinkSpace", ...unlink }) }, "×") : null,
    );
  };
  const incoming = spaces.filter((other) => (other.next ?? []).includes(id));
  const outgoing = space.next ?? [];
  const arrow = () => el("div", { className: "flow-arrow" });
  const kind = types.get(space.type ?? "");
  return el(
    "div",
    { className: "flow" },
    el("div", { className: "flow-row" }, incoming.length > 0 ? incoming.map((other) => tile(other, other.id, { from: other.id, to: id })) : el("div", { className: "flow-empty" }, "Nothing leads here")),
    arrow(),
    el(
      "div",
      { className: "flow-row" },
      colored(el("div", { className: "flow-node self" }, el("b", {}, `Space ${id}`), el("span", {}, kind?.name ?? "No type"), space.star ? el("span", { className: "flow-star" }, "Star") : null), space.type),
    ),
    arrow(),
    el(
      "div",
      { className: "flow-row" },
      outgoing.map((to) => tile(byId.get(to), to, { from: id, to })),
      el("button", { className: `flow-node add${previous === id ? " on" : ""}`, dataset: { tip: "The next space you place leads on from this one" }, onclick: () => options.createPath(id) }, el("b", {}, "+"), el("span", {}, "Create path")),
      el("button", { className: `flow-node add${options.leading === id ? " on" : ""}`, dataset: { tip: "Then click the space it leads to" }, onclick: () => options.leadTo(id) }, el("b", {}, "→"), el("span", {}, options.leading === id ? "Click a space" : "Lead to")),
    ),
  );
}

/** A picked link's panel: where it runs (each end picks its space), its bends, and Delete. */
export function linkPanel(link: { from: number; to: number }, options: SpacePanelOptions): HTMLElement {
  return el(
    "section",
    {},
    el("h2", {}, "Link"),
    el(
      "div",
      { className: "buttons" },
      el("button", { className: "small", onclick: () => options.show(link.from) }, `Space ${link.from}`),
      el("span", { className: "sub" }, "leads to"),
      el("button", { className: "small", onclick: () => options.show(link.to) }, `Space ${link.to}`),
    ),
    bendsSection(link, options),
    el("div", { className: "buttons" }, el("button", { className: "small danger", onclick: () => options.edit({ op: "unlinkSpace", ...link }) }, "Delete link")),
  );
}

/** The Spaces tool's panel: the previous space, Deal again, and the board check. */
export function spacesToolPanel(options: SpacePanelOptions): HTMLElement {
  const { config, board, previous } = options;
  const spaces = spacesOf(config);
  const report = checkBoard(spaces, board);
  const finding = (text: string, ids: number[], problem: boolean) =>
    el("li", {}, el("button", { className: "check", disabled: ids.length === 0, onclick: () => options.show(ids[0]) }, el("span", { className: problem ? "dot bad" : "dot" }), el("span", { className: "grow" }, text)));
  const dealAgainNow = () => {
    const types = dealAgain(spaces, board);
    const count = Object.keys(types).length;
    if (count === 0) return options.note("Dealt again: no space changed.");
    const warnings = checkBoard(retypeSpaces(spaces, types), board).warnings.length;
    options.edit({ op: "retypeSpaces", types });
    options.note(`Dealt again: ${count} space${count === 1 ? "" : "s"} changed, ${warnings} warning${warnings === 1 ? "" : "s"} left.`);
  };
  const summary = reportLines(report).filter((line) => !line.startsWith("Error: ") && !line.startsWith("Warning: ") && line !== "No errors.");
  return el(
    "section",
    {},
    el("h2", {}, "Spaces"),
    el("p", { className: "sub" }, previous !== undefined && spaces.some((space) => space.id === previous) ? `Click a block: a space after space ${previous}.` : spaces.length === 0 ? "Click a block: Start." : "Click a block: a space on its own (pick one and Make it the previous to link from it)."),
    el("div", { className: "buttons" }, el("button", { className: "small", disabled: spaces.length === 0, onclick: dealAgainNow }, "Deal again")),
    spaces.length > 0
      ? el(
          "div",
          {},
          el("div", { className: "group-label" }, "Board check"),
          el("ul", { className: "check-list" }, [...report.errors.map((error) => finding(error.text, error.spaces, true)), ...golemFindings(config).map((text) => finding(text, [], true)), ...report.warnings.map((warning) => finding(warning.text, warning.spaces, false))]),
          summary.map((line) => el("p", { className: "sub" }, line)),
        )
      : null,
  );
}
