// Sends players to another server. Players on the host's own network can't reach its public
// address (no NAT loopback), so names listed in LAN_PLAYERS go to the LAN address instead.
import type { Player } from "@minecraft/server";
import { transferPlayer } from "@minecraft/server-admin";
import { describeError, log } from "./log.ts";
import { say } from "./text.ts";
import type { ServerVars } from "./vars.ts";

export class TransferService {
  private readonly lanHost: string;
  private readonly publicHost: string;
  private readonly lanPlayers: Set<string>;

  constructor(vars: Pick<ServerVars, "lanHost" | "publicHost" | "lanPlayers">) {
    this.lanHost = vars.lanHost;
    this.publicHost = vars.publicHost;
    this.lanPlayers = new Set(vars.lanPlayers.map((name) => name.toLowerCase()));
  }

  hostFor(name: string): string {
    return this.lanPlayers.has(name.toLowerCase()) ? this.lanHost : this.publicHost;
  }

  /**
   * Starts a transfer. Returns false if it could not start. A transfer that fails on the
   * player's side (an unreachable address) can't be detected here.
   */
  transfer(player: Player, port: number): boolean {
    if (!player.isValid) return false;
    const hostname = this.hostFor(player.name);
    const route = hostname === this.lanHost ? "in LAN_PLAYERS" : "not in LAN_PLAYERS, public";
    log.info(`sending ${player.name} to ${hostname}:${port} (${route})`);
    try {
      transferPlayer(player, { hostname, port });
      return true;
    } catch (error) {
      log.warn(`could not transfer ${player.name}: ${describeError(error)}`);
      player.sendMessage(say.error("Couldn't send you to the other server. Ask the host to check the logs."));
      return false;
    }
  }
}
