// What a game gets only while previewed from the map editor (the "preview" server variable):
// - /fake [count] (minecade:fake): adds fake players to the match (fakes.ts), who wait, spawn and
//   go down like players, their hearts over them in play. Right click one for the side panel: it
//   kills you, or wins the best-of round being played.
// - /exit (minecade:exit): a map editor ends the preview for everyone, back to Edit; an invited
//   guest just leaves, for the editor lobby.
// - /restart (minecade:restart): a map editor plays the preview again from the start, for everyone,
//   as if they all picked Replay: they wait in the editor lobby while it starts again (a new server
//   on a fresh copy of the map, since a match changes the world).
// - Once the match is over, each player picks what's next (endPreview): Replay, Edit or Lobby.
// The preview's resource pack carries the map editor's form UI, so the confirm draws in its side
// panel (editor/resource_pack/ui/editor_forms.json).
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, system, world, type Entity, type Player } from "@minecraft/server";
import { variables } from "@minecraft/server-admin";
import { ActionFormData } from "@minecraft/server-ui";
import { log } from "../log.ts";
import { normalizePlayer } from "../player.ts";
import type { Scope } from "../scope.ts";
import { showForm } from "../ui.ts";
import { homePort, type ServerVars } from "../vars.ts";
import type { Minigame } from "./minigame.ts";

/** The map editor's side panel layout, its red button and its green one (editor/behavior_pack/scripts/marks.ts LAYOUT.side, MARK.danger, MARK.go). */
export const SIDE_TITLE = "§s§i§d§e";
export const DANGER_BUTTON = "§d§g§r";
export const GO_BUTTON = "§g§o§r";
/** The most fake players one /fake adds. */
const MAX_FAKES = 16;
/** How long players get to pick what's next once the match is over. */
const NEXT_SECONDS = 60;

/** What's next after a preview's match, in its menu (Edit only for map editors). */
export const PREVIEW_NEXT = [
  { choice: "replay", text: `${GO_BUTTON}Replay\n§7the preview starts again` },
  { choice: "edit", text: "Edit\n§7back to editing the map" },
  { choice: "lobby", text: "Lobby\n§7the editor lobby" },
] as const;

/** Who picked what after a preview's match, for the map editor's host: Replay, and Edit when it has to open the map (a preview from the editor lobby). */
export interface PreviewNext {
  replay: string[];
  edit: string[];
}

/**
 * Once a preview's match is over, every player gets "Preview over" in the side panel: Replay
 * (green: they wait in the editor lobby while the preview starts again), Edit (map editors: back to
 * editing the map; Edit's port when the preview came from there, else the editor lobby while the
 * host opens it), or Lobby (the editor lobby). Each goes as soon as they pick. Whoever closes it,
 * or hasn't picked within a minute, goes back where the preview came from.
 */
export async function endPreview(root: Scope, vars: ServerVars, transfer: (player: Player, port: number) => void): Promise<PreviewNext> {
  const next: PreviewNext = { replay: [], edit: [] };
  const lobby = vars.guestLobbyPort ?? vars.lobbyPort;
  const fromEdit = vars.guestLobbyPort !== undefined && vars.guestLobbyPort !== vars.lobbyPort;
  // The menus and their minute: both go once everyone has picked.
  const menus = root.child("preview end");
  const timeUp = menus.wait(NEXT_SECONDS * 20).then(() => undefined);
  try {
    await Promise.all(
      world.getAllPlayers().map(async (player) => {
        const name = player.name;
        const editor = vars.lanPlayers.some((lan) => lan.toLowerCase() === name.toLowerCase());
        const options = PREVIEW_NEXT.filter((option) => editor || option.choice !== "edit");
        const form = new ActionFormData().title(`${SIDE_TITLE}Preview over`);
        for (const option of options) form.button(option.text);
        const answer = await Promise.race([showForm(menus, player, form), timeUp]);
        if (!player.isValid) return;
        const choice = answer?.selection === undefined ? undefined : options[answer.selection]?.choice;
        if (choice === "replay") next.replay.push(name);
        if (choice === "edit" && !fromEdit) next.edit.push(name);
        normalizePlayer(player);
        transfer(player, choice === undefined ? homePort(vars, name) : choice === "edit" && fromEdit ? vars.lobbyPort : lobby);
      }),
    );
  } finally {
    menus.dispose();
  }
  return next;
}

/** After /restart: everyone waits in the editor lobby while the preview starts again, as if they all picked Replay. */
export function replayAll(vars: ServerVars, transfer: (player: Player, port: number) => void): PreviewNext {
  const lobby = vars.guestLobbyPort ?? vars.lobbyPort;
  const replay: string[] = [];
  for (const player of world.getAllPlayers()) {
    replay.push(player.name);
    normalizePlayer(player);
    transfer(player, lobby);
  }
  return { replay, edit: [] };
}

/** Registers /fake, /exit and /restart on a preview's game server; does nothing anywhere else. */
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
    customCommandRegistry.registerCommand(
      { name: "minecade:restart", description: "Play the preview again from the start", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
      (origin) => {
        const player = origin.sourceEntity;
        if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can restart the preview." };
        system.run(() => game()?.restartPreview(player as Player));
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
