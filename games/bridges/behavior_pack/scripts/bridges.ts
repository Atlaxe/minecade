// Bridges on the minigame framework. Core already handles the rest: the two teams, the kit form
// before the match, best-of rounds with the circles top right, quick respawns at the team's spawn,
// building in survival (only placed blocks break, and nobody builds in a spawn guard), the clock
// over all the rounds, and the stats. This class puts a hole by each spawn, gives a team the round
// when one of its players gets into the other team's hole, brings the arrow back, makes the Leap
// feather leap, and clears placed blocks between rounds when the lobby's setting says so.
import { EntityComponentTypes, ItemLockMode, ItemStack, system, world, type Player, type Vector3 } from "@minecraft/server";
import {
  Minigame,
  describeError,
  dyeName,
  log,
  nameOf,
  say,
  worldPoint,
  type Box,
  type Down,
  type DownDecision,
  type GameContext,
  type MapView,
  type Result,
} from "@minecade/minigame-core";
import type config from "../../game.config.ts";

const ARROW = "minecraft:arrow";
const SNOWBALL = "minecraft:snowball";
const LEAP = "minecraft:feather";
export const HOLE = "minecade:bridges_hole";
/** The dyes a hole can show, in the order of the hole entity's minecade:team property and its render controller. */
export const HOLE_DYES = ["red", "blue", "lime", "yellow"];
const HOLE_TEAM_PROPERTY = "minecade:team";
/** The points a map has a hole at, one per team: "hole.<team>". */
const HOLE_POINT = "hole";
/** How far a player reaches past their middle: touching a hole counts. */
const PLAYER_HALF_WIDTH = 0.3;
/** The arrow's slot, as in the kit. */
const ARROW_SLOT = 8;
/** A down from jumping into your own hole. */
export const OWN_HOLE = "ownHole";
const HOLE_CHECK_TICKS = 2;
const ARROW_CHECK_TICKS = 5;
/** A hole whose chunk isn't loaded yet is placed again this often. */
const PLACE_RETRY_TICKS = 20;

/** A team's hole: the middle of its floor. */
export interface Hole {
  team: string;
  at: Vector3;
}

/** The map's holes, one per team (the first point of each "hole.<team>" list). */
export function holesOf(map: MapView): Hole[] {
  return Object.entries(map.config.points ?? {})
    .filter(([key, list]) => key.startsWith(`${HOLE_POINT}.`) && list.length > 0)
    .map(([key, list]) => ({ team: key.slice(HOLE_POINT.length + 1), at: worldPoint(list[0]) }));
}

/** True when a player standing at `position` (their feet) touches the hole: inside its sides, below its rim. */
export function inHole(position: Vector3, hole: Hole, size: { halfWidth: number; height: number }): boolean {
  const reach = size.halfWidth + PLAYER_HALF_WIDTH;
  return Math.abs(position.x - hole.at.x) <= reach && Math.abs(position.z - hole.at.z) <= reach && position.y >= hole.at.y - 1 && position.y < hole.at.y + size.height;
}

/** The blocks a hole stands in, and every block above them up to `top`: nobody builds there. */
export function holeColumn(hole: Hole, halfWidth: number, top: number): Box {
  const low = (value: number) => Math.floor(value - halfWidth);
  const high = (value: number) => Math.ceil(value + halfWidth) - 1;
  const floor = Math.floor(hole.at.y);
  return { min: [low(hole.at.x), floor, low(hole.at.z)], max: [high(hole.at.x), Math.max(floor, top), high(hole.at.z)] };
}

/** The Leap's push: the way the player looks, flat, at `strength`. */
export function leapPush(view: Vector3, strength: number): { x: number; z: number } {
  const flat = Math.hypot(view.x, view.z);
  return flat < 0.0001 ? { x: 0, z: 0 } : { x: (view.x / flat) * strength, z: (view.z / flat) * strength };
}

export class Bridges extends Minigame<typeof config> {
  private holes: Hole[] = [];
  /** When each player's last arrow went (tick), for the next one. */
  private readonly arrowGoneAt = new Map<string, number>();
  /** The seconds each player's level shows (until their arrow is back), so it's set only when it changes. */
  private readonly shownSeconds = new Map<string, number>();

  /** `picturePack`: the game's resource pack UUID, where the build draws the kit form's pictures. */
  constructor(ctx: GameContext, gameConfig: typeof config, picturePack?: string) {
    super(ctx, gameConfig);
    this.kitPicturePack = picturePack;
  }

  /** The lobby's Placed blocks setting: cleared when a round ends, or kept all match (the default). */
  get clearsBlocks(): boolean {
    return this.ctx.vars.settings.blocks === "clear";
  }

  protected override setup(): void {
    this.holes = holesOf(this.map);
    // A shot arrow is gone as it lands, so nobody picks it up: the arrow comes back by itself.
    this.scope.subscribe(world.afterEvents.projectileHitBlock, ({ projectile }) => {
      try {
        if (projectile.typeId === ARROW) projectile.remove();
      } catch (error) {
        log.warn(`bridges: could not remove an arrow: ${describeError(error)}`);
      }
    });
    // A snowball's push counts toward a knock-off, like a hit (no damage event comes for it).
    this.scope.subscribe(world.afterEvents.projectileHitEntity, (event) => {
      try {
        if (event.projectile.typeId !== SNOWBALL || event.source?.typeId !== "minecraft:player") return;
        const victim = this.whoIs(event.getEntityHit().entity);
        const from = (event.source as Player).name;
        if (victim === undefined || from.toLowerCase() === victim.toLowerCase() || this.teamOf(from)?.id === this.teamOf(victim)?.id) return;
        if (this.roster.get(from)?.state === "alive" && this.roster.get(victim)?.state === "alive") this.credit.hit(victim, from, system.currentTick);
      } catch (error) {
        log.warn(`bridges: could not credit a snowball: ${describeError(error)}`);
      }
    });
    this.scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (itemStack.typeId === LEAP) this.leap(source);
    });
    this.scope.interval(() => this.watchHoles(), HOLE_CHECK_TICKS);
    this.scope.interval(() => this.regenArrows(), ARROW_CHECK_TICKS);
  }

  protected override onStart(): void {
    this.placeHoles();
  }

  protected override onRoundStart(round: number): void {
    const series = this.bestOf;
    if (round !== 1 || !series) return;
    this.broadcast(say.info(`Get into the other team's hole and guard yours. Best of ${series.rounds}: the first to ${series.winsNeeded} rounds wins.`));
  }

  protected override onSpawn(player: Player): void {
    const key = player.name.toLowerCase();
    this.arrowGoneAt.delete(key);
    this.shownSeconds.delete(key);
  }

  /** A kill brings the killer's arrow back at once (up to the most they can hold). */
  protected override onDown(_name: string, down: Down): DownDecision | void {
    const killer = down.killer;
    if (killer === undefined || this.roster.get(killer)?.state !== "alive") return;
    const shooter = this.player(killer);
    if (!shooter || countItem(shooter, ARROW) >= this.config.arrow.max) return;
    giveArrow(shooter);
    this.arrowGoneAt.delete(killer.toLowerCase());
    shooter.playSound("random.orb", { pitch: 1.4, volume: 0.7 });
  }

  protected override deathMessage(victim: string, down: Down): string | undefined {
    if (down.cause !== OWN_HOLE || down.killer !== undefined) return super.deathMessage(victim, down);
    return say.highlight(`${nameOf(victim, this.teamOf(victim)?.color)} jumped into their own hole`);
  }

  protected override onRoundEnd(_round: number, _result: Result): void {
    if (this.clearsBlocks) this.build?.clearPlaced();
  }

  /** The holes, and all the air above them: nobody builds a lid on one. */
  protected override noBuildBoxes(): Box[] {
    const top = this.map.bounds?.max[1] ?? 319;
    return this.holes.map((hole) => holeColumn(hole, this.config.hole.halfWidth, top));
  }

  /** Into the other team's hole: the round is theirs. Into your own: you're down, as from a fall. */
  private watchHoles(): void {
    if (this.phase !== "playing" || !this.roundInPlay) return;
    for (const participant of this.roster.inState("alive")) {
      const location = this.body(participant.name)?.location;
      const hole = location ? this.holes.find((candidate) => inHole(location, candidate, this.config.hole)) : undefined;
      if (!hole || participant.team === undefined) continue;
      if (hole.team === participant.team) {
        this.down(participant.name, OWN_HOLE);
        continue;
      }
      this.stats.extra(participant.name, "goals", 1);
      this.endRound(this.teamWins(participant.team, `${participant.name} scored`));
      return;
    }
  }

  /** Each player missing an arrow gets one back once it has been gone long enough; their level counts down the seconds. */
  private regenArrows(): void {
    if (this.phase !== "playing") return;
    const now = system.currentTick;
    const { max, regenSeconds } = this.config.arrow;
    for (const participant of this.roster.inState("alive")) {
      const player = this.player(participant.name);
      if (!player) continue;
      const key = participant.name.toLowerCase();
      let seconds = 0;
      if (countItem(player, ARROW) >= max) {
        this.arrowGoneAt.delete(key);
      } else {
        const since = this.arrowGoneAt.get(key) ?? now;
        this.arrowGoneAt.set(key, since);
        const left = regenSeconds * 20 - (now - since);
        if (left <= 0) {
          giveArrow(player);
          this.arrowGoneAt.delete(key);
        } else {
          seconds = Math.ceil(left / 20);
        }
      }
      this.showSeconds(player, key, seconds);
    }
  }

  private showSeconds(player: Player, key: string, seconds: number): void {
    if (this.shownSeconds.get(key) === seconds) return;
    this.shownSeconds.set(key, seconds);
    try {
      player.resetLevel();
      if (seconds > 0) player.addLevels(seconds);
    } catch {
      // left
    }
  }

  /** The Leap: a push forward and up, once (the feather is used up). Only while a round is played. */
  private leap(player: Player): void {
    if (!this.roundInPlay || this.roster.get(player.name)?.state !== "alive" || countItem(player, LEAP) === 0) return;
    const { horizontal, vertical } = this.config.leap;
    try {
      player.applyKnockback(leapPush(player.getViewDirection(), horizontal), vertical);
      useOne(player, LEAP);
      player.playSound("mob.enderdragon.flap", { pitch: 1.6, volume: 0.6 });
    } catch (error) {
      log.warn(`bridges: ${player.name} could not leap: ${describeError(error)}`);
    }
  }

  /** A hole entity at each team's hole, in the team's color; one whose chunk isn't loaded yet comes later. */
  private placeHoles(): void {
    const waiting = [...this.holes];
    const placing = this.scope.child("holes");
    const place = () => {
      for (const hole of [...waiting]) {
        try {
          const entity = world.getDimension("overworld").spawnEntity(HOLE, hole.at);
          const color = this.teamDefs.find((team) => team.id === hole.team)?.color;
          entity.setProperty(HOLE_TEAM_PROPERTY, Math.max(0, HOLE_DYES.indexOf(dyeName(color))));
          this.track(entity);
          waiting.splice(waiting.indexOf(hole), 1);
        } catch {
          // Not loaded yet: the next try.
        }
      }
      if (waiting.length === 0) placing.dispose();
    };
    place();
    if (!placing.disposed) placing.interval(place, PLACE_RETRY_TICKS);
  }
}

function countItem(player: Player, typeId: string): number {
  const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) return 0;
  let count = 0;
  for (let slot = 0; slot < inventory.size; slot++) {
    const stack = inventory.getItem(slot);
    if (stack?.typeId === typeId) count += stack.amount;
  }
  return count;
}

/** One arrow in the arrow slot (anywhere free if something else is there), locked like kit items. */
function giveArrow(player: Player): void {
  try {
    const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!inventory) return;
    const stack = new ItemStack(ARROW, 1);
    stack.lockMode = ItemLockMode.inventory;
    if (inventory.getItem(ARROW_SLOT) === undefined) inventory.setItem(ARROW_SLOT, stack);
    else inventory.addItem(stack);
  } catch (error) {
    log.warn(`bridges: could not give ${player.name} an arrow: ${describeError(error)}`);
  }
}

/** Uses up one of an item: from the held slot when it's there, else the first stack of it. */
function useOne(player: Player, typeId: string): void {
  const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) return;
  let slot = player.selectedSlotIndex;
  if (inventory.getItem(slot)?.typeId !== typeId) {
    slot = -1;
    for (let candidate = 0; candidate < inventory.size && slot < 0; candidate++) if (inventory.getItem(candidate)?.typeId === typeId) slot = candidate;
  }
  const stack = slot >= 0 ? inventory.getItem(slot) : undefined;
  if (!stack) return;
  if (stack.amount > 1) {
    stack.amount -= 1;
    inventory.setItem(slot, stack);
  } else {
    inventory.setItem(slot, undefined);
  }
}
