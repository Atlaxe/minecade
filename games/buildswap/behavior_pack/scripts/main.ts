import { CommandPermissionLevel, CustomCommandStatus, system, type Player } from "@minecraft/server";
import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { BuildSwap } from "./buildswap.ts";

let game: BuildSwap | undefined;

// /floor (minecade:floor): the block in hand becomes the floor of the area you're building in.
system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand(
    { name: "minecade:floor", description: "Lay the block in your hand as the floor of the area you're building in", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const player = origin.sourceEntity;
      if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can lay a floor." };
      // Commands run where the world can't be changed: the floor goes down next tick.
      system.run(() => {
        if (player.isValid) (player as Player).sendMessage(game?.floor(player as Player) ?? "The game isn't running yet.");
      });
      return { status: CustomCommandStatus.Success };
    },
  );
});

runGameServer((ctx) => (game = new BuildSwap(ctx, config)));
