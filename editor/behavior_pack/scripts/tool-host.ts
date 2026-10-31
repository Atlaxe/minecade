// What the editor (editor.ts) gives its tools, so the region and Kill Y tools change the map the
// same way the spawn tool does without reaching into the editor, plus small helpers they share.
import { EntityComponentTypes, system, type Player } from "@minecraft/server";
import { playChime, type EditorRules, type MapConfig, type MapEdit, type Scope } from "@minecade/minigame-core";
import { toolOf, type ToolId } from "./tools.ts";

/** How long feedback on the action bar stays before the held tool's hint comes back. */
const FEEDBACK_TICKS = 40;

export interface ToolHost {
  /** The map as players see it now. */
  map(): MapConfig;
  readonly rules: EditorRules;
  /** Applies an edit and sends it to the host; false (and a message) when it doesn't fit. */
  edit(player: Player, edit: MapEdit, done?: string): boolean;
  /** Shows a form unless this player has one of the editor's open already. */
  show<R extends { canceled: boolean }>(player: Player, form: { show(player: Player): Promise<R> }): Promise<R | undefined>;
  tell(player: Player, text: string): void;
  /** Puts a tool in the player's hand (slot 1), the way picking it in the map menu does. */
  equip(player: Player, tool: ToolId): void;
}

/** The tool in the player's hand, if any. */
export function heldTool(player: Player): ToolId | undefined {
  try {
    const item = player.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(player.selectedSlotIndex);
    return item ? toolOf(item.typeId)?.id : undefined;
  } catch {
    return undefined;
  }
}

/** How long a notice stays above the hotbar, and when it's put back once (the bar fades in 3 seconds). */
const NOTICE_TICKS = 120;
const NOTICE_AGAIN_TICKS = 50;

/** Until when each player's action bar is left to feedback or a notice, in ticks. */
const quietUntil = new Map<string, number>();
/** The last feedback or notice each player got, so a notice is only put back when nothing replaced it. */
const lastLine = new Map<string, string>();

/** A line above the hotbar, for quick feedback that shouldn't fill the chat. */
export function actionBar(player: Player, text: string): void {
  hold(player, text, FEEDBACK_TICKS);
}

/** News above the hotbar with a chime, kept up for about 6 seconds: hints wait, feedback replaces it. */
export function notice(scope: Scope, player: Player, text: string): void {
  hold(player, text, NOTICE_TICKS);
  playChime(player, "go");
  scope.timeout(() => {
    if (lastLine.get(player.name) === text) show(player, text);
  }, NOTICE_AGAIN_TICKS);
}

/** The held tool's hint above the hotbar, unless feedback (2 seconds) or a notice is showing. */
export function hintBar(player: Player, text: string): void {
  if (system.currentTick >= (quietUntil.get(player.name) ?? 0)) show(player, text);
}

function hold(player: Player, text: string, ticks: number): void {
  quietUntil.set(player.name, system.currentTick + ticks);
  lastLine.set(player.name, text);
  show(player, text);
}

function show(player: Player, text: string): void {
  try {
    if (player.isValid) player.onScreenDisplay.setActionBar(text);
  } catch {
    // left between the check and the call
  }
}
