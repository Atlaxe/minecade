// Probe: the smallest possible game on the framework. The default play() runs one stage of
// timeLimit; when it runs out the match ends as a draw and everyone goes back. The lobby's Round
// setting picks the stage length, and the match starts by saying which settings arrived and who is
// on which team (picked in the lobby, or dealt out). Its kits are there for the kit form; the
// Painter's guns, in the team's paint, fire balls that splash in it and hurt nobody, and a row of
// the guns' pickups floats in front of the first player. The Gunner's and Grenadier's arsenal fires
// and blasts for real but hurts nobody either: each hit says in chat what it would have taken, the
// held gun's ammo shows top right, and a second row floats the arsenal's models. Letting go of a held
// gun (the Paintball Rifle, SMG, Assault Rifle) says in chat what it fired and how far apart Bedrock
// reported the held button's swings, to tune their triggerTicks.
import { world, type Player, type Vector3 } from "@minecraft/server";
import { ARSENAL_MODELS, ARSENAL_PICKUP, Arsenal, GUN_PICKUP, Guns, KIND_PROPERTY, MODEL_PROPERTY, PICKUP_KINDS, paintSplash, type TriggerReport } from "@minecade/guns";
import { Minigame, nameOf, say, type GameContext } from "@minecade/minigame-core";
import { runGameServer } from "@minecade/minigame-core/game";
import pack from "../../resource_pack/manifest.json";
import config from "../../game.config.ts";

class Probe extends Minigame<typeof config> {
  private arsenal?: Arsenal;

  constructor(ctx: GameContext, gameConfig: typeof config, picturePack: string) {
    super(ctx, gameConfig);
    this.kitPicturePack = picturePack;
  }

  protected override setup(): void {
    new Guns(this.scope, {
      canFire: (player) => this.roster.get(player.name)?.state === "alive",
      onHitBlock: (shot, _hit, location) => paintSplash(location, shot.color),
      onHitEntity: (shot, _entity, location) => paintSplash(location, shot.color),
      onBurst: (shot, location) => paintSplash(location, shot.color, 3),
      onTrigger: (player, report) => this.reportTrigger(player, report),
    });
    const alive = (name: string) => this.roster.get(name)?.state === "alive";
    this.arsenal = new Arsenal(
      this.scope,
      {
        canFire: (player) => alive(player.name),
        targets: () => world.getAllPlayers().filter((player) => alive(player.name)),
        nameOf: (entity) => (entity.typeId === "minecraft:player" ? (entity as Player).name : undefined),
        hurt: (victim, attacker, amount, cause) => {
          const taken = amount === "lethal" ? "everything" : `${Math.round(amount * 10) / 10}`;
          this.broadcast(say.minor(`${attacker ?? "Their own"} ${cause} hit ${(victim as Player).name}: ${taken}`));
          return "hurt";
        },
      },
      { onAmmo: (player) => this.refreshHud(player.name), onTrigger: (player, report) => this.reportTrigger(player, report) },
    );
  }

  /** "smg held: 14 shots, swings 4 to 9 ticks apart (mostly 4)", or one click's. */
  private reportTrigger(player: Player, { gun, shots, swingGaps }: TriggerReport): void {
    let swings = "one swing";
    if (swingGaps.length > 0) {
      const counts = new Map<number, number>();
      for (const gap of swingGaps) counts.set(gap, (counts.get(gap) ?? 0) + 1);
      const most = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      swings = `${swingGaps.length + 1} swings, ${Math.min(...swingGaps)} to ${Math.max(...swingGaps)} ticks apart (mostly ${most})`;
    }
    const line = `${gun} held: ${shots} shots, ${swings}`;
    console.warn(`[probe] ${player.name} ${line}`);
    player.sendMessage(say.minor(line));
  }

  /** The held arsenal gun's ammo, top right beside the clock. */
  protected override hud(name: string): string | undefined {
    const player = this.player(name);
    return (player && this.arsenal?.ammoLine(player)) ?? super.hud(name);
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

  /** Each gun's pickup in a row a few blocks south of `from`, and the arsenal's in a row behind it, to look at the models. */
  private showPickups(from: Vector3): void {
    const dimension = world.getDimension("overworld");
    PICKUP_KINDS.forEach((_kind, i) => {
      const pickup = dimension.spawnEntity(GUN_PICKUP, { x: Math.floor(from.x) - 3 + i * 2 + 0.5, y: Math.floor(from.y), z: Math.floor(from.z) + 4.5 });
      pickup.setProperty(KIND_PROPERTY, i);
      this.track(pickup);
    });
    ARSENAL_MODELS.forEach((_model, i) => {
      const pickup = dimension.spawnEntity(ARSENAL_PICKUP, { x: Math.floor(from.x) - 14 + i * 2 + 0.5, y: Math.floor(from.y), z: Math.floor(from.z) + 7.5 });
      pickup.setProperty(MODEL_PROPERTY, i);
      this.track(pickup);
    });
  }
}

// The kit form's pictures are in the game's resource pack, which the build draws them into.
runGameServer((ctx) => new Probe(ctx, config, pack.header.uuid));
