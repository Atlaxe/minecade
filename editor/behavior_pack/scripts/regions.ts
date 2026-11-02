// The boxes a map has (its bounds and regions), where the region tool can save a box, and the
// colors their outlines are drawn in: pure functions of the map and its rules, so they can be
// tested without a server.
import { BUILD_LIMIT_SIDES, KILL_REGION, codeTint, enclosingBox, mapRequirements, type Box, type BuildLimitSide, type EditorRules, type MapConfig, type MapRequirement } from "@minecade/minigame-core/config";

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
/**
 * Regions without a team take these in turn, plane colors (sheets.ts PLANE_COLORS: light blue, lime,
 * magenta, blue, pink, cyan, green, purple). White, red, yellow and orange are kept for the bounds,
 * kill, the selection and the build limit.
 */
const PALETTE = [0x3ab3da, 0x80c71f, 0xc74ebd, 0x3c44aa, 0xf38baa, 0x169c9c, 0x5e7c16, 0x8932b8].map(rgb);
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
  /**
   * What it is, whatever the team: "bounds", "addBounds", "regions.kill", "regions.<name>" (a team's
   * region by the name before its team), or "new". A screen picks this first, then the team.
   */
  group: string;
  /** Its group's name there: "Bounds", "Kill region", "Spawn guard", "New region". */
  groupLabel: string;
  /** Its name in the Team list, for a team's region. */
  teamLabel?: string;
  /** A tile (the bounds and the kill region), else an option in the Region list (the game's regions, the map's others, New region). */
  tile: boolean;
}

export type SelectionAction = "saveAs" | "clear";

/** The bounds (and another bounds box), the kill region, the regions the rules ask for, any others the map has, then a new one. */
export function regionTargets(config: MapConfig, rules: EditorRules): RegionTarget[] {
  const bounds = boundsEntries(config).length;
  const regions = regionNames(config, rules).map((name): RegionTarget => {
    const label = regionLabel(name, rules);
    if (name === KILL_REGION) return { key: `regions.${name}`, label, kind: "region", name, group: `regions.${name}`, groupLabel: label, tile: true };
    const team = teamOf(name, rules);
    if (!team) return { key: `regions.${name}`, label, kind: "region", name, group: `regions.${name}`, groupLabel: label, tile: false };
    // A team's region: "spawnGuard.red", labeled "Spawn guard (Red)".
    const suffix = ` (${team.name})`;
    const groupLabel = label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
    return { key: `regions.${name}`, label, kind: "region", name, group: `regions.${name.slice(0, name.lastIndexOf("."))}`, groupLabel, teamLabel: team.name, tile: false };
  });
  return [
    { key: "bounds", label: bounds > 1 ? `Bounds (replaces all ${bounds} boxes)` : "Bounds", kind: "bounds", group: "bounds", groupLabel: "Bounds", tile: true },
    ...(bounds > 0 ? [{ key: "addBounds", label: "Add to bounds (another box)", kind: "addBounds", group: "addBounds", groupLabel: "Add bounds", tile: true } as const] : []),
    ...regions,
    { key: "new", label: "New region...", kind: "new", group: "new", groupLabel: "New region", tile: false },
  ];
}

/** Where a box the map has is saved now: "bounds", or its region's key. */
export function targetKeyOf(entry: RegionEntry): string {
  return entry.region ? `regions.${entry.region.name}` : "bounds";
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
  /** The Boundaries view's switch it shows with: "bounds", or "regions.<name>". */
  group: string;
  box: Box;
  color: Rgb;
}

/** The Boundaries view's switch for every boundary at once. */
export const ALL_BOUNDARIES = "all";
/** The Boundaries view's switch for the kill Y plane. */
export const KILL_Y_GROUP = "killY";
/** The Boundaries view's switch for the build limit's planes. */
export const BUILD_LIMIT_GROUP = "buildLimit";
/** The build limit's planes: orange, apart from kill Y's red. */
export const BUILD_LIMIT_COLOR = rgb(0xff8c1a);

/** A height the Kill Y tool sets: kill Y, or a side of the build limit. */
export type HeightLine = "killY" | BuildLimitSide;

/** A height the map has, as a plane: which one, its height, and its color and Boundaries switch. */
export interface HeightPlane {
  line: HeightLine;
  y: number;
  color: Rgb;
  group: string;
}

/** The map's kill Y and build limit, as planes. */
export function heightPlanes(config: MapConfig): HeightPlane[] {
  const planes: HeightPlane[] = [];
  if (typeof config.killY === "number") planes.push({ line: "killY", y: config.killY, color: KILL_COLOR, group: KILL_Y_GROUP });
  for (const side of BUILD_LIMIT_SIDES) {
    const y = config.buildLimit?.[side];
    if (typeof y === "number") planes.push({ line: side, y, color: BUILD_LIMIT_COLOR, group: BUILD_LIMIT_GROUP });
  }
  return planes;
}

/** A height line's plane color. */
export function heightColor(line: HeightLine): Rgb {
  return line === "killY" ? KILL_COLOR : BUILD_LIMIT_COLOR;
}

/** A row of the Boundaries view: one switch per boundary the map has. */
export interface BoundaryRow {
  group: string;
  label: string;
  /** Under the label: how many boxes, or the height. */
  detail: string;
}

/** The map's boundaries, in outline order: the bounds, kill Y, kill regions, then each other region. */
export function boundaryRows(config: MapConfig, rules: EditorRules): BoundaryRow[] {
  const rows: BoundaryRow[] = [];
  const boxes = (count: number) => `${count} box${count === 1 ? "" : "es"}`;
  const bounds = boundsEntries(config).length;
  if (bounds > 0) rows.push({ group: "bounds", label: "Bounds", detail: `white, ${boxes(bounds)}` });
  if (typeof config.killY === "number") rows.push({ group: KILL_Y_GROUP, label: "Kill Y", detail: `red plane, y ${config.killY}` });
  const limits = BUILD_LIMIT_SIDES.filter((side) => typeof config.buildLimit?.[side] === "number");
  if (limits.length > 0) rows.push({ group: BUILD_LIMIT_GROUP, label: "Build limit", detail: `orange, ${limits.map((side) => `${side} ${config.buildLimit?.[side]}`).join(", ")}` });
  const regions = regionsOf(config);
  for (const name of regionNames(config, rules)) {
    const count = Array.isArray(regions[name]) ? regions[name].filter(isBox).length : 0;
    if (count === 0) continue;
    const label = name === KILL_REGION ? "Kill regions" : regionLabel(name, rules);
    rows.push({ group: `regions.${name}`, label, detail: `${name === KILL_REGION ? "red, " : ""}${boxes(count)}` });
  }
  return rows;
}

/** True when a boundary group is switched on in the Boundaries view (or every one is). */
export function outlineShown(group: string, shown: ReadonlySet<string>): boolean {
  return shown.has(ALL_BOUNDARIES) || shown.has(group);
}

/**
 * The switches after one is tapped: Show all turns every one on or off; one switch while all are on
 * leaves every other boundary on.
 */
export function toggleBoundary(shown: ReadonlySet<string>, group: string, groups: string[]): Set<string> {
  if (group === ALL_BOUNDARIES) return new Set(shown.has(ALL_BOUNDARIES) ? [] : [ALL_BOUNDARIES]);
  if (shown.has(ALL_BOUNDARIES)) return new Set(groups.filter((other) => other !== group));
  const next = new Set(shown);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  return next;
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
    group: entry.region ? `regions.${entry.region.name}` : "bounds",
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
  const value = codeTint(code);
  return value === undefined ? undefined : rgb(value);
}

function rgb(hex: number): Rgb {
  return { red: ((hex >> 16) & 0xff) / 255, green: ((hex >> 8) & 0xff) / 255, blue: (hex & 0xff) / 255 };
}
