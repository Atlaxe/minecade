// Probe: the smallest possible game on the framework. The default play() runs one stage of
// timeLimit; when it runs out the match ends as a draw and everyone goes back. The lobby's Round
// setting picks the stage length, and the match starts by saying which settings arrived.
import { Minigame, say } from "@minecade/minigame-core";
import { runGameServer } from "@minecade/minigame-core/game";
import config from "../../game.config.ts";

class Probe extends Minigame<typeof config> {
  protected override get timeLimit(): number | undefined {
    const round = Number(this.ctx.vars.settings.round);
    return Number.isInteger(round) && round > 0 ? round : super.timeLimit;
  }

  protected override onStart(): void {
    const settings = config.options.map((option) => {
      const value = this.ctx.vars.settings[option.id] ?? option.values[0].value;
      return `${option.label} ${option.values.find((entry) => entry.value === value)?.label ?? value}`;
    });
    this.broadcast(say.info(`Probe settings: ${settings.join(", ")}`));
  }
}

runGameServer((ctx) => new Probe(ctx, config));
