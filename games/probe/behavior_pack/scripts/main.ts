// Probe: the smallest possible game on the framework. The default play() runs one stage of
// timeLimitSeconds; when it runs out the match ends as a draw and everyone goes back.
import { Minigame } from "@minecade/minigame-core";
import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";

class Probe extends Minigame<typeof config> {}

runGameServer((ctx) => new Probe(ctx, config));
