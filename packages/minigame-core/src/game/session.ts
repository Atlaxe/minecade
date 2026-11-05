// Runs a game on a game server: boots the script side, plays the match, then sends everyone back
// to the lobby and tells the orchestrator. A preview's match that's over asks each player what's
// next instead (preview.ts endPreview), and the end_game says who picked Replay and Edit (after a
// /restart, everyone). Party mode will run several factories in a row here.
import { ScriptEventSource, system, world, type Player } from "@minecraft/server";
import { bootServer } from "../bootstrap.ts";
import { describeError, log } from "../log.ts";
import { normalizePlayer } from "../player.ts";
import { homePort } from "../vars.ts";
import type { EndReason } from "../protocol/index.ts";
import type { Scope, ScopeCounts } from "../scope.ts";
import type { GameContext, Minigame } from "./minigame.ts";
import { endPreview, registerPreviewCommands, replayAll } from "./preview.ts";
import { draw, endReason } from "./results.ts";
import { removeLeftoverObjectives } from "./sidebar.ts";

/** How long to wait for players to leave after being sent back, before ending anyway. */
const EMPTY_WAIT_SECONDS = 10;

export function runGameServer(factory: (ctx: GameContext) => Minigame): void {
  let game: Minigame | undefined;
  registerPreviewCommands(() => game);
  bootServer((server) => {
    const { root, transport, vars } = server;
    removeLeftoverObjectives();
    const report = () =>
      transport.send({ t: "player_count", sessionId: vars.sessionId, players: world.getAllPlayers().map((player) => player.name) });
    root.subscribe(world.afterEvents.playerSpawn, ({ initialSpawn }) => {
      if (initialSpawn) report();
    });
    root.subscribe(world.afterEvents.playerLeave, () => root.defer(report));

    root.add(
      transport.onMessage((message) => {
        if (message.t === "return_all") game?.abort("aborted");
        else if (message.t === "team_picks") game?.setTeamPicks(message.picks);
        else if (message.t === "expected_players") game?.setExpectedPlayers(message.players);
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
    const match = factory({ ...server, random: Math.random, match: 1 });
    game = match;
    void playSession(match, server.root, baseline, async (reason) => {
      const transfer = (player: Player, port: number) => server.transfer.transfer(player, port);
      const next = !vars.preview ? undefined : match.restarting ? replayAll(vars, transfer) : reason === "finished" ? await endPreview(root, vars, transfer) : undefined;
      // After the preview's menu everyone is on their way already, where they picked.
      for (const player of next ? [] : world.getAllPlayers()) {
        normalizePlayer(player);
        server.transfer.transfer(player, homePort(vars, player.name));
      }
      for (let second = 0; second < EMPTY_WAIT_SECONDS && world.getAllPlayers().length > 0; second++) await root.wait(20);
      const picks = { ...(next?.replay.length ? { replay: next.replay } : {}), ...(next?.edit.length ? { edit: next.edit } : {}) };
      transport.send({ t: "end_game", sessionId: vars.sessionId, reason, ...picks });
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
