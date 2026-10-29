import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { Sumo } from "./sumo.ts";

runGameServer((ctx) => new Sumo(ctx, config));
