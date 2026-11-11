import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";
import { Chameleon } from "./chameleon.ts";

runGameServer((ctx) => new Chameleon(ctx, config));
