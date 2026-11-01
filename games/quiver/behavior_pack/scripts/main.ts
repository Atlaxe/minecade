import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { Quiver } from "./quiver.ts";

runGameServer((ctx) => new Quiver(ctx, config));
