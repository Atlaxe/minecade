// Probe: the smallest possible game on the framework. The default play() runs one stage of
// timeLimit; when it runs out the match ends as a draw and everyone goes back. The lobby's Round
// setting picks the stage length, and the match starts by saying which settings arrived and who is
// on which team (picked in the lobby, or dealt out). Its kits are there for the kit form; the
// Painter's guns, in the team's paint, fire balls that splash in it and hurt nobody, and a row of
// the guns' pickups floats in front of the first player. The Gunner's and Grenadier's arsenal fires
// and blasts for real but hurts nobody either: each hit says in chat what it would have taken, the
// held gun's ammo shows top right, and a second row floats the arsenal's models. Letting go of a held
// gun's right click (the Paintball Rifle, SMG, Assault Rifle) says in chat what it fired, how long
// it was down and how Bedrock reported the button, to tune held fire. For the Holds kit's Test H, while a
// player holds one of its items the aim marker comes and goes from their off hand every 2 seconds.
import { EquipmentSlot, ItemStack, world, type Player, type Vector3 } from "@minecraft/server";
import { ARSENAL_MODELS, ARSENAL_PICKUP, Arsenal, GUN_PICKUP, Guns, KIND_PROPERTY, MODEL_PROPERTY, PICKUP_KINDS, paintSplash, type TriggerReport } from "@minecade/guns";
import { AIM_MARKER } from "@minecade/guns/defs";
import { Minigame, SCOPE_CODE, nameOf, say, type GameContext } from "@minecade/minigame-core";
import { runGameServer } from "@minecade/minigame-core/game";
import pack from "../../resource_pack/manifest.json";
import config from "../../game.config.ts";

const HOLD_TEST = "minecade:hold_test_";

class Probe extends Minigame<typeof config> {
  private arsenal?: Arsenal;
  /** Players whose off hand holds an aim marker Probe put there (Test H), not Guns. */
  private readonly testMarkers = new Set<string>();

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
      {
        onAmmo: (player) => this.refreshHud(player.name),
        onAim: (player) => this.refreshHud(player.name),
        onTrigger: (player, report) => this.reportTrigger(player, report),
      },
    );
    // Test H: a held model that sees the aim marker in the off hand moves 8 up or sideways and back
    // every 2 seconds. (Playing an animation on the player to set a variable didn't reach a held
    // model, and it jerked the player's arm.)
    let up = false;
    this.scope.interval(() => {
      up = !up;
      for (const player of world.getAllPlayers()) this.flipTestMarker(player, up);
    }, 40);
    this.scope.interval(() => {
      for (const player of world.getAllPlayers()) if (!this.holdsTest(player)) this.flipTestMarker(player, false);
    }, 5);
  }

  private holdsTest(player: Player): boolean {
    return player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId.startsWith(HOLD_TEST) ?? false;
  }

  /** Test H: puts the aim marker in an empty off hand while a Holds test item is held, or takes back the one it put there. */
  private flipTestMarker(player: Player, on: boolean): void {
    const equipment = player.getComponent("minecraft:equippable");
    if (!equipment) return;
    if (on && this.holdsTest(player) && !equipment.getEquipment(EquipmentSlot.Offhand)) {
      equipment.setEquipment(EquipmentSlot.Offhand, new ItemStack(AIM_MARKER.item));
      this.testMarkers.add(player.name);
    } else if (!on && this.testMarkers.delete(player.name) && equipment.getEquipment(EquipmentSlot.Offhand)?.typeId === AIM_MARKER.item) {
      equipment.setEquipment(EquipmentSlot.Offhand, undefined);
    }
  }

  /**
   * "smg held 40 ticks: 20 shots, in use", "smg held 30 ticks: 15 shots, 6 repeats 4 to 5 ticks
   * apart (mostly 4)" (at a block), or "smg held 10 ticks: 5 shots, no release or repeats".
   */
  private reportTrigger(player: Player, { gun, shots, ticks, held, gaps }: TriggerReport): void {
    let how = "in use";
    if (held === "press") how = "no release or repeats";
    if (held === "repeats") {
      const counts = new Map<number, number>();
      for (const gap of gaps) counts.set(gap, (counts.get(gap) ?? 0) + 1);
      const most = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      how = `${gaps.length} repeats, ${Math.min(...gaps)} to ${Math.max(...gaps)} ticks apart (mostly ${most})`;
    }
    const line = `${gun} held ${ticks} ticks: ${shots} shots, ${how}`;
    console.warn(`[probe] ${player.name} ${line}`);
    player.sendMessage(say.minor(line));
  }

  /** The held arsenal gun's ammo, top right beside the clock. */
  protected override hud(name: string): string | undefined {
    const player = this.player(name);
    return (player && this.arsenal?.ammoLine(player)) ?? super.hud(name);
  }

  /** The Sniper Rifle's scope over the screen while it's raised. */
  protected override hudCodes(name: string): string {
    return this.arsenal?.guns.isScoped(name) ? SCOPE_CODE : "";
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
