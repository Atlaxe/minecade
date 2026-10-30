// What the map menu and the checklist offer, as plain data: the editor turns these into forms.
import type { Checklist, ChecklistRow, MapConfig } from "@minecade/minigame-core/config";

export type MenuAction = "checklist" | "spawnTool" | "undo" | "redo" | "markReady" | "settings" | "saveWorld" | "dropBuild";

export interface MenuView {
  config: MapConfig;
  checklist: Checklist;
  /** What undo and redo would change, when there is something to undo or redo. */
  undo?: string;
  redo?: string;
  /** The world is saved when the editor stops. */
  saveWorld: boolean;
}

/** The map menu's buttons, in order. */
export function menuEntries(view: MenuView): { action: MenuAction; text: string }[] {
  const { done, total } = progress(view.checklist);
  const entries: { action: MenuAction; text: string }[] = [
    { action: "checklist", text: `Checklist (${done} of ${total})${view.checklist.problems.length > 0 ? "\n§c" : "\n§2"}${problemCount(view.checklist)}` },
    { action: "spawnTool", text: "Spawn tool\n§8spawns and points" },
  ];
  if (view.undo) entries.push({ action: "undo", text: `Undo\n§8${view.undo}` });
  if (view.redo) entries.push({ action: "redo", text: `Redo\n§8${view.redo}` });
  if (view.config.draft === true) entries.push({ action: "markReady", text: `Mark ready\n§8${view.checklist.ready ? "the build will include it" : "finish the checklist first"}` });
  entries.push({ action: "settings", text: "Map settings\n§8name and game settings" });
  entries.push({ action: "saveWorld", text: view.saveWorld ? "World: saved at stop\n§8tap to keep it as it was" : "World: kept as it was\n§8tap to save it at stop" });
  if (view.config.build) entries.push({ action: "dropBuild", text: "Drop build commands\n§8keep block changes" });
  return entries;
}

/** The menu's first lines: the map, the game, and whether it's a draft. */
export function menuBody(targetName: string, mapId: string, config: MapConfig): string {
  return `${config.name} (${mapId}), ${targetName}${config.draft === true ? ", draft" : ""}`;
}

/** A checklist button: green when done, red with the count when not. */
export function rowText(row: ChecklistRow): string {
  return `${row.done ? "§2" : "§4"}${row.label}\n§8${row.have} of ${row.need}`;
}

/** The checklist's text above its buttons: what the build would refuse, then warnings. */
export function checklistBody(checklist: Checklist): string {
  if (checklist.ready && checklist.warnings.length === 0) return "§2Nothing missing. Tap an entry for its tool.";
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
