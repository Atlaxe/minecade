// What the editor (editor.ts) gives its tools, so the region and Kill Y tools change the map the
// same way the spawn tool does without reaching into the editor, plus small helpers they share.
import { EntityComponentTypes, type Player } from "@minecraft/server";
import type { EditorRules, MapConfig, MapEdit } from "@minecade/minigame-core";
import { toolOf, type ToolId } from "./tools.ts";

export interface ToolHost {
  /** The map as players see it now. */
  map(): MapConfig;
  readonly rules: EditorRules;
  isEditor(player: Player): boolean;
  /** Applies an edit and sends it to the host; false (and a message) when it doesn't fit. */
  edit(player: Player, edit: MapEdit, done?: string): boolean;
  /** Shows a form unless this player has one of the editor's open already. */
  show<R extends { canceled: boolean }>(player: Player, form: { show(player: Player): Promise<R> }): Promise<R | undefined>;
  tell(player: Player, text: string): void;
  /** Puts a tool in the player's hand (slot 1), the way its switch in the map menu does. */
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

/** A line above the hotbar, for quick feedback that shouldn't fill the chat. */
export function actionBar(player: Player, text: string): void {
  try {
    if (player.isValid) player.onScreenDisplay.setActionBar(text);
  } catch {
    // left between the check and the call
  }
}
