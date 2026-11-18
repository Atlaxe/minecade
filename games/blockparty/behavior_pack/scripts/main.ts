import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, system, type Player } from "@minecraft/server";
import { log, say } from "@minecade/minigame-core";
import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { BlockPartySpike } from "./spike.ts";

let current: BlockPartySpike | undefined;

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  // The Tests menu by command (block-party-ui.md: Tests and settings as commands), since the bar's
  // compass is out of sight on the board (the hotbar shows only in minigames).
  customCommandRegistry.registerCommand(
    { name: "blockparty:tests", description: "Open Block Party's Tests menu", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const player = origin.sourceEntity;
      if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can open the Tests menu." };
      // A tick later: a command runs where forms can't open.
      system.run(() => {
        if (!player.isValid) return;
        if (current) current.openTests(player as Player);
        else (player as Player).sendMessage("Block Party isn't running yet.");
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
});

runGameServer((ctx) => (current = new BlockPartySpike(ctx, config)));
