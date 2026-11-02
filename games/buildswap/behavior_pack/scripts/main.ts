import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { BuildSwap } from "./buildswap.ts";

runGameServer((ctx) => new BuildSwap(ctx, config));
