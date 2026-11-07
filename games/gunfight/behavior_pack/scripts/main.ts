import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { Gunfight } from "./gunfight.ts";

runGameServer((ctx) => new Gunfight(ctx, config));
