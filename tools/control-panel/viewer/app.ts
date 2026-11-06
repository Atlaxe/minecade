// The map viewer page (/viewer?target=<id>&map=<id>&name=<name>&game=<name>, opened from the
// Panel's Maps page): a map's world in 3D. It loads the map's view file and the blocks' colors from
// the Panel, meshes the blocks in workers, and draws them (scene.ts) with the camera's views and
// the height, X and Z cuts; over them, the map's markup (overlay.ts) and beside them its checklist
// and lists (sidebar.ts), kept up to date when map.json changes.
import type { EditorRules, MapConfig } from "@minecade/minigame-core/config";
import { decodeView } from "../../viewer/view-format.ts";
import { buildMarkup, findEntry, type Markup } from "./markup.ts";
import { Overlay, type MarkerAssets } from "./overlay.ts";
import { MapScene, type Cuts, type Toggles, type ViewName } from "./scene.ts";
import { Sidebar } from "./sidebar.ts";
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
}
const DEFAULTS: Settings = { occlusion: true, variation: true, darkenBelow: false, faded: true, names: true };

/** What the Panel sends for a map's markup (tools/viewer/map-data.ts). */
interface MapData extends MarkerAssets {
  config: MapConfig;
  stamp: string;
  targetName: string;
  rules: EditorRules;
}

function loadToggles(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveToggles(toggles: Settings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(toggles));
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
  // Nothing is meshed again in a read-only view.
  for (const worker of workers) worker.terminate();
  $("message").hidden = true;

  let blocks = 0;
  for (const look of volume.blocks) if (volume.drawn[look]) blocks++;
  const size = view.box.max.map((v, i) => v - view.box.min[i] + 1).join(" x ");
  $("info").textContent = `${size} blocks, ${blocks.toLocaleString()} drawn, ${(stats.quads * 2).toLocaleString()} triangles, made in ${Math.round(stats.ms)} ms`;
  const notes = [colors.note, volume.unknown.length > 0 ? `${volume.unknown.length} kinds of block have no color (pink)` : undefined].filter(Boolean);
  $("note").textContent = notes.join("; ");
  $("note").title = volume.unknown.join("\n");

  // The markup: drawn over the blocks, listed beside them, and drawn again whenever map.json changes.
  const overlay = new Overlay(scene, data, $("tags"));
  let config = data.config;
  let markup: Markup = buildMarkup(config, data.rules);
  let picked: string | undefined;
  const sidebar = new Sidebar($("sidebar"), { pick: (key) => pickEntry(key, true) });
  const redraw = () => {
    markup = buildMarkup(config, data.rules);
    if (picked && !findEntry(markup, picked)) picked = undefined;
    overlay.set(markup);
    overlay.pick(picked);
    sidebar.render(markup);
    sidebar.pick(picked);
    showPicked();
    document.title = `${config.name || name} (${data.targetName})`;
    $("map-name").textContent = config.name || name;
  };
  events.addEventListener("map", (event) => {
    const change = JSON.parse((event as MessageEvent<string>).data) as { stamp: string; config?: MapConfig };
    if (!change.config) return show("map.json isn't valid JSON right now: the viewer shows it as it was.", true);
    $("message").hidden = true;
    config = change.config;
    redraw();
  });

  const showPicked = () => {
    const found = picked ? findEntry(markup, picked) : undefined;
    $("picked").textContent = found ? `${found.entry.label}: ${found.entry.detail}` : "";
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

  // Toggles.
  let toggles = loadToggles();
  const applyToggles = () => {
    scene.setToggles(toggles);
    overlay.showNames(toggles.names);
    overlay.refresh();
    saveToggles(toggles);
    $<HTMLInputElement>("toggle-occlusion").checked = toggles.occlusion;
    $<HTMLInputElement>("toggle-variation").checked = toggles.variation;
    $<HTMLInputElement>("toggle-darken").checked = toggles.darkenBelow;
    $<HTMLInputElement>("toggle-names").checked = toggles.names;
    $("past-faded").classList.toggle("on", toggles.faded);
    $("past-gone").classList.toggle("on", !toggles.faded);
  };
  $("toggle-occlusion").onchange = (event) => ((toggles = { ...toggles, occlusion: (event.target as HTMLInputElement).checked }), applyToggles());
  $("toggle-variation").onchange = (event) => ((toggles = { ...toggles, variation: (event.target as HTMLInputElement).checked }), applyToggles());
  $("toggle-darken").onchange = (event) => ((toggles = { ...toggles, darkenBelow: (event.target as HTMLInputElement).checked }), applyToggles());
  $("toggle-names").onchange = (event) => ((toggles = { ...toggles, names: (event.target as HTMLInputElement).checked }), applyToggles());
  $("past-faded").onclick = () => ((toggles = { ...toggles, faded: true }), applyToggles());
  $("past-gone").onclick = () => ((toggles = { ...toggles, faded: false }), applyToggles());
  applyToggles();

  // Views.
  $("view-home").onclick = () => scene.view("home");
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) button.onclick = () => scene.view(button.dataset.view as ViewName);
  scene.addRenderListener(() => {
    $("needle").style.transform = `rotate(${-scene.heading}deg)`;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) button.classList.toggle("on", button.dataset.view === "top" && scene.isTop);
  });

  // Cuts. The height slider runs over the layers the map uses; at its top, nothing is cut.
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
  addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type !== "range") return;
    const step = event.shiftKey ? 5 : 1;
    const now = cuts.top ?? max[1];
    if (event.key === "PageDown" || event.key === "[" || event.key === "{") setTop(now - step);
    else if (event.key === "PageUp" || event.key === "]" || event.key === "}") setTop(now + step);
    else if (event.key === "Home") scene.view("home");
    else return;
    event.preventDefault();
  });

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

  // A left click (not a drag) on a block; a double click centers the view on it.
  let down: { x: number; y: number } | undefined;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button === 0) down = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", (event) => {
    if (event.button !== 0 || !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    down = undefined;
    if (!arming) {
      // A marker in front of the blocks picks its entry; anywhere else picks nothing.
      const point = overlay.pointAt(event.clientX, event.clientY);
      const block = scene.pickAt(event.clientX, event.clientY);
      pickEntry(point && (!block || point.distance <= block.distance + 0.01) ? point.key : undefined);
      return;
    }
    const hit = scene.pickAt(event.clientX, event.clientY);
    if (!hit) return;
    const [x, y, z] = hit.world;
    if (arming === "top") setTop(y);
    else applyCuts({ ...cuts, [arming]: { at: arming === "x" ? x : z, side: cuts[arming]?.side ?? "below" } });
    arm(undefined);
  });
  canvas.addEventListener("dblclick", (event) => {
    const hit = scene.pickAt(event.clientX, event.clientY);
    if (hit) scene.centerOn([hit.world[0] + 0.5, hit.world[1] + 0.5, hit.world[2] + 0.5]);
  });

  // The block under the mouse, in the status line.
  let hoverQueued = false;
  let last: PointerEvent | undefined;
  canvas.addEventListener("pointermove", (event) => {
    last = event;
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (!last) return;
      const hit = scene.pickAt(last.clientX, last.clientY);
      const point = overlay.pointAt(last.clientX, last.clientY);
      if (point && (!hit || point.distance <= hit.distance + 0.01)) return void ($("hover").textContent = findEntry(markup, point.key)?.entry.label ?? "");
      if (!hit) return void ($("hover").textContent = "");
      const look = volume.looks[hit.look];
      const states = look.states ? ` ${Object.entries(look.states).map(([key, value]) => `${key}=${value}`).join(" ")}` : "";
      $("hover").textContent = `${look.name.replace(/^minecraft:/, "")}${states} at ${hit.world.join(", ")}`;
    });
  });
  canvas.addEventListener("pointerleave", () => ($("hover").textContent = ""));
  applyCuts({});
  redraw();
  canvas.focus();
}

main().catch((error: unknown) => show(`The viewer stopped: ${error instanceof Error ? error.message : String(error)}`, true));
