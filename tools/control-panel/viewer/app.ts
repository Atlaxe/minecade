// The map viewer page (/viewer?target=<id>&map=<id>&name=<name>&game=<name>, opened from the
// Panel's Maps page): a map's world in 3D. It loads the map's view file and the blocks' colors from
// the Panel, meshes the blocks in workers, and draws them (scene.ts) with the camera's views and
// the height, X and Z cuts; over them, the map's markup (overlay.ts) and beside them its checklist
// and lists (sidebar.ts), kept up to date when map.json changes. Spawns and game markers are
// placed, moved, turned and deleted with the mouse; boxes (bounds, spectator bounds, regions) are
// drawn from two corners and changed with their face handles; kill Y and the build limit are set by
// a click and dragged by their handle. Each edit goes to the Panel (changes.ts), with undo and redo,
// Save and Publish.
import { bigEnough, worldPoint, type Box, type EditorRules, type MapConfig, type MapEdit, type MapPosition, type Vec3 } from "@minecade/minigame-core/config";
import { lookAt, mapMiddle } from "../../../editor/behavior_pack/scripts/lists.ts";
import { regionName, type HeightLine } from "../../../editor/behavior_pack/scripts/regions.ts";
import { decodeView } from "../../viewer/view-format.ts";
import { addBoxEdit, boxFrom, faceToCut, facePlane, heightEdit, heightFromBlock, heightProblem, moveFace, nearestOnAxis, nudgeFace, removeBoxEdit, setBoxEdit, sizeText, MAX_LIMIT, MIN_HEIGHT, type Face } from "./boxes.ts";
import { MapChangesClient } from "./changes.ts";
import { buildMarkup, findEntry, type BoxMark, type Markup, type MarkupList, type PlaneMark, type PointMark } from "./markup.ts";
import { Overlay, type MarkerAssets } from "./overlay.ts";
import { floorSpot, placedPosition, yawToward, type Spot } from "./placing.ts";
import { MapScene, type Cuts, type Toggles, type ViewName } from "./scene.ts";
import { Sidebar, el } from "./sidebar.ts";
import { buildVolume, type FaceColors } from "./volume.ts";

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
}
const DEFAULTS: Settings = { occlusion: true, variation: true, darkenBelow: false, faded: true, names: true, center: true };

/** What the Panel sends for a map's markup (tools/viewer/map-data.ts). */
interface MapData extends MarkerAssets {
  config: MapConfig;
  stamp: string;
  targetName: string;
  rules: EditorRules;
}

/** How far the pointer moves before a press is a drag, in pixels. */
const DRAG_PIXELS = 4;
/** Facing steps while dragging the knob (Shift: whole degrees). */
const FACING_STEP = 15;
/** A new region's color until it has a box (then it takes game Edit's). */
const NEW_REGION_COLOR = 0xffffff;

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

async function main(): Promise<void> {
  document.title = `${name} (${game})`;
  $("map-name").textContent = name;
  $("map-game").textContent = `${game}, ${map}`;
  const query = `target=${encodeURIComponent(target)}&map=${encodeURIComponent(map)}`;
  // An open event stream counts this window as one of the Panel's, so it stays up while the viewer
  // is open; naming the map also brings its map.json's changes.
  const events = new EventSource(`/api/events?${query}`);

  const [viewResponse, colorsResponse, mapResponse] = await Promise.all([fetch(`/api/viewer/view?${query}`), fetch("/api/viewer/colors"), fetch(`/api/viewer/map?${query}`)]);
  for (const response of [viewResponse, mapResponse]) {
    if (response.ok) continue;
    const answer = (await response.json().catch(() => ({}))) as { error?: string };
    return show(`This map can't be shown: ${answer.error ?? `HTTP ${response.status}`}.`, true);
  }
  const data = (await mapResponse.json()) as MapData;
  const view = decodeView(new Uint8Array(await viewResponse.arrayBuffer()));
  const colors = (await colorsResponse.json()) as { blocks: Record<string, FaceColors>; note?: string };
  const volume = buildVolume(view, colors.blocks);
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
  const notes = [colors.note, volume.unknown.length > 0 ? `${volume.unknown.length} kinds of block have no color (pink)` : undefined].filter(Boolean);
  $("note").textContent = notes.join("; ");
  $("note").title = volume.unknown.join("\n");

  let settings = loadSettings();

  // ---- The markup: drawn over the blocks, listed beside them, drawn again whenever the map changes.
  const overlay = new Overlay(scene, data, $("tags"));
  let config = data.config;
  let markup: Markup = buildMarkup(config, data.rules);
  let picked: string | undefined;
  /**
   * The list a click on the blocks adds to: points are placed (Place), a box is drawn from two
   * corners (Add, `corner` once the first is clicked), a height is set (Set).
   */
  let armed: MarkupList | undefined;
  let corner: Vec3 | undefined;
  /** The picked box's face the arrow keys nudge. */
  let activeFace: Face | undefined;
  const allLists = () => markup.sections.flatMap((section) => section.lists);
  const armLabel = (list: MarkupList) => (list.kind === "points" ? "Place" : list.kind === "boxes" ? "Add" : "Set");
  const armTitle = (list: MarkupList) =>
    list.kind === "points" ? `Click blocks to place ${list.spawn?.single ? "it" : "entries"} (Esc stops)` : list.kind === "boxes" ? "Click one corner block, then the opposite one (Esc stops)" : "Click a block: the height goes to its layer (Esc stops)";
  const sidebar = new Sidebar($("sidebar"), {
    pick: (key) => pickEntry(key, true),
    listTools: (list) => el("button", { className: `small${armed?.key === list.key ? " on" : ""}`, title: armTitle(list), onclick: () => arm(armed?.key === list.key ? undefined : list) }, armLabel(list)),
    sectionTools: (section) => (section.title === "Boundaries" ? el("button", { className: "small", title: "A region of the map's own, by name", onclick: newRegion }, "New region") : null),
  });
  const redraw = () => {
    markup = buildMarkup(config, data.rules);
    if (picked && !findEntry(markup, picked)) picked = undefined;
    // A new region's list is the viewer's own until its first box is saved.
    if (armed) armed = allLists().find((list) => list.key === armed!.key) ?? (armed.kind === "boxes" ? armed : undefined);
    overlay.set(markup);
    overlay.pick(picked);
    sidebar.render(markup);
    sidebar.pick(picked);
    showPicked();
    document.title = `${config.name || name} (${data.targetName})`;
    $("map-name").textContent = config.name || name;
    const publish = $<HTMLButtonElement>("publish");
    publish.disabled = !markup.checklist.ready;
    publish.title = markup.checklist.ready ? "Publish: the lobby gets this version" : `Not ready to publish: ${markup.checklist.problems.join("; ")}`;
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
      $("undo").title = undo ? `Undo: ${undo} (Ctrl+Z)` : "Undo (Ctrl+Z)";
      $("redo").title = redo ? `Redo: ${redo} (Ctrl+Y)` : "Redo (Ctrl+Y)";
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
    const state = JSON.parse((event as MessageEvent<string>).data) as { editor?: { status?: { edit?: { target: string; map: string; state?: string } } | null } };
    const open = state.editor?.status?.edit;
    $("in-edit").hidden = !(open && open.target === target && open.map === map);
  });
  $("undo").onclick = () => changes.undo();
  $("redo").onclick = () => changes.redo();
  $("save").onclick = () => void changes.act("save");
  $("publish").onclick = () => {
    if (confirm(`Publish ${config.name || name}? The lobby gets this version.`)) void changes.act("publish");
  };

  // ---- Picking: an entry in the side panel or a marker in the view; the tool panel says what can be done with it.
  const pointOf = (key: string | undefined): PointMark | undefined => (key ? markup.points.find((point) => point.key === key) : undefined);
  const boxOf = (key: string | undefined): BoxMark | undefined => (key ? markup.boxes.find((box) => box.key === key) : undefined);
  const heightMarkOf = (key: string | undefined): PlaneMark | undefined => (key ? markup.planes.find((plane) => plane.key === key) : undefined);
  const showPicked = () => {
    const found = picked ? findEntry(markup, picked) : undefined;
    $("picked").textContent = found ? `${found.entry.label}: ${found.entry.detail}` : "";
    renderTool();
  };
  /** Picks an entry (or none); from the side panel, the view frames it, moving a height cut that hides it. */
  const pickEntry = (key: string | undefined, frame = false) => {
    if (key !== picked) activeFace = undefined;
    picked = key;
    overlay.pick(key);
    overlay.setActiveFace(activeFace);
    sidebar.pick(key);
    showPicked();
    if (!key || !frame) return;
    const extent = overlay.extent(key);
    if (!extent) return;
    if (cuts.top !== undefined && extent.floor > cuts.top) setTop(extent.floor);
    scene.frame(extent.center, extent.radius);
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

  /** Saves a changed box, unless it's too small for its list. */
  const saveBox = (box: BoxMark, next: Box) => {
    if (next.min.every((v, axis) => v === box.box.min[axis]) && next.max.every((v, axis) => v === box.box.max[axis])) return;
    const problem = sizeProblem(next, findEntry(markup, box.key)?.list.label ?? box.label, box.minSize);
    if (problem) return notice(problem, true);
    edit(setBoxEdit(box.entry, next));
  };

  /** Sets a height, unless game Edit's rules refuse it. */
  const saveHeight = (line: HeightLine, y: number) => {
    const problem = heightProblem(config, line, y);
    if (problem) return notice(problem, true);
    edit(heightEdit(line, y));
  };

  /** Moves the picked box's face, or the picked height, by whole blocks (the arrow keys and the tool panel's buttons). */
  const nudge = (steps: number) => {
    const box = boxOf(picked);
    const height = heightMarkOf(picked);
    if (box) {
      if (!activeFace) return notice("Click one of the box's handles first: the arrow keys move that face.", true);
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

  /** The tool panel: what's armed and Center on block, then what can be done with the picked entry. */
  const renderTool = () => {
    const center = el("input", { type: "checkbox", checked: settings.center, onchange: (event: Event) => ((settings = { ...settings, center: (event.target as HTMLInputElement).checked }), saveSettings(settings)) });
    const doing = armed
      ? armed.kind === "points"
        ? "Placing"
        : armed.kind === "boxes"
          ? corner
            ? "Opposite corner for"
            : "First corner for"
          : "Click a block for"
      : undefined;
    const point = pointOf(picked);
    const pointList = point ? findEntry(markup, point.key)?.list : undefined;
    const box = boxOf(picked);
    const height = heightMarkOf(picked);
    const cutButtons = (axes: (0 | 1 | 2)[]) =>
      axes.map((axis) => {
        const layer = axis === 1 ? cuts.top : axis === 0 ? cuts.x?.at : cuts.z?.at;
        const label = axis === 1 ? "Height cut" : axis === 0 ? "X cut" : "Z cut";
        return el("button", { className: "small", disabled: layer === undefined, title: layer === undefined ? `No ${label.toLowerCase()} to set it to` : `Move ${box ? "the face nearer it (or the picked face)" : "it"} onto the ${label.toLowerCase()}`, onclick: () => toCut(axis) }, `To ${label.toLowerCase()}`);
      });
    const nudges = el("div", { className: "row" }, el("button", { className: "small", title: box ? "Move the picked face in (Down or Left)" : "Down a block (Down)", onclick: () => nudge(-1) }, box ? "In" : "Down"), el("button", { className: "small", title: box ? "Move the picked face out (Up or Right)" : "Up a block (Up)", onclick: () => nudge(1) }, box ? "Out" : "Up"));
    const remove = el("button", { className: "small danger", title: "Delete (Del)", onclick: removePicked }, "Delete");
    const pickedPart = point && pointList?.spawn
      ? el(
          "div",
          { className: "picked" },
          el("strong", {}, point.label),
          el("div", { className: "row" }, el("button", { className: "small", disabled: !point.faced, title: "Face the map's middle again", onclick: () => edit({ op: "face", target: pointList.spawn!.target, index: point.index }) }, "Clear facing"), remove),
        )
      : box
        ? el(
            "div",
            { className: "picked" },
            el("strong", {}, box.label),
            el("span", { className: "muted" }, `${sizeText(box.box)}${box.minSize !== undefined ? `, at least ${box.minSize} each way` : ""}`),
            el("span", { className: "muted" }, activeFace ? `Face: ${faceName(activeFace)}` : "Drag a handle; click one to nudge it."),
            activeFace ? nudges : null,
            el("div", { className: "row" }, ...cutButtons([1, 0, 2])),
            el("div", { className: "row" }, remove),
          )
        : height
          ? el("div", { className: "picked" }, el("strong", {}, height.label), el("span", { className: "muted" }, `y ${height.y}`), nudges, el("div", { className: "row" }, ...cutButtons([1]), remove))
          : null;
    $("tool").replaceChildren(
      ...[
        el("h2", {}, "Tool"),
        armed && doing
          ? el("div", { className: "row" }, el("span", { className: "grow" }, `${doing} `, el("strong", {}, armed.label)), el("button", { className: "small", onclick: () => arm(undefined) }, "Stop"))
          : el("div", { className: "muted" }, "Place, Add or Set beside a list."),
        el("label", { className: "check" }, center, " Center on block"),
        pickedPart,
      ].filter((child): child is NonNullable<typeof child> => child !== null),
    );
  };

  /** Arms a list (or nothing): clicks on blocks then place its points, draw its box or set its height. */
  const arm = (list: MarkupList | undefined) => {
    armed = list;
    corner = undefined;
    // Clicks go to the armed list: the picked entry's handles would catch them.
    if (list && picked) pickEntry(undefined);
    canvas.classList.toggle("placing", list !== undefined);
    if (list?.kind === "points" && list.shape) overlay.setGhost({ key: "ghost", list: list.key, index: -1, label: "", at: { x: 0, y: -1e4, z: 0 }, yaw: 0, pitch: 0, faced: false, color: list.color, shape: list.shape });
    else overlay.setGhost(undefined);
    overlay.showBox(undefined, 0);
    sidebar.render(markup);
    sidebar.pick(picked);
    renderTool();
  };

  /** New region: a name of the map's own, then two corners. */
  const newRegion = () => {
    const typed = prompt("The new region's name (letters, digits and _, starting with a letter):");
    if (typed === null) return;
    const regionKey = regionName(typed);
    if (!regionKey) return notice("A region's name is letters, digits and _, starting with a letter.", true);
    const existing = allLists().find((list) => list.key === `regions.${regionKey}`);
    if (existing) return arm(existing);
    arm({ key: `regions.${regionKey}`, label: regionKey, kind: "boxes", color: NEW_REGION_COLOR, entries: [], place: { kind: "region", name: regionKey } });
  };

  /** Where a point would go for a pointer spot: its position in map.json, and where it stands. */
  const spotUnder = (clientX: number, clientY: number): { position: MapPosition; at: Spot } | undefined => {
    const hit = scene.pickAt(clientX, clientY);
    const spot = hit && floorSpot(volume, hit);
    if (!spot) return undefined;
    const position = placedPosition(spot, settings.center);
    return { position, at: worldPoint(position) };
  };
  const middle = () => mapMiddle(config);

  /** What a click does while a list is armed: place a point, a box's corner, or a height. */
  const useArmed = (clientX: number, clientY: number) => {
    const list = armed;
    if (!list) return;
    if (list.kind === "points" && list.spawn) {
      const spot = spotUnder(clientX, clientY);
      if (!spot) return notice("Nothing to stand on there: click the top of a block.", true);
      const replace = list.spawn.single && list.entries.length > 0;
      const done = edit(replace ? { op: "set", target: list.spawn.target, index: 0, at: spot.position } : { op: "add", target: list.spawn.target, at: spot.position });
      if (!done) return;
      pickEntry(`${list.key}#${replace ? 0 : list.entries.length}`);
      if (list.spawn.single) arm(undefined);
      return;
    }
    const hit = scene.pickAt(clientX, clientY);
    if (!hit) return notice("Click a block.", true);
    if (list.kind === "plane" && list.line) {
      const y = heightFromBlock(list.line, hit.world[1]);
      const problem = heightProblem(config, list.line, y);
      if (problem) return notice(problem, true);
      if (!edit(heightEdit(list.line, y))) return;
      arm(undefined);
      pickEntry(list.key);
      return;
    }
    if (list.kind === "boxes" && list.place) {
      if (!corner) {
        corner = hit.world;
        renderTool();
        return;
      }
      const box = boxFrom(corner, hit.world);
      const problem = sizeProblem(box, list.label, list.minSize);
      if (problem) return notice(problem, true);
      if (!edit(addBoxEdit(list.place, box))) return;
      const index = list.entries.length;
      const key = list.place.kind === "region" ? `regions.${list.place.name}#${index}` : `${list.place.kind}#${index}`;
      arm(undefined);
      pickEntry(key);
    }
  };

  // ---- Toggles.
  const applyToggles = () => {
    scene.setToggles(settings);
    overlay.showNames(settings.names);
    overlay.refresh();
    saveSettings(settings);
    $<HTMLInputElement>("toggle-occlusion").checked = settings.occlusion;
    $<HTMLInputElement>("toggle-variation").checked = settings.variation;
    $<HTMLInputElement>("toggle-darken").checked = settings.darkenBelow;
    $<HTMLInputElement>("toggle-names").checked = settings.names;
    $("past-faded").classList.toggle("on", settings.faded);
    $("past-gone").classList.toggle("on", !settings.faded);
  };
  const toggle = (id: string, key: "occlusion" | "variation" | "darkenBelow" | "names") => {
    $(id).onchange = (event) => ((settings = { ...settings, [key]: (event.target as HTMLInputElement).checked }), applyToggles());
  };
  toggle("toggle-occlusion", "occlusion");
  toggle("toggle-variation", "variation");
  toggle("toggle-darken", "darkenBelow");
  toggle("toggle-names", "names");
  $("past-faded").onclick = () => ((settings = { ...settings, faded: true }), applyToggles());
  $("past-gone").onclick = () => ((settings = { ...settings, faded: false }), applyToggles());
  applyToggles();

  // ---- Views.
  $("view-home").onclick = () => scene.view("home");
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) button.onclick = () => scene.view(button.dataset.view as ViewName);
  scene.addRenderListener(() => {
    $("needle").style.transform = `rotate(${-scene.heading}deg)`;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) button.classList.toggle("on", button.dataset.view === "top" && scene.isTop);
  });

  // ---- Cuts. The height slider runs over the layers the map uses; at its top, nothing is cut.
  const { min, max } = view.box;
  let cuts: Cuts = {};
  const top = $<HTMLInputElement>("top");
  Object.assign(top, { min: String(min[1]), max: String(max[1]), value: String(max[1]) });
  const axes = { x: { input: $<HTMLInputElement>("x"), index: 0 }, z: { input: $<HTMLInputElement>("z"), index: 2 } } as const;
  for (const axis of ["x", "z"] as const) {
    const { input, index } = axes[axis];
    Object.assign(input, { min: String(min[index]), max: String(max[index]), value: String(max[index]) });
  }
  const applyCuts = (next: Cuts) => {
    cuts = next;
    scene.setCuts(cuts);
    overlay.refresh();
    top.value = String(cuts.top ?? max[1]);
    $("top-label").textContent = cuts.top === undefined ? "all" : `y ${cuts.top}`;
    for (const axis of ["x", "z"] as const) {
      const cut = cuts[axis];
      const { input, index } = axes[axis];
      input.value = String(cut?.at ?? max[index]);
      $(`${axis}-label`).textContent = cut ? `${axis} ${cut.side === "below" ? "<=" : ">="} ${cut.at}` : "off";
    }
    // The tool panel's To cut buttons follow the cuts.
    if (picked && (boxOf(picked) || heightMarkOf(picked))) renderTool();
  };
  const setTop = (value: number) => applyCuts({ ...cuts, top: value >= max[1] ? undefined : Math.max(min[1], value) });
  top.oninput = () => setTop(Number(top.value));
  $("top-off").onclick = () => setTop(max[1]);
  for (const axis of ["x", "z"] as const) {
    const { input } = axes[axis];
    input.oninput = () => applyCuts({ ...cuts, [axis]: { at: Number(input.value), side: cuts[axis]?.side ?? "below" } });
    $(`${axis}-flip`).onclick = () => {
      const cut = cuts[axis];
      if (cut) applyCuts({ ...cuts, [axis]: { ...cut, side: cut.side === "below" ? "above" : "below" } });
    };
    $(`${axis}-off`).onclick = () => applyCuts({ ...cuts, [axis]: undefined });
  }

  // Cut here: the next click on a block puts that cut at it.
  let arming: "top" | "x" | "z" | undefined;
  const armCut = (axis: typeof arming) => {
    arming = arming === axis ? undefined : axis;
    canvas.classList.toggle("arming", arming !== undefined);
    for (const id of ["top", "x", "z"]) $(`${id}-here`).classList.toggle("on", arming === id);
  };
  $("top-here").onclick = () => armCut("top");
  $("x-here").onclick = () => armCut("x");
  $("z-here").onclick = () => armCut("z");

  // ---- Keys: the cut, undo and redo, the arrows (nudge), Delete, and Esc (stop a drag, an armed list, Cut here, or the pick).
  addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type !== "range" && event.target.type !== "checkbox") return;
    const step = event.shiftKey ? 5 : 1;
    const now = cuts.top ?? max[1];
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === "z" && !event.shiftKey) changes.undo();
    else if (ctrl && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) changes.redo();
    else if (event.key === "PageDown" || event.key === "[" || event.key === "{") setTop(now - step);
    else if (event.key === "PageUp" || event.key === "]" || event.key === "}") setTop(now + step);
    else if (event.key === "Home") scene.view("home");
    else if ((event.key === "ArrowUp" || event.key === "ArrowRight") && (boxOf(picked) || heightMarkOf(picked))) nudge(step);
    else if ((event.key === "ArrowDown" || event.key === "ArrowLeft") && (boxOf(picked) || heightMarkOf(picked))) nudge(-step);
    else if (event.key === "Delete" || event.key === "Backspace") removePicked();
    else if (event.key === "Escape") {
      if (press?.drag) cancelDrag();
      else if (armed) arm(undefined);
      else if (arming) armCut(undefined);
      else pickEntry(undefined);
    } else return;
    event.preventDefault();
  });

  // ---- The pointer. A left press on a handle drags a box's face or a height; on the picked
  // point's knob it turns its facing; on a marker it drags it along the floor. A click uses the
  // armed list, cuts (Cut here), or picks. A double click centers the view.
  type Drag =
    | { kind: "move" | "face"; point: PointMark; moved: boolean; position?: MapPosition; yaw?: number }
    | { kind: "boxFace"; box: BoxMark; face: Face; moved: boolean; next?: Box }
    | { kind: "height"; height: PlaneMark; moved: boolean; y?: number; from: { x: number; y: number; z: number } };
  let press: { x: number; y: number; drag?: Drag } | undefined;
  const cancelDrag = () => {
    press = undefined;
    overlay.hideWhileEditing(undefined);
    overlay.showBox(undefined, 0);
    overlay.set(markup);
    overlay.pick(picked);
  };
  const finishDrag = (drag: Drag) => {
    overlay.hideWhileEditing(undefined);
    overlay.showBox(undefined, 0);
    if (drag.kind === "boxFace") {
      if (drag.next) saveBox(drag.box, drag.next);
      return;
    }
    if (drag.kind === "height") {
      if (drag.y !== undefined && drag.y !== drag.height.y) saveHeight(drag.height.line, drag.y);
      else overlay.refresh();
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

  /** Where along an axis through a spot the pointer is nearest: the spot's coordinate plus how far along. */
  const alongAxis = (spot: Vec3, axis: 0 | 1 | 2, clientX: number, clientY: number): number | undefined => {
    const { ray } = scene.rayAt(clientX, clientY);
    const direction: Vec3 = [0, 0, 0];
    direction[axis] = 1;
    const s = nearestOnAxis(spot, direction, [ray.origin.x, ray.origin.y, ray.origin.z], [ray.direction.x, ray.direction.y, ray.direction.z]);
    return s === undefined ? undefined : spot[axis] + s;
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    press = { x: event.clientX, y: event.clientY };
    if (arming) return;
    const handle = overlay.handleAt(event.clientX, event.clientY);
    const box = boxOf(picked);
    const height = heightMarkOf(picked);
    if (handle && "face" in handle && box) press.drag = { kind: "boxFace", box, face: handle.face, moved: false };
    else if (handle && "height" in handle && height) {
      const spot = overlay.heightHandleSpot();
      if (spot) press.drag = { kind: "height", height, moved: false, from: { x: spot.x, y: spot.y, z: spot.z } };
    }
    if (!press.drag && armed?.kind !== "boxes" && armed?.kind !== "plane") {
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
      if (drag.kind === "boxFace") {
        const { box, face } = drag;
        const spot = [0, 1, 2].map((axis) => (box.box.min[axis] + box.box.max[axis] + 1) / 2) as Vec3;
        spot[face.axis] = facePlane(box.box, face);
        const plane = alongAxis(spot, face.axis, event.clientX, event.clientY);
        if (plane === undefined) return;
        drag.next = moveFace(box.box, face, plane);
        const problem = sizeProblem(drag.next, box.label, box.minSize);
        activeFace = face;
        overlay.setActiveFace(face);
        overlay.hideWhileEditing(box.key);
        overlay.showBox(drag.next, box.color, sizeText(drag.next), problem !== undefined);
        $("hover").textContent = `${box.label}: ${sizeText(drag.next)}${problem ? ` (too small: at least ${box.minSize} each way)` : ""}`;
      } else if (drag.kind === "height") {
        const along = alongAxis([drag.from.x, drag.from.y, drag.from.z], 1, event.clientX, event.clientY);
        if (along === undefined) return;
        const high = drag.height.line === "killY" ? MAX_LIMIT - 1 : MAX_LIMIT;
        drag.y = Math.min(high, Math.max(MIN_HEIGHT, Math.round(along)));
        overlay.hideWhileEditing(drag.height.key);
        overlay.previewHeight(drag.height.key, drag.y);
        $("hover").textContent = `${drag.height.label}: y ${drag.y}`;
      } else if (drag.kind === "move") {
        const spot = spotUnder(event.clientX, event.clientY);
        if (!spot) return;
        drag.position = spot.position;
        const yaw = drag.point.faced ? drag.point.yaw : lookAt(spot.at, middle()).yaw;
        overlay.previewPoint(drag.point.key, spot.at, yaw);
        $("hover").textContent = `${drag.point.label} to ${spot.position.join(" ")}`;
      } else {
        const { ray } = scene.rayAt(event.clientX, event.clientY);
        const { at } = drag.point;
        if (Math.abs(ray.direction.y) < 1e-6) return;
        const t = (at.y - ray.origin.y) / ray.direction.y;
        if (t <= 0) return;
        const to = { x: ray.origin.x + ray.direction.x * t, y: at.y, z: ray.origin.z + ray.direction.z * t };
        drag.yaw = yawToward(at, to, event.shiftKey ? 1 : FACING_STEP);
        overlay.previewPoint(drag.point.key, at, drag.yaw);
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
    if (drag?.kind === "boxFace") {
      // A click on a face's handle picks that face for the arrow keys.
      activeFace = drag.face;
      overlay.setActiveFace(activeFace);
      renderTool();
      return;
    }
    if (drag?.kind === "height") return;
    if (arming) {
      const hit = scene.pickAt(event.clientX, event.clientY);
      if (!hit) return;
      const [x, y, z] = hit.world;
      if (arming === "top") setTop(y);
      else applyCuts({ ...cuts, [arming]: { at: arming === "x" ? x : z, side: cuts[arming]?.side ?? "below" } });
      armCut(undefined);
      return;
    }
    if (armed && !drag) return useArmed(event.clientX, event.clientY);
    // A marker in front of the blocks picks its entry; anywhere else picks nothing.
    pickEntry(drag?.point.key);
  });
  canvas.addEventListener("dblclick", (event) => {
    const hit = scene.pickAt(event.clientX, event.clientY);
    if (hit) scene.centerOn([hit.world[0] + 0.5, hit.world[1] + 0.5, hit.world[2] + 0.5]);
  });

  // What's under the pointer, in the status line, and what the armed list would do there (once a frame).
  let hoverQueued = false;
  let last: PointerEvent | undefined;
  const queueHover = (event: PointerEvent) => {
    last = event;
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (!last) return;
      const hit = scene.pickAt(last.clientX, last.clientY);
      if (armed?.kind === "points") {
        const spot = spotUnder(last.clientX, last.clientY);
        overlay.moveGhost(spot?.at, spot ? lookAt(spot.at, middle()).yaw : 0);
      } else if (armed?.kind === "boxes") {
        if (hit) {
          const box = boxFrom(corner ?? hit.world, hit.world);
          const problem = corner ? sizeProblem(box, armed.label, armed.minSize) : undefined;
          overlay.showBox(box, armed.color, sizeText(box), problem !== undefined);
          return void ($("hover").textContent = `${corner ? "Box" : "First corner"}: ${sizeText(box)} from ${box.min.join(" ")}${problem ? " (too small)" : ""}`);
        }
        overlay.showBox(undefined, 0);
      } else if (armed?.kind === "plane" && armed.line && hit) {
        return void ($("hover").textContent = `${armed.label} at y ${heightFromBlock(armed.line, hit.world[1])}`);
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
    if (armed?.kind === "boxes" && !corner) overlay.showBox(undefined, 0);
  });
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
