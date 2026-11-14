// Chameleon on the minigame framework. Core runs the rest: the seekers and the hiders as role teams
// (one seeker, everyone else hiding), the countdown at the team spawns, the clock, the respawns and
// the end. This class plays the hide (the seekers held blinded at their spawn for the map's Hide
// time), then the seek; gives each side its hotbar; fires the arsenal's Pump Shotgun, with no
// magazine to run out, at the hiders and their free look stand-ins (one pellet finds a hider); turns a hider shot down into a
// seeker; throws a seeker a hider hits; and runs the seekers' Detector.
//
// The hiders' own side is the chameleon pack (private_packs/chameleon, from the workshop's
// chameleon-test): it knows a hider by their Wear block item and a seeker by their Detector, and
// does the costumes, poses, cameras, Lock position, free look's stand-in (tagged with its hider's
// name, STAND_IN_OWNER), hiding hiders from each other and the costume pictures on the right. The
// game tells it what only the game knows by script events (PACK_EVENTS).
import { EntityComponentTypes, ItemLockMode, ItemStack, system, world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { ARSENAL_GUN_DEFS, Arsenal, heldItem, type ArsenalCause, type HurtResult } from "@minecade/guns";
import { Minigame, say, type Down, type DownDecision, type Hit, type Result, type SpawnReason, type Stage } from "@minecade/minigame-core";
import type config from "../../game.config.ts";

export const HIDERS = "hiders";
export const SEEKERS = "seekers";
/** The first stage, while the seekers wait. */
export const HIDE_STAGE = "Hide";
/** Free look's stand-in (the chameleon pack's), and the tag naming its hider. */
export const STAND_IN = "chameleon:stand_in";
export const STAND_IN_OWNER = "chameleon_owner:";
/**
 * What the game tells the chameleon pack: a Chameleon match is on (it leaves the hits, the roles'
 * items and the placeholder pictures to the game); bring a hider back to their stand-in; and a
 * hider is found (their costume and picture go, and they stay where core puts them).
 */
export const PACK_EVENTS = { match: "chameleon:match", back: "chameleon:return", out: "chameleon:out" } as const;
const FOREVER_TICKS = 1_000_000;
/** Blindness lasts a little past the hide, so it can't flicker off before the release. */
const BLIND_EXTRA_TICKS = 20;
const BEEP = "note.pling";

type HotbarItem = { readonly item: string; readonly name?: string; readonly slot: number };
type DetectorBand = (typeof config)["detector"]["bands"][number];

export class Chameleon extends Minigame<typeof config> {
  private arsenal?: Arsenal;
  /** Whether the hide is over and the seekers are hunting. */
  private seeking = false;
  /** When each seeker's Detector works again (lowercase name to tick). */
  private readonly detectorReady = new Map<string, number>();
  /** What each seeker's experience bar shows (lowercase name to level * 1000 + points), so it's set only when it changes. */
  private readonly barShown = new Map<string, number>();
  /** When a hider last threw each seeker (lowercase name to tick). */
  private readonly lastThrown = new Map<string, number>();
  /** The tick a Detector last went off on a block for each seeker, so the same click's air use doesn't count twice. */
  private readonly detectedOnBlock = new Map<string, number>();

  protected override setup(): void {
    tellPack(PACK_EVENTS.match, "");
    // The Pump Shotgun with no magazine: it never runs out or reloads, only its fire rate holds it back.
    const shotgun = { ...ARSENAL_GUN_DEFS.pump_shotgun, ammo: undefined };
    this.arsenal = new Arsenal(
      this.scope,
      {
        canFire: (player) => this.seeking && this.isSeeker(player.name) && this.roster.get(player.name)?.state === "alive",
        targets: () => this.hiderBodies().map((hider) => hider.body),
        // Only hiders are bodies to the shotgun: shots pass through the other seekers.
        nameOf: (entity) => {
          const name = this.ownerOf(entity);
          return name !== undefined && this.isHider(name) ? name : undefined;
        },
        hurt: (victim, attacker, amount, cause) => this.shot(victim, attacker, amount, cause),
      },
      { guns: [shotgun], throwables: [], random: () => this.ctx.random(), onAmmo: (player) => this.refreshHud(player.name) },
    );
    const detector = this.detectorItem();
    this.scope.subscribeBefore(world.beforeEvents.playerInteractWithBlock, (event) => {
      if (!isItem(event.itemStack, detector)) return;
      event.cancel = true;
      if (!event.isFirstEvent) return;
      const player = event.player;
      this.detectedOnBlock.set(player.name.toLowerCase(), system.currentTick);
      system.run(() => player.isValid && this.detect(player));
    });
    this.scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (!isItem(itemStack, detector)) return;
      const onBlock = this.detectedOnBlock.get(source.name.toLowerCase());
      if (onBlock !== undefined && system.currentTick - onBlock <= 2) return;
      this.detect(source);
    });
    this.scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => this.thrown(damagingEntity, hitEntity));
    this.scope.interval(() => this.showCooldowns(), 2);
  }

  /** Alone (a test with DEV_MIN_PLAYERS=1), you hide: the one seeker's place goes unfilled, and the clock runs out. */
  protected override onStart(): void {
    const everyone = this.roster.all();
    if (everyone.length === 1 && this.isSeeker(everyone[0].name)) {
      this.moveToTeam(everyone[0].name, HIDERS);
      this.spawn(everyone[0].name, "start");
    }
    const hide = this.mapSetting("hideSeconds");
    this.broadcast(say.info(`Hiders: ${hide} seconds to hide. Wear a block that blends in.`));
    this.broadcast(say.minor("Seekers: shoot the hiders down. Everyone found joins the hunt."));
  }

  /** The hide (the seekers held blinded at their spawn), then the seek on the match's clock. */
  protected override async play(): Promise<Result | void> {
    await this.stage(HIDE_STAGE, { seconds: this.mapSetting("hideSeconds") }, (stage) => {
      for (const seeker of this.roster.teamMembers(SEEKERS)) this.holdSeeker(seeker.name, stage);
    });
    this.seeking = true;
    this.title(say.warn("Ready or not!"), say.minor("Here come the seekers"));
    const { timedOut } = await this.stage("Seek", { seconds: this.timeLimit });
    if (timedOut) return this.onTimeUp();
  }

  /** The seekers win once every hider is found; the hiders win if every seeker leaves. Never alone. */
  protected override checkWin(): Result | undefined {
    if (this.roster.all().length < 2) return undefined;
    const hiding = this.roster.teamMembers(HIDERS).filter((member) => member.state === "alive" || member.state === "respawning");
    if (hiding.length === 0) return this.teamWins(SEEKERS, "found every hider");
    const seekers = this.roster.teamMembers(SEEKERS).filter((member) => member.state !== "left" && member.state !== "out");
    if (seekers.length === 0) return this.teamWins(HIDERS, "the seekers left");
    return undefined;
  }

  /** Each side's hotbar; hiders are weak. A seeker who comes in during the hide is held too. */
  protected override onSpawn(player: Player, _why: SpawnReason): void {
    const key = player.name.toLowerCase();
    this.arsenal?.refill(player.name);
    this.barShown.delete(key);
    const hider = this.isHider(player.name);
    giveHotbar(player, hider ? this.config.hotbars.hiders : this.config.hotbars.seekers);
    if (hider) player.addEffect("weakness", FOREVER_TICKS, { amplifier: 0, showParticles: false });
    const stage = this.activeStage;
    if (!hider && stage?.name === HIDE_STAGE) this.holdSeeker(player.name, stage);
  }

  /** A hider down (shot, or out of the map) is found: they come back as a seeker. A seeker just comes back. */
  protected override onDown(name: string, _down: Down): DownDecision | void {
    this.arsenal?.forget(name);
    if (!this.isHider(name)) return "respawn";
    tellPack(PACK_EVENTS.out, name);
    const player = this.player(name);
    try {
      player?.getComponent(EntityComponentTypes.Inventory)?.container.clearAll();
    } catch {
      // left
    }
    this.moveToTeam(name, SEEKERS);
    player?.sendMessage(say.warn("You were found! You're a seeker now."));
    return "respawn";
  }

  /**
   * Only a hider's hit on a seeker counts, while the seekers hunt: half a heart, never their last
   * (thrown does the throw). Seekers find with the shotgun alone.
   */
  protected override onDamage(hit: Hit): number | "cancel" | void {
    if (hit.cause !== "entityAttack" || hit.attacker === undefined) return;
    if (!this.seeking || !this.isHider(hit.attacker) || !this.isSeeker(hit.victim)) return "cancel";
    // Core: the reported health already has this hit taken off.
    const before = (this.body(hit.victim)?.getComponent(EntityComponentTypes.Health)?.currentValue ?? 20) + hit.damage;
    return hiderHitDamage(before, this.config.hiderHit.damage);
  }

  /** The hiders still hiding, top right. */
  protected override hud(_name: string): string | undefined {
    if (this.phase !== "playing") return undefined;
    const left = this.roster.teamMembers(HIDERS).filter((member) => member.state === "alive").length;
    return say.info(`${left} hider${left === 1 ? "" : "s"} left`);
  }

  protected override onEnd(): void {
    for (const hider of this.roster.teamMembers(HIDERS)) tellPack(PACK_EVENTS.back, hider.name);
  }

  // ---- The hide -------------------------------------------------------------------------------

  /** Holds a seeker still and blind at their spawn until the hide stage ends. */
  private holdSeeker(name: string, stage: Stage): void {
    this.freeze([name], stage.scope);
    const player = this.player(name);
    if (!player) return;
    try {
      player.addEffect("blindness", (stage.secondsLeft ?? 0) * 20 + BLIND_EXTRA_TICKS, { amplifier: 0, showParticles: false });
    } catch {
      // left
    }
    this.title(say.warn("Wait"), say.minor("The hiders are hiding"), name, Math.max(30, (stage.secondsLeft ?? 0) * 20));
    stage.scope.add(() => {
      try {
        if (player.isValid) player.removeEffect("blindness");
      } catch {
        // left
      }
    });
  }

  // ---- The shotgun ----------------------------------------------------------------------------

  /** Each hider still hiding, and the body seekers can shoot: their stand-in while they're in free look, else themselves. */
  private hiderBodies(): { name: string; body: Entity }[] {
    const standIns = new Map<string, Entity>();
    try {
      for (const entity of world.getDimension("overworld").getEntities({ type: STAND_IN })) {
        const owner = standInOwner(entity);
        if (owner) standIns.set(owner.toLowerCase(), entity);
      }
    } catch {
      // none loaded
    }
    return this.roster.inState("alive").flatMap((member) => {
      if (member.team !== HIDERS) return [];
      const body = standIns.get(member.name.toLowerCase()) ?? this.body(member.name);
      return body ? [{ name: member.name, body }] : [];
    });
  }

  /** A participant's name for a body: a player, a preview's fake player, or a stand-in's hider. */
  private ownerOf(entity: Entity): string | undefined {
    return this.whoIs(entity) ?? (entity.typeId === STAND_IN ? standInOwner(entity) : undefined);
  }

  /**
   * A shot that hit a hider or their stand-in finds them: one pellet is enough, whatever its
   * damage, through core's combat (a hit in free look brings them back first).
   */
  private shot(victim: Entity, attacker: string | undefined, _amount: number | "lethal", cause: ArsenalCause): HurtResult {
    const name = this.ownerOf(victim);
    if (name === undefined || !this.isHider(name)) return undefined;
    const body = this.body(name);
    if (!body) return undefined;
    if (victim.typeId === STAND_IN) tellPack(PACK_EVENTS.back, name);
    return this.combat.hit(body, attacker, "lethal", cause, { direct: true });
  }

  // ---- Hiders hitting seekers -------------------------------------------------------------------

  /** A hider's hit throws a seeker the way the hider faces, once per pause. */
  private thrown(attackerEntity: Entity | undefined, victimEntity: Entity | undefined): void {
    const attacker = this.whoIs(attackerEntity);
    const victim = this.whoIs(victimEntity);
    if (!this.seeking || attacker === undefined || victim === undefined || !attackerEntity || !victimEntity) return;
    if (!this.isHider(attacker) || !this.isSeeker(victim)) return;
    if (this.roster.get(attacker)?.state !== "alive" || this.roster.get(victim)?.state !== "alive") return;
    const { horizontal, vertical, pauseTicks } = this.config.hiderHit;
    const key = victim.toLowerCase();
    const now = system.currentTick;
    if (now - (this.lastThrown.get(key) ?? Number.NEGATIVE_INFINITY) < pauseTicks) return;
    this.lastThrown.set(key, now);
    const { x, z } = facing(attackerEntity.getRotation().y);
    try {
      victimEntity.applyKnockback({ x: x * horizontal, z: z * horizontal }, vertical);
    } catch {
      // gone
    }
  }

  // ---- The Detector ---------------------------------------------------------------------------

  private detectorItem(): HotbarItem {
    const item = this.config.hotbars.seekers.find((entry) => "name" in entry && entry.name === "Detector");
    if (!item) throw new Error("chameleon: the seekers' hotbar has no Detector");
    return item;
  }

  /** How near the nearest hider (or stand-in) is: beeps and a word, then the cooldown. */
  private detect(player: Player): void {
    if (!this.seeking || !this.isSeeker(player.name) || this.roster.get(player.name)?.state !== "alive") return;
    const key = player.name.toLowerCase();
    const now = system.currentTick;
    if (now < (this.detectorReady.get(key) ?? 0)) return; // the experience bar shows the wait
    const { cooldownSeconds, bands } = this.config.detector;
    const nearest = nearestDistance(player.location, this.hiderBodies().map((hider) => hider.body.location));
    if (nearest === undefined) return;
    this.detectorReady.set(key, now + cooldownSeconds * 20);
    const band = detectorBand(bands, nearest);
    for (let beep = 0; beep < band.beeps; beep++) {
      this.scope.timeout(() => {
        try {
          if (player.isValid) player.playSound(BEEP, { pitch: band.pitch, volume: 0.8 });
        } catch {
          // left
        }
      }, 1 + beep * band.gapTicks);
    }
    player.sendMessage(`${say.highlight(band.word)}${say.minor(`: ${band.text}`)}`);
  }

  /** While a seeker holds the Detector: the seconds left as the level, and the bar emptying as the wait runs out. */
  private showCooldowns(): void {
    const detector = this.detectorItem();
    const total = this.config.detector.cooldownSeconds * 20;
    for (const seeker of this.roster.teamMembers(SEEKERS)) {
      const player = this.player(seeker.name);
      if (!player) continue;
      const key = seeker.name.toLowerCase();
      let held = false;
      try {
        held = isItem(heldItem(player), detector);
      } catch {
        // left
      }
      const left = held ? Math.max(0, (this.detectorReady.get(key) ?? 0) - system.currentTick) : 0;
      const bar = cooldownBar(left, total);
      const shown = bar.level * 1000 + bar.points;
      if (this.barShown.get(key) === shown) continue;
      this.barShown.set(key, shown);
      showBar(player, bar);
    }
  }

  // ---- Sides -----------------------------------------------------------------------------------

  private isHider(name: string): boolean {
    return this.teamOf(name)?.id === HIDERS;
  }

  private isSeeker(name: string): boolean {
    return this.teamOf(name)?.id === SEEKERS;
  }
}

/** Damage for a hider's hit on a seeker with `before` health: the hit's damage, or none when it would take their last half heart. */
export function hiderHitDamage(before: number, damage: number): number {
  return before - damage >= 1 ? damage : 0;
}

/** The band a distance falls in (the last for anything past them all). */
export function detectorBand(bands: readonly DetectorBand[], distance: number): DetectorBand {
  return bands.find((band) => distance <= band.within) ?? bands[bands.length - 1];
}

export function nearestDistance(from: Vector3, others: Vector3[]): number | undefined {
  let nearest: number | undefined;
  for (const at of others) {
    const far = Math.hypot(at.x - from.x, at.y - from.y, at.z - from.z);
    if (nearest === undefined || far < nearest) nearest = far;
  }
  return nearest;
}

/** Points from one level to the next (Minecraft's). */
export function pointsToNextLevel(level: number): number {
  if (level <= 15) return 2 * level + 7;
  if (level <= 30) return 5 * level - 38;
  return 9 * level - 158;
}

/**
 * A cooldown on the experience bar: the seconds left as the level, and the bar's share of that
 * level's points as the share of the wait still to go. Nothing (level 0, an empty bar) when done.
 */
export function cooldownBar(leftTicks: number, totalTicks: number): { level: number; points: number } {
  if (leftTicks <= 0 || totalTicks <= 0) return { level: 0, points: 0 };
  const level = Math.ceil(leftTicks / 20);
  const needed = pointsToNextLevel(level);
  return { level, points: Math.min(needed - 1, Math.round((needed * Math.min(leftTicks, totalTicks)) / totalTicks)) };
}

/** Sets the bar. Going up onto a multiple of 5 chimes, so those levels go one past and back (as core's LevelSeconds). */
function showBar(player: Player, { level, points }: { level: number; points: number }): void {
  try {
    player.resetLevel();
    if (level > 0 && level % 5 === 0) {
      player.addLevels(level + 1);
      player.addLevels(-1);
    } else if (level > 0) {
      player.addLevels(level);
    }
    if (points > 0) player.addExperience(points);
  } catch {
    // left
  }
}

/** The way a yaw faces on the ground, as Minecraft's own knockback goes. */
export function facing(yawDegrees: number): { x: number; z: number } {
  const yaw = (yawDegrees * Math.PI) / 180;
  return { x: -Math.sin(yaw), z: Math.cos(yaw) };
}

function isItem(stack: { typeId: string; nameTag?: string } | undefined, item: HotbarItem): boolean {
  return stack !== undefined && stack.typeId === item.item && (item.name === undefined || stack.nameTag === item.name);
}

/** A side's hotbar, each item named and locked in its slot. */
function giveHotbar(player: Player, items: readonly HotbarItem[]): void {
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!container) return;
  for (const entry of items) {
    const stack = new ItemStack(entry.item, 1);
    if (entry.name) stack.nameTag = entry.name;
    stack.lockMode = ItemLockMode.slot;
    container.setItem(entry.slot, stack);
  }
}

function standInOwner(entity: Entity): string | undefined {
  try {
    const tag = entity.getTags().find((each) => each.startsWith(STAND_IN_OWNER));
    return tag?.slice(STAND_IN_OWNER.length);
  } catch {
    return undefined;
  }
}

function tellPack(id: string, message: string): void {
  try {
    system.sendScriptEvent(id, message);
  } catch {
    // no pack to tell
  }
}
