// What the map viewer may change, checked before anything applies it: a MapEdit (map-edit.ts) of
// the ops that place, move, face and remove markup (spawns, points, boxes, heights), Publish's
// "draft", and the map settings (the name, the time of day, the queue, a game's own settings and
// other plain keys, the lobby's star box, the requirement options), with finite numbers, whole-block
// boxes and heights, and sensible names. The Panel checks what its page sends, and the map editor what the Panel forwards
// (control.ts POST /edit).
import {
  MAP_TIMES,
  QUEUE_COUNTDOWN,
  bigEnough,
  isMapKey,
  mapSettings,
  regionMinSize,
  requirementOptions,
  settingFits,
  type Box,
  type BuildLimitSide,
  type MapConfig,
  type MapEdit,
  type MapList,
  type MapRequirementsConfig,
} from "@minecade/minigame-core/config";

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

/** The longest map name the viewer sets. */
export const MAX_NAME = 48;

/** What markupProblem checks an edit against: the game's requirements, and whether it's the lobby's map. */
export interface EditRules {
  requires?: MapRequirementsConfig;
  kind?: string;
}

/**
 * Why an edit breaks a rule game Edit's tools keep (a region's minSize, the build limit's order, a
 * game setting's range, a key's kind of value, the lobby's star box, a queue without its spawn), or
 * undefined.
 */
export function markupProblem(config: MapConfig, edit: MapEdit, rules: EditRules): string | undefined {
  const { requires } = rules;
  switch (edit.op) {
    case "extra": {
      const setting = mapSettings(requires).find((candidate) => candidate.key === edit.key);
      if (setting) return edit.value === undefined || settingFits(setting, edit.value) ? undefined : `${setting.label} is a whole number from ${setting.min} to ${setting.max}.`;
      // Any other key is one the map has already, keeping its kind of value (game Edit's Name and map id form).
      const old = config[edit.key];
      if (!["string", "number", "boolean"].includes(typeof old)) return `${edit.key} isn't one of this map's settings.`;
      return typeof edit.value === typeof old ? undefined : `${edit.key} is ${typeof old === "boolean" ? "true or false" : `a ${typeof old}`}.`;
    }
    case "addSpace":
    case "setSpace":
      return edit.type === undefined ? (requires?.board ? undefined : "This game has no board.") : spaceTypeProblem(requires, edit.type);
    case "retypeSpaces":
      for (const type of Object.values(edit.types)) {
        const problem = spaceTypeProblem(requires, type);
        if (problem) return problem;
      }
      return undefined;
    case "requirement":
      return edit.value === undefined ? undefined : requirementProblem(requires, rules.kind === "lobby" ? "lobby" : "game", edit.key, edit.value);
    case "stars":
      return edit.on && rules.kind !== "lobby" ? "The star box is only for the lobby's maps." : undefined;
    case "gameThumbnail":
      return edit.on && rules.kind === "lobby" ? "The lobby has no picture: a minigame thumbnail map is one of a game's maps." : undefined;
    case "queue":
      return config.queueSpawn === undefined ? "Place the queue spawn first." : undefined;
    case "addRegion":
    case "setRegion":
      return regionBoxProblem(requires, edit.name, edit.box);
    case "killY":
      return edit.y === undefined ? undefined : heightProblem(config, "killY", edit.y);
    case "buildLimit":
      return edit.y === undefined ? undefined : heightProblem(config, edit.side, edit.y);
    case "batch":
      for (const inner of edit.edits) {
        const problem = markupProblem(config, inner, rules);
        if (problem) return problem;
      }
      return undefined;
    default:
      return undefined;
  }
}
/** Why a space can't be a type: the game's board doesn't have it (or the game has no board), or undefined. */
export function spaceTypeProblem(requires: MapRequirementsConfig | undefined, type: string): string | undefined {
  const board = requires?.board;
  if (!board) return "This game has no board.";
  return board.types.some((candidate) => candidate.id === type) ? undefined : `A space can't be "${type}": it's one of ${board.types.map((candidate) => candidate.name).join(", ")}.`;
}

/** Why a map can't make a requirement option choice (its game's map.adjustable decides), or undefined. */
export function requirementProblem(requires: MapRequirementsConfig | undefined, kind: "lobby" | "game", key: string, value: false | number): string | undefined {
  const option = requirementOptions(requires, { kind }).find((candidate) => candidate.key === key);
  if (!option) return `This game doesn't let a map change ${key}.`;
  if (value === false) return option.off ? undefined : `This game can't do without ${option.label}.`;
  if (!option.range) return `${option.label} has no count to set.`;
  return value >= option.range.min && value <= option.range.max ? undefined : `${option.label} is a count from ${option.range.min} to ${option.range.max}.`;
}

const NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_-]+)?$/;
const SPACE_TYPE = /^[a-z][a-z0-9_]*$/;
/** The most spaces one Deal again can retype. */
const MAX_SPACES = 500;

function spaceId(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 1;
}
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
    case "name":
      return typeof edit.name === "string" && edit.name.trim() === edit.name && edit.name.length > 0 && edit.name.length <= MAX_NAME && !/[\u0000-\u001f\u00a7]/.test(edit.name)
        ? (edit as MapEdit)
        : `a map's name is 1 to ${MAX_NAME} characters, without color codes`;
    case "time":
      return edit.time === undefined || (typeof edit.time === "string" && Object.hasOwn(MAP_TIMES, edit.time)) || (Number.isInteger(edit.time) && (edit.time as number) >= 0 && (edit.time as number) < 24000)
        ? (edit as MapEdit)
        : "a time of day is one of its names, or ticks from 0 to 23999";
    case "queue": {
      const { min, max } = QUEUE_COUNTDOWN;
      if (edit.mode !== undefined && edit.mode !== "lock" && edit.mode !== "free") return "the queue's mode is lock or free";
      if (edit.countdown !== undefined && !(Number.isInteger(edit.countdown) && (edit.countdown as number) >= min && (edit.countdown as number) <= max)) return `the queue countdown is whole seconds from ${min} to ${max}`;
      return edit.mode !== undefined || edit.countdown !== undefined ? (edit as MapEdit) : "a queue edit sets its mode or its countdown";
    }
    case "extra":
      if (typeof edit.key !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(edit.key) || isMapKey(edit.key)) return "a game setting's key is letters, digits and _, and not one of map.json's own";
      return edit.value === undefined || typeof edit.value === "boolean" || finite(edit.value) || (typeof edit.value === "string" && edit.value.length <= 200)
        ? (edit as MapEdit)
        : "a game setting's value is a number, true or false, or text";
    case "requirement":
      if (typeof edit.key !== "string" || !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)?$/.test(edit.key)) return "a requirement's key is a checklist row's, such as killY or regions.kill";
      return edit.value === undefined || edit.value === false || (Number.isInteger(edit.value) && (edit.value as number) >= 1 && (edit.value as number) <= 999)
        ? (edit as MapEdit)
        : "a requirement is off (false) or a count from 1";
    case "addSpace":
      if (!position(edit.at)) return "a space needs a position";
      if (typeof edit.type !== "string" || !SPACE_TYPE.test(edit.type)) return "a space's type is a type id";
      return edit.from === undefined || spaceId(edit.from) ? (edit as MapEdit) : "a space id is a whole number from 1";
    case "moveSpace":
      return spaceId(edit.id) && numbers(edit.at, 3) ? (edit as MapEdit) : "moving a space needs its id and x, y and z";
    case "removeSpace":
      return spaceId(edit.id) ? (edit as MapEdit) : "a space id is a whole number from 1";
    case "linkSpace":
    case "unlinkSpace":
      return spaceId(edit.from) && spaceId(edit.to) ? (edit as MapEdit) : "a link is from one space id to another";
    case "setSpace":
      if (!spaceId(edit.id)) return "a space id is a whole number from 1";
      if (edit.type !== undefined && (typeof edit.type !== "string" || !SPACE_TYPE.test(edit.type))) return "a space's type is a type id";
      return ["locked", "star", "opening"].every((flag) => edit[flag] === undefined || typeof edit[flag] === "boolean") ? (edit as MapEdit) : "a space's flags are true or false";
    case "retypeSpaces": {
      const types = edit.types;
      if (!isRecord(types) || Object.keys(types).length === 0 || Object.keys(types).length > MAX_SPACES) return `dealing again gives 1 to ${MAX_SPACES} spaces their types`;
      return Object.entries(types).every(([id, type]) => spaceId(Number(id)) && typeof type === "string" && SPACE_TYPE.test(type)) ? (edit as MapEdit) : "dealing again maps space ids to type ids";
    }
    case "stars":
      return typeof edit.on === "boolean" ? (edit as MapEdit) : "stars is true or false";
    case "gameThumbnail":
      return typeof edit.on === "boolean" ? (edit as MapEdit) : "gameThumbnail is true or false";
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
