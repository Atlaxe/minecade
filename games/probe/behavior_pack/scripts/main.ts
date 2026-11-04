// Probe: the smallest possible game on the framework. The default play() runs one stage of
// timeLimit; when it runs out the match ends as a draw and everyone goes back. The lobby's Round
// setting picks the stage length, and the match starts by saying which settings arrived and who is
// on which team (picked in the lobby, or dealt out). Its kits are there for the kit form; the
// Painter's guns fire paint balls that splash in the team's color and hurt nobody, and a row of the
// guns' pickups floats in front of the first player.
import { world, type Vector3 } from "@minecraft/server";
import {
  GUN_PICKUP,
  Guns,
  KIND_PROPERTY,
  Minigame,
  PICKUP_KINDS,
  dyeIndex,
  dyeName,
  nameOf,
  paintSplash,
  say,
  type GameContext,
} from "@minecade/minigame-core";
import { runGameServer } from "@minecade/minigame-core/game";
import pack from "../../resource_pack/manifest.json";
import config from "../../game.config.ts";

class Probe extends Minigame<typeof config> {
  constructor(ctx: GameContext, gameConfig: typeof config, picturePack: string) {
    super(ctx, gameConfig);
    this.kitPicturePack = picturePack;
  }

  protected override setup(): void {
    new Guns(this.scope, {
      canFire: (player) => this.roster.get(player.name)?.state === "alive",
      colorOf: (player) => dyeIndex(dyeName(this.teamOf(player.name)?.color)),
      onHitBlock: (shot, _hit, location) => paintSplash(location, shot.color),
      onHitEntity: (shot, _entity, location) => paintSplash(location, shot.color),
      onBurst: (shot, location) => paintSplash(location, shot.color, 3),
    });
  }

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
    const first = world.getAllPlayers()[0];
    if (first) this.showPickups(first.location);
  }

  /** Each gun's pickup in a row a few blocks south of `from`, to look at the models. */
  private showPickups(from: Vector3): void {
    const dimension = world.getDimension("overworld");
    PICKUP_KINDS.forEach((_kind, i) => {
      const pickup = dimension.spawnEntity(GUN_PICKUP, { x: Math.floor(from.x) - 3 + i * 2 + 0.5, y: Math.floor(from.y), z: Math.floor(from.z) + 4.5 });
      pickup.setProperty(KIND_PROPERTY, i);
      this.track(pickup);
    });
  }
}

// The kit form's pictures are in the game's resource pack, which the build draws them into.
runGameServer((ctx) => new Probe(ctx, config, pack.header.uuid));
