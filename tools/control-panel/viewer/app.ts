// The map viewer page (/viewer?target=<id>&map=<id>&name=<name>&game=<name>, opened from the
// Panel's Maps page): a map's world in 3D. It loads the map's view file and the blocks' colors from
// the Panel, meshes the blocks in workers, and draws them (scene.ts) with the camera's views and
// the height, X and Z cuts; over them, the map's markup (overlay.ts) and beside them its checklist
// and lists (sidebar.ts), kept up to date when map.json changes. Spawns and game markers are
// placed, moved, turned and deleted with the mouse (changes.ts sends each edit to the Panel), with
// undo and redo, Save and Publish.
import { worldPoint, type EditorRules, type MapConfig, type MapEdit, type MapPosition } from "@minecade/minigame-core/config";
import { lookAt, mapMiddle } from "../../../editor/behavior_pack/scripts/lists.ts";
import { decodeView } from "../../viewer/view-format.ts";
import { MapChangesClient } from "./changes.ts";
import { buildMarkup, findEntry, type Markup, type MarkupList, type PointMark } from "./markup.ts";
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
  /** The list new points go into while Place is on. */
  let placing: MarkupList | undefined;
  const sidebar = new Sidebar($("sidebar"), {
    pick: (key) => pickEntry(key, true),
    listTools: (list) =>
      list.kind === "points" && list.spawn
        ? el("button", { className: `small${placing?.key === list.key ? " on" : ""}`, title: `Click blocks to place ${list.spawn.single ? "it" : "entries"} (Esc stops)`, onclick: () => place(placing?.key === list.key ? undefined : list) }, "Place")
        : null,
  });
  const redraw = () => {
    markup = buildMarkup(config, data.rules);
    if (picked && !findEntry(markup, picked)) picked = undefined;
    if (placing) placing = markup.sections.flatMap((section) => section.lists).find((list) => list.key === placing!.key);
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
  const showPicked = () => {
    const found = picked ? findEntry(markup, picked) : undefined;
    $("picked").textContent = found ? `${found.entry.label}: ${found.entry.detail}` : "";
    renderTool();
  };
  /** Picks an entry (or none); from the side panel, the view frames it, moving a height cut that hides it. */
  const pickEntry = (key: string | undefined, frame = false) => {
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

  /** Removes the picked entry. */
  const removePicked = () => {
    const point = pointOf(picked);
    const list = point && findEntry(markup, point.key)?.list;
    if (!point || !list?.spawn) return;
    edit({ op: "remove", target: list.spawn.target, index: point.index });
    pickEntry(undefined);
  };

  /** The tool panel: Place's list and Center on block, then what can be done with the picked entry. */
  const renderTool = () => {
    const point = pointOf(picked);
    const list = point ? findEntry(markup, point.key)?.list : undefined;
    const center = el("input", { type: "checkbox", checked: settings.center, onchange: (event: Event) => ((settings = { ...settings, center: (event.target as HTMLInputElement).checked }), saveSettings(settings)) });
    $("tool").replaceChildren(
      el("h2", {}, "Tool"),
      placing
        ? el("div", { className: "row" }, el("span", { className: "grow" }, "Placing ", el("strong", {}, placing.label)), el("button", { className: "small", onclick: () => place(undefined) }, "Stop"))
        : el("div", { className: "muted" }, "Place beside a list puts its entries."),
      el("label", { className: "check" }, center, " Center on block"),
      ...(point && list?.spawn
        ? [el(
            "div",
            { className: "picked" },
            el("strong", {}, point.label),
            el(
              "div",
              { className: "row" },
              el("button", { className: "small", disabled: !point.faced, title: "Face the map's middle again", onclick: () => edit({ op: "face", target: list.spawn!.target, index: point.index }) }, "Clear facing"),
              el("button", { className: "small danger", title: "Delete (Del)", onclick: removePicked }, "Delete"),
            ),
          )]
        : []),
    );
  };

  /** Turns Place on for a list (or off): clicks on blocks then put entries in it. */
  const place = (list: MarkupList | undefined) => {
    placing = list;
    canvas.classList.toggle("placing", list !== undefined);
    if (list?.shape) overlay.setGhost({ key: "ghost", list: list.key, index: -1, label: "", at: { x: 0, y: -1e4, z: 0 }, yaw: 0, pitch: 0, faced: false, color: list.color, shape: list.shape });
    else overlay.setGhost(undefined);
    sidebar.render(markup);
    sidebar.pick(picked);
    renderTool();
  };

  /** Where a point would go for a pointer spot: its position in map.json, where it stands, and which way it looks. */
  const spotUnder = (clientX: number, clientY: number): { position: MapPosition; at: Spot } | undefined => {
    const hit = scene.pickAt(clientX, clientY);
    const spot = hit && floorSpot(volume, hit);
    if (!spot) return undefined;
    const position = placedPosition(spot, settings.center);
    return { position, at: worldPoint(position) };
  };
  const middle = () => mapMiddle(config);

  /** Places a point into the Place list at a spot on the canvas, and picks it. */
  const placeAt = (clientX: number, clientY: number) => {
    const list = placing;
    if (!list?.spawn) return;
    const spot = spotUnder(clientX, clientY);
    if (!spot) return notice("Nothing to stand on there: click the top of a block.", true);
    const replace = list.spawn.single && list.entries.length > 0;
    const done = edit(replace ? { op: "set", target: list.spawn.target, index: 0, at: spot.position } : { op: "add", target: list.spawn.target, at: spot.position });
    if (!done) return;
    pickEntry(`${list.key}#${replace ? 0 : list.entries.length}`);
    if (list.spawn.single) place(undefined);
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
  const arm = (axis: typeof arming) => {
    arming = arming === axis ? undefined : axis;
    canvas.classList.toggle("arming", arming !== undefined);
    for (const id of ["top", "x", "z"]) $(`${id}-here`).classList.toggle("on", arming === id);
  };
  $("top-here").onclick = () => arm("top");
  $("x-here").onclick = () => arm("x");
  $("z-here").onclick = () => arm("z");

  // ---- Keys: the cut, undo and redo, Delete, and Esc (stop a drag, Place, Cut here, or the pick).
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
    else if (event.key === "Delete" || event.key === "Backspace") removePicked();
    else if (event.key === "Escape") {
      if (press?.drag) cancelDrag();
      else if (placing) place(undefined);
      else if (arming) arm(undefined);
      else pickEntry(undefined);
    } else return;
    event.preventDefault();
  });

  // ---- The pointer. A left press on a marker drags it along the floor; on the picked point's knob
  // it turns its facing; a click places (Place), cuts (Cut here) or picks. A double click centers.
  type Drag = { kind: "move" | "face"; point: PointMark; moved: boolean; position?: MapPosition; yaw?: number };
  let press: { x: number; y: number; drag?: Drag } | undefined;
  const cancelDrag = () => {
    press = undefined;
    overlay.set(markup);
    overlay.pick(picked);
  };
  const finishDrag = (drag: Drag) => {
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
    press = { x: event.clientX, y: event.clientY };
    if (arming) return;
    const block = scene.pickAt(event.clientX, event.clientY);
    const knob = overlay.knobAt(event.clientX, event.clientY);
    const pickedPoint = pointOf(picked);
    const point = overlay.pointAt(event.clientX, event.clientY);
    if (knob !== undefined && pickedPoint) press.drag = { kind: "face", point: pickedPoint, moved: false };
    else if (point && (!block || point.distance <= block.distance + 0.01)) press.drag = { kind: "move", point: pointOf(point.key)!, moved: false };
    if (press.drag) canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    const drag = press?.drag;
    if (drag && press) {
      if (!drag.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= DRAG_PIXELS) return;
      drag.moved = true;
      if (drag.kind === "move") {
        const spot = spotUnder(event.clientX, event.clientY);
        if (!spot) return;
        drag.position = spot.position;
        const yaw = drag.point.faced ? drag.point.yaw : lookAt(spot.at, middle()).yaw;
        overlay.previewPoint(drag.point.key, spot.at, yaw);
        $("hover").textContent = `${drag.point.label} to ${spot.position.join(" ")}`;
      } else {
        const ray = scene.rayAt(event.clientX, event.clientY).ray;
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
    if (arming) {
      const hit = scene.pickAt(event.clientX, event.clientY);
      if (!hit) return;
      const [x, y, z] = hit.world;
      if (arming === "top") setTop(y);
      else applyCuts({ ...cuts, [arming]: { at: arming === "x" ? x : z, side: cuts[arming]?.side ?? "below" } });
      arm(undefined);
      return;
    }
    if (placing && !drag) return placeAt(event.clientX, event.clientY);
    // A marker in front of the blocks picks its entry; anywhere else picks nothing.
    pickEntry(drag?.point.key);
  });
  canvas.addEventListener("dblclick", (event) => {
    const hit = scene.pickAt(event.clientX, event.clientY);
    if (hit) scene.centerOn([hit.world[0] + 0.5, hit.world[1] + 0.5, hit.world[2] + 0.5]);
  });

  // What's under the pointer, in the status line, and where Place would put a point (once a frame).
  let hoverQueued = false;
  let last: PointerEvent | undefined;
  const queueHover = (event: PointerEvent) => {
    last = event;
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (!last) return;
      if (placing) {
        const spot = spotUnder(last.clientX, last.clientY);
        overlay.moveGhost(spot?.at, spot ? lookAt(spot.at, middle()).yaw : 0);
      }
      const hit = scene.pickAt(last.clientX, last.clientY);
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
  });
  applyCuts({});
  redraw();
  canvas.focus();
}

main().catch((error: unknown) => show(`The viewer stopped: ${error instanceof Error ? error.message : String(error)}`, true));
