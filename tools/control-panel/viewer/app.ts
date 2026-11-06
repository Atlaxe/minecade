// The map viewer page (/viewer?target=<id>&map=<id>&name=<name>&game=<name>, opened from the
// Panel's Maps page in the same window): a map's world in 3D. It loads the map's view file, the
// blocks' colors and its custom blocks' shapes from the Panel, meshes the blocks in workers, and
// draws them (scene.ts); over them the map's markup (overlay.ts), and beside them the tools, the
// checklist, the checks (checks.ts) and the overview (sidebar.ts) on the left and the picked tool's
// or entry's settings, or the cuts, on the right.
// Tools as game Edit has them: Select (pick, then move or resize with the gizmo, gizmo.ts, or type
// the values), Spawn and Marker (place points), Region (draw boxes), Height (kill Y, the build
// limit) and Cut. Each edit goes to the Panel (changes.ts), with undo and redo, Save and Publish.
import * as THREE from "three";
import { bigEnough, listOf, worldPoint, type Box, type EditorRules, type MapConfig, type MapEdit, type MapPosition, type Vec3 } from "@minecade/minigame-core/config";
import { lookAt, mapMiddle } from "../../../editor/behavior_pack/scripts/lists.ts";
import { regionName } from "../../../editor/behavior_pack/scripts/regions.ts";
import { decodeView } from "../../viewer/view-format.ts";
import { addBoxEdit, boxFrom, faceToCut, facePlane, heightEdit, heightFromBlock, heightProblem, moveFace, nearestOnAxis, nudgeFace, removeBoxEdit, setBoxEdit, sizeText, MAX_LIMIT, MIN_HEIGHT, type Face } from "./boxes.ts";
import { MapChangesClient } from "./changes.ts";
import { FLY_SPEEDS, Fly, type FlySpeed } from "./fly.ts";
import { Gizmo, type GizmoPart } from "./gizmo.ts";
import { buildMarkup, findEntry, type BoxMark, type Markup, type MarkupList, type PlaneMark, type PointMark } from "./markup.ts";
import { Overlay, type MarkerAssets } from "./overlay.ts";
import { blocksWithoutLook, mapWarnings } from "./checks.ts";
import { centeredSpot, floorSpot, normalYaw, placedPosition, yawToward, type Spot } from "./placing.ts";
import { MapScene, type Cuts, type Toggles } from "./scene.ts";
import { Sidebar, el, swatch } from "./sidebar.ts";
import { ViewCube } from "./viewcube.ts";
import type { CustomShape } from "./shapes.ts";
import { buildVolume, spotsOf, type FaceColors } from "./volume.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const target = params.get("target") ?? "";
const map = params.get("map") ?? "";
const name = params.get("name") || map;
const game = params.get("game") || target;

/** The viewer's own settings, kept in this browser: per viewer, not per map. */
const STORE_KEY = "minecade-viewer";
interface Settings extends Toggles {
  /** Names over the markers. */
  names: boolean;
  /** A placed or moved point goes to the middle of its block (game Edit's Center on block). */
  center: boolean;
  /** WASD flying, and how fast. */
  wasd: boolean;
  flySpeed: FlySpeed;
  /** Outlines of the hidden blocks a game uses: barriers, invisible bedrock, light blocks. */
  hidden: boolean;
  /** Each face one color (Average colors), or its texture (Vanilla textures). */
  look: "colors" | "textures";
}
const DEFAULTS: Settings = { occlusion: true, variation: true, darkenBelow: false, faded: true, names: true, center: true, wasd: false, flySpeed: "normal", hidden: false, look: "colors" };

/** What the Panel sends for a map's markup (tools/viewer/map-data.ts). */
interface MapData extends MarkerAssets {
  config: MapConfig;
  stamp: string;
  targetName: string;
  rules: EditorRules;
}

type ToolId = "select" | "spawn" | "marker" | "region" | "height" | "cut";
type CutAxis = "x" | "y" | "z";
/** Each tool's key (no modifier). W, A, S and D stay free for flying. */
const TOOL_KEYS: Record<string, ToolId> = { KeyV: "select", KeyP: "spawn", KeyM: "marker", KeyB: "region", KeyH: "height", KeyC: "cut" };

/** How far the pointer moves before a press is a drag, in pixels. */
const DRAG_PIXELS = 4;
/** Facing steps while dragging the knob (Shift: whole degrees). */
const FACING_STEP = 15;
/** A new region's color until it has a box (then it takes game Edit's). */
const NEW_REGION_COLOR = 0xffffff;
const AXIS_VECTORS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    // Not kept: the viewer starts with the defaults next time.
  }
}

function show(text: string, bad = false): void {
  const message = $("message");
  message.textContent = text;
  message.className = bad ? "message bad" : "message";
  message.hidden = false;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** A note over the view for a few seconds: what a change did, or why it didn't happen. */
function notice(text: string, bad = false): void {
  const box = $("notice");
  box.textContent = text;
  box.className = bad ? "notice bad" : "notice";
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (box.hidden = true), bad ? 9000 : 6000);
}

/** Why a box can't be saved in a list with a minimum size, or undefined. */
function sizeProblem(box: Box, label: string, minSize: number | undefined): string | undefined {
  return bigEnough(box, minSize) ? undefined : `${label} boxes must span at least ${minSize} blocks along every side.`;
}

/** Whether a key event is typing into a field (keys then belong to the field). */
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ? !["range", "checkbox", "radio", "button"].includes(target.type) : target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** A number to two places, without "-0". */
function round2(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

async function main(): Promise<void> {
  document.title = `${name} (${game})`;
  $("map-name").textContent = name;
  $("map-game").textContent = `${game}, ${map}`;
  const query = `target=${encodeURIComponent(target)}&map=${encodeURIComponent(map)}`;
  // The map's thumbnail, when it has one.
  const thumb = el("img", { className: "banner-thumb", alt: "" });
  thumb.onload = () => $("map-thumb").replaceChildren(thumb);
  thumb.src = `/api/viewer/thumb?${query}`;
  // An open event stream counts this window as one of the Panel's, so it stays up while the viewer
  // is open; naming the map also brings its map.json's changes.
  const events = new EventSource(`/api/events?${query}`);

  const [viewResponse, colorsResponse, mapResponse, shapesResponse] = await Promise.all([
    fetch(`/api/viewer/view?${query}`),
    fetch("/api/viewer/colors"),
    fetch(`/api/viewer/map?${query}`),
    fetch(`/api/viewer/shapes?${query}`),
  ]);
  for (const response of [viewResponse, mapResponse]) {
    if (response.ok) continue;
    const answer = (await response.json().catch(() => ({}))) as { error?: string };
    return show(`This map can't be shown: ${answer.error ?? `HTTP ${response.status}`}.`, true);
  }
  const data = (await mapResponse.json()) as MapData;
  const view = decodeView(new Uint8Array(await viewResponse.arrayBuffer()));
  const colors = (await colorsResponse.json()) as { blocks: Record<string, FaceColors>; textures?: Record<string, [number, number, number]>; layers?: number; note?: string };
  // Custom blocks are drawn as cubes when their shapes can't be read.
  const shapes = shapesResponse.ok ? ((await shapesResponse.json()) as { shapes: Record<string, CustomShape> }).shapes : {};
  const volume = buildVolume(view, colors.blocks, shapes, colors.textures);
  const unknown = blocksWithoutLook(volume);
  show("Meshing...");

  const canvas = $<HTMLCanvasElement>("view");
  const scene = new MapScene(canvas, volume);
  const workers = Array.from({ length: Math.max(2, Math.min(8, navigator.hardwareConcurrency - 1)) }, () => new Worker("/viewer/worker.js", { type: "module" }));
  const stats = await scene.build(workers);
  // The blocks are never meshed again: the viewer doesn't change them.
  for (const worker of workers) worker.terminate();
  $("message").hidden = true;

  let blocks = 0;
  for (const look of volume.blocks) if (volume.drawn[look]) blocks++;
  const size = view.box.max.map((v, i) => v - view.box.min[i] + 1).join(" x ");
  $("info").textContent = `${size} blocks, ${blocks.toLocaleString()} drawn, ${(stats.quads * 2).toLocaleString()} triangles, made in ${Math.round(stats.ms)} ms`;
  $("note").textContent = colors.note ?? "";

  let settings = loadSettings();

  // ---- The markup: drawn over the blocks, listed beside them, drawn again whenever the map changes.
  const overlay = new Overlay(scene, data, $("tags"));
  const gizmo = new Gizmo(scene);
  const cube = new ViewCube($<HTMLCanvasElement>("cube"), (direction) => scene.viewFrom(direction));
  scene.addRenderListener(() => cube.sync(scene.cameraQuaternion));
  const fly = new Fly(scene, canvas);
  let config = data.config;
  let markup: Markup = buildMarkup(config, data.rules);
  let picked: string | undefined;

  // The tools' state: which is on, each placing tool's list, a new region's name, the box's first corner.
  let tool: ToolId = "select";
  const toolList: Partial<Record<ToolId, string>> = {};
  let newRegion: string | undefined;
  let corner: Vec3 | undefined;
  /** The picked box's gizmo: moving it, or moving its faces. */
  let boxMode: "move" | "expand" = "expand";
  /** The picked box's face the arrow keys move. */
  let activeFace: Face | undefined;
  /** Here on a cut: the next click on a block puts that cut at it. The Cut tool's clicks cut along `cutAxis`. */
  let arming: CutAxis | undefined;
  let cutAxis: CutAxis = "y";

  const allLists = () => markup.sections.flatMap((section) => section.lists);
  const listsFor = (which: ToolId): MarkupList[] =>
    allLists().filter((list) =>
      which === "spawn" ? list.kind === "points" && list.spawn?.tool === "spawn" : which === "marker" ? list.kind === "points" && list.spawn?.tool === "marker" : which === "region" ? list.kind === "boxes" : which === "height" ? list.kind === "plane" : false,
    );
  /** The list the active tool adds to. */
  const armedList = (): MarkupList | undefined => {
    if (tool === "region" && newRegion) return allLists().find((list) => list.key === `regions.${newRegion}`) ?? { key: `regions.${newRegion}`, label: newRegion, kind: "boxes", color: NEW_REGION_COLOR, entries: [], place: { kind: "region", name: newRegion } };
    const lists = listsFor(tool);
    return lists.find((list) => list.key === toolList[tool]) ?? lists[0];
  };

  const sidebar = new Sidebar($("sidebar"), {
    pick: (key) => {
      setTool("select");
      pickEntry(key, true);
    },
    find: (block) => {
      const spot = spotsOf(volume, (look) => volume.looks[look].name === block, 1)[0];
      if (!spot) return notice(`There's no ${block} left in the world.`, true);
      const at = spot.map((value, axis) => value + volume.origin[axis]);
      scene.frame(new THREE.Vector3(at[0] + 0.5, at[1] + 0.5, at[2] + 0.5), 4);
      notice(`${block} at ${at.join(" ")}`);
    },
  });
  const redraw = () => {
    markup = buildMarkup(config, data.rules);
    if (picked && !findEntry(markup, picked)) picked = undefined;
    overlay.set(markup);
    overlay.pick(picked);
    sidebar.render(markup, { warnings: mapWarnings(volume, markup), unknown });
    sidebar.pick(picked);
    showPicked();
    document.title = `${config.name || name} (${data.targetName})`;
    $("map-name").textContent = config.name || name;
    $("map-game").textContent = `${data.targetName}, ${map}`;
    const publish = $<HTMLButtonElement>("publish");
    publish.disabled = !markup.checklist.ready;
    publish.dataset.tip = markup.checklist.ready ? "Publish: the lobby gets this version" : `Not ready to publish: ${markup.checklist.problems.join("; ")}`;
    const markers = listsFor("marker").length > 0;
    const markerButton = document.querySelector<HTMLButtonElement>('[data-tool="marker"]')!;
    markerButton.disabled = !markers;
    markerButton.dataset.tip = markers ? "Marker: place the game's markers" : "This game has no markers of its own";
  };
  const setConfig = (next: MapConfig) => {
    if (JSON.stringify(next) === JSON.stringify(config)) return;
    config = next;
    redraw();
  };

  // ---- Changes: each edit shows at once, then goes to the Panel (through game Edit when it has the map open).
  const changes = new MapChangesClient(target, map, {
    config: setConfig,
    message: notice,
    labels: (undo, redo) => {
      $("undo").dataset.tip = undo ? `Undo: ${undo}` : "Undo";
      $("redo").dataset.tip = redo ? `Redo: ${redo}` : "Redo";
    },
  });
  const edit = (change: MapEdit) => changes.edit(config, change);
  events.addEventListener("map", (event) => {
    const change = JSON.parse((event as MessageEvent<string>).data) as { stamp: string; config?: MapConfig };
    if (!change.config) return notice("map.json isn't valid JSON right now: the viewer shows it as it was.", true);
    changes.external(change.stamp, change.config);
  });
  // The Panel's state says whether game Edit has this map open: then edits go through it.
  events.addEventListener("state", (event) => {
    const state = JSON.parse((event as MessageEvent<string>).data) as { editor?: { status?: { edit?: { target: string; map: string } } | null } };
    const open = state.editor?.status?.edit;
    $("in-edit").hidden = !(open && open.target === target && open.map === map);
  });
  $("undo").onclick = () => changes.undo();
  $("redo").onclick = () => changes.redo();
  $("save").onclick = () => void changes.act("save");
  $("publish").onclick = () => {
    if (confirm(`Publish ${config.name || name}? The lobby gets this version.`)) void changes.act("publish");
  };

  // ---- Picking: an entry in the overview, or a marker in the view with Select.
  const pointOf = (key: string | undefined): PointMark | undefined => (key ? markup.points.find((point) => point.key === key) : undefined);
  const boxOf = (key: string | undefined): BoxMark | undefined => (key ? markup.boxes.find((box) => box.key === key) : undefined);
  const heightMarkOf = (key: string | undefined): PlaneMark | undefined => (key ? markup.planes.find((plane) => plane.key === key) : undefined);
  const positionOf = (point: PointMark): MapPosition | undefined => {
    const list = findEntry(markup, point.key)?.list;
    return list?.spawn ? listOf(config, list.spawn.target)[point.index] : undefined;
  };
  const showPicked = () => {
    const found = picked ? findEntry(markup, picked) : undefined;
    $("picked").textContent = found ? `${found.entry.label}: ${found.entry.detail}` : "";
    renderPanel();
    placeGizmo();
  };
  /** Picks an entry (or none); from the overview, the view frames it, moving a Y cut that hides it. */
  const pickEntry = (key: string | undefined, frame = false) => {
    if (key !== picked) activeFace = undefined;
    picked = key;
    overlay.pick(key);
    sidebar.pick(key);
    showPicked();
    if (!key || !frame) return;
    const extent = overlay.extent(key);
    if (!extent) return;
    if (cuts.top !== undefined && extent.floor > cuts.top) setTop(extent.floor);
    scene.frame(extent.center, extent.radius);
  };

  /** Where the picked entry's gizmo goes: a point's middle, a box's (or its faces), a height's sheet. */
  const placeGizmo = (preview?: { point?: Spot; box?: Box; y?: number }) => {
    if (tool !== "select" || !picked) return gizmo.hide();
    const point = pointOf(picked);
    const box = boxOf(picked);
    const height = heightMarkOf(picked);
    if (point) {
      const at = preview?.point ?? point.at;
      if (!scene.isKept(at)) return gizmo.hide();
      gizmo.showMove(new THREE.Vector3(at.x, at.y + 1, at.z));
    } else if (box) {
      const shown = preview?.box ?? box.box;
      if (boxMode === "move") gizmo.showMove(new THREE.Vector3(...([0, 1, 2].map((axis) => (shown.min[axis] + shown.max[axis] + 1) / 2) as Vec3)));
      else gizmo.showExpand(shown);
    } else if (height) {
      const spot = overlay.heightSpot(height.key, preview?.y ?? height.y);
      if (spot) gizmo.showMove(spot, [1]);
    } else gizmo.hide();
    gizmo.setActive(box && boxMode === "expand" && activeFace ? { kind: "face", face: activeFace } : undefined);
  };

  /** Removes the picked entry: a point, a box, or a height. */
  const removePicked = () => {
    const point = pointOf(picked);
    const pointList = point && findEntry(markup, point.key)?.list;
    const box = boxOf(picked);
    const height = heightMarkOf(picked);
    if (point && pointList?.spawn) edit({ op: "remove", target: pointList.spawn.target, index: point.index });
    else if (box) edit(removeBoxEdit(box.entry));
    else if (height) edit(heightEdit(height.line));
    else return;
    pickEntry(undefined);
  };

  /** Saves a point at a position (its facing kept when the position has none of its own and `keepFacing`). */
  const savePoint = (point: PointMark, at: MapPosition) => {
    const list = findEntry(markup, point.key)?.list;
    if (!list?.spawn) return;
    edit({ op: "set", target: list.spawn.target, index: point.index, at });
  };
  /** Moves a point to x, y, z, keeping its facing. */
  const movePoint = (point: PointMark, at: Vec3) => {
    const list = findEntry(markup, point.key)?.list;
    if (!list?.spawn) return;
    const before = positionOf(point);
    if (before && before[0] === at[0] && before[1] === at[1] && before[2] === at[2]) return;
    edit({ op: "move", target: list.spawn.target, index: point.index, at });
  };

  /** Saves a changed box, unless it's too small for its list. */
  const saveBox = (box: BoxMark, next: Box) => {
    if (next.min.every((v, axis) => v === box.box.min[axis]) && next.max.every((v, axis) => v === box.box.max[axis])) return;
    const problem = sizeProblem(next, findEntry(markup, box.key)?.list.label ?? box.label, box.minSize);
    if (problem) return notice(problem, true);
    edit(setBoxEdit(box.entry, next));
  };

  /** Sets a height, unless game Edit's rules refuse it. */
  const saveHeight = (line: PlaneMark["line"], y: number) => {
    const problem = heightProblem(config, line, y);
    if (problem) return notice(problem, true);
    edit(heightEdit(line, y));
  };

  /** A point moved along an axis by `delta` blocks: whole blocks, or (fine) to a hundredth. */
  const pointMovedBy = (point: PointMark, axis: 0 | 1 | 2, delta: number, fine: boolean): Vec3 | undefined => {
    const position = positionOf(point);
    if (!position) return undefined;
    const at = [position[0], position[1], position[2]] as Vec3;
    at[axis] = round2(at[axis] + (fine ? round2(delta) : Math.round(delta)));
    return at;
  };
  const boxMovedBy = (box: Box, offset: Vec3): Box => ({ min: box.min.map((v, axis) => v + offset[axis]) as Vec3, max: box.max.map((v, axis) => v + offset[axis]) as Vec3 });

  /** A step of the arrow keys, the In and Out buttons or a click on a gizmo arrow. */
  const stepPicked = (axis: 0 | 1 | 2, steps: number) => {
    const point = pointOf(picked);
    const box = boxOf(picked);
    const height = heightMarkOf(picked);
    if (point) {
      const at = pointMovedBy(point, axis, steps, false);
      if (at) movePoint(point, at);
    } else if (box) {
      const offset: Vec3 = [0, 0, 0];
      offset[axis] = steps;
      saveBox(box, boxMovedBy(box.box, offset));
    } else if (height && axis === 1) saveHeight(height.line, height.y + steps);
  };

  /** The picked box's face (expand mode) or the picked height, by whole blocks. */
  const nudge = (steps: number) => {
    const box = boxOf(picked);
    const height = heightMarkOf(picked);
    if (box) {
      if (!activeFace) return notice("Click one of the box's squares first: the arrow keys move that face.", true);
      saveBox(box, nudgeFace(box.box, activeFace, steps));
    } else if (height) saveHeight(height.line, height.y + steps);
  };

  /** Moves the picked box's face (or the picked height) onto a cut. */
  const toCut = (axis: 0 | 1 | 2) => {
    const layer = axis === 1 ? cuts.top : axis === 0 ? cuts.x?.at : cuts.z?.at;
    if (layer === undefined) return;
    const box = boxOf(picked);
    const height = heightMarkOf(picked);
    if (box) saveBox(box, faceToCut(box.box, axis, layer, activeFace));
    else if (height && axis === 1) saveHeight(height.line, heightFromBlock(height.line, layer));
  };

  /**
   * Center on block switched on: the picked point, when it's at an exact spot, moves to the middle
   * of its block (its facing and height kept), as game Edit's entry screen does.
   */
  const centerPicked = () => {
    const point = pointOf(picked);
    const position = point && positionOf(point);
    const at = position && centeredSpot(position);
    if (point && at) movePoint(point, at);
  };

  // ---- The right panel: the tool's settings, the picked entry's values, or the cuts.
  const numberField = (label: string, axisClass: string, value: number, step: number, commit: (value: number) => void) => {
    const input = el("input", { type: "number", value: String(value), step: String(step) });
    const done = () => {
      const next = Number(input.value);
      if (input.value.trim() === "" || !Number.isFinite(next)) {
        input.value = String(value);
        return;
      }
      if (next !== value) commit(next);
    };
    input.addEventListener("change", done);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      if (event.key === "Escape") {
        input.value = String(value);
        input.blur();
      }
    });
    return el("label", { className: axisClass }, el("b", {}, label), input);
  };
  const centerBox = () =>
    el(
      "label",
      { className: "field-row" },
      el("input", {
        type: "checkbox",
        checked: settings.center,
        onchange: (event: Event) => {
          settings = { ...settings, center: (event.target as HTMLInputElement).checked };
          saveSettings(settings);
          if (settings.center) centerPicked();
        },
      }),
      " Center on block",
    );
  const choiceList = (lists: MarkupList[], chosen: string | undefined, pick: (key: string) => void) =>
    el(
      "div",
      { className: "choices", role: "radiogroup" },
      lists.map((list) =>
        el(
          "button",
          { className: `choice${list.key === chosen ? " on" : ""}`, role: "radio", ariaChecked: String(list.key === chosen), onclick: () => pick(list.key) },
          swatch(list.color),
          el("span", {}, list.label),
          el("span", { className: "count" }, list.need !== undefined ? `${list.entries.length} of ${list.need}` : String(list.entries.length || "")),
        ),
      ),
    );
  const deleteButton = () => el("button", { className: "small danger", dataset: { tip: "Delete", key: "Del" }, onclick: removePicked }, "Delete");

  const pointEditor = (point: PointMark): HTMLElement => {
    const position = positionOf(point);
    const list = findEntry(markup, point.key)?.list;
    if (!position || !list?.spawn) return el("div");
    const [x, y, z] = position;
    const faced = position.length === 5;
    const yaw = faced ? position[3] : point.yaw;
    const pitch = faced ? position[4] : 0;
    const at = (next: Partial<{ x: number; y: number; z: number; yaw: number; pitch: number; faced: boolean }>) => {
      const v = { x, y, z, yaw, pitch, faced, ...next };
      savePoint(point, v.faced ? [round2(v.x), round2(v.y), round2(v.z), normalYaw(Math.round(v.yaw)), Math.max(-90, Math.min(90, Math.round(v.pitch)))] : [round2(v.x), round2(v.y), round2(v.z)]);
    };
    return el(
      "section",
      {},
      el("h2", {}, point.label),
      el("p", { className: "sub" }, `${list.label}. Drag the arrows to move it, the red knob to turn it.`),
      el("div", { className: "group-label" }, "Position (whole X and Z: the block's middle)"),
      el("div", { className: "fields" }, numberField("X", "x", x, 1, (value) => at({ x: value })), numberField("Y", "y", y, 1, (value) => at({ y: value })), numberField("Z", "z", z, 1, (value) => at({ z: value }))),
      el(
        "label",
        { className: "field-row" },
        el("input", { type: "checkbox", checked: faced, onchange: (event: Event) => at({ faced: (event.target as HTMLInputElement).checked }) }),
        " Faces a fixed way",
      ),
      faced
        ? el("div", { className: "fields" }, numberField("Yaw", "", yaw, FACING_STEP, (value) => at({ yaw: value })), numberField("Pitch", "", pitch, 5, (value) => at({ pitch: value })))
        : el("p", { className: "sub" }, "It faces the map's middle."),
      centerBox(),
      el("div", { className: "buttons" }, deleteButton()),
    );
  };

  const boxEditor = (box: BoxMark): HTMLElement => {
    const { min, max } = box.box;
    const setCorner = (side: "min" | "max", axis: number, value: number) => {
      const corners = { min: [...min] as Vec3, max: [...max] as Vec3 };
      corners[side][axis] = Math.round(value);
      saveBox(box, boxFrom(corners.min, corners.max));
    };
    const mode = (which: "move" | "expand", label: string, key: string, tip: string) =>
      el("button", { className: `small${boxMode === which ? " on" : ""}`, dataset: { tip, key }, onclick: () => setBoxMode(which) }, label);
    const cutOn = cuts.top !== undefined || cuts.x !== undefined || cuts.z !== undefined;
    return el(
      "section",
      {},
      el("h2", {}, box.label),
      el("p", { className: "sub" }, `${sizeText(box.box)} blocks${box.minSize !== undefined ? `, at least ${box.minSize} each way` : ""}`),
      el("div", { className: "modes" }, mode("move", "Move", "G", "Move the whole box"), mode("expand", "Resize", "E", "Move its faces")),
      el("div", { className: "group-label" }, "From (lowest corner block)"),
      el("div", { className: "fields" }, ...[0, 1, 2].map((axis) => numberField("XYZ"[axis], "xyz"[axis], min[axis], 1, (value) => setCorner("min", axis, value)))),
      el("div", { className: "group-label" }, "To (highest corner block)"),
      el("div", { className: "fields" }, ...[0, 1, 2].map((axis) => numberField("XYZ"[axis], "xyz"[axis], max[axis], 1, (value) => setCorner("max", axis, value)))),
      boxMode === "expand" && activeFace
        ? el(
            "div",
            { className: "buttons" },
            el("span", { className: "sub grow" }, `Picked face: ${faceName(activeFace)}`),
            el("button", { className: "small", dataset: { tip: "Move the face in", key: "Down" }, onclick: () => nudge(-1) }, "In"),
            el("button", { className: "small", dataset: { tip: "Move the face out", key: "Up" }, onclick: () => nudge(1) }, "Out"),
          )
        : null,
      cutOn
        ? el(
            "div",
            { className: "buttons" },
            ...([1, 0, 2] as const)
              .filter((axis) => (axis === 1 ? cuts.top : axis === 0 ? cuts.x : cuts.z) !== undefined)
              .map((axis) => el("button", { className: "small", dataset: { tip: `Move ${activeFace?.axis === axis ? "the picked face" : "the face nearer it"} onto the ${"XYZ"[axis]} cut` }, onclick: () => toCut(axis) }, `To ${"XYZ"[axis]} cut`)),
          )
        : null,
      el("div", { className: "buttons" }, deleteButton()),
    );
  };

  const heightEditor = (height: PlaneMark): HTMLElement =>
    el(
      "section",
      {},
      el("h2", {}, height.label),
      el("p", { className: "sub" }, height.line === "killY" ? "Players below it are out." : height.line === "above" ? "No block goes above it." : "No block goes below it."),
      el("div", { className: "fields" }, numberField("Y", "y", height.y, 1, (value) => saveHeight(height.line, Math.round(value)))),
      el(
        "div",
        { className: "buttons" },
        el("button", { className: "small", dataset: { tip: "Down a block", key: "Down" }, onclick: () => nudge(-1) }, "Down"),
        el("button", { className: "small", dataset: { tip: "Up a block", key: "Up" }, onclick: () => nudge(1) }, "Up"),
        cuts.top !== undefined ? el("button", { className: "small", dataset: { tip: "Put it where a click on the Y cut's layer would" }, onclick: () => toCut(1) }, "To Y cut") : null,
        deleteButton(),
      ),
    );

  const placeToolPanel = (which: "spawn" | "marker"): HTMLElement => {
    const lists = listsFor(which);
    const list = armedList();
    return el(
      "section",
      {},
      el("h2", {}, which === "spawn" ? "Spawn" : "Marker"),
      el("p", { className: "sub" }, list?.spawn?.single ? "Click the top of a block: it replaces the one there is." : "Click the top of a block to place one there."),
      choiceList(lists, list?.key, (key) => {
        toolList[which] = key;
        armTool();
      }),
      centerBox(),
    );
  };

  const regionToolPanel = (): HTMLElement => {
    const list = armedList();
    const naming = newRegion === "";
    const input = el("input", { type: "text", placeholder: "Name: letters, digits and _", maxLength: 32, spellcheck: false });
    const useName = () => {
      const valid = regionName(input.value);
      if (!valid) return notice("A region's name is letters, digits and _, starting with a letter.", true);
      newRegion = valid;
      armTool();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") useName();
      if (event.key === "Escape") {
        newRegion = undefined;
        armTool();
      }
    });
    if (naming) queueMicrotask(() => input.focus());
    return el(
      "section",
      {},
      el("h2", {}, "Region"),
      el("p", { className: "sub" }, corner ? `First corner at ${corner.join(" ")}: click the opposite corner block, on any layer.` : "Click one corner block, then the opposite one."),
      choiceList(listsFor("region"), newRegion ? undefined : list?.key, (key) => {
        toolList.region = key;
        newRegion = undefined;
        armTool();
      }),
      newRegion
        ? el("div", { className: "choices" }, el("button", { className: "choice on" }, swatch(NEW_REGION_COLOR), el("span", {}, `New: ${newRegion}`)))
        : naming
          ? el("div", { className: "field-row" }, input, el("button", { className: "small", onclick: useName }, "Use"))
          : el("div", { className: "buttons" }, el("button", { className: "small", dataset: { tip: "A region of the map's own, by name" }, onclick: () => ((newRegion = ""), armTool()) }, "New region")),
    );
  };

  const heightToolPanel = (): HTMLElement =>
    el(
      "section",
      {},
      el("h2", {}, "Height"),
      el("p", { className: "sub" }, "Click a block: kill Y goes under it, a build limit onto it."),
      choiceList(listsFor("height"), armedList()?.key, (key) => {
        toolList.height = key;
        armTool();
      }),
    );

  const cutToolPanel = (): HTMLElement =>
    el(
      "section",
      {},
      el("h2", {}, "Cut"),
      el("p", { className: "sub" }, "Click a block to cut there along:"),
      el(
        "div",
        { className: "modes three" },
        (["x", "y", "z"] as const).map((axis) => el("button", { className: `small${cutAxis === axis ? " on" : ""}`, onclick: () => ((cutAxis = axis), renderPanel()) }, axis.toUpperCase())),
      ),
    );

  const renderPanel = () => {
    const point = pointOf(picked);
    const box = boxOf(picked);
    const height = heightMarkOf(picked);
    let content: HTMLElement | null = null;
    if (tool === "select") content = point ? pointEditor(point) : box ? boxEditor(box) : height ? heightEditor(height) : null;
    else if (tool === "spawn" || tool === "marker") content = placeToolPanel(tool);
    else if (tool === "region") content = regionToolPanel();
    else if (tool === "height") content = heightToolPanel();
    else if (tool === "cut") content = cutToolPanel();
    $("tool").replaceChildren(...(content ? [content] : []));
    $("cuts").hidden = !((tool === "select" && !picked) || tool === "cut");
  };

  /** Switches tools: a placing tool picks nothing (its clicks place), and Esc comes back to Select. */
  const setTool = (next: ToolId) => {
    if (next === "marker" && listsFor("marker").length === 0) return;
    tool = next;
    newRegion = undefined;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) button.classList.toggle("on", button.dataset.tool === next);
    if (next !== "select" && picked) pickEntry(undefined);
    armTool();
  };
  /** What the active tool shows under the pointer, and its panel. */
  const armTool = () => {
    corner = undefined;
    const list = armedList();
    canvas.classList.toggle("aiming", tool !== "select" || arming !== undefined);
    if ((tool === "spawn" || tool === "marker") && list?.shape) overlay.setGhost({ key: "ghost", list: list.key, index: -1, label: "", at: { x: 0, y: -1e4, z: 0 }, yaw: 0, pitch: 0, faced: false, color: list.color, shape: list.shape });
    else overlay.setGhost(undefined);
    overlay.showBox(undefined, 0);
    renderPanel();
    placeGizmo();
  };
  const setBoxMode = (mode: "move" | "expand") => {
    boxMode = mode;
    renderPanel();
    placeGizmo();
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) button.onclick = () => setTool(button.dataset.tool as ToolId);

  /** Where a point would go for a pointer spot: its position in map.json, and where it stands. */
  const spotUnder = (clientX: number, clientY: number): { position: MapPosition; at: Spot } | undefined => {
    const hit = scene.pickAt(clientX, clientY);
    const spot = hit && floorSpot(volume, hit);
    if (!spot) return undefined;
    const position = placedPosition(spot, settings.center);
    return { position, at: worldPoint(position) };
  };
  const middle = () => mapMiddle(config);

  /** A click on the blocks with a placing tool: a point, a box's corner, a height, or a cut. */
  const useTool = (clientX: number, clientY: number) => {
    const list = armedList();
    if ((tool === "spawn" || tool === "marker") && list?.spawn) {
      const spot = spotUnder(clientX, clientY);
      if (!spot) return notice("Nothing to stand on there: click the top of a block.", true);
      const replace = list.spawn.single && list.entries.length > 0;
      edit(replace ? { op: "set", target: list.spawn.target, index: 0, at: spot.position } : { op: "add", target: list.spawn.target, at: spot.position });
      return;
    }
    const hit = scene.pickAt(clientX, clientY);
    if (!hit) return notice("Click a block.", true);
    if (tool === "cut") return cutAt(cutAxis, hit.world);
    if (tool === "height" && list?.line) {
      const y = heightFromBlock(list.line, hit.world[1]);
      const problem = heightProblem(config, list.line, y);
      if (problem) return notice(problem, true);
      edit(heightEdit(list.line, y));
      return;
    }
    if (tool === "region" && list?.place) {
      if (!corner) {
        corner = hit.world;
        renderPanel();
        return;
      }
      const box = boxFrom(corner, hit.world);
      const problem = sizeProblem(box, list.label, list.minSize);
      if (problem) return notice(problem, true);
      if (!edit(addBoxEdit(list.place, box))) return;
      corner = undefined;
      if (newRegion) {
        toolList.region = `regions.${newRegion}`;
        newRegion = undefined;
      }
      overlay.showBox(undefined, 0);
      renderPanel();
    }
  };

  // ---- Settings: the dialog behind the sliders button.
  const settingsDialog = $<HTMLDialogElement>("settings");
  /** The texture layers, fetched the first time Vanilla textures is picked. */
  let textures: Promise<boolean> | undefined;
  const loadTextures = (): Promise<boolean> =>
    (textures ??= (async () => {
      const response = await fetch("/api/viewer/textures").catch(() => undefined);
      const count = colors.layers ?? 0;
      const data = response?.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
      if (!data || count === 0 || data.length !== count * 16 * 16 * 4) {
        textures = undefined;
        notice("The textures couldn't be loaded: the viewer shows Average colors.", true);
        return false;
      }
      scene.setTextures(data, count);
      return true;
    })());
  const applyLook = async () => {
    const wanted = settings.look === "textures";
    scene.setLook(wanted && (await loadTextures()));
  };
  const applySettings = () => {
    scene.setToggles(settings);
    void applyLook();
    overlay.showNames(settings.names);
    overlay.refresh();
    fly.setEnabled(settings.wasd);
    fly.speed = FLY_SPEEDS[settings.flySpeed] ?? FLY_SPEEDS.normal;
    scene.setOutlines(settings.hidden);
    saveSettings(settings);
    $<HTMLInputElement>("toggle-occlusion").checked = settings.occlusion;
    $<HTMLInputElement>("toggle-variation").checked = settings.variation;
    $<HTMLInputElement>("toggle-darken").checked = settings.darkenBelow;
    $<HTMLInputElement>("toggle-names").checked = settings.names;
    $<HTMLInputElement>("toggle-hidden").checked = settings.hidden;
    $<HTMLInputElement>("toggle-wasd").checked = settings.wasd;
    $<HTMLSelectElement>("fly-speed").value = settings.flySpeed;
    $<HTMLInputElement>("past-faded").checked = settings.faded;
    $<HTMLInputElement>("past-gone").checked = !settings.faded;
    $<HTMLInputElement>("look-colors").checked = settings.look === "colors";
    $<HTMLInputElement>("look-textures").checked = settings.look === "textures";
  };
  const toggle = (id: string, key: "occlusion" | "variation" | "darkenBelow" | "names" | "wasd" | "hidden") => {
    $(id).onchange = (event) => ((settings = { ...settings, [key]: (event.target as HTMLInputElement).checked }), applySettings());
  };
  toggle("toggle-occlusion", "occlusion");
  toggle("toggle-variation", "variation");
  toggle("toggle-darken", "darkenBelow");
  toggle("toggle-names", "names");
  toggle("toggle-hidden", "hidden");
  toggle("toggle-wasd", "wasd");
  $("fly-speed").onchange = (event) => ((settings = { ...settings, flySpeed: (event.target as HTMLSelectElement).value as FlySpeed }), applySettings());
  $("past-faded").onchange = () => ((settings = { ...settings, faded: true }), applySettings());
  $("past-gone").onchange = () => ((settings = { ...settings, faded: false }), applySettings());
  $("look-colors").onchange = () => ((settings = { ...settings, look: "colors" }), applySettings());
  $("look-textures").onchange = () => ((settings = { ...settings, look: "textures" }), applySettings());
  $("open-settings").onclick = () => settingsDialog.showModal();
  applySettings();

  // ---- Views: the cube and Home.
  $("view-home").onclick = () => scene.view("home");

  // ---- Cuts. Each slider runs over the layers the map uses; at its end, nothing is cut.
  const { min, max } = view.box;
  let cuts: Cuts = {};
  const sliders = { x: { input: $<HTMLInputElement>("x"), index: 0 }, y: { input: $<HTMLInputElement>("y"), index: 1 }, z: { input: $<HTMLInputElement>("z"), index: 2 } } as const;
  for (const axis of ["x", "y", "z"] as const) {
    const { input, index } = sliders[axis];
    Object.assign(input, { min: String(min[index]), max: String(max[index]), value: String(max[index]) });
  }
  const applyCuts = (next: Cuts) => {
    cuts = next;
    scene.setCuts(cuts);
    overlay.refresh();
    sliders.y.input.value = String(cuts.top ?? max[1]);
    $("y-label").textContent = cuts.top === undefined ? "all" : `top layer ${cuts.top}`;
    for (const axis of ["x", "z"] as const) {
      const cut = cuts[axis];
      const { input, index } = sliders[axis];
      input.value = String(cut?.at ?? max[index]);
      $(`${axis}-label`).textContent = cut ? `${cut.side === "below" ? "up to" : "from"} ${cut.at}` : "off";
    }
    // The picked box's To cut buttons, and its gizmo past a cut, follow the cuts.
    if (picked) renderPanel();
    placeGizmo();
  };
  const setTop = (value: number) => applyCuts({ ...cuts, top: value >= max[1] ? undefined : Math.max(min[1], value) });
  const cutAt = (axis: CutAxis, block: Vec3) => {
    if (axis === "y") setTop(block[1]);
    else applyCuts({ ...cuts, [axis]: { at: axis === "x" ? block[0] : block[2], side: cuts[axis]?.side ?? "below" } });
  };
  sliders.y.input.oninput = () => setTop(Number(sliders.y.input.value));
  $("y-off").onclick = () => setTop(max[1]);
  for (const axis of ["x", "z"] as const) {
    const { input } = sliders[axis];
    input.oninput = () => applyCuts({ ...cuts, [axis]: { at: Number(input.value), side: cuts[axis]?.side ?? "below" } });
    $(`${axis}-flip`).onclick = () => {
      const cut = cuts[axis];
      if (cut) applyCuts({ ...cuts, [axis]: { ...cut, side: cut.side === "below" ? "above" : "below" } });
    };
    $(`${axis}-off`).onclick = () => applyCuts({ ...cuts, [axis]: undefined });
  }
  // Here: the next click on a block puts that cut at it.
  const armCut = (axis: CutAxis | undefined) => {
    arming = arming === axis ? undefined : axis;
    canvas.classList.toggle("aiming", tool !== "select" || arming !== undefined);
    for (const id of ["x", "y", "z"]) $(`${id}-here`).classList.toggle("on", arming === id);
  };
  for (const axis of ["x", "y", "z"] as const) $(`${axis}-here`).onclick = () => armCut(axis);

  // ---- Keys. In the capture phase on the window, so a focused button or the canvas never keeps them.
  addEventListener(
    "keydown",
    (event) => {
      if (settingsDialog.open || typing(event.target)) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const step = event.shiftKey ? 5 : 1;
      const now = cuts.top ?? max[1];
      const pickedBox = boxOf(picked);
      const pickedHeight = heightMarkOf(picked);
      if (ctrl && event.code === "KeyZ" && !event.shiftKey) changes.undo();
      else if (ctrl && (event.code === "KeyY" || (event.code === "KeyZ" && event.shiftKey))) changes.redo();
      else if (ctrl || event.altKey) return;
      else if (TOOL_KEYS[event.code] && !event.shiftKey) setTool(TOOL_KEYS[event.code]);
      else if (event.code === "KeyG" && pickedBox) setBoxMode("move");
      else if (event.code === "KeyE" && pickedBox) setBoxMode("expand");
      else if (event.code === "KeyF" && picked) pickEntry(picked, true);
      else if (event.key === "PageDown" || event.key === "[" || event.key === "{") setTop(now - step);
      else if (event.key === "PageUp" || event.key === "]" || event.key === "}") setTop(now + step);
      else if (event.key === "Home") scene.view("home");
      else if ((event.key === "ArrowUp" || event.key === "ArrowRight") && (pickedBox || pickedHeight) && tool === "select") pickedBox && boxMode === "move" ? notice("Drag the gizmo's arrows, or click one to step a block.", false) : nudge(step);
      else if ((event.key === "ArrowDown" || event.key === "ArrowLeft") && (pickedBox || pickedHeight) && tool === "select") pickedBox && boxMode === "move" ? notice("Drag the gizmo's arrows, or click one to step a block.", false) : nudge(-step);
      else if (event.key === "Delete" || event.key === "Backspace") removePicked();
      else if (event.key === "Escape") {
        if (press?.drag) cancelDrag();
        else if (arming) armCut(undefined);
        else if (corner) armTool();
        else if (tool !== "select") setTool("select");
        else pickEntry(undefined);
      } else return;
      event.preventDefault();
    },
    true,
  );

  // ---- The pointer. With Select, a press on the gizmo moves or resizes the picked entry, on the
  // picked point's knob it turns it, on a marker it drags it along the floor; a click picks (or,
  // on nothing, picks nothing). Other tools use the click. A double click centers the view.
  type Drag =
    | { kind: "move" | "face"; point: PointMark; moved: boolean; position?: MapPosition; yaw?: number }
    | { kind: "gizmo"; part: GizmoPart; moved: boolean; origin: THREE.Vector3; start: THREE.Vector3; fine: boolean; result?: { point?: Vec3; box?: Box; y?: number } };
  let press: { x: number; y: number; drag?: Drag } | undefined;
  const cancelDrag = () => {
    press = undefined;
    overlay.hideWhileEditing(undefined);
    overlay.showBox(undefined, 0);
    overlay.set(markup);
    overlay.pick(picked);
    placeGizmo();
  };

  /** Where along an axis through a spot the pointer is nearest, as a world point. */
  const alongAxis = (spot: THREE.Vector3, axis: 0 | 1 | 2, clientX: number, clientY: number): THREE.Vector3 | undefined => {
    const { ray } = scene.rayAt(clientX, clientY);
    const s = nearestOnAxis([spot.x, spot.y, spot.z], [AXIS_VECTORS[axis].x, AXIS_VECTORS[axis].y, AXIS_VECTORS[axis].z], [ray.origin.x, ray.origin.y, ray.origin.z], [ray.direction.x, ray.direction.y, ray.direction.z]);
    return s === undefined ? undefined : spot.clone().addScaledVector(AXIS_VECTORS[axis], s);
  };
  /** Where the pointer's ray meets the level plane through a spot. */
  const onLevel = (spot: THREE.Vector3, clientX: number, clientY: number): THREE.Vector3 | undefined => {
    const { ray } = scene.rayAt(clientX, clientY);
    if (Math.abs(ray.direction.y) < 1e-6) return undefined;
    const t = (spot.y - ray.origin.y) / ray.direction.y;
    return t > 0 ? ray.origin.clone().addScaledVector(ray.direction, t) : undefined;
  };
  /** Where a gizmo drag starts measuring from: on the arrow's axis, or on the level plane. */
  const gizmoStart = (part: GizmoPart, origin: THREE.Vector3, clientX: number, clientY: number): THREE.Vector3 | undefined =>
    part.kind === "arrow" ? alongAxis(origin, part.axis, clientX, clientY) : part.kind === "center" ? onLevel(origin, clientX, clientY) : alongAxis(origin, part.face.axis, clientX, clientY);

  /** A gizmo drag at a pointer spot: the entry's new place, shown (not saved). */
  const dragGizmo = (drag: Extract<Drag, { kind: "gizmo" }>, clientX: number, clientY: number, fine: boolean) => {
    const { part } = drag;
    const point = pointOf(picked);
    const box = boxOf(picked);
    const height = heightMarkOf(picked);
    if (part.kind === "face" && box) {
      const spot = [0, 1, 2].map((axis) => (box.box.min[axis] + box.box.max[axis] + 1) / 2) as Vec3;
      spot[part.face.axis] = facePlane(box.box, part.face);
      const along = alongAxis(new THREE.Vector3(...spot), part.face.axis, clientX, clientY);
      if (!along) return;
      const next = moveFace(box.box, part.face, along.getComponent(part.face.axis));
      const problem = sizeProblem(next, box.label, box.minSize);
      drag.result = { box: next };
      activeFace = part.face;
      overlay.hideWhileEditing(box.key);
      overlay.showBox(next, box.color, sizeText(next), problem !== undefined);
      placeGizmo({ box: next });
      gizmo.setActive(part);
      $("hover").textContent = `${box.label}: ${sizeText(next)}${problem ? ` (too small: at least ${box.minSize} each way)` : ""}`;
      return;
    }
    const now = gizmoStart(part, drag.origin, clientX, clientY);
    if (!now) return;
    const delta = now.clone().sub(drag.start);
    const axes: (0 | 1 | 2)[] = part.kind === "arrow" ? [part.axis] : [0, 2];
    if (point) {
      const position = positionOf(point);
      if (!position) return;
      const at = [position[0], position[1], position[2]] as Vec3;
      for (const axis of axes) at[axis] = round2(at[axis] + (fine ? round2(delta.getComponent(axis)) : Math.round(delta.getComponent(axis))));
      drag.result = { point: at };
      const spot = worldPoint(at);
      overlay.previewPoint(point.key, spot, point.faced ? point.yaw : lookAt(spot, middle()).yaw);
      placeGizmo({ point: spot });
      $("hover").textContent = `${point.label} to ${at.join(" ")}`;
    } else if (box) {
      const offset: Vec3 = [0, 0, 0];
      for (const axis of axes) offset[axis] = Math.round(delta.getComponent(axis));
      const next = boxMovedBy(box.box, offset);
      drag.result = { box: next };
      overlay.hideWhileEditing(box.key);
      overlay.showBox(next, box.color, `${sizeText(next)} from ${next.min.join(" ")}`);
      placeGizmo({ box: next });
      $("hover").textContent = `${box.label} from ${next.min.join(" ")}`;
    } else if (height) {
      const high = height.line === "killY" ? MAX_LIMIT - 1 : MAX_LIMIT;
      const y = Math.min(high, Math.max(MIN_HEIGHT, height.y + Math.round(delta.y)));
      drag.result = { y };
      overlay.hideWhileEditing(height.key);
      overlay.previewHeight(height.key, y);
      placeGizmo({ y });
      $("hover").textContent = `${height.label}: y ${y}`;
    }
    gizmo.setActive(part);
  };

  const finishDrag = (drag: Drag) => {
    overlay.hideWhileEditing(undefined);
    overlay.showBox(undefined, 0);
    if (drag.kind === "gizmo") {
      const result = drag.result;
      const point = pointOf(picked);
      const box = boxOf(picked);
      const height = heightMarkOf(picked);
      if (result?.point && point) movePoint(point, result.point);
      else if (result?.box && box) saveBox(box, result.box);
      else if (result?.y !== undefined && height && result.y !== height.y) saveHeight(height.line, result.y);
      else cancelDrag();
      placeGizmo();
      return;
    }
    const list = findEntry(markup, drag.point.key)?.list;
    if (!list?.spawn) return;
    if (drag.kind === "move" && drag.position) {
      const [x, y, z] = drag.position;
      const to = worldPoint([x, y, z]);
      const from = drag.point.at;
      if (to.x === from.x && to.y === from.y && to.z === from.z) return cancelDrag();
      edit({ op: "move", target: list.spawn.target, index: drag.point.index, at: [x, y, z] });
    } else if (drag.kind === "face" && drag.yaw !== undefined) {
      if (drag.point.faced && drag.point.yaw === drag.yaw) return cancelDrag();
      edit({ op: "face", target: list.spawn.target, index: drag.point.index, facing: { yaw: drag.yaw, pitch: drag.point.faced ? drag.point.pitch : 0 } });
    }
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    canvas.focus();
    press = { x: event.clientX, y: event.clientY };
    if (arming || tool !== "select") return;
    const part = gizmo.partAt(event.clientX, event.clientY);
    if (part) {
      const origin = gizmo.center;
      const start = gizmoStart(part, origin, event.clientX, event.clientY);
      if (start || part.kind === "face") press.drag = { kind: "gizmo", part, moved: false, origin, start: start ?? origin, fine: event.shiftKey };
    } else {
      const block = scene.pickAt(event.clientX, event.clientY);
      const knob = overlay.knobAt(event.clientX, event.clientY);
      const pickedPoint = pointOf(picked);
      const point = overlay.pointAt(event.clientX, event.clientY);
      if (knob !== undefined && pickedPoint) press.drag = { kind: "face", point: pickedPoint, moved: false };
      else if (point && (!block || point.distance <= block.distance + 0.01)) press.drag = { kind: "move", point: pointOf(point.key)!, moved: false };
    }
    if (press.drag) canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    const drag = press?.drag;
    if (drag && press) {
      if (!drag.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= DRAG_PIXELS) return;
      drag.moved = true;
      if (drag.kind === "gizmo") return dragGizmo(drag, event.clientX, event.clientY, event.shiftKey);
      if (drag.kind === "move") {
        const spot = spotUnder(event.clientX, event.clientY);
        if (!spot) return;
        drag.position = spot.position;
        const yaw = drag.point.faced ? drag.point.yaw : lookAt(spot.at, middle()).yaw;
        overlay.previewPoint(drag.point.key, spot.at, yaw);
        placeGizmo({ point: spot.at });
        $("hover").textContent = `${drag.point.label} to ${spot.position.join(" ")}`;
      } else {
        const to = onLevel(new THREE.Vector3(drag.point.at.x, drag.point.at.y, drag.point.at.z), event.clientX, event.clientY);
        if (!to) return;
        drag.yaw = yawToward(drag.point.at, to, event.shiftKey ? 1 : FACING_STEP);
        overlay.previewPoint(drag.point.key, drag.point.at, drag.yaw);
        $("hover").textContent = `${drag.point.label} faces ${drag.yaw} degrees`;
      }
      return;
    }
    queueHover(event);
  });

  canvas.addEventListener("pointerup", (event) => {
    if (event.button !== 0 || !press) return;
    const drag = press.drag;
    const click = Math.hypot(event.clientX - press.x, event.clientY - press.y) <= DRAG_PIXELS;
    press = undefined;
    if (drag?.moved) return finishDrag(drag);
    if (!click) return;
    if (arming) {
      const hit = scene.pickAt(event.clientX, event.clientY);
      if (!hit) return;
      cutAt(arming, hit.world);
      armCut(undefined);
      return;
    }
    if (tool !== "select") return useTool(event.clientX, event.clientY);
    if (drag?.kind === "gizmo") {
      // A click on an arrow steps a block its way; on a square, picks that face for the arrow keys.
      if (drag.part.kind === "arrow") stepPicked(drag.part.axis, drag.part.sign);
      else if (drag.part.kind === "face") {
        activeFace = drag.part.face;
        renderPanel();
        placeGizmo();
      }
      return;
    }
    // A marker in front of the blocks picks its entry; anywhere else picks nothing.
    pickEntry(drag?.point.key);
  });
  canvas.addEventListener("dblclick", (event) => {
    const hit = scene.pickAt(event.clientX, event.clientY);
    if (hit) scene.centerOn([hit.world[0] + 0.5, hit.world[1] + 0.5, hit.world[2] + 0.5]);
  });

  // What's under the pointer, in the status line, and what the active tool would do there (once a frame).
  let hoverQueued = false;
  let last: PointerEvent | undefined;
  const queueHover = (event: PointerEvent) => {
    last = event;
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (!last) return;
      const list = armedList();
      canvas.style.cursor = tool === "select" && !arming && gizmo.partAt(last.clientX, last.clientY) ? "grab" : "";
      const hit = scene.pickAt(last.clientX, last.clientY);
      if (!arming && (tool === "spawn" || tool === "marker")) {
        const spot = spotUnder(last.clientX, last.clientY);
        overlay.moveGhost(spot?.at, spot ? lookAt(spot.at, middle()).yaw : 0);
      } else if (!arming && tool === "region" && list) {
        if (hit) {
          const box = boxFrom(corner ?? hit.world, hit.world);
          const problem = corner ? sizeProblem(box, list.label, list.minSize) : undefined;
          overlay.showBox(box, list.color, sizeText(box), problem !== undefined);
          return void ($("hover").textContent = `${corner ? "Box" : "First corner"}: ${sizeText(box)} from ${box.min.join(" ")}${problem ? " (too small)" : ""}`);
        }
        overlay.showBox(undefined, 0);
      } else if (!arming && tool === "height" && list?.line && hit) {
        return void ($("hover").textContent = `${list.label} at y ${heightFromBlock(list.line, hit.world[1])}`);
      } else if ((arming || tool === "cut") && hit) {
        const axis = arming ?? cutAxis;
        return void ($("hover").textContent = `Cut ${axis.toUpperCase()} at ${hit.world["xyz".indexOf(axis)]}`);
      }
      const point = overlay.pointAt(last.clientX, last.clientY);
      if (point && (!hit || point.distance <= hit.distance + 0.01)) return void ($("hover").textContent = findEntry(markup, point.key)?.entry.label ?? "");
      if (!hit) return void ($("hover").textContent = "");
      const look = volume.looks[hit.look];
      const states = look.states ? ` ${Object.entries(look.states).map(([key, value]) => `${key}=${value}`).join(" ")}` : "";
      $("hover").textContent = `${look.name.replace(/^minecraft:/, "")}${states} at ${hit.world.join(", ")}`;
    });
  };
  canvas.addEventListener("pointerleave", () => {
    $("hover").textContent = "";
    overlay.moveGhost(undefined, 0);
    if (tool === "region" && !corner) overlay.showBox(undefined, 0);
  });

  setTool("select");
  applyCuts({});
  redraw();
  canvas.focus();
}

/** A box's face in words: "top", "west side". */
function faceName(face: Face): string {
  if (face.axis === 1) return face.side === "max" ? "top" : "bottom";
  if (face.axis === 0) return face.side === "max" ? "east side" : "west side";
  return face.side === "max" ? "south side" : "north side";
}

main().catch((error: unknown) => show(`The viewer stopped: ${error instanceof Error ? error.message : String(error)}`, true));
