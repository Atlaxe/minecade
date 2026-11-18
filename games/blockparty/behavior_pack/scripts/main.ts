import { CommandPermissionLevel, CustomCommandStatus, system, type Player } from "@minecraft/server";
import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { BlockPartySpike } from "./spike.ts";

let current: BlockPartySpike | undefined;

// The Tests menu by command (block-party-ui.md: Tests and settings as commands), since the bar's
// compass is out of sight on the board (the hotbar shows only in minigames).
system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
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
});

runGameServer((ctx) => (current = new BlockPartySpike(ctx, config)));
