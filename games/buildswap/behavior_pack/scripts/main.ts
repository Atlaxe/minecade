import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, system, type BlockType, type CustomCommandOrigin, type CustomCommandResult, type Player } from "@minecraft/server";
import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { BuildSwap } from "./buildswap.ts";

let game: BuildSwap | undefined;

/**
 * Runs a building command for the player who typed it, a tick later (commands run where the world
 * can't be changed), and tells them what happened.
 */
function forPlayer(origin: CustomCommandOrigin, run: (game: BuildSwap, player: Player) => string): CustomCommandResult {
  const player = origin.sourceEntity;
  if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can do that." };
  system.run(() => {
    if (player.isValid) (player as Player).sendMessage(game ? run(game, player as Player) : "The game isn't running yet.");
  });
  return { status: CustomCommandStatus.Success };
}

const blockId = (block: BlockType | undefined) => block?.id ?? "";
const anyone = { permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false };

// The building commands, all for the area you're building in: /floor lays the block in hand as its
// floor; /wand gives the selection wand (a wooden axe: left click a block for the first corner,
// right click for the second); /set fills the selection with a block; /replace swaps one block for
// another in it; /fix, standing in water or lava, levels the pool around you. Bedrock can't take
// WorldEdit's "//wand" (it stops at the second slash), so they take one.
system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand(
    { name: "minecade:floor", description: "Lay the block in your hand as the floor of the area you're building in", ...anyone },
    (origin) => forPlayer(origin, (running, player) => running.floor(player)),
  );
  customCommandRegistry.registerCommand(
    { name: "minecade:wand", description: "Get the selection wand: left click a block for the first corner, right click for the second", ...anyone },
    (origin) => forPlayer(origin, (running, player) => running.wand(player)),
  );
  customCommandRegistry.registerCommand(
    { name: "minecade:set", description: "Fill your selection with a block", ...anyone, mandatoryParameters: [{ name: "block", type: CustomCommandParamType.BlockType }] },
    (origin, block: BlockType) => forPlayer(origin, (running, player) => running.set(player, blockId(block))),
  );
  customCommandRegistry.registerCommand(
    {
      name: "minecade:replace",
      description: "Replace one block with another in your selection",
      ...anyone,
      mandatoryParameters: [
        { name: "from", type: CustomCommandParamType.BlockType },
        { name: "to", type: CustomCommandParamType.BlockType },
      ],
    },
    (origin, from: BlockType, to: BlockType) => forPlayer(origin, (running, player) => running.replace(player, blockId(from), blockId(to))),
  );
  customCommandRegistry.registerCommand(
    { name: "minecade:fix", description: "Standing in water or lava: make the pool around you still and level (7 blocks around)", ...anyone },
    (origin) => forPlayer(origin, (running, player) => running.fix(player)),
  );
});

runGameServer((ctx) => (game = new BuildSwap(ctx, config)));
