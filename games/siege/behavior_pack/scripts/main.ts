import { runGameServer } from "@minecade/minigame-core/game";
import pack from "../../resource_pack/manifest.json";
import config from "../../game.config.ts";
import { Siege } from "./siege.ts";

// The class form's pictures are in the game's resource pack, which the build draws them into.
runGameServer((ctx) => new Siege(ctx, config, pack.header.uuid));
