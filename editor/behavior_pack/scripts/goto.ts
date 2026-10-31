// The host's "goto": moves players to another of the editor's servers, each by the address that
// reaches them (LAN or public, by LAN_PLAYERS), the way the lobby sends players to games.
import { world, type Player } from "@minecraft/server";
import { uiManager } from "@minecraft/server-ui";
import { TransferService, readServerVars } from "@minecade/minigame-core";

let transfers: TransferService | undefined;

export function goto(players: string[], port: number, label: string, tell: (player: Player, text: string) => void): void {
  transfers ??= new TransferService(readServerVars());
  const wanted = new Set(players.map((name) => name.toLowerCase()));
  for (const player of world.getAllPlayers()) {
    if (!wanted.has(player.name.toLowerCase())) continue;
    tell(player, `Moving you to ${label}...`);
    uiManager.closeAllForms(player);
    transfers.transfer(player, port);
  }
}
