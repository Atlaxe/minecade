// What the viewer draws over a map's blocks and lists beside them: every list game Edit's tools
// place into (its pack's lists.ts and regions.ts, so the labels, colors and order are game Edit's),
// each entry as a point, a box or a height, and the game's checklist. Plain data of the map and
// its rules, rebuilt after every change; the overlay draws it and the side panel lists it.
import {
  BUILD_LIMIT_SIDES,
  boxSize,
  facingOf,
  mapChecklist,
  positionText,
  regionMinSize,
  stripColors,
  type Box,
  type BuildLimitSide,
  type Checklist,
  type EditorRules,
  type MapConfig,
} from "@minecade/minigame-core/config";
import { MARKER_STYLES, compass, markerSpecs, spawnLists, type SpawnList } from "../../../editor/behavior_pack/scripts/lists.ts";
import {
  BOUNDS_COLOR,
  BUILD_LIMIT_COLOR,
  KILL_COLOR,
  SPECTATOR_BOUNDS_COLOR,
  regionColors,
  regionEntries,
  regionTargets,
  targetKeyOf,
  type HeightLine,
  type RegionEntry,
  type RegionTarget,
  type Rgb,
} from "../../../editor/behavior_pack/scripts/regions.ts";
import type { BoxPlace } from "./boxes.ts";

/** Game Edit's marker colors by what they mark (editor/resource_pack/textures/entity/editor_marker*.png). */
export const KIND_COLORS = { spawns: 0xffaa1e, spectatorSpawn: 0xafb9cd, queueSpawn: 0x3cc8ff, teamSpawns: 0x5adc5a, points: 0xffe63c } as const;
/** The facing line's color (editor_marker_facing.png). */
export const FACING_COLOR = 0xff2828;

/** How a point's marker is drawn: game Edit's mannequin or post, or one of the game's own models. */
export type Shape = { kind: "player" } | { kind: "post" } | { kind: "model"; model: string };

export interface PointMark {
  /** "<list key>#<index>", as game Edit keys its markers: "spawns#0", "points.hole.red#1". */
  key: string;
  list: string;
  index: number;
  /** Its name over it: "Spawn 1", "Queue spawn (lock in, 5 s)". */
  label: string;
  /** Where it stands: the exact point, or the middle of its block (y the feet). */
  at: { x: number; y: number; z: number };
  /** Its facing in degrees, or where it looks without one (the map's middle). */
  yaw: number;
  pitch: number;
  /** It has a facing of its own. */
  faced: boolean;
  color: number;
  shape: Shape;
}

export interface BoxMark {
  /** "bounds#0", "spectatorBounds#1", "regions.kill#0". */
  key: string;
  list: string;
  label: string;
  box: Box;
  color: number;
  /** Where the map keeps it (game Edit's Region tool's entry): the edits that change it name this. */
  entry: RegionEntry;
  /** Regions: the fewest blocks it must span along every side. */
  minSize?: number;
}

export interface PlaneMark {
  /** "killY", "buildLimit.above" or "buildLimit.below". */
  key: string;
  line: HeightLine;
  label: string;
  y: number;
  color: number;
}

export interface MarkupEntry {
  key: string;
  label: string;
  /** Where it is: "3 65 -2, faces south", "12 x 5 x 30 at 0 60 0", "y 12". */
  detail: string;
}

export interface MarkupList {
  /** Its place in map.json, and its checklist row's key: "spawns", "teamSpawns.red", "points.hole.red", "bounds", "regions.kill", "killY". */
  key: string;
  label: string;
  kind: "points" | "boxes" | "plane";
  color: number;
  entries: MarkupEntry[];
  /** Points: the list as game Edit's Spawn and Game marker tools have it, and how its markers are drawn. */
  spawn?: SpawnList;
  shape?: Shape;
  /** Boxes: where game Edit's Region tool saves a box, and where a new one goes. */
  region?: RegionTarget;
  place?: BoxPlace;
  /** Heights: which line. */
  line?: HeightLine;
  /** The checklist's row for it: entries needed, and whether that's met. */
  need?: number;
  done?: boolean;
  /** Regions: the fewest blocks a box spans along every side. */
  minSize?: number;
}

export interface MarkupSection {
  title: string;
  lists: MarkupList[];
}

export interface Markup {
  points: PointMark[];
  boxes: BoxMark[];
  planes: PlaneMark[];
  sections: MarkupSection[];
  checklist: Checklist;
}

export function buildMarkup(config: MapConfig, rules: EditorRules): Markup {
  const checklist = mapChecklist(config, rules);
  const row = (key: string) => checklist.rows.find((candidate) => candidate.key === key);
  const need = (key: string) => {
    const found = row(key);
    return found ? { need: found.need, done: found.done } : {};
  };

  // Points: game Edit's Spawn tool's lists, then its Game marker tool's.
  const lists = spawnLists(config, rules);
  const models = Object.fromEntries(Object.entries(rules.markerModels ?? {}).map(([model, style]) => [style, model]));
  const points: PointMark[] = markerSpecs(config, lists).map((spec) => {
    const facing = spec.facing ?? spec.look;
    return {
      key: spec.key,
      list: spec.list.key,
      index: spec.index,
      label: stripColors(spec.label.split("\n")[0]),
      at: spec.at,
      yaw: facing?.yaw ?? 0,
      pitch: spec.facing?.pitch ?? 0,
      faced: spec.facing !== undefined,
      color: pointColor(spec.list),
      shape: shapeOf(spec.list.style, models),
    };
  });
  const pointList = (list: SpawnList): MarkupList => ({
    key: list.key,
    label: list.label,
    kind: "points",
    color: pointColor(list),
    spawn: list,
    shape: shapeOf(list.style, models),
    entries: points.filter((point) => point.list === list.key).map((point) => ({ key: point.key, label: point.label, detail: pointDetail(config, list, point.index) ?? "" })),
    ...need(list.key),
  });

  // Boxes: the bounds, the spectator bounds, then each region (kill first), as game Edit's Region tool lists them.
  const entries = regionEntries(config, rules);
  const colors = regionColors(config, rules);
  const boxes: BoxMark[] = entries.map((entry) => {
    const list = targetKeyOf(entry);
    const color = entry.region ? (colors.get(entry.region.name) ?? BOUNDS_COLOR) : entry.spectators ? SPECTATOR_BOUNDS_COLOR : BOUNDS_COLOR;
    const minSize = entry.region ? regionMinSize(rules.requires, entry.region.name) : undefined;
    return { key: entry.key, list, label: entry.label, box: entry.box, color: hex(color), entry, ...(minSize !== undefined ? { minSize } : {}) };
  });
  const targets = regionTargets(config, rules).filter((target) => target.kind !== "addBounds" && target.kind !== "new");
  const boxLists: MarkupList[] = targets.map((target) => {
    const color = target.kind === "region" ? (colors.get(target.name ?? "") ?? BOUNDS_COLOR) : target.kind === "spectatorBounds" ? SPECTATOR_BOUNDS_COLOR : BOUNDS_COLOR;
    const label = target.kind === "bounds" ? "Bounds" : target.kind === "spectatorBounds" ? "Spectator bounds" : target.label;
    const minSize = target.kind === "region" ? regionMinSize(rules.requires, target.name ?? "") : undefined;
    return {
      key: target.key,
      label,
      kind: "boxes",
      color: hex(color),
      region: target,
      place: target.kind === "region" ? { kind: "region", name: target.name ?? "" } : target.kind === "spectatorBounds" ? { kind: "spectatorBounds" } : { kind: "bounds" },
      entries: boxes.filter((box) => box.list === target.key).map((box) => ({ key: box.key, label: box.label, detail: boxText(box.box) })),
      ...need(target.key),
      ...(minSize !== undefined ? { minSize } : {}),
    };
  });

  // Heights: kill Y, and on a game's map the build limit's sides.
  const planes: PlaneMark[] = [];
  const heightLists: MarkupList[] = [];
  const lines: HeightLine[] = ["killY", ...(rules.kind === "game" || config.buildLimit !== undefined ? BUILD_LIMIT_SIDES : [])];
  for (const line of lines) {
    const key = line === "killY" ? "killY" : `buildLimit.${line}`;
    const label = line === "killY" ? "Kill Y" : `Build limit ${line}`;
    const color = hex(line === "killY" ? KILL_COLOR : BUILD_LIMIT_COLOR);
    const y = line === "killY" ? config.killY : config.buildLimit?.[line as BuildLimitSide];
    if (typeof y === "number") planes.push({ key, line, label, y, color });
    heightLists.push({ key, label, kind: "plane", color, line, entries: typeof y === "number" ? [{ key, label, detail: `y ${y}` }] : [], ...need(key) });
  }

  const spawnSection = lists.filter((list) => list.tool === "spawn").map(pointList);
  const markerSection = lists.filter((list) => list.tool === "marker").map(pointList);
  const sections: MarkupSection[] = [
    { title: "Spawns", lists: spawnSection },
    ...(markerSection.length > 0 ? [{ title: "Game markers", lists: markerSection }] : []),
    { title: "Boundaries", lists: [...boxLists, ...heightLists] },
  ];
  return { points, boxes, planes, sections, checklist };
}

/** A point list's marker color: a team's (its tint), else its kind's. */
function pointColor(list: SpawnList): number {
  return list.tint ?? KIND_COLORS[list.target.list];
}

/** A marker style's shape: game Edit's mannequin or post, or a game's model by its number. */
function shapeOf(style: number, models: Record<number, string>): Shape {
  if (style === MARKER_STYLES.player) return { kind: "player" };
  const model = models[style];
  return model ? { kind: "model", model } : { kind: "post" };
}

/** An entry's place for the side panel: "3 65 -2", "3.27 65 -1.84, faces south". */
function pointDetail(config: MapConfig, list: SpawnList, index: number): string | undefined {
  const position = listEntry(config, list, index);
  if (!position) return undefined;
  const facing = facingOf(position);
  return `${positionText(position)}${facing ? `, faces ${compass(facing.yaw)}` : ""}`;
}

function listEntry(config: MapConfig, list: SpawnList, index: number) {
  switch (list.target.list) {
    case "spawns":
      return config.spawns?.[index];
    case "spectatorSpawn":
      return index === 0 ? config.spectatorSpawn : undefined;
    case "queueSpawn":
      return index === 0 ? config.queueSpawn : undefined;
    case "teamSpawns":
      return config.teamSpawns?.[list.target.team]?.[index];
    case "points":
      return config.points?.[list.target.name]?.[index];
  }
}

/** "12 x 5 x 30 from 0 60 0". */
export function boxText(box: Box): string {
  return `${boxSize(box).join(" x ")} from ${box.min.join(" ")}`;
}

export function hex(color: Rgb): number {
  return (Math.round(color.red * 255) << 16) | (Math.round(color.green * 255) << 8) | Math.round(color.blue * 255);
}

/** A list's entry by key, with its list. */
export function findEntry(markup: Markup, key: string): { list: MarkupList; entry: MarkupEntry } | undefined {
  for (const section of markup.sections) {
    for (const list of section.lists) {
      const entry = list.entries.find((candidate) => candidate.key === key);
      if (entry) return { list, entry };
    }
  }
  return undefined;
}
