// Probe: the smallest possible game on the framework. The default play() runs one stage of
// timeLimit; when it runs out the match ends as a draw and everyone goes back. The lobby's Round
// setting picks the stage length, and the match starts by saying which settings arrived and who is
// on which team (picked in the lobby, or dealt out).
import { world } from "@minecraft/server";
import { Minigame, nameOf, say } from "@minecade/minigame-core";
import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";

class Probe extends Minigame<typeof config> {
  protected override get timeLimit(): number | undefined {
    const round = Number(this.ctx.vars.settings.round);
    return Number.isInteger(round) && round > 0 ? round : super.timeLimit;
  }

  protected override onStart(): void {
    const settings = this.ctx.vars.settings;
    const round = config.options[0].values.find((entry) => entry.value === settings.round)?.label ?? `${this.timeLimit} s`;
    this.broadcast(say.info(`Probe settings: Teams ${settings.teams ?? "(not set)"}, Round ${round}`));
    const teams = world.getAllPlayers().map((player) => {
      const team = this.teamOf(player.name);
      return `${nameOf(player.name, team?.color)} ${team ? nameOf(team.name, team.color) : "no team"}`;
    });
    this.broadcast(say.info(`Teams: ${teams.join(", ")}`));
  }
}

runGameServer((ctx) => new Probe(ctx, config));
