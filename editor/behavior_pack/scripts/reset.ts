// /reset (minecade:reset): a map editor gets the editor's items back (the map menu, and in Select
// the Select tool) and creative mode, for worlds whose command blocks clear inventories or change
// game modes. Registered when the script loads; Select and Edit say what resetting does.
import { CommandPermissionLevel, CustomCommandStatus, system, type Player } from "@minecraft/server";

let handler: ((player: Player) => void) | undefined;

/** What /reset does on this server. */
export function onReset(fn: (player: Player) => void): void {
  handler = fn;
}

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand(
    { name: "minecade:reset", description: "Get the map editor's items back, and creative mode", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const player = origin.sourceEntity;
      if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can reset." };
      // Commands run where the world can't be changed: the reset happens next tick.
      system.run(() => handler?.(player as Player));
      return { status: CustomCommandStatus.Success };
    },
  );
});
