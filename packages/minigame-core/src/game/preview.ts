// What a game gets only while previewed from the map editor (the "preview" server variable):
// - /fake [count] (minecade:fake): adds fake players to the match (fakes.ts), who wait, spawn and
//   go down like players. Right click one to kill it (after a confirm in the side panel).
// - /exit (minecade:exit): a map editor ends the preview for everyone, back to Edit; an invited
//   guest just leaves, for the editor lobby.
// The preview's resource pack carries the map editor's form UI, so the confirm draws in its side
// panel (editor/resource_pack/ui/editor_forms.json).
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, system, type Entity, type Player } from "@minecraft/server";
import { variables } from "@minecraft/server-admin";
import { log } from "../log.ts";
import type { Minigame } from "./minigame.ts";

/** The map editor's side panel layout and its red button (editor/behavior_pack/scripts/marks.ts LAYOUT.side, MARK.danger). */
export const SIDE_TITLE = "§s§i§d§e";
export const DANGER_BUTTON = "§d§g§r";
/** The most fake players one /fake adds. */
const MAX_FAKES = 16;

/** Registers /fake and /exit on a preview's game server; does nothing anywhere else. */
export function registerPreviewCommands(game: () => Minigame | undefined): void {
  system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
    if (!String(variables.get("preview") ?? "").trim()) return;
    customCommandRegistry.registerCommand(
      {
        name: "minecade:fake",
        description: "Add fake players to the preview's match",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        optionalParameters: [{ name: "count", type: CustomCommandParamType.Integer }],
      },
      (origin, count?: number) => {
        const asked = Math.max(1, Math.min(MAX_FAKES, Math.trunc(count ?? 1)));
        // Commands run where the world can't be changed: the fakes come next tick.
        system.run(() => reply(origin.sourceEntity, game()?.addFakes(asked) ?? "The game isn't running yet."));
        return { status: CustomCommandStatus.Success };
      },
    );
    customCommandRegistry.registerCommand(
      { name: "minecade:exit", description: "Leave the preview", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
      (origin) => {
        const player = origin.sourceEntity;
        if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can leave." };
        system.run(() => game()?.exitPreview(player as Player));
        return { status: CustomCommandStatus.Success };
      },
    );
  });
}

/** Tells whoever ran a command (the console: the log). */
function reply(source: Entity | undefined, text: string): void {
  if (source?.typeId === "minecraft:player" && source.isValid) (source as Player).sendMessage(text);
  else log.info(text);
}
