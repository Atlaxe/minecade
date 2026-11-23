import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, system, type Entity, type Player } from "@minecraft/server";
import { log, say } from "@minecade/minigame-core";
import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { BOARD_CAM_ENUM, BOARD_CAM_WORDS, SPACE_CAM_ENUM, SPACE_CAM_WORDS } from "./camera-tuning.ts";
import { BlockPartySpike } from "./spike.ts";
import { TEST_ENUM, TEST_WORDS } from "./tests-menu.ts";

let current: BlockPartySpike | undefined;

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  // The Tests menu by command (block-party-ui.md: Tests and settings as commands), since the bar's
  // compass is out of sight on the board (the hotbar shows only in minigames). A word after it runs
  // that button straight away (tests-menu.ts: /tests playeranimations opens the Player animations form).
  customCommandRegistry.registerEnum(TEST_ENUM, [...TEST_WORDS]);
  customCommandRegistry.registerCommand(
    {
      name: "blockparty:tests",
      description: "Open Block Party's Tests menu, or one of its tests by name",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      optionalParameters: [{ name: TEST_ENUM, type: CustomCommandParamType.Enum }],
    },
    (origin, test?: string) => {
      const player = origin.sourceEntity;
      if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can open the Tests menu." };
      // A tick later: a command runs where forms can't open.
      system.run(() => {
        if (!player.isValid) return;
        if (current) current.openTests(player as Player, test);
        else (player as Player).sendMessage("Block Party isn't running yet.");
      });
      return { status: CustomCommandStatus.Success };
    },
  );
  // /chat: Block Party hides the chat (the user, 2026-11-18); this brings it back for the player
  // who types it, and hides it again the next time.
  customCommandRegistry.registerCommand(
    { name: "blockparty:chat", description: "Show or hide the chat in Block Party", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const player = origin.sourceEntity;
      if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player has a chat to show." };
      if (!current) return { status: CustomCommandStatus.Failure, message: "Block Party isn't running yet." };
      const game = current;
      // A tick later: a command can't change what a player sees where it runs.
      system.run(() => {
        if (!player.isValid) return;
        (player as Player).sendMessage(say.info(game.toggleChat(player as Player)));
      });
      return { status: CustomCommandStatus.Success };
    },
  );
  // /hold (testing): stops the game on the typer's turns, to try dice and items: every turn is theirs
  // and what they hold comes back after each one (spike.ts, holdGame). Typed again, the game goes on.
  customCommandRegistry.registerCommand(
    { name: "blockparty:hold", description: "Testing: hold the game on your turns (dice and items come back), or let it go on", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const player = origin.sourceEntity;
      if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can hold the game." };
      // A tick later: a command can't change the world where it runs.
      system.run(() => {
        if (!player.isValid) return;
        const problem = current ? current.holdGame(player as Player) : "Block Party isn't running yet.";
        if (problem !== undefined) (player as Player).sendMessage(say.error(problem));
      });
      return { status: CustomCommandStatus.Success };
    },
  );
  // /minigame win <name> (testing): skips the minigame on now, the named player or bot winning it
  // (their side in a team minigame), straight to its results and coins (minigame-runner.ts, win).
  // A name with spaces goes in quotes, or just its start: the one playing whose name starts with it.
  customCommandRegistry.registerEnum("blockparty:minigameaction", ["win"]);
  customCommandRegistry.registerCommand(
    {
      name: "blockparty:minigame",
      description: "Testing: skip the minigame on now, a player or bot winning it",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      mandatoryParameters: [
        { name: "blockparty:minigameaction", type: CustomCommandParamType.Enum },
        { name: "player", type: CustomCommandParamType.String },
      ],
    },
    (origin, _action: string, name: string) => {
      const sender = origin.sourceEntity?.typeId === "minecraft:player" ? (origin.sourceEntity as Player) : undefined;
      // A tick later: a command can't change the world where it runs.
      system.run(() => {
        const problem = current ? current.winMinigame(name) : "Block Party isn't running yet.";
        if (problem === undefined) return;
        if (sender?.isValid) sender.sendMessage(say.error(problem));
        else log.info(`blockparty: /minigame win ${name}: ${problem}`);
      });
      return { status: CustomCommandStatus.Success };
    },
  );
  // /boardcam and /spacecam (testing; camera-tuning.ts): the board camera's settings and a space's
  // cutscene camera, changed for everyone at once; /boardcam save keeps them on the map (a preview
  // from the map editor). Not /camera: that's the game's own command.
  customCommandRegistry.registerEnum(BOARD_CAM_ENUM, [...BOARD_CAM_WORDS]);
  customCommandRegistry.registerCommand(
    {
      name: "blockparty:boardcam",
      description: "Testing: the board camera's settings (distance, height, pitch, fov...), changed live; reset, or save to the map",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      optionalParameters: [
        { name: BOARD_CAM_ENUM, type: CustomCommandParamType.Enum },
        { name: "value", type: CustomCommandParamType.Integer },
      ],
    },
    (origin, word?: string, value?: number) => tune(origin.sourceEntity, (game, player) => game.boardCam(player, word, value)),
  );
  customCommandRegistry.registerEnum(SPACE_CAM_ENUM, [...SPACE_CAM_WORDS]);
  customCommandRegistry.registerCommand(
    {
      name: "blockparty:spacecam",
      description: "Testing: a space's cutscene camera (way, pitch, distance, free, board, default), changed live; space <id> picks one",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      optionalParameters: [
        { name: SPACE_CAM_ENUM, type: CustomCommandParamType.Enum },
        { name: "value", type: CustomCommandParamType.Integer },
      ],
    },
    (origin, word?: string, value?: number) => tune(origin.sourceEntity, (game, player) => game.spaceCam(player, word, value)),
  );
});

/** Runs a camera command a tick later (a command can't move the camera where it runs) and tells the player what it did. */
function tune(source: Entity | undefined, run: (game: BlockPartySpike, player: Player) => Promise<string>): { status: CustomCommandStatus; message?: string } {
  if (source?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can tune the camera." };
  const player = source as Player;
  system.run(() => {
    if (!player.isValid) return;
    if (!current) return player.sendMessage("Block Party isn't running yet.");
    run(current, player)
      .then((text) => {
        if (player.isValid && text) player.sendMessage(say.info(text));
      })
      .catch((error: unknown) => log.warn(`blockparty: a camera command failed: ${String(error)}`));
  });
  return { status: CustomCommandStatus.Success };
}

runGameServer((ctx) => (current = new BlockPartySpike(ctx, config)));
