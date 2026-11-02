// Starts the script side of a lobby or game server. Once the world has loaded it reads the
// server variables, connects to the orchestrator, lets the pack set up (including its message
// handlers), and only then reports ready. Kept out of the package index because it pulls in
// "#transport", which only pack bundles can resolve.
import { world } from "@minecraft/server";
import { createTransport, kind } from "#transport";
import { playerWaypoints } from "./config.ts";
import type { ServerContext } from "./context.ts";
import { describeError, log } from "./log.ts";
import { mapTimeTicks } from "./map-config.ts";
import { PROTOCOL_VERSION } from "./protocol/index.ts";
import { Scope } from "./scope.ts";
import { TransferService } from "./transfer.ts";
import { readServerVars } from "./vars.ts";

export type { ServerContext } from "./context.ts";

export function bootServer(onReady: (ctx: ServerContext) => void): void {
  const handle = world.afterEvents.worldLoad.subscribe(() => {
    world.afterEvents.worldLoad.unsubscribe(handle);
    const vars = readServerVars();
    // Maps come from worlds built in Java and converted: command blocks left in them could clear
    // inventories or change game modes, so none run on any server.
    world.gameRules.commandBlocksEnabled = false;
    // No "new recipe unlocked" popups when players pick up wool, logs and the like.
    world.gameRules.showRecipeMessages = false;
    // Games show no players on the locator bar (the dots over the hotbar that point to the others),
    // unless the game offers Waypoints and the game screen turned it on. The rule takes a word,
    // which world.gameRules has no field for, so it's set by command.
    if (vars.role === "game") {
      try {
        world.getDimension("overworld").runCommand(`gamerule playerwaypoints ${playerWaypoints(vars.settings)}`);
      } catch (error) {
        log.warn(`could not set who shows on the locator bar: ${describeError(error)}`);
      }
    }
    // map.json "time": the sky stays at that time of day.
    const ticks = mapTimeTicks(vars.mapConfig.time);
    if (ticks !== undefined) {
      world.gameRules.doDayLightCycle = false;
      world.setTimeOfDay(ticks);
    }
    const transport = createTransport({ serverId: vars.serverId, orchestratorUrl: vars.orchestratorUrl });
    const ctx: ServerContext = { vars, transport, transfer: new TransferService(vars), root: new Scope(vars.role) };
    onReady(ctx);
    transport.send({
      t: "server_ready",
      protocol: PROTOCOL_VERSION,
      role: vars.role,
      transport: kind,
      ...(vars.sessionId ? { sessionId: vars.sessionId } : {}),
    });
  });
}
