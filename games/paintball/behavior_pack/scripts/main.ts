import { BlockPermutation, system, type Block } from "@minecraft/server";
import modShapes from "#mod-blocks";
import { describeError, log } from "@minecade/minigame-core";
import { runGameServer } from "@minecade/minigame-core/game";
import pack from "../../resource_pack/manifest.json";
import config from "../../game.config.ts";
import { toggled } from "./paint.ts";
import { Paintball } from "./paintball.ts";
import { PAINT_USE, parsePaintBlock } from "./shapes.ts";

// Painted doors, trapdoors and gates open and shut with a right click, as the blocks they were
// painted from (a door's other half with it).
system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent(PAINT_USE, { onPlayerInteract: ({ block }) => openOrShut(block) });
});

function openOrShut(block: Block): void {
  try {
    const states = block.permutation.getAllStates();
    const next = toggled(states);
    block.setPermutation(BlockPermutation.resolve(block.typeId, next));
    if (parsePaintBlock(block.typeId)?.shape === "door") {
      const other = states["minecade:half"] === "upper" ? block.below() : block.above();
      if (other?.typeId === block.typeId) other.setPermutation(BlockPermutation.resolve(other.typeId, { ...other.permutation.getAllStates(), "minecade:open": next["minecade:open"] }));
    }
    block.dimension.playSound(next["minecade:open"] === "true" ? "open.wooden_door" : "close.wooden_door", block.center());
  } catch (error) {
    log.warn(`paintball: could not open or shut ${block.typeId}: ${describeError(error)}`);
  }
}

// The kit form's pictures are in the game's resource pack, which the build draws them into.
runGameServer((ctx) => new Paintball(ctx, config, pack.header.uuid, modShapes));
