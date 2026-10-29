// Probe: the smallest possible game, for testing the orchestrator before real games exist.
// It reports ready, greets each player, sends them back to the lobby after a short stay, and
// ends the session once everyone has left, or if nobody came. Milestone 6 replaces this
// hand-rolled loop with the Minigame framework.
import { system, world, type Player } from "@minecraft/server";
import { transferPlayer, variables } from "@minecraft/server-admin";
import { PROTOCOL_VERSION, type EndReason } from "@minecade/minigame-core/protocol";
import { createTransport, kind } from "#transport";

const STAY_SECONDS = 15;
const EMPTY_TIMEOUT_SECONDS = 60;

const sessionId = String(variables.get("sessionId"));
const mapId = String(variables.get("map"));
const lanHost = String(variables.get("lanHost"));
const publicHost = String(variables.get("publicHost"));
const lobbyPort = Number(variables.get("lobbyPort"));
const lanPlayers = new Set(
  (JSON.parse(String(variables.get("lanPlayers") ?? "[]")) as string[]).map((name) => name.toLowerCase()),
);

const transport = createTransport({ serverId: sessionId, orchestratorUrl: String(variables.get("orchestratorUrl")) });
const joinedAt = new Map<string, number>(); // player id -> tick of first spawn
const seen = new Set<string>();
let readyTick = 0;
let ending = false;

function sendToLobby(player: Player, why: string): void {
  // Players on the host's network can't reach its public address (no NAT loopback).
  const hostname = lanPlayers.has(player.name.toLowerCase()) ? lanHost : publicHost;
  player.sendMessage(`${why} Sending you back to the lobby...`);
  try {
    transferPlayer(player, { hostname, port: lobbyPort });
  } catch (error) {
    console.warn(`[probe] could not transfer ${player.name}: ${String(error)}`);
  }
}

function reportPlayers(): void {
  transport.send({ t: "player_count", sessionId, players: world.getAllPlayers().map((player) => player.name) });
}

function end(reason: EndReason): void {
  if (ending) return;
  ending = true;
  transport.send({
    t: "stats",
    sessionId,
    game: "probe",
    map: mapId,
    players: [...seen],
    kills: {},
    deaths: {},
    winner: null,
    durationSec: Math.round((system.currentTick - readyTick) / 20),
  });
  transport.send({ t: "end_game", sessionId, reason });
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn || ending) return;
  joinedAt.set(player.id, system.currentTick);
  seen.add(player.name);
  player.sendMessage(`Probe game (session ${sessionId}). You'll go back to the lobby in ${STAY_SECONDS} seconds.`);
  reportPlayers();
});

world.afterEvents.playerLeave.subscribe(() => {
  system.run(reportPlayers);
});

system.runInterval(() => {
  if (ending || readyTick === 0) return;
  const players = world.getAllPlayers();
  for (const player of players) {
    const since = joinedAt.get(player.id);
    if (since === undefined) continue;
    const left = STAY_SECONDS - Math.floor((system.currentTick - since) / 20);
    if (left > 0) {
      player.onScreenDisplay.setActionBar(`Probe: back to the lobby in ${left}s`);
    } else {
      joinedAt.delete(player.id);
      sendToLobby(player, "Probe finished.");
    }
  }
  if (players.length > 0) return;
  if (seen.size > 0) end("finished");
  else if (system.currentTick - readyTick >= EMPTY_TIMEOUT_SECONDS * 20) end("empty");
}, 20);

world.afterEvents.worldLoad.subscribe(() => {
  readyTick = system.currentTick || 1;
  transport.onMessage((message) => {
    if (message.t !== "return_all") return;
    for (const player of world.getAllPlayers()) sendToLobby(player, message.reason);
    system.runTimeout(() => end("aborted"), 40);
  });
  transport.send({ t: "server_ready", protocol: PROTOCOL_VERSION, role: "game", transport: kind, sessionId });
});
