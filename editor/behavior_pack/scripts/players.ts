// Map editors and guests. Everyone not in LAN_PLAYERS is a guest, set on the Panel's Map editor
// page: guests may join the editor lobby and whatever runs on Select's port (Select, or a preview),
// never Edit; the host (tools/editor/runner.ts) keeps the list, opens those servers to them, and
// moves them on.
import type { Player } from "@minecraft/server";
import { readServerVars } from "@minecade/minigame-core";

let editors: Set<string> | undefined;

/** A map editor (in LAN_PLAYERS); anyone else here is a guest. */
export function isMapEditor(player: Player): boolean {
  editors ??= new Set(readServerVars().lanPlayers.map((name) => name.toLowerCase()));
  return editors.has(player.name.toLowerCase());
}
