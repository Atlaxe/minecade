// What the map menu and the checklist offer, as plain data: the editor turns these into forms.
// The button menus use the editor's side layout (resource_pack/ui/editor_forms.json): a dark panel
// down the right side of the screen, picked by a mark at the start of the title.
import type { Checklist, ChecklistRow, MapConfig } from "@minecade/minigame-core/config";
import { EDITOR_TOOLS, type ToolId } from "./tools.ts";

/** Layout marks: formatting codes that never render. Each must match the resource pack's UI files (a test checks). */
export const LAYOUT = {
  side: "§s§i§d§e",
} as const;

/** Button marks, read by the side layout. */
export const MARK = {
  /** A switch: drawn with an on or off picture on the right. */
  toggle: "§t§g§r",
  /** Added to a switch while it's on. */
  on: "§o§n§r",
} as const;

/** A title that gets the side layout. */
export function sideTitle(title: string): string {
  return `${LAYOUT.side}§r${title}`;
}

/** A switch's button text: the name, and a hint under it. */
export function switchText(label: string, hint: string, on: boolean): string {
  return `${MARK.toggle}${on ? MARK.on : ""}${label}\n§7${hint}`;
}

export type MenuAction = "checklist" | "tool" | "undo" | "redo" | "markReady" | "settings" | "saveWorld" | "dropBuild";

export interface MenuEntry {
  action: MenuAction;
  text: string;
  /** The tool a "tool" entry switches. */
  tool?: ToolId;
}

export interface MenuView {
  config: MapConfig;
  checklist: Checklist;
  /** The tools this player has out. */
  tools: ToolId[];
  /** What undo and redo would change, when there is something to undo or redo. */
  undo?: string;
  redo?: string;
  /** The world is saved when the editor stops. */
  saveWorld: boolean;
}

/** The map menu's buttons, top down. */
export function menuEntries(view: MenuView): MenuEntry[] {
  const { done, total } = progress(view.checklist);
  const entries: MenuEntry[] = [
    { action: "checklist", text: `Checklist (${done} of ${total})${view.checklist.problems.length > 0 ? "\n§c" : "\n§a"}${problemCount(view.checklist)}` },
  ];
  for (const tool of EDITOR_TOOLS) entries.push({ action: "tool", tool: tool.id, text: switchText(tool.label, tool.hint, view.tools.includes(tool.id)) });
  if (view.undo) entries.push({ action: "undo", text: `Undo\n§7${view.undo}` });
  if (view.redo) entries.push({ action: "redo", text: `Redo\n§7${view.redo}` });
  if (view.config.draft === true) entries.push({ action: "markReady", text: `Mark ready\n§7${view.checklist.ready ? "the build will include it" : "finish the checklist first"}` });
  entries.push({ action: "settings", text: "Map settings\n§7name and game settings" });
  entries.push({ action: "saveWorld", text: switchText("Save the world at stop", view.saveWorld ? "block changes are kept" : "kept as it was", view.saveWorld) });
  if (view.config.build) entries.push({ action: "dropBuild", text: "Drop build commands\n§7keep block changes" });
  return entries;
}

/** The menu's first lines: the map, the game, and whether it's a draft. */
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
