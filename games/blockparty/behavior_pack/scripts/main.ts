import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { BlockPartySpike } from "./spike.ts";

runGameServer((ctx) => new BlockPartySpike(ctx, config));
