// Probe: the smallest possible game, for testing the orchestrator and the lobby before real
// games exist. It greets each player, sends them back to the lobby after a short stay, and
// ends the session once everyone has left, or if nobody came. Milestone 6 replaces this
// hand-rolled loop with the Minigame framework.
import { system, world } from "@minecraft/server";
import { bootServer } from "@minecade/minigame-core/bootstrap";
import type { EndReason } from "@minecade/minigame-core/protocol";

const STAY_SECONDS = 15;
const EMPTY_TIMEOUT_SECONDS = 60;

bootServer(({ vars, transport, transfer, root }) => {
  const { sessionId } = vars;
  const readyTick = system.currentTick;
  const joinedAt = new Map<string, number>(); // player id -> tick of first spawn
  const seen = new Set<string>();
  let ending = false;

  const reportPlayers = () =>
    transport.send({ t: "player_count", sessionId, players: world.getAllPlayers().map((player) => player.name) });

  function end(reason: EndReason): void {
    if (ending) return;
    ending = true;
    transport.send({
      t: "stats",
      sessionId,
      game: "probe",
      map: vars.map,
      players: [...seen],
      kills: {},
      deaths: {},
      winner: null,
      durationSec: Math.round((system.currentTick - readyTick) / 20),
    });
    transport.send({ t: "end_game", sessionId, reason });
  }

  root.subscribe(world.afterEvents.playerSpawn, ({ player, initialSpawn }) => {
    if (!initialSpawn || ending) return;
    joinedAt.set(player.id, system.currentTick);
    seen.add(player.name);
    player.sendMessage(`Probe game (session ${sessionId}). You'll go back to the lobby in ${STAY_SECONDS} seconds.`);
    reportPlayers();
  });

  root.subscribe(world.afterEvents.playerLeave, () => {
    root.timeout(reportPlayers, 1);
  });

  root.interval(() => {
    if (ending) return;
    const players = world.getAllPlayers();
    for (const player of players) {
      const since = joinedAt.get(player.id);
      if (since === undefined) continue;
      const left = STAY_SECONDS - Math.floor((system.currentTick - since) / 20);
      if (left > 0) {
        player.onScreenDisplay.setActionBar(`Probe: back to the lobby in ${left}s`);
      } else {
        joinedAt.delete(player.id);
        player.sendMessage("Probe finished. Sending you back to the lobby...");
        transfer.transfer(player, vars.lobbyPort);
      }
    }
    if (players.length > 0) return;
    if (seen.size > 0) end("finished");
    else if (system.currentTick - readyTick >= EMPTY_TIMEOUT_SECONDS * 20) end("empty");
  }, 20);

  root.add(
    transport.onMessage((message) => {
      if (message.t !== "return_all") return;
      for (const player of world.getAllPlayers()) {
        player.sendMessage(`${message.reason} Sending you back to the lobby...`);
        transfer.transfer(player, vars.lobbyPort);
      }
      root.timeout(() => end("aborted"), 40);
    }),
  );
});
