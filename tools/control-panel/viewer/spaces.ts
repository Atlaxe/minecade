// A board's spaces in the map viewer (the board kit, a game whose config has map.board: Block
// Party's boards), as game Edit's Spaces tool has them (editor/behavior_pack/scripts/spaces-tool.ts):
//   - markup: each space a post in its type's color (a point the Select tool picks, drags and
//     deletes like any other), an arrow for each link, and a Spaces list in a Board section;
//   - the Spaces tool: a click on a block places a space on its middle, linked from the previous
//     space (the one placed or picked last) and dealt its type; its panel has the previous space,
//     Deal again, and the board check (each finding flies to its first space);
//   - a picked space's panel: Type, Lock, Star candidate, Opening spot, Make it the previous, Link
//     the previous here, its links (each with a button to take it away), and Delete.
import {
  checkBoard,
  dealAgain,
  nextSpaceId,
  positionText,
  reportLines,
  retypeSpaces,
  spacesOf,
  typeForNewSpace,
  worldPoint,
  type BoardConfig,
  type BoardSpace,
  type MapConfig,
  type MapEdit,
  type MapPosition,
} from "@minecade/minigame-core/config";
import { el } from "./sidebar.ts";
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

/** An arrow from one space toward the next. */
export interface LinkMark {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
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
    label: `Space ${space.id}: ${types.get(space.type ?? "")?.name ?? "no type"}`,
    at: worldPoint(space.at),
    yaw: 0,
    pitch: 0,
    faced: false,
    color: types.get(space.type ?? "")?.color ?? 0xffffff,
    shape: { kind: "post" },
    noLine: true,
  }));
  const at = new Map(spaces.map((space) => [space.id, worldPoint(space.at)]));
  const links: LinkMark[] = spaces.flatMap((space) => (space.next ?? []).flatMap((id) => (at.has(id) ? [{ from: at.get(space.id)!, to: at.get(id)! }] : [])));
  const list: MarkupList = {
    key: SPACES_LIST,
    label: board.label ?? "Spaces",
    kind: "points",
    color: types.get("blue")?.color ?? 0x3c5adc,
    shape: { kind: "post" },
    entries: points.map((point, index) => ({ key: point.key, label: point.label, detail: positionText(spaces[index].at) })),
    ...need,
  };
  return { points, list, links };
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

export interface SpacePanelOptions {
  config: MapConfig;
  board: BoardConfig;
  previous: number | undefined;
  edit(change: MapEdit): unknown;
  setPrevious(id: number): void;
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
  const previousSpace = spacesOf(options.config).find((candidate) => candidate.id === previous);
  const canLink = previousSpace && previous !== id && !previousSpace.next?.includes(id);
  return el(
    "section",
    {},
    el("h2", {}, `Space ${id}`),
    el("label", { className: "setting" }, el("span", { className: "group-label" }, "Type"), type),
    flag("locked", "Lock"),
    flag("star", "Star candidate"),
    space.star ? flag("opening", "Opening spot") : null,
    el(
      "div",
      { className: "buttons" },
      el("button", { className: `small${previous === id ? " on" : ""}`, onclick: () => options.setPrevious(id) }, previous === id ? "The previous space" : "Make it the previous"),
      canLink ? el("button", { className: "small", onclick: () => edit({ op: "linkSpace", from: previous!, to: id }) }, `Link space ${previous} here`) : null,
    ),
    (space.next ?? []).length > 0 ? el("div", { className: "group-label" }, "Leads to") : null,
    (space.next ?? []).map((to) =>
      el(
        "div",
        { className: "field-row" },
        el("button", { className: "small", onclick: () => options.show(to) }, `Space ${to}`),
        el("button", { className: "small danger", onclick: () => edit({ op: "unlinkSpace", from: id, to }) }, "Unlink"),
      ),
    ),
    el("div", { className: "buttons" }, el("button", { className: "small danger", onclick: () => edit({ op: "removeSpace", id }) }, "Delete")),
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
          el("ul", { className: "check-list" }, [...report.errors.map((error) => finding(error.text, error.spaces, true)), ...report.warnings.map((warning) => finding(warning.text, warning.spaces, false))]),
          summary.map((line) => el("p", { className: "sub" }, line)),
        )
      : null,
  );
}
