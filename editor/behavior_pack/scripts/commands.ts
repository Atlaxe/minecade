// The editor's commands, registered when the script loads:
// - /reset (minecade:reset): a map editor gets the editor's items back (the map menu, and in Select
//   the Select tool) and creative mode, for worlds whose command blocks clear inventories or change
//   game modes. Select and Edit say what resetting does.
// - /zoom (minecade:zoom): zooms the view in, like a spyglass, whatever you hold; again to zoom
//   back out.
import { CommandPermissionLevel, CustomCommandStatus, system, type Player } from "@minecraft/server";

/** The field of view while zoomed in (Minecraft's default is about 70). */
const ZOOM_FOV = 30;
/** Who is zoomed in, by lower-case name. */
const zoomed = new Set<string>();

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
  customCommandRegistry.registerCommand(
    { name: "minecade:zoom", description: "Zoom the view in, or back out", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const player = origin.sourceEntity;
      if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can zoom." };
      system.run(() => toggleZoom(player as Player));
      return { status: CustomCommandStatus.Success };
    },
  );
});

function toggleZoom(player: Player): void {
  if (!player.isValid) return;
  const key = player.name.toLowerCase();
  const easeOptions = { easeTime: 0.2 };
  if (zoomed.delete(key)) {
    player.camera.setFov({ easeOptions });
  } else {
    zoomed.add(key);
    player.camera.setFov({ fov: ZOOM_FOV, easeOptions });
  }
}
