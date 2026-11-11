import { runGameServer } from "@minecade/minigame-core/game";
import { registerBuildingCommands } from "@minecade/minigame-core/building";
import config from "../../game.config.ts";
import { BuildSwap } from "./buildswap.ts";

let game: BuildSwap | undefined;

// /floor, /wand, /set, /replace and /fix, for the area you're building in (the building kit's commands.ts).
registerBuildingCommands(() => game);

runGameServer((ctx) => (game = new BuildSwap(ctx, config)));
