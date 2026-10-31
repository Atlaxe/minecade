// What the map menu and the checklist offer, as plain data: the editor turns these into forms.
// The map menu has its own layout (resource_pack/ui/editor_forms.json, picked by LAYOUT.map): the
// quick icons (the checklist pill, Undo, Redo, Map settings), the tool grid, the picked tool's
// settings (scrolling) and a green Save bar. Each button's mark (marks.ts) says where it goes.
import { listOf, type Box, type Checklist, type ChecklistRow, type MapConfig } from "@minecade/minigame-core/config";
import { sizeText } from "./boxes.ts";
import { SNAPS, type Snap, type SpawnList } from "./lists.ts";
import { COLUMNS, MARK, dangerText, headingText, switchText } from "./marks.ts";
import { selectionActions, type RegionEntry, type SelectionAction } from "./regions.ts";
import { EDITOR_TOOLS, type ToolId } from "./tools.ts";

/** The quick icons' pictures (editor/resource_pack/textures/minecade/editor/). */
export const ICONS = {
  check: "textures/minecade/editor/icon_check",
  checkDone: "textures/minecade/editor/icon_check_done",
  undo: "textures/minecade/editor/icon_undo",
  redo: "textures/minecade/editor/icon_redo",
  settings: "textures/minecade/editor/icon_settings",
} as const;

export type MenuAction =
  | { kind: "checklist" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "settings" }
  | { kind: "tool"; tool: ToolId }
  /** A heading: nothing happens but the menu opening again. */
  | { kind: "none" }
  | { kind: "list"; key: string }
  | { kind: "keepFacing" }
  | { kind: "snap" }
  | { kind: "selection"; action: SelectionAction }
  | { kind: "box"; key: string }
  | { kind: "typeKillY" }
  | { kind: "removeKillY" }
  | { kind: "save" };

export interface MenuEntry {
  action: MenuAction;
  text: string;
  /** A picture for the quick icons and the tool grid. */
  icon?: string;
}

/** The spawn tool's settings, as a map editor last picked them. */
export interface SpawnSettings {
  list: string;
  keepFacing: boolean;
  snap: Snap;
}

export interface MapMenuView {
  config: MapConfig;
  checklist: Checklist;
  /** The tool this player has out, if any. */
  tool?: ToolId;
  /** What undo and redo would change, when there is something to undo or redo. */
  undo?: string;
  redo?: string;
  /** Blocks changed since the world was last saved. */
  unsaved: boolean;
  saving: boolean;
  /** For the spawn tool's settings. */
  spawn: { lists: SpawnList[]; settings: SpawnSettings };
  /** For the region tool's settings: the player's selection, and the map's boxes. */
  region: { selection?: { box: Box; editing?: string; steps: number }; entries: RegionEntry[] };
}

/** The map menu's buttons: the quick icons, the tools, the picked tool's settings, then Save. */
export function mapMenuEntries(view: MapMenuView): MenuEntry[] {
  const { done, total } = progress(view.checklist);
  const entries: MenuEntry[] = [
    {
      action: { kind: "checklist" },
      text: `${MARK.pill}${done}/${total}\n§7Checklist: ${problemCount(view.checklist)}`,
      icon: view.checklist.ready ? ICONS.checkDone : ICONS.check,
    },
    { action: { kind: "undo" }, text: `${MARK.quick}${view.undo ? "" : MARK.dim}Undo\n§7${view.undo ?? "nothing to undo"}`, icon: ICONS.undo },
    { action: { kind: "redo" }, text: `${MARK.quick}${view.redo ? "" : MARK.dim}Redo\n§7${view.redo ?? "nothing to redo"}`, icon: ICONS.redo },
    { action: { kind: "settings" }, text: `${MARK.quick}Map settings\n§7name, game settings, build commands`, icon: ICONS.settings },
  ];
  EDITOR_TOOLS.forEach((tool, i) => {
    const picked = tool.id === view.tool ? MARK.on : "";
    entries.push({ action: { kind: "tool", tool: tool.id }, text: `${MARK.tool}${COLUMNS[i % COLUMNS.length]}${picked}${tool.label}\n§7${tool.hint}`, icon: tool.icon });
  });
  if (view.tool === "spawn") entries.push(...spawnSettings(view.config, view.checklist, view.spawn.lists, view.spawn.settings));
  else if (view.tool === "region") entries.push(...regionSettings(view.region.selection, view.region.entries, view.config.killY));
  else if (view.tool === "killY") entries.push(...killYSettings(view.config.killY));
  entries.push({ action: { kind: "save" }, text: `${MARK.save}${saveText(view)}` });
  return entries;
}

/** The text over the settings: the map, then how to use the picked tool. */
export function mapMenuBody(targetName: string, mapId: string, config: MapConfig, tool: ToolId | undefined): string {
  const howTo = EDITOR_TOOLS.find((candidate) => candidate.id === tool)?.howTo ?? "Pick a tool above. Hit a marker to change it.";
  return `${menuBody(targetName, mapId, config)}\n\n§f${howTo}`;
}

/** The spawn tool's settings: the list it places into, and how it saves your facing. */
export function spawnSettings(config: MapConfig, checklist: Checklist, lists: SpawnList[], settings: SpawnSettings): MenuEntry[] {
  const entries: MenuEntry[] = [{ action: { kind: "none" }, text: headingText("Place into") }];
  for (const list of lists) {
    const row = checklist.rows.find((candidate) => candidate.key === list.key);
    const have = row?.have ?? listOf(config, list.target).length;
    const count = row ? `${have} of ${row.need}` : `${have}`;
    entries.push({ action: { kind: "list", key: list.key }, text: `${list.key === settings.list ? MARK.picked : ""}${list.label}\n§7${count}` });
  }
  const snap = SNAPS.find((candidate) => candidate.snap === settings.snap)?.label ?? "Exact";
  entries.push(
    { action: { kind: "none" }, text: headingText("Facing") },
    { action: { kind: "keepFacing" }, text: switchText("Save my facing", settings.keepFacing ? "the way you look" : "off: it faces the middle of the map", settings.keepFacing) },
    { action: { kind: "snap" }, text: `Snap: ${snap}\n§7tap for ${SNAPS.filter((candidate) => candidate.label !== snap).map((candidate) => candidate.label).join(" or ")}` },
  );
  return entries;
}

/** The region tool's settings: the selection's actions, then the map's bounds and regions. */
export function regionSettings(selection: MapMenuView["region"]["selection"], boxes: RegionEntry[], killY: number | undefined): MenuEntry[] {
  const entries: MenuEntry[] = [];
  if (selection) {
    entries.push({ action: { kind: "none" }, text: headingText(`Selection: ${sizeText(selection.box)}`) });
    for (const { action, text } of selectionActions(selection.editing, selection.steps, killY)) entries.push({ action: { kind: "selection", action }, text });
  }
  entries.push({ action: { kind: "none" }, text: headingText(boxes.length > 0 ? `Bounds and regions (${boxes.length})` : "No bounds or regions yet") });
  for (const box of boxes) entries.push({ action: { kind: "box", key: box.key }, text: `${box.label}\n§7${sizeText(box.box)}: edit, nudge, go to, delete` });
  return entries;
}

/** The Kill Y tool's settings: the height now, typing one, and removing it. */
export function killYSettings(killY: number | undefined): MenuEntry[] {
  return [
    { action: { kind: "none" }, text: headingText(killY === undefined ? "Kill Y: not set" : `Kill Y: ${killY}`) },
    { action: { kind: "typeKillY" }, text: "Type a height" },
    ...(killY === undefined ? [] : [{ action: { kind: "removeKillY" } as const, text: dangerText("Remove kill Y") }]),
  ];
}

function saveText(view: MapMenuView): string {
  if (view.saving) return "Saving...\nthe map and the world";
  return `Save\n${view.unsaved ? "unsaved block changes" : "the map and the world"}`;
}

/** The menu's first line: the map, the game, and whether it's a draft. */
export function menuBody(targetName: string, mapId: string, config: MapConfig): string {
  return `${config.name} (${mapId}), ${targetName}${config.draft === true ? ", draft" : ""}`;
}

/** A checklist button: green when done, red with the count when not. */
export function rowText(row: ChecklistRow): string {
  return `${row.done ? "§a" : "§c"}${row.label}\n§7${row.have} of ${row.need}`;
}

/** The checklist's text above its buttons: what the build would refuse, then warnings. */
export function checklistBody(checklist: Checklist): string {
  if (checklist.ready && checklist.warnings.length === 0) return "§aNothing missing. Tap an entry for its tool.";
  const lines = [...checklist.problems.map((problem) => `§c- ${problem}`), ...checklist.warnings.map((warning) => `§e- ${warning}`)];
  return `${lines.join("\n")}\n§rTap an entry for its tool.`;
}

/** Mark ready, under the checklist's rows, for a draft. */
export function markReadyText(checklist: Checklist): string {
  return `Mark ready\n§7${checklist.ready ? "the build will include it" : "finish the checklist first"}`;
}

/**
 * A game setting typed into the settings form, as the type it had: a number, true or false, or
 * text. Undefined when it doesn't read as that type.
 */
export function parseSetting(text: string, old: string | number | boolean): string | number | boolean | undefined {
  if (typeof old === "string") return text;
  const trimmed = text.trim();
  if (typeof old === "boolean") return /^(true|false)$/i.test(trimmed) ? trimmed.toLowerCase() === "true" : undefined;
  const value = Number(trimmed);
  return trimmed !== "" && Number.isFinite(value) ? value : undefined;
}

function progress(checklist: Checklist): { done: number; total: number } {
  return { done: checklist.rows.filter((row) => row.done).length, total: checklist.rows.length };
}

function problemCount(checklist: Checklist): string {
  const count = checklist.problems.length;
  return count === 0 ? "ready" : `${count} problem${count === 1 ? "" : "s"}`;
}
