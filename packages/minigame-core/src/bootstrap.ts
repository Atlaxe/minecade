// Starts the script side of a lobby or game server. Once the world has loaded it reads the
// server variables, connects to the orchestrator, lets the pack set up (including its message
// handlers), and only then reports ready. Kept out of the package index because it pulls in
// "#transport", which only pack bundles can resolve.
import { world } from "@minecraft/server";
import { createTransport, kind } from "#transport";
import type { ServerContext } from "./context.ts";
import { PROTOCOL_VERSION } from "./protocol/index.ts";
import { Scope } from "./scope.ts";
import { TransferService } from "./transfer.ts";
import { readServerVars } from "./vars.ts";

export type { ServerContext } from "./context.ts";

export function bootServer(onReady: (ctx: ServerContext) => void): void {
  const handle = world.afterEvents.worldLoad.subscribe(() => {
    world.afterEvents.worldLoad.unsubscribe(handle);
    const vars = readServerVars();
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
