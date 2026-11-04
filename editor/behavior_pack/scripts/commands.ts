// The editor's commands, registered when the script loads:
// - /reset (minecade:reset): a map editor gets the editor's items back (the map menu, and in Select
//   the Select tool) and creative mode, for worlds whose command blocks clear inventories or change
//   game modes. Select and Edit say what resetting does.
// - /zoom (minecade:zoom): zooms the view in, like a spyglass, whatever you hold; again to zoom
//   back out.
// - /replace (minecade:replace): in Edit, turns replace mode on or off (replace-mode.ts): a right
//   click on a block puts the block in hand in its place.
// - /gamesettings (minecade:gamesettings): in Edit, the Game settings tool's screen: the game's own
//   settings for this map (game-settings-tool.ts).
import { CommandPermissionLevel, CustomCommandStatus, system, type Player } from "@minecraft/server";

/** The field of view while zoomed in (Minecraft's default is about 70). */
const ZOOM_FOV = 30;
/** Who is zoomed in, by lower-case name. */
const zoomed = new Set<string>();

let handler: ((player: Player) => void) | undefined;
let replaceHandler: ((player: Player) => void) | undefined;
let gameSettingsHandler: ((player: Player) => void) | undefined;

/** What /reset does on this server. */
export function onReset(fn: (player: Player) => void): void {
  handler = fn;
}

/** What /replace does: only Edit has replace mode. */
export function onReplace(fn: (player: Player) => void): void {
  replaceHandler = fn;
}

/** What /gamesettings does: only Edit has a map's game settings. */
export function onGameSettings(fn: (player: Player) => void): void {
  gameSettingsHandler = fn;
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
    { name: "minecade:replace", description: "Turn replace mode on or off: a right click on a block puts the block in your hand in its place", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const player = origin.sourceEntity;
      if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can replace blocks." };
      if (!replaceHandler) return { status: CustomCommandStatus.Failure, message: "Replace mode is for editing a map." };
      system.run(() => replaceHandler?.(player as Player));
      return { status: CustomCommandStatus.Success };
    },
  );
  customCommandRegistry.registerCommand(
    { name: "minecade:gamesettings", description: "Change the game's own settings for this map", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const player = origin.sourceEntity;
      if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can change game settings." };
      if (!gameSettingsHandler) return { status: CustomCommandStatus.Failure, message: "Game settings are for editing a map." };
      system.run(() => gameSettingsHandler?.(player as Player));
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
