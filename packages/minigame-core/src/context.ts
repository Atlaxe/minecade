// What a server's script side is handed once it has booted (see bootstrap.ts).
import type { Scope } from "./scope.ts";
import type { TransferService } from "./transfer.ts";
import type { Transport } from "./transport/transport.ts";
import type { ServerVars } from "./vars.ts";

export interface ServerContext {
  vars: ServerVars;
  transport: Transport;
  transfer: TransferService;
  /** Lives as long as the server. Everything the pack sets up hangs off it. */
  root: Scope;
}
