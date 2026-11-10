import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { GunGame } from "./gungame.ts";

runGameServer((ctx) => new GunGame(ctx, config));
