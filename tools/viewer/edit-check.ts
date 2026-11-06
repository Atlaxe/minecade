// What the map viewer may change, checked before anything applies it: a MapEdit (map-edit.ts) of
// the ops that place, move, face and remove markup (spawns, points, boxes, heights) and Publish's
// "draft", with finite numbers, whole-block boxes and heights, and sensible names. The Panel checks
// what its page sends, and the map editor what the Panel forwards (control.ts POST /edit).
import { bigEnough, regionMinSize, type Box, type BuildLimitSide, type MapConfig, type MapEdit, type MapList, type MapRequirementsConfig } from "@minecade/minigame-core/config";

/** Who the viewer's changes are by, in game Edit's log and the map store's versions. */
export const VIEWER_BY = "Map viewer";

/** The world's height range: kill Y within it, a build limit up to one over it. */
const MIN_Y = -64;
const MAX_Y = 320;

/** Why a line (kill Y, or a side of the build limit) can't be at a height, by game Edit's Kill Y tool's rules, or undefined. */
export function heightProblem(config: MapConfig, line: "killY" | BuildLimitSide, y: number): string | undefined {
  if (line === "killY") return Number.isInteger(y) && y >= MIN_Y && y <= MAX_Y - 1 ? undefined : `Kill Y must be a whole number from ${MIN_Y} to ${MAX_Y - 1}.`;
  if (!Number.isInteger(y) || y < MIN_Y || y > MAX_Y) return `The build limit ${line} must be a whole number from ${MIN_Y} to ${MAX_Y}.`;
  const other: BuildLimitSide = line === "above" ? "below" : "above";
  const otherY = config.buildLimit?.[other];
  if (typeof otherY === "number" && (line === "above" ? y <= otherY : y >= otherY)) return `The build limit ${line} must be ${line === "above" ? "over" : "under"} the build limit ${other} (${otherY}), or nothing can be built.`;
  return undefined;
}

/** Why a region's box can't be saved (smaller than the game's minSize for it, as game Edit refuses), or undefined. */
export function regionBoxProblem(requires: MapRequirementsConfig | undefined, name: string, box: Box): string | undefined {
  const minSize = regionMinSize(requires, name);
  return bigEnough(box, minSize) ? undefined : `${name} boxes must span at least ${minSize} blocks along every side.`;
}

/** Why an edit breaks a rule game Edit's tools keep (a region's minSize, the build limit's order), or undefined. */
export function markupProblem(config: MapConfig, edit: MapEdit, requires: MapRequirementsConfig | undefined): string | undefined {
  switch (edit.op) {
    case "addRegion":
    case "setRegion":
      return regionBoxProblem(requires, edit.name, edit.box);
    case "killY":
      return edit.y === undefined ? undefined : heightProblem(config, "killY", edit.y);
    case "buildLimit":
      return edit.y === undefined ? undefined : heightProblem(config, edit.side, edit.y);
    case "batch":
      for (const inner of edit.edits) {
        const problem = markupProblem(config, inner, requires);
        if (problem) return problem;
      }
      return undefined;
    default:
      return undefined;
  }
}
const NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_-]+)?$/;
const TEAM = /^[A-Za-z0-9_-]+$/;
const MAX_BATCH = 64;

/** The edit, or why it isn't one the viewer may make. */
export function viewerEdit(value: unknown, depth = 0): MapEdit | string {
  if (!isRecord(value)) return "an edit is an object";
  const edit = value as Record<string, unknown>;
  switch (edit.op) {
    case "add":
      return listOf(edit.target) ?? (position(edit.at) ? (edit as MapEdit) : "add needs a position");
    case "set":
      return listOf(edit.target) ?? index(edit.index) ?? (position(edit.at) ? (edit as MapEdit) : "set needs a position");
    case "move":
      return listOf(edit.target) ?? index(edit.index) ?? (numbers(edit.at, 3) ? (edit as MapEdit) : "move needs x, y and z");
    case "face":
      if (edit.facing !== undefined && !(isRecord(edit.facing) && finite(edit.facing.yaw) && finite(edit.facing.pitch))) return "a facing is a yaw and a pitch";
      return listOf(edit.target) ?? index(edit.index) ?? (edit as MapEdit);
    case "remove":
      return listOf(edit.target) ?? index(edit.index) ?? (edit as MapEdit);
    case "renumber":
      return listOf(edit.target) ?? index(edit.from) ?? index(edit.to) ?? (edit as MapEdit);
    case "bounds":
      return edit.box === undefined || box(edit.box) ? (edit as MapEdit) : "a box is whole-block corners, min to max";
    case "addBounds":
    case "setBounds":
    case "removeBounds":
      if (edit.op !== "removeBounds" && !box(edit.box)) return "a box is whole-block corners, min to max";
      if (edit.op !== "addBounds" && index(edit.index)) return index(edit.index)!;
      return edit.spectators === undefined || typeof edit.spectators === "boolean" ? (edit as MapEdit) : "spectators is true or false";
    case "addRegion":
    case "setRegion":
    case "removeRegion":
      if (typeof edit.name !== "string" || !NAME.test(edit.name)) return "a region's name is letters, digits and _, starting with a letter";
      if (edit.op !== "removeRegion" && !box(edit.box)) return "a box is whole-block corners, min to max";
      if (edit.op !== "addRegion" && index(edit.index)) return index(edit.index)!;
      return edit as MapEdit;
    case "killY":
      return edit.y === undefined || height(edit.y, MAX_Y - 1) ? (edit as MapEdit) : `kill Y is a whole number from ${MIN_Y} to ${MAX_Y - 1}`;
    case "buildLimit":
      if (edit.side !== "above" && edit.side !== "below") return "a build limit's side is above or below";
      return edit.y === undefined || height(edit.y, MAX_Y) ? (edit as MapEdit) : `a build limit is a whole number from ${MIN_Y} to ${MAX_Y}`;
    case "draft":
      return typeof edit.draft === "boolean" ? (edit as MapEdit) : "draft is true or false";
    case "batch": {
      if (depth > 0) return "a batch can't hold a batch";
      if (!Array.isArray(edit.edits) || edit.edits.length === 0 || edit.edits.length > MAX_BATCH) return `a batch is 1 to ${MAX_BATCH} edits`;
      for (const inner of edit.edits) {
        const checked = viewerEdit(inner, depth + 1);
        if (typeof checked === "string") return checked;
      }
      return edit as MapEdit;
    }
    default:
      return `the viewer doesn't make "${String(edit.op)}" edits`;
  }
}

/** Undefined for a list the viewer can place into, else why not. */
function listOf(value: unknown): string | undefined {
  if (!isRecord(value)) return "an edit names its list";
  const target = value as Partial<MapList> & Record<string, unknown>;
  switch (target.list) {
    case "spawns":
    case "spectatorSpawn":
    case "queueSpawn":
      return undefined;
    case "teamSpawns":
      return typeof target.team === "string" && TEAM.test(target.team) ? undefined : "team spawns name their team";
    case "points":
      return typeof target.name === "string" && NAME.test(target.name) ? undefined : "points name their list";
    default:
      return "not a list of map.json";
  }
}

function index(value: unknown): string | undefined {
  return Number.isInteger(value) && (value as number) >= 0 ? undefined : "an entry's place is a whole number";
}

/** [x, y, z], or [x, y, z, yaw, pitch]. */
function position(value: unknown): boolean {
  return numbers(value, 3) || numbers(value, 5);
}

function numbers(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length && value.every(finite);
}

function box(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { min, max } = value as { min?: unknown; max?: unknown };
  if (!numbers(min, 3) || !numbers(max, 3)) return false;
  const [low, high] = [min as number[], max as number[]];
  return low.every(Number.isInteger) && high.every(Number.isInteger) && low.every((v, axis) => v <= high[axis]);
}

function height(value: unknown, max: number): boolean {
  return Number.isInteger(value) && (value as number) >= MIN_Y && (value as number) <= max;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
