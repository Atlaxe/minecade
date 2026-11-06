// Select from above (pass V.10, /viewer/select?world=<id>, opened from the Maps page's Worlds tab):
// a world seen from above, one pixel a block column (overview-format.ts), with the maps already cut
// from it as named outlines. A box drawn on it (up to 256 by 256, select-box.ts) gets its height
// trimmed to the blocks inside, shown from the side with a floor and a ceiling to drag (for ground
// under the build), a 3D look at what's between them (scene.ts), and Export to map, which the Panel
// runs in the background (tools/viewer/select.ts) while the network keeps running. In-game Select
// stays as it is.
import { decodeOverview, NO_TOP, type Overview } from "../../viewer/overview-format.ts";
import { decodeView, type View } from "../../viewer/view-format.ts";
import { MapScene } from "./scene.ts";
import { columnsFrom, columnsSize, dragColumns, heightRange, mapIdFrom, mapIdProblem, sidePicture, typedColumns, viewBetween, MAX_SIDE, MIN_Y, MAX_Y, type Columns, type Grip } from "./select-box.ts";
import type { CustomShape } from "./shapes.ts";
import { el } from "./sidebar.ts";
import { ViewCube } from "./viewcube.ts";
import { buildVolume, HIDDEN, type FaceColors } from "./volume.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const worldParam = new URLSearchParams(location.search).get("world") ?? "";
const worldQuery = `world=${encodeURIComponent(worldParam)}`;

/** A map cut from the world, as the Panel lists them (selections.ts). */
interface SelectionInfo {
  target: string;
  targetName: string;
  map: string;
  name: string;
  box: { min: [number, number, number]; max: [number, number, number] };
  status: "queued" | "extracting" | "ready" | "failed" | "updating";
  error?: string;
}
/** A game (or the lobby) maps can be made for, from the editor's catalog. */
interface Target {
  id: string;
  name: string;
  maps: { id: string; name: string }[];
}

/** Pixels a block at most, and how far a grip reaches, in pixels. */
const MAX_SCALE = 24;
const GRIP_PIXELS = 7;
const DRAG_PIXELS = 4;
/** The last game exported for, kept in this browser. */
const GAME_STORE = "minecade-select-game";
const STATUS: Record<SelectionInfo["status"], { label: string; tone: "ok" | "warn" | "bad" }> = {
  queued: { label: "Queued", tone: "warn" },
  extracting: { label: "Cutting out", tone: "warn" },
  updating: { label: "Updating", tone: "warn" },
  ready: { label: "Ready", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
};

function show(text: string, bad = false): void {
  const message = $("message");
  message.textContent = text;
  message.className = bad ? "message bad" : "message";
  message.hidden = false;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function notice(text: string, bad = false): void {
  const box = $("notice");
  box.textContent = text;
  box.className = bad ? "notice bad" : "notice";
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (box.hidden = true), bad ? 9000 : 6000);
}

async function errorOf(response: Response): Promise<string> {
  const answer = (await response.json().catch(() => ({}))) as { error?: string };
  return answer.error ?? `HTTP ${response.status}`;
}

/** A plain color for a block with none in the table, from its name. */
function nameColor(name: string): number[] {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return [80 + (hash & 127), 80 + ((hash >> 7) & 127), 80 + ((hash >> 14) & 127)];
}

function css(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

async function main(): Promise<void> {
  // An open event stream counts this window as one of the Panel's.
  new EventSource("/api/events");
  const [overviewResponse, colorsResponse, catalogResponse] = await Promise.all([fetch(`/api/viewer/overview?${worldQuery}`), fetch("/api/viewer/colors"), fetch("/api/viewer/maps")]);
  if (!overviewResponse.ok) return show(`This world can't be shown: ${await errorOf(overviewResponse)}.`, true);
  const overview = decodeOverview(new Uint8Array(await overviewResponse.arrayBuffer()));
  const colors = (await colorsResponse.json().catch(() => ({ blocks: {} }))) as { blocks: Record<string, FaceColors>; textures?: Record<string, [number, number, number]> };
  const targets = catalogResponse.ok ? ((await catalogResponse.json()) as { targets: Target[] }).targets : [];
  const icon = el("img", { className: "banner-thumb", alt: "" });
  icon.onload = () => $("world-icon").replaceChildren(icon);
  icon.src = `/api/viewer/world-icon?${worldQuery}`;
  $("message").hidden = true;

  // ---- The picture: each column's top block, shaded by its height and by the slope toward the north west.
  const picture = document.createElement("canvas");
  picture.width = overview.width;
  picture.height = overview.depth;
  {
    const image = new ImageData(overview.width, overview.depth);
    const span = Math.max(1, overview.high - overview.low);
    const tops = overview.tops;
    const base = overview.names.map((name) => colors.blocks[name]?.[0] ?? nameColor(name));
    for (let i = 0; i < tops.length; i++) {
      const top = tops[i];
      if (top === NO_TOP) continue;
      const color = base[overview.blocks[i]];
      const behind = i > overview.width ? tops[i - overview.width - 1] : NO_TOP;
      const slope = behind === NO_TOP ? 0 : Math.max(-3, Math.min(3, top - behind));
      const shade = (0.62 + 0.38 * ((top - overview.low) / span)) * (1 + slope * 0.05);
      image.data[i * 4] = color[0] * shade;
      image.data[i * 4 + 1] = color[1] * shade;
      image.data[i * 4 + 2] = color[2] * shade;
      image.data[i * 4 + 3] = 255;
    }
    picture.getContext("2d")!.putImageData(image, 0, 0);
  }
  // Where the world has blocks (the chunks around them are often empty).
  const content = (() => {
    let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < overview.tops.length; i++) {
      if (overview.tops[i] === NO_TOP) continue;
      const x = i % overview.width;
      const z = Math.floor(i / overview.width);
      [x0, z0, x1, z1] = [Math.min(x0, x), Math.min(z0, z), Math.max(x1, x), Math.max(z1, z)];
    }
    return x0 === Infinity ? { x0: overview.x, z0: overview.z, x1: overview.x + overview.width - 1, z1: overview.z + overview.depth - 1 } : { x0: overview.x + x0, z0: overview.z + z0, x1: overview.x + x1, z1: overview.z + z1 };
  })();
  $("info").textContent = `${overview.width} x ${overview.depth} columns, blocks from y ${overview.low} to ${overview.high}`;

  const canvas = $<HTMLCanvasElement>("picture");
  const ctx = canvas.getContext("2d")!;
  /** Pixels a block, and where the world's x and z 0 are on the canvas (css pixels). */
  let scale = 1;
  let panX = 0;
  let panY = 0;
  const toScreen = (x: number, z: number) => ({ x: (x - overview.x) * scale + panX, y: (z - overview.z) * scale + panY });
  const toColumn = (sx: number, sy: number) => ({ x: Math.floor((sx - panX) / scale) + overview.x, z: Math.floor((sy - panY) / scale) + overview.z });
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  let box: Columns | undefined;
  let selections: SelectionInfo[] = [];
  const colorsOf = { primary: css("--primary", "#48c0f0"), ok: css("--ok", "#5ccf6e"), warn: css("--warn", "#f0b429"), bad: css("--bad", "#f0605a"), inset: css("--inset", "#0b1622"), text: "#ffffff" };

  /** Frames columns on the canvas, with a margin. */
  const fit = (area: Columns) => {
    const { width, height } = canvas.getBoundingClientRect();
    const size = columnsSize(area);
    scale = Math.min(MAX_SCALE, Math.max(0.05, Math.min((width - 80) / size.width, (height - 80) / size.depth)));
    panX = width / 2 - ((area.x0 + area.x1 + 1) / 2 - overview.x) * scale;
    panY = height / 2 - ((area.z0 + area.z1 + 1) / 2 - overview.z) * scale;
    draw();
  };

  let drawQueued = false;
  const draw = () => {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = devicePixelRatio;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = colorsOf.inset;
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = scale < 1;
      ctx.drawImage(picture, panX, panY, overview.width * scale, overview.depth * scale);
      // Every chunk's edge, up close.
      if (scale >= 6) {
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const first = toColumn(0, 0);
        const last = toColumn(width, height);
        for (let x = Math.ceil(first.x / 16) * 16; x <= last.x + 1; x += 16) {
          const sx = Math.round(toScreen(x, 0).x) + 0.5;
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, height);
        }
        for (let z = Math.ceil(first.z / 16) * 16; z <= last.z + 1; z += 16) {
          const sy = Math.round(toScreen(0, z).y) + 0.5;
          ctx.moveTo(0, sy);
          ctx.lineTo(width, sy);
        }
        ctx.stroke();
      }
      // The maps cut from the world, as named outlines.
      ctx.font = `600 13px ${css("--font", "sans-serif")}`;
      ctx.textBaseline = "bottom";
      for (const selection of selections) {
        const a = toScreen(selection.box.min[0], selection.box.min[2]);
        const b = toScreen(selection.box.max[0] + 1, selection.box.max[2] + 1);
        const tone = colorsOf[STATUS[selection.status]?.tone ?? "warn"];
        ctx.strokeStyle = tone;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(selection.status === "ready" ? [] : [6, 4]);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.setLineDash([]);
        const label = `${selection.name} (${selection.targetName})`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(6, 12, 20, 0.8)";
        ctx.fillRect(a.x, a.y - 20, textWidth + 12, 20);
        ctx.fillStyle = tone;
        ctx.fillRect(a.x, a.y - 20, 3, 20);
        ctx.fillStyle = colorsOf.text;
        ctx.fillText(label, a.x + 7, a.y - 4);
      }
      // The box, its grips and its size.
      if (box) {
        const a = toScreen(box.x0, box.z0);
        const b = toScreen(box.x1 + 1, box.z1 + 1);
        ctx.fillStyle = "rgba(72, 192, 240, 0.14)";
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.strokeStyle = colorsOf.primary;
        ctx.lineWidth = 2;
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.fillStyle = colorsOf.primary;
        for (const [gx, gy] of [[a.x, a.y], [b.x, a.y], [a.x, b.y], [b.x, b.y], [(a.x + b.x) / 2, a.y], [(a.x + b.x) / 2, b.y], [a.x, (a.y + b.y) / 2], [b.x, (a.y + b.y) / 2]]) ctx.fillRect(gx - 4, gy - 4, 8, 8);
        const size = columnsSize(box);
        const label = `${size.width} x ${size.depth}${size.width === MAX_SIDE || size.depth === MAX_SIDE ? " (the most)" : ""}`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(6, 12, 20, 0.85)";
        ctx.fillRect((a.x + b.x) / 2 - textWidth / 2 - 6, b.y + 6, textWidth + 12, 20);
        ctx.fillStyle = colorsOf.text;
        ctx.fillText(label, (a.x + b.x) / 2 - textWidth / 2, b.y + 22);
      }
    });
  };
  new ResizeObserver(draw).observe(canvas);
  fit(content);

  // ---- The box: drawn, moved and resized on the picture, or typed.
  const gripAt = (sx: number, sy: number): Grip | undefined => {
    if (!box) return undefined;
    const a = toScreen(box.x0, box.z0);
    const b = toScreen(box.x1 + 1, box.z1 + 1);
    const near = (p: number, q: number) => Math.abs(p - q) <= GRIP_PIXELS;
    const inX = sx >= a.x - GRIP_PIXELS && sx <= b.x + GRIP_PIXELS;
    const inY = sy >= a.y - GRIP_PIXELS && sy <= b.y + GRIP_PIXELS;
    if (!inX || !inY) return undefined;
    const ns = near(sy, a.y) ? "n" : near(sy, b.y) ? "s" : "";
    const we = near(sx, a.x) ? "w" : near(sx, b.x) ? "e" : "";
    if (ns || we) return `${ns}${we}` as Grip;
    return sx > a.x && sx < b.x && sy > a.y && sy < b.y ? "move" : undefined;
  };
  const CURSORS: Record<Grip, string> = { move: "move", n: "ns-resize", s: "ns-resize", w: "ew-resize", e: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };

  const setFields = () => {
    for (const key of ["x0", "z0", "x1", "z1"] as const) $<HTMLInputElement>(key).value = box ? String(box[key]) : "";
    const size = box && columnsSize(box);
    $("box-size").textContent = size ? `${size.width} x ${size.depth} blocks${size.width === MAX_SIDE || size.depth === MAX_SIDE ? `, the most a map can be (${MAX_SIDE})` : ""}` : "No box yet.";
  };
  for (const key of ["x0", "z0", "x1", "z1"] as const) {
    $<HTMLInputElement>(key).addEventListener("change", () => {
      const value = (id: string) => Number($<HTMLInputElement>(id).value);
      if (!["x0", "z0", "x1", "z1"].every((id) => $<HTMLInputElement>(id).value.trim() !== "" && Number.isFinite(value(id)))) return setFields();
      box = typedColumns(value("x0"), value("z0"), value("x1"), value("z1"));
      boxChanged();
    });
  }

  type Press = { button: number; x: number; y: number; moved: boolean; kind: "pan" | "draw" | "grip"; grip?: Grip; start?: { x: number; z: number }; from?: Columns; panX: number; panY: number };
  let press: Press | undefined;
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    const at = local(event);
    canvas.focus();
    if (event.button === 1 || event.button === 2) press = { button: event.button, ...at, moved: false, kind: "pan", panX, panY };
    else if (event.button === 0) {
      const grip = gripAt(at.x, at.y);
      press = grip ? { button: 0, ...at, moved: false, kind: "grip", grip, from: box, start: toColumn(at.x, at.y), panX, panY } : { button: 0, ...at, moved: false, kind: "draw", start: toColumn(at.x, at.y), panX, panY };
    } else return;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    const at = local(event);
    const column = toColumn(at.x, at.y);
    if (press) {
      if (!press.moved && Math.hypot(at.x - press.x, at.y - press.y) <= DRAG_PIXELS) return;
      press.moved = true;
      if (press.kind === "pan") {
        panX = press.panX + at.x - press.x;
        panY = press.panY + at.y - press.y;
        canvas.classList.add("grab");
      } else if (press.kind === "draw") box = columnsFrom(press.start!, column);
      else if (press.from && press.grip) box = dragColumns(press.from, press.grip, column.x - press.start!.x, column.z - press.start!.z);
      if (press.kind !== "pan") setFields();
      draw();
    } else canvas.style.cursor = CURSORS[gripAt(at.x, at.y) as Grip] ?? "";
    // What's under the pointer.
    const px = column.x - overview.x;
    const pz = column.z - overview.z;
    const inside = px >= 0 && pz >= 0 && px < overview.width && pz < overview.depth;
    const top = inside ? overview.tops[pz * overview.width + px] : NO_TOP;
    $("hover").textContent = `x ${column.x}, z ${column.z}${top !== NO_TOP ? `: ${overview.names[overview.blocks[pz * overview.width + px]].replace(/^minecraft:/, "")}, top at y ${top}` : ""}`;
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!press) return;
    const done = press;
    press = undefined;
    canvas.classList.remove("grab");
    if (done.kind === "pan" || !done.moved) {
      // A click (no drag) leaves the box as it is.
      return;
    }
    void event;
    boxChanged();
  });
  canvas.addEventListener("pointerleave", () => ($("hover").textContent = ""));
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const at = local(event);
      const next = Math.min(MAX_SCALE, Math.max(0.05, scale * Math.exp(-event.deltaY * 0.0015)));
      panX = at.x - ((at.x - panX) / scale) * next;
      panY = at.y - ((at.y - panY) / scale) * next;
      scale = next;
      draw();
    },
    { passive: false },
  );
  const fitNow = () => (mode === "3d" ? scene?.view("home") : fit(box ?? content));
  $("fit").onclick = fitNow;
  addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === "Home") {
      fitNow();
      event.preventDefault();
    }
  });

  // ---- The height: the box's blocks, trimmed, seen from the south with a floor and a ceiling.
  let boxView: View | undefined;
  let trim: { low: number; high: number } | undefined;
  let floor = 0;
  let ceiling = 0;
  let loadToken = 0;
  const hiddenLook = (view: View) => {
    const hidden = view.looks.map((look) => HIDDEN.test(look.name));
    return (look: number) => hidden[look] ?? true;
  };
  const boxText = () => (box ? `${box.x0},${MIN_Y},${box.z0},${box.x1},${MAX_Y},${box.z1}` : "");

  function boxChanged(): void {
    setFields();
    draw();
    validate();
    if (!box) return;
    const token = ++loadToken;
    boxView = undefined;
    trim = undefined;
    $("height-section").hidden = false;
    $("export-section").hidden = false;
    $("trim-note").textContent = "Reading the blocks in the box...";
    drawSide();
    $<HTMLButtonElement>("tab-3d").disabled = true;
    void (async () => {
      const response = await fetch(`/api/viewer/select/view?${worldQuery}&box=${boxText()}`).catch(() => undefined);
      if (token !== loadToken) return;
      if (!response?.ok) {
        $("trim-note").textContent = response ? `${(await errorOf(response)).replace(/^./, (c) => c.toUpperCase())}.` : "The Panel didn't answer.";
        drawSide();
        validate();
        if (mode === "3d") setMode("above");
        return;
      }
      boxView = decodeView(new Uint8Array(await response.arrayBuffer()));
      if (token !== loadToken) return;
      trim = { low: boxView.box.min[1], high: boxView.box.max[1] };
      floor = trim.low;
      ceiling = trim.high;
      heightChanged();
      $<HTMLButtonElement>("tab-3d").disabled = false;
    })();
  }

  /** The floor or ceiling changed: the fields, the side picture, Export's check, and the 3D look. */
  function heightChanged(): void {
    $<HTMLInputElement>("floor").value = String(floor);
    $<HTMLInputElement>("ceiling").value = String(ceiling);
    if (trim) $("trim-note").textContent = `Blocks from y ${trim.low} to ${trim.high}${floor !== trim.low || ceiling !== trim.high ? `; kept: y ${floor} to ${ceiling} (${ceiling - floor + 1} high)` : ` (${trim.high - trim.low + 1} high)`}. Drag the floor up past ground you don't want.`;
    drawSide();
    validate();
    if (mode === "3d") void buildLook();
  }
  for (const which of ["floor", "ceiling"] as const) {
    $<HTMLInputElement>(which).addEventListener("change", () => {
      const value = Number($<HTMLInputElement>(which).value);
      if (!Number.isFinite(value)) return heightChanged();
      ({ floor, ceiling } = heightRange(which === "floor" ? value : floor, which === "ceiling" ? value : ceiling, which));
      heightChanged();
    });
  }
  $("trim").onclick = () => {
    if (!trim) return;
    floor = trim.low;
    ceiling = trim.high;
    heightChanged();
  };

  // The picture from the south: a pixel row per layer, rows from the top; the floor and ceiling lines drag.
  const side = $<HTMLCanvasElement>("side");
  const sideCtx = side.getContext("2d")!;
  /** Where the side picture sits on its canvas: the layers it shows and their scale. */
  let sideFrame: { low: number; high: number; scale: number; left: number; top: number; width: number; height: number } | undefined;
  let sideDrag: "floor" | "ceiling" | undefined;
  function drawSide(): void {
    const { width, height } = side.getBoundingClientRect();
    const ratio = devicePixelRatio;
    side.width = Math.round(width * ratio);
    side.height = Math.round(height * ratio);
    sideCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    sideCtx.clearRect(0, 0, width, height);
    sideFrame = undefined;
    if (!box || !boxView || !trim) return;
    const low = Math.max(MIN_Y, Math.min(trim.low, floor) - 2);
    const high = Math.min(MAX_Y, Math.max(trim.high, ceiling) + 2);
    const picture = sidePicture(boxView, box, low, high, hiddenLook(boxView));
    const image = new ImageData(picture.width, picture.height);
    for (let i = 0; i < picture.looks.length; i++) {
      const look = picture.looks[i];
      if (!look) continue;
      const name = boxView.looks[look].name;
      const color = colors.blocks[name]?.[2] ?? nameColor(name);
      const shade = 1 - (Math.min(picture.depth[i], 96) / 96) * 0.6;
      image.data.set([color[0] * shade, color[1] * shade, color[2] * shade, 255], i * 4);
    }
    const bitmap = document.createElement("canvas");
    bitmap.width = picture.width;
    bitmap.height = picture.height;
    bitmap.getContext("2d")!.putImageData(image, 0, 0);
    const scale = Math.min((width - 16) / picture.width, (height - 16) / picture.height);
    const frame = { low, high, scale, left: (width - picture.width * scale) / 2, top: (height - picture.height * scale) / 2, width: picture.width * scale, height: picture.height * scale };
    sideFrame = frame;
    sideCtx.imageSmoothingEnabled = scale < 1;
    sideCtx.drawImage(bitmap, frame.left, frame.top, frame.width, frame.height);
    // What's left out is dimmed; the floor (under its layer) and the ceiling (over its layer) are lines.
    const yAt = (layer: number) => frame.top + (high + 1 - layer) * scale;
    sideCtx.fillStyle = "rgba(4, 10, 18, 0.62)";
    sideCtx.fillRect(frame.left, frame.top, frame.width, yAt(ceiling + 1) - frame.top);
    sideCtx.fillRect(frame.left, yAt(floor), frame.width, frame.top + frame.height - yAt(floor));
    const green = css("--axis-y", "#5ccf6e");
    sideCtx.font = `600 12px ${css("--font", "sans-serif")}`;
    for (const [layer, label, edge] of [[ceiling + 1, `Ceiling ${ceiling}`, "ceiling"], [floor, `Floor ${floor}`, "floor"]] as const) {
      const y = Math.round(yAt(layer)) + 0.5;
      sideCtx.strokeStyle = green;
      sideCtx.lineWidth = sideDrag === edge ? 3 : 2;
      sideCtx.beginPath();
      sideCtx.moveTo(frame.left - 6, y);
      sideCtx.lineTo(frame.left + frame.width + 6, y);
      sideCtx.stroke();
      const textWidth = sideCtx.measureText(label).width;
      sideCtx.fillStyle = "rgba(6, 12, 20, 0.85)";
      const ty = edge === "ceiling" ? y - 18 : y + 2;
      sideCtx.fillRect(frame.left, ty, textWidth + 10, 16);
      sideCtx.fillStyle = green;
      sideCtx.fillText(label, frame.left + 5, ty + 12);
    }
  }
  const layerAt = (clientY: number) => {
    if (!sideFrame) return undefined;
    const rect = side.getBoundingClientRect();
    return Math.round(sideFrame.high + 1 - (clientY - rect.top - sideFrame.top) / sideFrame.scale);
  };
  side.addEventListener("pointerdown", (event) => {
    const layer = layerAt(event.clientY);
    if (layer === undefined) return;
    // The nearer line: the ceiling's is over its layer, the floor's under it.
    sideDrag = Math.abs(layer - (ceiling + 1)) < Math.abs(layer - floor) ? "ceiling" : "floor";
    side.setPointerCapture(event.pointerId);
    moveLine(event.clientY);
  });
  const moveLine = (clientY: number) => {
    const layer = layerAt(clientY);
    if (layer === undefined || !sideDrag || !sideFrame) return;
    const clamped = Math.max(sideFrame.low, Math.min(sideFrame.high + 1, layer));
    ({ floor, ceiling } = sideDrag === "floor" ? heightRange(clamped, ceiling, "floor") : heightRange(floor, clamped - 1, "ceiling"));
    $<HTMLInputElement>("floor").value = String(floor);
    $<HTMLInputElement>("ceiling").value = String(ceiling);
    drawSide();
  };
  side.addEventListener("pointermove", (event) => {
    if (sideDrag) moveLine(event.clientY);
  });
  side.addEventListener("pointerup", () => {
    if (!sideDrag) return;
    sideDrag = undefined;
    heightChanged();
  });
  new ResizeObserver(() => drawSide()).observe(side);

  // ---- The 3D look: the blocks from the floor to the ceiling, in the viewer's own drawing.
  let mode: "above" | "3d" = "above";
  let scene: MapScene | undefined;
  let built = "";
  let building: Promise<void> | undefined;
  const cube = new ViewCube($<HTMLCanvasElement>("cube"), (direction) => scene?.viewFrom(direction));
  const setMode = (next: "above" | "3d") => {
    mode = next;
    $("tab-above").setAttribute("aria-selected", String(next === "above"));
    $("tab-3d").setAttribute("aria-selected", String(next === "3d"));
    $("picture").hidden = next !== "above";
    $("look").hidden = next !== "3d";
    $("cube-wrap").hidden = next !== "3d";
    if (next === "3d") void buildLook();
    else draw();
  };
  $("tab-above").onclick = () => setMode("above");
  $("tab-3d").onclick = () => setMode("3d");
  async function buildLook(): Promise<void> {
    if (!box || !boxView) return;
    const key = `${boxText()} ${floor} ${ceiling}`;
    if (key === built) return;
    if (building) await building;
    if (key === built || mode !== "3d") return;
    building = (async () => {
      built = key;
      show("Meshing...");
      const shapesResponse = await fetch(`/api/viewer/select/shapes?${worldQuery}&box=${boxText()}`).catch(() => undefined);
      const shapes = shapesResponse?.ok ? ((await shapesResponse.json()) as { shapes: Record<string, CustomShape> }).shapes : {};
      const between = viewBetween(boxView!, floor, ceiling);
      if (between.list.length === 0) return show("There are no blocks from the floor to the ceiling.", true);
      // A fresh canvas each time: the last one's drawing is let go.
      if (scene) {
        scene.renderer.dispose();
        scene.renderer.forceContextLoss();
      }
      const old = $<HTMLCanvasElement>("look");
      const fresh = old.cloneNode() as HTMLCanvasElement;
      old.replaceWith(fresh);
      const volume = buildVolume(between, colors.blocks, shapes, colors.textures);
      const next = new MapScene(fresh, volume);
      const workers = Array.from({ length: Math.max(2, Math.min(8, navigator.hardwareConcurrency - 1)) }, () => new Worker("/viewer/worker.js", { type: "module" }));
      try {
        await next.build(workers);
      } finally {
        for (const worker of workers) worker.terminate();
      }
      scene = next;
      next.addRenderListener(() => cube.sync(next.cameraQuaternion));
      next.view("home");
      $("message").hidden = true;
    })();
    try {
      await building;
    } catch (error) {
      built = "";
      show(`The 3D look stopped: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      building = undefined;
    }
  }

  // ---- Export to map: the game, a name and an id, as in-game Select's Export to Map asks.
  const gameSelect = $<HTMLSelectElement>("game");
  // The games first, the lobby last.
  gameSelect.replaceChildren(...[...targets.filter((target) => target.id !== "lobby"), ...targets.filter((target) => target.id === "lobby")].map((target) => el("option", { value: target.id }, target.name)));
  try {
    const last = localStorage.getItem(GAME_STORE);
    if (last && targets.some((target) => target.id === last)) gameSelect.value = last;
  } catch {
    // The first game, then.
  }
  const nameInput = $<HTMLInputElement>("map-name");
  const idInput = $<HTMLInputElement>("map-id");
  let idTyped = false;
  nameInput.addEventListener("input", () => {
    if (!idTyped) idInput.value = mapIdFrom(nameInput.value);
    validate();
  });
  idInput.addEventListener("input", () => {
    idTyped = idInput.value !== "" && idInput.value !== mapIdFrom(nameInput.value);
    validate();
  });
  gameSelect.addEventListener("change", () => {
    try {
      localStorage.setItem(GAME_STORE, gameSelect.value);
    } catch {
      // Not kept.
    }
    validate();
  });
  /** Why Export can't go yet (the first thing missing), or undefined. */
  function exportProblem(): string | undefined {
    if (!box) return "Draw a box first.";
    if (!boxView || !trim) return "The box has no blocks.";
    const target = targets.find((candidate) => candidate.id === gameSelect.value);
    if (!target) return "Pick a game.";
    if (!nameInput.value.trim()) return "The map needs a name.";
    const taken = [...target.maps.map((map) => map.id), ...selections.filter((selection) => selection.target === target.id).map((selection) => selection.map)];
    return mapIdProblem(idInput.value.trim(), taken);
  }
  function validate(): void {
    const problem = exportProblem();
    const line = $("export-problem");
    // Nothing typed yet isn't a problem to point out.
    line.hidden = !problem || (!nameInput.value.trim() && !idInput.value.trim());
    line.textContent = problem ?? "";
    $<HTMLButtonElement>("export").disabled = problem !== undefined;
  }
  /** Exports waiting to open in the viewer when they're ready ("target/map"). */
  const toOpen = new Set<string>();
  $("export").onclick = async () => {
    const problem = exportProblem();
    if (problem || !box) return notice(problem ?? "Draw a box first.", true);
    const body = { world: worldParam, box: { min: [box.x0, floor, box.z0], max: [box.x1, ceiling, box.z1] }, target: gameSelect.value, map: idInput.value.trim(), name: nameInput.value.trim() };
    $<HTMLButtonElement>("export").disabled = true;
    const response = await fetch("/api/viewer/select/export", { method: "POST", headers: { "content-type": "application/json", "x-minecade-panel": "1" }, body: JSON.stringify(body) }).catch(() => undefined);
    if (!response?.ok) {
      validate();
      return notice(response ? `Not exported: ${await errorOf(response)}.` : "The Panel didn't answer.", true);
    }
    const answer = (await response.json()) as { message: string };
    if ($<HTMLInputElement>("open-when-ready").checked) toOpen.add(`${body.target}/${body.map}`);
    notice(answer.message);
    nameInput.value = "";
    idInput.value = "";
    idTyped = false;
    await loadMaps();
  };

  // ---- The maps cut from this world (in-game Select's and these), and how each export is going.
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  async function loadMaps(): Promise<void> {
    clearTimeout(pollTimer);
    const response = await fetch(`/api/viewer/select/maps?${worldQuery}`).catch(() => undefined);
    if (response?.ok) {
      const answer = (await response.json()) as { world: string; selections: SelectionInfo[] };
      selections = answer.selections;
      document.title = `${answer.world}: Select from above`;
      $("world-name").textContent = answer.world;
      renderMaps();
      draw();
      validate();
      for (const selection of selections) {
        const key = `${selection.target}/${selection.map}`;
        if (!toOpen.has(key)) continue;
        if (selection.status === "ready") {
          toOpen.delete(key);
          location.href = `/viewer?${new URLSearchParams({ target: selection.target, map: selection.map, name: selection.name, game: selection.targetName })}`;
          return;
        }
        if (selection.status === "failed") {
          toOpen.delete(key);
          notice(`${selection.name} failed: ${selection.error ?? "no reason given"}`, true);
        }
      }
    }
    const busy = selections.some((selection) => selection.status === "queued" || selection.status === "extracting" || selection.status === "updating");
    pollTimer = setTimeout(() => void loadMaps(), busy ? 2000 : 15000);
  }
  const post = async (action: "retry" | "forget", selection: SelectionInfo) => {
    const response = await fetch(`/api/viewer/select/${action}`, { method: "POST", headers: { "content-type": "application/json", "x-minecade-panel": "1" }, body: JSON.stringify({ world: worldParam, target: selection.target, map: selection.map }) }).catch(() => undefined);
    if (!response?.ok) notice(response ? await errorOf(response) : "The Panel didn't answer.", true);
    await loadMaps();
  };
  function renderMaps(): void {
    $("maps").replaceChildren(
      ...(selections.length === 0
        ? [el("li", {}, el("p", { className: "empty" }, "None yet."))]
        : selections.map((selection) => {
            const status = STATUS[selection.status] ?? { label: selection.status, tone: "warn" };
            const box = selection.box;
            const size = `${box.max[0] - box.min[0] + 1} x ${box.max[1] - box.min[1] + 1} x ${box.max[2] - box.min[2] + 1}`;
            return el(
              "li",
              { className: "map-row" },
              el("span", { className: "name" }, `${selection.name} (${selection.map})`),
              el("span", { className: `pill ${status.tone}` }, status.label),
              el("span", { className: "detail" }, `${selection.targetName}, ${size}`),
              selection.error ? el("span", { className: "error" }, selection.error) : null,
              el(
                "div",
                { className: "row-buttons" },
                el("button", { className: "small", dataset: { tip: "Show it on the picture" }, onclick: () => (setMode("above"), fit({ x0: box.min[0], z0: box.min[2], x1: box.max[0], z1: box.max[2] })) }, "Show"),
                selection.status === "ready" ? el("button", { className: "small", dataset: { tip: "Open it in the 3D viewer" }, onclick: () => (location.href = `/viewer?${new URLSearchParams({ target: selection.target, map: selection.map, name: selection.name, game: selection.targetName })}`) }, "Open") : null,
                selection.status === "failed" ? el("button", { className: "small", onclick: () => void post("retry", selection) }, "Retry") : null,
                selection.status === "failed" ? el("button", { className: "small", dataset: { tip: "Take it off this world's list" }, onclick: () => void post("forget", selection) }, "Forget") : null,
              ),
            );
          })),
    );
  }

  setFields();
  validate();
  await loadMaps();
  canvas.focus();
}

main().catch((error: unknown) => show(`Select from above stopped: ${error instanceof Error ? error.message : String(error)}`, true));
