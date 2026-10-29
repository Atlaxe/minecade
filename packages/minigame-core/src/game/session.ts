// Runs a game on a game server: boots the script side, plays the match, then sends everyone back
// to the lobby and tells the orchestrator. Party mode will run several factories in a row here.
import { ScriptEventSource, system, world } from "@minecraft/server";
import { bootServer } from "../bootstrap.ts";
import { describeError, log } from "../log.ts";
import { normalizePlayer } from "../player.ts";
import type { EndReason } from "../protocol/index.ts";
import type { Scope, ScopeCounts } from "../scope.ts";
import type { GameContext, Minigame } from "./minigame.ts";
import { draw, endReason } from "./results.ts";
import { removeLeftoverObjectives } from "./sidebar.ts";

/** How long to wait for players to leave after being sent back, before ending anyway. */
const EMPTY_WAIT_SECONDS = 10;

export function runGameServer(factory: (ctx: GameContext) => Minigame): void {
  bootServer((server) => {
    const { root, transport, vars } = server;
    removeLeftoverObjectives();
    const report = () =>
      transport.send({ t: "player_count", sessionId: vars.sessionId, players: world.getAllPlayers().map((player) => player.name) });
    root.subscribe(world.afterEvents.playerSpawn, ({ initialSpawn }) => {
      if (initialSpawn) report();
    });
    root.subscribe(world.afterEvents.playerLeave, () => root.defer(report));

    let game: Minigame | undefined;
    root.add(
      transport.onMessage((message) => {
        if (message.t === "return_all") game?.abort("aborted");
        else if (message.t === "team_picks") game?.setTeamPicks(message.picks);
      }),
    );
    root.subscribe(
      system.afterEvents.scriptEventReceive,
      (event) => {
        if (event.id !== "minecade:debug" || event.sourceType !== ScriptEventSource.Server) return;
        const command = event.message.trim();
        if (command === "scopes") log.info(`live: ${JSON.stringify(root.live())}`);
        else if (command === "end") game?.finish(draw("ended from the console"));
        else if (command === "skip") game?.skipStage();
        else log.warn(`minecade:debug: unknown command "${command}" (scopes, end, skip)`);
      },
      { namespaces: ["minecade"] },
    );

    const baseline = root.live();
    game = factory({ ...server, random: Math.random, match: 1 });
    void playSession(game, server.root, baseline, async (reason) => {
      for (const player of world.getAllPlayers()) {
        normalizePlayer(player);
        server.transfer.transfer(player, vars.lobbyPort);
      }
      for (let second = 0; second < EMPTY_WAIT_SECONDS && world.getAllPlayers().length > 0; second++) await root.wait(20);
      transport.send({ t: "end_game", sessionId: vars.sessionId, reason });
    });
  });
}

/** Runs the match, checks nothing leaked, then hands over to `finish` (send everyone back, end the session). */
export async function playSession(
  game: Minigame,
  root: Scope,
  baseline: ScopeCounts,
  finish: (reason: EndReason) => Promise<void>,
): Promise<void> {
  let reason: EndReason = "error";
  try {
    reason = endReason(await game.run());
  } catch (error) {
    log.error(`the game crashed: ${describeError(error)}`);
  }
  const live = root.live();
  if (live.scopes > baseline.scopes || live.subscriptions > baseline.subscriptions || live.runs > baseline.runs) {
    log.warn(`the game left resources behind: ${JSON.stringify(live)} (before the game: ${JSON.stringify(baseline)})`);
  }
  await finish(reason);
}
