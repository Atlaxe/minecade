// Paintball on the minigame framework. Core already runs the rest: the teams (Red and Blue),
// unlimited respawns with spawn protection, a kill
// for the team of whoever painted a player out, first to 10 with each team's kills top right, the
// clock and the stats. This class wires the shared guns (packs/guns, @minecade/guns): every hit
// colors a piece of armor and takes a share of health, four put a player out; every ball paints a
// circle where it lands, and a grenade paints a ball of blocks and hits everyone near twice. Your
// own team's paint under your feet speeds you up, the other team's slows you down. It puts out the
// power-ups and hands out what they hold: a rifle or shotgun in place of the pistol for 30 seconds
// (counted on the level), or a grenade.
import { BlockPermutation, EntityComponentTypes, EquipmentSlot, ItemLockMode, ItemStack, LiquidType, system, world, type Block, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { DYES, Guns, dyeIndex, gunItem, paintSplash, parseGunItem, type BlockHit, type Dye, type PickupKind, type Shot } from "@minecade/guns";
import {
  FAKE_PLAYER,
  LevelSeconds,
  Minigame,
  describeError,
  dyeName,
  dyedLeather,
  kitStack,
  log,
  parseDyedLeather,
  say,
  worldPoint,
  type Down,
  type DownDecision,
  type GameContext,
  type Hit,
  type LeatherPiece,
  type SpawnReason,
} from "@minecade/minigame-core";
import type config from "../../game.config.ts";
import { blend, nextPiece, pieceAt } from "./armor.ts";
import { Painter, paintDyeOf, type BlockLook, type PaintPort, type Vec, type WorldBlock } from "./paint.ts";
import { PowerUps } from "./powerups.ts";

/** What a hit is, for the death message (core's paint verbs). */
export const PAINT_CAUSE = "paintball";
const ARMOR_SLOTS: Record<LeatherPiece, EquipmentSlot> = {
  helmet: EquipmentSlot.Head,
  chestplate: EquipmentSlot.Chest,
  leggings: EquipmentSlot.Legs,
  boots: EquipmentSlot.Feet,
};
const MAX_HEALTH = 20;
const GUN_CHECK_TICKS = 5;
/** How often the paint under players' feet is looked at, in ticks. */
const FEET_CHECK_TICKS = 2;
const AIR = "minecraft:air";
const HURT_SOUND = "game.player.hurt";
const HIT_SOUND = "random.orb";

/** Whether paint flies through a block: what flowing water washes away (plants, torches, rails), and light blocks. Never a liquid. */
function throughBlock(block: Block, typeId: string): boolean {
  if (typeId.startsWith("minecraft:light_block")) return true;
  try {
    return !block.isLiquid && block.permutation.canBeDestroyedByLiquidSpread(LiquidType.Water);
  } catch {
    return false;
  }
}

/** A player's life so far: the hits taken, and the pieces they colored. */
interface Life {
  hits: number;
  colored: Set<LeatherPiece>;
}

export class Paintball extends Minigame<typeof config> {
  private readonly levels = new LevelSeconds();
  private readonly lives = new Map<string, Life>();
  /** Until when (tick) each player's power-up gun lasts. */
  private readonly gunUntil = new Map<string, number>();
  /** Players walking faster or slower on paint: the share of their own speed, by lowercase name. */
  private readonly paintSpeeds = new Map<string, { player: Player; share: number }>();
  private readonly painter: Painter;
  private guns?: Guns;
  private powerUps?: PowerUps;

  /**
   * `picturePack`: the game's resource pack UUID, where the build draws the kit form's pictures.
   * `modShapes`: the shared blocks pack's paintable blocks by shape ("#mod-blocks").
   */
  constructor(ctx: GameContext, gameConfig: typeof config, picturePack?: string, modShapes: Readonly<Record<string, string>> = {}) {
    super(ctx, gameConfig);
    this.kitPicturePack = picturePack;
    this.painter = new Painter(this.paintPort(modShapes));
  }

  /** The guns: fired only while playing and alive, each ball in the shooter's team's paint. */
  protected override setup(): void {
    this.guns = new Guns(this.scope, {
      canFire: (player) => this.phase === "playing" && this.roster.get(player.name)?.state === "alive",
      colorOf: (player, itemDye) => dyeIndex(this.dyeOf(player.name) ?? itemDye),
      // A player or a preview's fake player in a ball's way: the ball flies on to hit them, not the wall behind.
      isTarget: (entity) => entity.typeId === "minecraft:player" || entity.typeId === FAKE_PLAYER,
      onHitEntity: (shot, entity, location) => this.ballHit(shot, entity, location),
      onHitBlock: (shot, hit, location) => this.ballLanded(shot, hit, location),
      onBurst: (shot, location) => this.burst(shot, location),
    });
    this.scope.interval(() => this.watchGuns(), GUN_CHECK_TICKS);
    this.scope.interval(() => this.watchFeet(), FEET_CHECK_TICKS);
    this.scope.add(() => {
      for (const key of [...this.paintSpeeds.keys()]) this.walkOn(key, 1);
    });
  }

  protected override onStart(): void {
    const settings = this.config.powerUps;
    const playing = this.roster.inState("alive").length;
    this.broadcast(say.info(`First team to ${this.config.scoring.target} kills wins. ${this.config.hitsToOut} hits and you're out until you respawn.`));
    this.broadcast(say.minor("Power-ups float on the map: a rifle or shotgun for 30 seconds, or a paint grenade."));
    if (playing === 0) return;
    this.powerUps = new PowerUps(this.scope, {
      spots: this.map.points("powerup").map(worldPoint),
      everySeconds: settings.everySeconds,
      kinds: settings.kinds as readonly PickupKind[],
      radius: settings.radius,
      random: () => this.ctx.random(),
      players: () => world.getAllPlayers().filter((player) => this.roster.get(player.name)?.state === "alive"),
      canTake: (player, kind) => this.canTake(player, kind),
      onTake: (player, kind) => this.take(player, kind),
      track: (entity) => this.track(entity),
    });
  }

  /** A fresh life: clean armor (the kit's), full health, the pistol. */
  protected override onSpawn(player: Player, _why: SpawnReason): void {
    this.forgetLife(player.name);
  }

  protected override onDown(name: string, _down: Down): DownDecision | void {
    this.forgetLife(name);
    this.guns?.forget(name);
  }

  /** Only paint hurts: no melee, no falls. Out of bounds and below the map still put players out (core). */
  protected override onDamage(_hit: Hit): number | "cancel" | void {
    return "cancel";
  }

  // ---- Hits ------------------------------------------------------------------------------------

  /** A ball hit a player (or a preview's fake player): one hit, on the piece where it landed. */
  private ballHit(shot: Shot, entity: Entity, location: Vector3): void {
    paintSplash(location, shot.color);
    const victim = this.whoIs(entity);
    if (victim === undefined) return;
    this.hit(victim, entity, shot.shooter, location.y - entity.location.y, 1);
  }

  /**
   * `count` hits on a player from an enemy, each coloring a piece (the one at `height` over their
   * feet first). The last of their hits puts them out, credited to the shooter.
   */
  private hit(victim: string, body: Entity, shooter: string, height: number, count: number): void {
    if (!this.canHit(victim, shooter)) return;
    const life = this.lifeOf(victim);
    const shooterDye = this.dyeOf(shooter);
    for (let index = 0; index < count && life.hits < this.config.hitsToOut; index++) {
      life.hits++;
      const piece = nextPiece(pieceAt(height), life.colored);
      if (piece) {
        life.colored.add(piece);
        if (shooterDye) this.colorPiece(body, piece, shooterDye);
      }
    }
    this.playTo(shooter, HIT_SOUND, 1.4);
    if (life.hits >= this.config.hitsToOut) {
      this.combat.hit(body, shooter, "lethal", PAINT_CAUSE);
      return;
    }
    this.credit.hit(victim, shooter, system.currentTick);
    this.playTo(victim, HURT_SOUND, 1);
    try {
      body.getComponent(EntityComponentTypes.Health)?.setCurrentValue(Math.ceil(MAX_HEALTH * (1 - life.hits / this.config.hitsToOut)));
      // A preview's fake player shows its health as hearts on its name tag: they follow the hit.
      if (body.typeId === FAKE_PLAYER) this.fakes?.showHealth(body);
    } catch (error) {
      log.warn(`paintball: could not show ${victim}'s hits: ${describeError(error)}`);
    }
  }

  /** Whether a shooter's ball counts on a player: both playing on different teams, the victim not protected. */
  private canHit(victim: string, shooter: string): boolean {
    if (this.phase !== "playing" || victim.toLowerCase() === shooter.toLowerCase()) return false;
    if (this.roster.get(victim)?.state !== "alive" || this.roster.get(shooter) === undefined) return false;
    if (this.isProtected(victim)) return false;
    const [team, theirs] = [this.teamOf(victim)?.id, this.teamOf(shooter)?.id];
    return team === undefined || team !== theirs;
  }

  /** A piece of armor takes the shooter's color, mixed into its own. */
  private colorPiece(body: Entity, piece: LeatherPiece, shooterDye: string): void {
    try {
      const equipment = body.getComponent(EntityComponentTypes.Equippable);
      if (!equipment) return;
      const slot = ARMOR_SLOTS[piece];
      const worn = equipment.getEquipment(slot);
      const own = worn ? parseDyedLeather(worn.typeId)?.dye : undefined;
      const stack = new ItemStack(dyedLeather(piece, own ? blend(own, shooterDye) : shooterDye), 1);
      stack.lockMode = ItemLockMode.slot;
      equipment.setEquipment(slot, stack);
    } catch (error) {
      log.warn(`paintball: could not color armor: ${describeError(error)}`);
    }
  }

  // ---- Paint -----------------------------------------------------------------------------------

  /** A ball landed on a block: it paints a circle around where it hit. */
  private ballLanded(shot: Shot, hit: BlockHit, location: Vector3): void {
    paintSplash(location, shot.color);
    this.painted(shot.shooter, this.painter.splat(location, hit.block.location, hit.face, this.paintDye(shot), this.config.splash.radius));
  }

  /** A grenade burst: it paints a ball of blocks, and every enemy near takes its hits. */
  private burst(shot: Shot, location: Vector3): void {
    const { paintRadius, hitRadius, hits } = this.config.grenade;
    paintSplash(location, shot.color, 3);
    this.painted(shot.shooter, this.painter.burst(location, paintRadius, this.paintDye(shot)));
    for (const participant of this.roster.inState("alive")) {
      const body = this.body(participant.name);
      if (!body) continue;
      const at = body.location;
      const middle = { x: at.x, y: at.y + 0.9, z: at.z };
      if (Math.hypot(middle.x - location.x, middle.y - location.y, middle.z - location.z) > hitRadius) continue;
      this.hit(participant.name, body, shot.shooter, location.y - at.y, hits);
    }
  }

  private painted(shooter: string, blocks: number): void {
    if (blocks > 0 && this.roster.get(shooter)) this.stats.extra(shooter, "painted", blocks);
  }

  /** The dye a shot paints in: its shooter's team's, or its ball's own color once they've left. */
  private paintDye(shot: Shot): string {
    return this.dyeOf(shot.shooter) ?? DYES[shot.color] ?? "white";
  }

  /** The world as the painter sees it: blocks in the overworld, inside the map's bounds. */
  private paintPort(modShapes: Readonly<Record<string, string>>): PaintPort {
    const dimension = () => world.getDimension("overworld");
    return {
      // A splat reads a hundred or so blocks, mostly air: a block's states, and whether paint flies
      // through it (what flowing water washes away: plants, torches, rails; and light blocks), are
      // only asked of the blocks that need them.
      read: (at: Vec): WorldBlock | undefined => {
        try {
          const block = dimension().getBlock(at);
          if (!block) return undefined;
          const typeId = block.typeId;
          if (typeId === AIR) return { typeId, states: {} };
          let states: WorldBlock["states"] | undefined;
          let open: boolean | undefined;
          return {
            typeId,
            get states() {
              return (states ??= block.permutation.getAllStates());
            },
            get open() {
              return (open ??= throughBlock(block, typeId));
            },
          };
        } catch {
          return undefined; // unloaded
        }
      },
      write: (at: Vec, look: BlockLook): boolean => {
        try {
          const block = dimension().getBlock(at);
          if (!block) return false;
          block.setPermutation(BlockPermutation.resolve(look.typeId, look.states));
          return true;
        } catch (error) {
          log.warn(`paintball: could not paint ${look.typeId} at ${at.x} ${at.y} ${at.z}: ${describeError(error)}`);
          return false;
        }
      },
      inside: (at: Vec) => !this.map.outOfBounds({ x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 }, { killRegions: false }),
      modShape: (typeId: string) => modShapes[typeId],
    };
  }

  // ---- Walking on paint ------------------------------------------------------------------------

  /**
   * Each player on the ground walks faster on their own team's paint and slower on the other team's
   * (any block that shows a team's paint: paintDyeOf); in the air, they keep the speed they had.
   */
  private watchFeet(): void {
    if (this.phase !== "playing") {
      for (const key of [...this.paintSpeeds.keys()]) this.walkOn(key, 1);
      return;
    }
    const teams = new Set(this.teamDefs.map((team) => dyeName(team.color)));
    const { own: faster, enemy: slower } = this.config.paintSpeed;
    for (const participant of this.roster.inState("alive")) {
      const player = this.player(participant.name);
      if (!player) continue; // a preview's fake player
      let paint: string | undefined;
      try {
        if (!player.isOnGround) continue;
        paint = this.paintUnder(player);
      } catch {
        continue;
      }
      const own = this.dyeOf(participant.name);
      const share = !paint || !own || !teams.has(paint) ? 1 : paint === own ? faster : slower;
      this.walkOn(participant.name.toLowerCase(), share, player);
    }
  }

  /** The paint (a dye) under a player's feet: the block they stand on, or the carpet or slab they stand in. */
  private paintUnder(player: Player): string | undefined {
    const at = player.location;
    const block = world.getDimension("overworld").getBlock({ x: Math.floor(at.x), y: Math.floor(at.y - 0.05), z: Math.floor(at.z) });
    return block ? paintDyeOf(block.typeId) : undefined;
  }

  /** A player walks at `share` of their own speed (1: their own again), set only when it changes (or they came back). */
  private walkOn(key: string, share: number, player = this.paintSpeeds.get(key)?.player): void {
    const known = this.paintSpeeds.get(key);
    if (known ? known.player === player && known.share === share : share === 1) return;
    this.paintSpeeds.delete(key);
    if (!player?.isValid) return;
    try {
      const movement = player.getComponent(EntityComponentTypes.Movement);
      if (!movement) return;
      if (share === 1) movement.resetToDefaultValue();
      else movement.setCurrentValue(movement.defaultValue * share);
      if (share !== 1) this.paintSpeeds.set(key, { player, share });
    } catch (error) {
      log.warn(`paintball: could not change ${player.name}'s speed: ${describeError(error)}`);
    }
  }

  // ---- Power-ups -------------------------------------------------------------------------------

  /** One gun at a time (no gun while a power-up gun lasts), and one grenade at a time. */
  private canTake(player: Player, kind: PickupKind): boolean {
    if (this.roster.get(player.name)?.state !== "alive") return false;
    if (kind === "grenade") return !this.carries(player, "grenade");
    return !this.gunUntil.has(player.name.toLowerCase());
  }

  private take(player: Player, kind: PickupKind): void {
    const dye = this.dyeOf(player.name) ?? "white";
    const { gun, grenade } = this.config.slots;
    try {
      const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
      if (!inventory) return;
      const stack = new ItemStack(gunItem(kind, dye as Dye), 1);
      stack.lockMode = ItemLockMode.slot;
      if (kind === "grenade") {
        inventory.setItem(grenade, stack);
        player.sendMessage(say.info("Paint grenade: throw it with either click."));
        return;
      }
      inventory.setItem(gun, stack);
      this.gunUntil.set(player.name.toLowerCase(), system.currentTick + this.config.powerUps.gunSeconds * 20);
      this.levels.show(player, this.config.powerUps.gunSeconds);
      player.sendMessage(say.info(`${kind === "rifle" ? "Rifle" : "Shotgun"} for ${this.config.powerUps.gunSeconds} seconds, then your pistol comes back.`));
    } catch (error) {
      log.warn(`paintball: could not hand ${player.name} a ${kind}: ${describeError(error)}`);
    }
  }

  /** Counts each power-up gun down on its player's level, and gives the pistol back once it's done. */
  private watchGuns(): void {
    const now = system.currentTick;
    for (const [key, until] of this.gunUntil) {
      const player = this.player(key);
      if (!player || this.roster.get(key)?.state !== "alive") {
        this.gunUntil.delete(key);
        continue;
      }
      const left = Math.max(0, Math.ceil((until - now) / 20));
      this.levels.show(player, left);
      if (left > 0) continue;
      this.gunUntil.delete(key);
      this.givePistol(player);
    }
  }

  private givePistol(player: Player): void {
    const kit = this.config.kits.list[0];
    const entry = kit.items[0];
    try {
      player.getComponent(EntityComponentTypes.Inventory)?.container?.setItem(entry.slot ?? this.config.slots.gun, kitStack(kit, entry, this.teamOf(player.name)?.color));
    } catch (error) {
      log.warn(`paintball: could not give ${player.name} the pistol back: ${describeError(error)}`);
    }
  }

  /** Whether a player has a gun or grenade of this kind anywhere in their inventory. */
  private carries(player: Player, kind: PickupKind): boolean {
    try {
      const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
      for (let slot = 0; slot < (inventory?.size ?? 0); slot++) {
        const stack = inventory?.getItem(slot);
        if (stack && parseGunItem(stack.typeId)?.kind === kind) return true;
      }
    } catch {
      // left
    }
    return false;
  }

  // ---- Players ---------------------------------------------------------------------------------

  private lifeOf(name: string): Life {
    const key = name.toLowerCase();
    let life = this.lives.get(key);
    if (!life) {
      life = { hits: 0, colored: new Set() };
      this.lives.set(key, life);
    }
    return life;
  }

  private forgetLife(name: string): void {
    const key = name.toLowerCase();
    this.lives.delete(key);
    this.gunUntil.delete(key);
    this.walkOn(key, 1);
    this.levels.forget(name);
    const player = this.player(name);
    if (player) this.levels.show(player, 0);
  }

  /** A player's team's dye (red or blue), or undefined without a team. */
  private dyeOf(name: string): string | undefined {
    const team = this.teamOf(name);
    return team ? dyeName(team.color) : undefined;
  }

  private playTo(name: string, sound: string, pitch: number): void {
    try {
      this.player(name)?.playSound(sound, { pitch, volume: 0.8 });
    } catch {
      // left
    }
  }
}
