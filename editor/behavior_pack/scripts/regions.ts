// The boxes a map has (its bounds and regions), where the region tool can save a box, and the
// colors their outlines are drawn in: pure functions of the map and its rules, so they can be
// tested without a server.
import { KILL_REGION, enclosingBox, mapRequirements, type Box, type EditorRules, type MapConfig, type MapRequirement } from "@minecade/minigame-core/config";
import { dangerText } from "./marks.ts";

/** An outline color, each part from 0 to 1 (the script API's RGB). */
export interface Rgb {
  red: number;
  green: number;
  blue: number;
}

export const SELECTION_COLOR = rgb(0xffff55);
export const BOUNDS_COLOR = rgb(0xffffff);
/** A deeper red than any team's (§c is 0xff5555), so a red team's region doesn't read as a kill region. */
export const KILL_COLOR = rgb(0xd00000);
/** Regions without a team take these in turn. White, red and yellow are kept for the bounds, kill and the selection. */
const PALETTE = [0x55ffff, 0x55ff55, 0xff55ff, 0x5555ff, 0xffaa00, 0x00aaaa, 0x00aa00, 0xaa00aa].map(rgb);
/** The colors of the § color codes teams use. */
const CODE_COLORS: Record<string, number> = {
  "0": 0x000000,
  "1": 0x0000aa,
  "2": 0x00aa00,
  "3": 0x00aaaa,
  "4": 0xaa0000,
  "5": 0xaa00aa,
  "6": 0xffaa00,
  "7": 0xaaaaaa,
  "8": 0x555555,
  "9": 0x5555ff,
  a: 0x55ff55,
  b: 0x55ffff,
  c: 0xff5555,
  d: 0xff55ff,
  e: 0xffff55,
  f: 0xffffff,
};

/**
 * Where the region tool can save a box: the bounds (replacing them all), another bounds box, a
 * region (as a new entry in its list), or a region named in the form.
 */
export interface RegionTarget {
  /** "bounds", "addBounds", "regions.<name>" (the checklist's key for it), or "new". */
  key: string;
  label: string;
  kind: "bounds" | "addBounds" | "region" | "new";
  /** The region's name, for kind "region". */
  name?: string;
}

export type SelectionAction = "saveChanges" | "saveAs" | "nudge" | "floor" | "back" | "clear";

/**
 * What a selection offers, in the region form and the map menu: Save changes while it edits a
 * saved box (`editing` is that box's label), Floor at kill Y when the map has one, and Back one
 * step after `steps` changes.
 */
export function selectionActions(editing: string | undefined, steps: number, killY: number | undefined): { action: SelectionAction; text: string }[] {
  return [
    ...(editing ? [{ action: "saveChanges" as const, text: `Save changes\n§7to ${editing}` }] : []),
    { action: "saveAs", text: "Save as...\n§7bounds, a region or a kill region" },
    { action: "nudge", text: "Nudge sides" },
    ...(killY === undefined ? [] : [{ action: "floor" as const, text: `Floor at kill Y\n§7bottom at y ${killY}` }]),
    ...(steps > 0 ? [{ action: "back" as const, text: "Back one step" }] : []),
    { action: "clear", text: dangerText("Clear selection") },
  ];
}

/** The bounds (and another bounds box), the kill region, the regions the rules ask for, any others the map has, then a new one. */
export function regionTargets(config: MapConfig, rules: EditorRules): RegionTarget[] {
  const bounds = boundsEntries(config).length;
  return [
    { key: "bounds", label: bounds > 1 ? `Bounds (replaces all ${bounds} boxes)` : "Bounds", kind: "bounds" },
    ...(bounds > 0 ? [{ key: "addBounds", label: "Add to bounds (another box)", kind: "addBounds" } as const] : []),
    ...regionNames(config, rules).map((name): RegionTarget => ({ key: `regions.${name}`, label: regionLabel(name, rules), kind: "region", name })),
    { key: "new", label: "New region...", kind: "new" },
  ];
}

/** A box the map has: a bounds box, or entry `index` of the region `name`. */
export interface RegionEntry {
  /** "bounds#<index>", or "regions.<name>#<index>". */
  key: string;
  /** "Bounds", "Bounds 2", "Kill region 2", "Buy zone (Red) 1". */
  label: string;
  box: Box;
  /** Undefined for a bounds box. */
  region?: { name: string; index: number };
  /** A bounds box's place among them. */
  bounds?: number;
}

/** Every box the map has: the bounds boxes first, then each region's boxes, in regionTargets' order. */
export function regionEntries(config: MapConfig, rules: EditorRules): RegionEntry[] {
  const entries: RegionEntry[] = boundsEntries(config);
  const regions = regionsOf(config);
  for (const name of regionNames(config, rules)) {
    const list = regions[name];
    if (!Array.isArray(list)) continue;
    const label = regionLabel(name, rules);
    list.forEach((box: unknown, index) => {
      if (isBox(box)) entries.push({ key: `regions.${name}#${index}`, label: `${label} ${index + 1}`, box, region: { name, index } });
    });
  }
  return entries;
}

/** The box at an entry's place in the map now, if there is one. */
export function entryBox(config: MapConfig, entry: RegionEntry): Box | undefined {
  const box: unknown = entry.region ? regionsOf(config)[entry.region.name]?.[entry.region.index] : boundsOf(config)[entry.bounds ?? 0];
  return isBox(box) ? box : undefined;
}

/** The box around every bounds box (the kill Y plane is drawn over it), if the map has bounds. */
export function boundsAround(config: MapConfig): Box | undefined {
  return enclosingBox(boundsEntries(config).map((entry) => entry.box));
}

/** The bounds boxes: "Bounds" when there's one, "Bounds 1", "Bounds 2" when there are several. */
function boundsEntries(config: MapConfig): RegionEntry[] {
  const list = boundsOf(config);
  const entries: RegionEntry[] = [];
  list.forEach((box, index) => {
    if (isBox(box)) entries.push({ key: `bounds#${index}`, label: list.length > 1 ? `Bounds ${index + 1}` : "Bounds", box, bounds: index });
  });
  return entries;
}

/** "bounds" as a list, whether the map has one box or several. */
function boundsOf(config: MapConfig): unknown[] {
  const bounds: unknown = config.bounds;
  return bounds === undefined ? [] : Array.isArray(bounds) ? bounds : [bounds];
}

/** A region's name in forms: its label from the rules, "Kill region", "name (Team)", or the name itself. */
export function regionLabel(name: string, rules: EditorRules): string {
  if (name === KILL_REGION) return "Kill region";
  const requirement = regionRequirements(rules).find((candidate) => candidate.name === name);
  if (requirement) return requirement.label;
  const team = teamOf(name, rules);
  return team ? `${name.slice(0, name.lastIndexOf("."))} (${team.name})` : name;
}

/** A new region's name as typed: letters, digits and _, starting with a letter (dots mark team keys). */
export function regionName(text: string): string | undefined {
  const name = text.trim();
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name) ? name : undefined;
}

export interface OutlineBox {
  /** The entry's key, so the box being edited can be left out. */
  key: string;
  box: Box;
  color: Rgb;
}

/** Every box the map has, with its outline color: bounds white, kill red, team regions in the team's color. */
export function outlineBoxes(config: MapConfig, rules: EditorRules): OutlineBox[] {
  const colors = new Map<string, Rgb>();
  let next = 0;
  for (const name of regionNames(config, rules)) {
    const team = teamOf(name, rules);
    const color = name === KILL_REGION ? KILL_COLOR : team && codeColor(team.color);
    colors.set(name, color ?? PALETTE[next++ % PALETTE.length]);
  }
  return regionEntries(config, rules).map((entry) => ({
    key: entry.key,
    box: entry.box,
    color: entry.region ? (colors.get(entry.region.name) ?? BOUNDS_COLOR) : BOUNDS_COLOR,
  }));
}

/** Region names in a fixed order: kill, then the ones the rules ask for, then any others the map has. */
function regionNames(config: MapConfig, rules: EditorRules): string[] {
  const names = [KILL_REGION];
  for (const requirement of regionRequirements(rules)) if (requirement.name !== undefined && !names.includes(requirement.name)) names.push(requirement.name);
  for (const name of Object.keys(regionsOf(config))) if (!names.includes(name)) names.push(name);
  return names;
}

function regionRequirements(rules: EditorRules): MapRequirement[] {
  const teams = rules.teams ?? [];
  return mapRequirements(rules.requires, { kind: rules.kind, maxPlayers: rules.maxPlayers, teams }).filter((requirement) => requirement.field === "regions");
}

/** The team of a "<name>.<team>" region, when it's one of the game's. */
function teamOf(name: string, rules: EditorRules): { id: string; name: string; color: string } | undefined {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? rules.teams?.find((team) => team.id === name.slice(dot + 1)) : undefined;
}

function regionsOf(config: MapConfig): Record<string, unknown[]> {
  const regions: unknown = config.regions;
  return typeof regions === "object" && regions !== null && !Array.isArray(regions) ? (regions as Record<string, unknown[]>) : {};
}

function isBox(value: unknown): value is Box {
  if (typeof value !== "object" || value === null) return false;
  const { min, max } = value as { min?: unknown; max?: unknown };
  return [min, max].every((corner) => Array.isArray(corner) && corner.length === 3 && corner.every((n) => typeof n === "number" && Number.isFinite(n)));
}

/** A § color code's color ("§c" is red), or undefined. */
function codeColor(code: string): Rgb | undefined {
  const value = CODE_COLORS[code.replace("§", "").toLowerCase()];
  return value === undefined ? undefined : rgb(value);
}

function rgb(hex: number): Rgb {
  return { red: ((hex >> 16) & 0xff) / 255, green: ((hex >> 8) & 0xff) / 255, blue: (hex & 0xff) / 255 };
}
