import { runGameServer } from "@minecade/minigame-core/game";
import pack from "../../resource_pack/manifest.json";
import config from "../../game.config.ts";
import { Bridges } from "./bridges.ts";

// The kit form's pictures are in the game's resource pack, which the build draws them into.
runGameServer((ctx) => new Bridges(ctx, config, pack.header.uuid));
