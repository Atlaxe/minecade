// The building games' commands, for the area you're building in: /floor lays the block in hand as
// its floor; /wand gives the selection wand (a wooden axe: left click a block for the first corner,
// right click for the second); /set fills the selection with a block; /replace swaps one block for
// another in it; /fix, standing in water or lava, levels the pool around you. Bedrock can't take
// WorldEdit's "//wand" (it stops at the second slash), so they take one. A game's main.ts registers
// them before the server starts.
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, system, type BlockType, type CustomCommandOrigin, type CustomCommandResult, type Player } from "@minecraft/server";
import type { BuildingGame, BuildingGameConfig } from "./building-game.ts";

type AnyBuildingGame = BuildingGame<BuildingGameConfig>;

const blockId = (block: BlockType | undefined) => block?.id ?? "";

/** Registers the building commands for whichever game `current` returns when one is typed. */
export function registerBuildingCommands(current: () => AnyBuildingGame | undefined): void {
  const anyone = { permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false };
  /**
   * Runs a building command for the player who typed it, a tick later (commands run where the world
   * can't be changed), and tells them what happened.
   */
  const forPlayer = (origin: CustomCommandOrigin, run: (game: AnyBuildingGame, player: Player) => string): CustomCommandResult => {
    const player = origin.sourceEntity;
    if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can do that." };
    system.run(() => {
      const game = current();
      if (player.isValid) (player as Player).sendMessage(game ? run(game, player as Player) : "The game isn't running yet.");
    });
    return { status: CustomCommandStatus.Success };
  };

  system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
    customCommandRegistry.registerCommand(
      { name: "minecade:floor", description: "Lay the block in your hand as the floor of the area you're building in", ...anyone },
      (origin) => forPlayer(origin, (game, player) => game.floor(player)),
    );
    customCommandRegistry.registerCommand(
      { name: "minecade:wand", description: "Get the selection wand: left click a block for the first corner, right click for the second", ...anyone },
      (origin) => forPlayer(origin, (game, player) => game.wand(player)),
    );
    customCommandRegistry.registerCommand(
      { name: "minecade:set", description: "Fill your selection with a block", ...anyone, mandatoryParameters: [{ name: "block", type: CustomCommandParamType.BlockType }] },
      (origin, block: BlockType) => forPlayer(origin, (game, player) => game.set(player, blockId(block))),
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
      (origin, from: BlockType, to: BlockType) => forPlayer(origin, (game, player) => game.replace(player, blockId(from), blockId(to))),
    );
    customCommandRegistry.registerCommand(
      { name: "minecade:fix", description: "Standing in water or lava: make the pool around you still and level (7 blocks around)", ...anyone },
      (origin) => forPlayer(origin, (game, player) => game.fix(player)),
    );
  });
}
