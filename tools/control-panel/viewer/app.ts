// The map viewer page (/viewer?target=<id>&map=<id>&name=<name>&game=<name>, opened from the
// Panel's Maps page): a map's world in 3D, read only. It loads the map's view file and the blocks'
// colors from the Panel, meshes the blocks in workers, and draws them (scene.ts) with the camera's
// views and the height, X and Z cuts.
import { decodeView } from "../../viewer/view-format.ts";
import { MapScene, type Cuts, type Toggles, type ViewName } from "./scene.ts";
import { buildVolume, type FaceColors } from "./volume.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const target = params.get("target") ?? "";
const map = params.get("map") ?? "";
const name = params.get("name") || map;
const game = params.get("game") || target;

/** The viewer's own settings, kept in this browser: per viewer, not per map. */
const STORE_KEY = "minecade-viewer";
const DEFAULTS: Toggles = { occlusion: true, variation: true, darkenBelow: false, faded: true };

function loadToggles(): Toggles {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Partial<Toggles>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveToggles(toggles: Toggles): void {
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
  // An open event stream counts this window as one of the Panel's, so it stays up while the viewer is open.
  new EventSource("/api/events");

  const query = `target=${encodeURIComponent(target)}&map=${encodeURIComponent(map)}`;
  const [viewResponse, colorsResponse] = await Promise.all([fetch(`/api/viewer/view?${query}`), fetch("/api/viewer/colors")]);
  if (!viewResponse.ok) {
    const answer = (await viewResponse.json().catch(() => ({}))) as { error?: string };
    return show(`This map can't be shown: ${answer.error ?? `HTTP ${viewResponse.status}`}.`, true);
  }
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

  // Toggles.
  let toggles = loadToggles();
  const applyToggles = () => {
    scene.setToggles(toggles);
    saveToggles(toggles);
    $<HTMLInputElement>("toggle-occlusion").checked = toggles.occlusion;
    $<HTMLInputElement>("toggle-variation").checked = toggles.variation;
    $<HTMLInputElement>("toggle-darken").checked = toggles.darkenBelow;
    $("past-faded").classList.toggle("on", toggles.faded);
    $("past-gone").classList.toggle("on", !toggles.faded);
  };
  $("toggle-occlusion").onchange = (event) => ((toggles = { ...toggles, occlusion: (event.target as HTMLInputElement).checked }), applyToggles());
  $("toggle-variation").onchange = (event) => ((toggles = { ...toggles, variation: (event.target as HTMLInputElement).checked }), applyToggles());
  $("toggle-darken").onchange = (event) => ((toggles = { ...toggles, darkenBelow: (event.target as HTMLInputElement).checked }), applyToggles());
  $("past-faded").onclick = () => ((toggles = { ...toggles, faded: true }), applyToggles());
  $("past-gone").onclick = () => ((toggles = { ...toggles, faded: false }), applyToggles());
  applyToggles();

  // Views.
  $("view-home").onclick = () => scene.view("home");
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) button.onclick = () => scene.view(button.dataset.view as ViewName);
  scene.onRender = () => {
    $("needle").style.transform = `rotate(${-scene.heading}deg)`;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) button.classList.toggle("on", button.dataset.view === "top" && scene.isTop);
  };

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
    if (!arming) return;
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
      if (!hit) return void ($("hover").textContent = "");
      const look = volume.looks[hit.look];
      const states = look.states ? ` ${Object.entries(look.states).map(([key, value]) => `${key}=${value}`).join(" ")}` : "";
      $("hover").textContent = `${look.name.replace(/^minecraft:/, "")}${states} at ${hit.world.join(", ")}`;
    });
  });
  canvas.addEventListener("pointerleave", () => ($("hover").textContent = ""));
  applyCuts({});
  canvas.focus();
}

main().catch((error: unknown) => show(`The viewer stopped: ${error instanceof Error ? error.message : String(error)}`, true));
