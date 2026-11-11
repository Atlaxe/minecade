// Gunfight on the minigame framework. Core already runs the rest: two teams, rounds with one life
// each (the last team standing takes a round) until a team has 5, the teams taking each other's
// spawns every other round (bestOf.swapSides), the stats. This class deals each round's loadout
// (LoadoutDeck: the same primary, secondary and grenade for everyone, and a stimpack), fires the
// arsenal (packages/guns, Arsenal: bullets take health straight off through core's combat, a
// crossbow's arrow and a netherite sword kill in one hit, the held gun's ammo top right), and runs
// the flag: when a round's clock runs out, a circle comes up around the map's flag for 20 seconds,
// and a team alone in it for 5 seconds in a row takes the round (FlagCapture); nobody does, and the
// team with more health left takes it, then the one that dealt more damage (flagTimeUpWinner).
import { EntityComponentTypes, ItemLockMode, ItemStack, MolangVariableMap, world, type Player, type Vector3 } from "@minecraft/server";
import { Arsenal, STIMPACK, arsenalItem, arsenalItemName } from "@minecade/guns";
import {
  COLOR,
  FLAG_CODE,
  Minigame,
  SCOPE_CODE,
  codeTint,
  describeError,
  draw,
  log,
  nameOf,
  playChime,
  say,
  type Down,
  type DownDecision,
  type GameContext,
  type Hit,
  type Result,
  type SpawnReason,
} from "@minecade/minigame-core";
import { worldPoint } from "@minecade/minigame-core/config";
import type config from "../../game.config.ts";

/** One round's loadout, as item ids: the same for everyone. */
export interface Loadout {
  primary: string;
  secondary: string;
  grenade: string;
}

export interface LoadoutLists {
  primary: readonly string[];
  secondary: readonly string[];
  grenade: readonly string[];
}

const CROSSBOW = "minecraft:crossbow";
const ARROWS = 8;
/** The flag's circle: the core pack's ring particle (packages/minigame-core/resource_pack/particles/flag_ring.json). */
const FLAG_RING = "minecade:flag_ring";
/** The ring drawn this often (each lasts a little longer), and the circle checked this often, in ticks. */
const RING_TICKS = 10;
const FLAG_CHECK_TICKS = 5;
/** The ring's color while no team is taking the flag: gold. */
const OPEN_RING = 0xffd84d;

/** What the flag's circle holds: nobody, one team (taking it), or both (held up). */
export type FlagState = "open" | "taking" | "contested";

export interface FlagStep {
  state: FlagState;
  /** The team taking it, or held up while the circle is contested. */
  team?: string;
  /** Ticks the taking team still has to hold it. */
  ticksLeft: number;
  /** The team took it: the round is theirs. */
  taken: boolean;
}

/**
 * The flag being taken: one team alone in its circle for `needTicks` in a row takes it. The other
 * team stepping in holds the taking where it is; the taking team leaving the circle starts it over.
 */
export class FlagCapture {
  private readonly needTicks: number;
  private taker: string | undefined;
  private heldTicks = 0;

  constructor(needTicks: number) {
    this.needTicks = needTicks;
  }

  /** The team taking the flag (or held up there), if any. */
  get team(): string | undefined {
    return this.taker;
  }

  /** One check, `ticks` after the last: `teams` are the teams of everyone standing in the circle. */
  step(teams: readonly string[], ticks: number): FlagStep {
    const present = [...new Set(teams)];
    if (present.length === 0) {
      this.taker = undefined;
      this.heldTicks = 0;
      return { state: "open", ticksLeft: this.needTicks, taken: false };
    }
    if (present.length > 1) return { state: "contested", team: this.taker, ticksLeft: this.needTicks - this.heldTicks, taken: false };
    if (present[0] !== this.taker) {
      this.taker = present[0];
      this.heldTicks = 0;
    }
    this.heldTicks += ticks;
    const ticksLeft = Math.max(0, this.needTicks - this.heldTicks);
    return { state: "taking", team: this.taker, ticksLeft, taken: ticksLeft === 0 };
  }
}

/** A team's side of a round nobody took the flag in: its standing players' health left, and the damage its players dealt that round. */
export interface FlagStanding {
  team: string;
  health: number;
  damage: number;
}

/**
 * Who takes a round nobody took the flag in: the team with more health left, then the one that
 * dealt more damage that round (`by` says which; health first, as the user asked). Undefined for a
 * draw.
 */
export function flagTimeUpWinner(sides: readonly FlagStanding[]): { team: string; by: "health" | "damage" } | undefined {
  const even = (value: number) => Math.round(value * 100) / 100;
  const [first, second] = [...sides].sort((a, b) => even(b.health) - even(a.health) || even(b.damage) - even(a.damage));
  if (!first) return undefined;
  if (!second || even(first.health) > even(second.health)) return { team: first.team, by: "health" };
  return even(first.damage) > even(second.damage) ? { team: first.team, by: "damage" } : undefined;
}

/**
 * Deals the rounds' loadouts. Primaries come from a shuffled bag, each once before any comes again
 * (never the last round's straight after a refill); the secondary and the grenade are random, never
 * the same as the round before when there's another. A round asked for again gets the same one.
 */
export class LoadoutDeck {
  private readonly lists: LoadoutLists;
  private readonly random: () => number;
  private readonly dealt: Loadout[] = [];
  private bag: string[] = [];

  constructor(lists: LoadoutLists, random: () => number) {
    this.lists = lists;
    this.random = random;
  }

  /** Round `round`'s loadout (from 1). */
  forRound(round: number): Loadout {
    while (this.dealt.length < round) this.dealt.push(this.deal(this.dealt.at(-1)));
    return this.dealt[round - 1];
  }

  private deal(last: Loadout | undefined): Loadout {
    if (this.bag.length === 0) {
      this.bag = shuffle([...this.lists.primary], this.random);
      // A fresh bag doesn't start with what was just played.
      if (last && this.bag.length > 1 && this.bag[0] === last.primary) this.bag.push(this.bag.shift()!);
    }
    return {
      primary: this.bag.shift()!,
      secondary: this.pick(this.lists.secondary, last?.secondary),
      grenade: this.pick(this.lists.grenade, last?.grenade),
    };
  }

  private pick(list: readonly string[], last: string | undefined): string {
    const choices = list.length > 1 ? list.filter((item) => item !== last) : list;
    return choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
  }
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** The flag's circle: a ring of `radius` around `at`, in `rgb` (0xRRGGBB), rising a little. */
function drawRing(at: Vector3, radius: number, rgb: number): void {
  try {
    const variables = new MolangVariableMap();
    variables.setFloat("variable.radius", radius);
    variables.setColorRGB("variable.color", { red: ((rgb >> 16) & 0xff) / 255, green: ((rgb >> 8) & 0xff) / 255, blue: (rgb & 0xff) / 255 });
    world.getDimension("overworld").spawnParticle(FLAG_RING, { x: at.x, y: at.y + 0.05, z: at.z }, variables);
  } catch {
    // An unloaded spot: the next ring comes in half a second.
  }
}

/** A loadout as a line: "Sniper Rifle and Pistol, with a Molotov". */
export function loadoutText(loadout: Loadout): string {
  return `${arsenalItemName(loadout.primary)} and ${arsenalItemName(loadout.secondary)}, with a ${arsenalItemName(loadout.grenade)}`;
}

export class Gunfight extends Minigame<typeof config> {
  private readonly deck: LoadoutDeck;
  private arsenal?: Arsenal;
  /** Each participant's damage dealt so far as their round started (lowercase): a round's damage counts from there. */
  private dealtAtStart = new Map<string, number>();
  /** While the flag's circle is up: the HUD says "Capture the flag!". */
  private flagUp = false;

  constructor(ctx: GameContext, gameConfig: typeof config) {
    super(ctx, gameConfig);
    this.deck = new LoadoutDeck(gameConfig.loadouts, () => ctx.random());
  }

  /** The arsenal: fired only while a round is in play, by players still standing; hits go through core's combat. */
  protected override setup(): void {
    const standing = (name: string) => this.roster.get(name)?.state === "alive";
    this.arsenal = new Arsenal(
      this.scope,
      {
        canFire: (player) => this.phase === "playing" && this.roundInPlay && standing(player.name),
        targets: () => this.roster.inState("alive").flatMap((participant) => this.body(participant.name) ?? []),
        nameOf: (entity) => this.whoIs(entity),
        hurt: (victim, attacker, amount, cause, headshot) => {
          const result = this.combat.hit(victim, attacker, amount, cause, { direct: true });
          if (result && headshot && attacker && this.roster.get(attacker)) this.stats.extra(attacker, "headshots", 1);
          return result;
        },
        give: (player, item) => this.giveGrenade(player, item),
      },
      { random: () => this.ctx.random(), onAmmo: (player) => this.refreshHud(player.name), onAim: (player) => this.refreshHud(player.name) },
    );
  }

  protected override onStart(): void {
    const { flag, bestOf } = this.config;
    this.broadcast(say.info(`First to ${this.bestOf?.winsNeeded ?? bestOf.firstTo} rounds: one life a round, and the last team standing takes it.`));
    this.broadcast(say.minor(`When a round's ${bestOf.roundSeconds / 60} minutes run out, the flag's circle comes up: hold it alone for ${flag.holdSeconds} seconds to take the round.`));
    this.broadcast(say.minor("Everyone gets the same guns, new every round, and the teams switch sides every round."));
  }

  /** A round's damage counts from here. */
  protected override onRoundStart(): void {
    this.dealtAtStart = new Map(this.roster.all().map((participant) => [participant.name.toLowerCase(), this.stats.get(participant.name)?.dealt ?? 0]));
  }

  /** Every spawn (the match's start, each new round) deals the round's loadout, magazines full. */
  protected override onSpawn(player: Player, why: SpawnReason): void {
    const round = this.bestOf?.round ?? 1;
    this.arsenal?.refill(player.name);
    this.giveLoadout(player, this.deck.forRound(round));
    const sides = round > 1 && this.config.bestOf.swapSides && why === "round" ? say.minor(" The teams have switched sides.") : "";
    player.sendMessage(`${say.info(`Round ${round}: ${loadoutText(this.deck.forRound(round))}.`)}${sides}`);
  }

  protected override onDown(name: string, _down: Down): DownDecision | void {
    this.arsenal?.forget(name);
  }

  /** A crossbow's arrow and a netherite sword kill in one hit; anything else as it comes. */
  protected override onDamage(hit: Hit): number | "cancel" | void {
    return this.arsenal?.vanillaDamage(hit);
  }

  /** The round's clock ran out: the flag's circle comes up (takeFlag). A map with no flag goes straight to health, then damage. */
  protected override onRoundTimeUp(): Result | Promise<Result> {
    const { flag } = this.config;
    const point = this.map.points(flag.point)[0];
    if (!point) {
      log.warn(`gunfight: the map has no ${flag.label}: a round that runs out of time goes to health left, then damage dealt`);
      return this.untakenResult();
    }
    return this.takeFlag(worldPoint(point));
  }

  /**
   * The flag's circle comes up around `at` for flag.seconds, on a clock of its own top right with
   * "Capture the flag!" beside it, drawn as a ring in the color of the team taking it. The first
   * team to hold it alone for flag.holdSeconds in a row takes the round; nobody does, and it goes
   * to health left, then damage dealt (untakenResult). A team standing down the other meanwhile
   * still takes it as ever (core's win check), and what this gives then is ignored.
   */
  private async takeFlag(at: Vector3): Promise<Result> {
    const { radius, holdSeconds, seconds } = this.config.flag;
    const capture = new FlagCapture(holdSeconds * 20);
    this.title(say.highlight("Capture the flag!"), say.minor(`Hold its circle alone for ${holdSeconds} seconds`));
    this.chime("bell");
    this.broadcast(say.info(`Time's up! Hold the flag's circle alone for ${holdSeconds} seconds to take the round. Nobody does in ${seconds} seconds: more health left takes it.`));
    const { outcome } = await this.stage<string>("Flag", { seconds }, (stage) => {
      this.flagUp = true;
      stage.scope.add(() => {
        this.flagUp = false;
        this.refreshEveryone();
      });
      this.refreshEveryone();
      drawRing(at, radius, this.ringColor(capture.team));
      stage.scope.interval(() => drawRing(at, radius, this.ringColor(capture.team)), RING_TICKS);
      // What each player in the circle was last shown, so a title goes out only when it changes.
      const shown = new Map<string, string>();
      let taker: string | undefined;
      stage.scope.interval(() => {
        const inside = this.inCircle(at, radius);
        const step = capture.step(
          inside.map((one) => one.team),
          FLAG_CHECK_TICKS,
        );
        if (step.taken && step.team !== undefined) return stage.end(step.team);
        if (step.state === "taking" && step.team !== taker) this.broadcast(say.info(`${this.teamName(step.team)} is taking the flag!`));
        taker = step.state === "open" ? undefined : step.team;
        for (const { name, team } of inside) {
          const secondsLeft = Math.ceil(step.ticksLeft / 20);
          const line = step.state === "contested" ? "contested" : team === step.team ? `taking ${secondsLeft}` : "";
          if (!line || shown.get(name) === line) continue;
          shown.set(name, line);
          if (step.state === "contested") this.title(say.warn("Contested"), say.minor("Clear the circle to take it"), name, 25);
          else this.title(`${COLOR.highlight}${secondsLeft}`, say.minor("Taking the flag"), name, 25);
          const player = this.player(name);
          if (player && step.state === "taking") playChime(player, "tick");
        }
        for (const name of [...shown.keys()]) if (!inside.some((one) => one.name === name)) shown.delete(name);
      }, FLAG_CHECK_TICKS);
    });
    if (outcome !== undefined) return this.teamWins(outcome, "took the flag");
    return this.untakenResult();
  }

  /**
   * A round nobody took the flag in: the team with more health left standing, then the one that
   * dealt more damage that round (flagTimeUpWinner); else a draw.
   */
  private untakenResult(): Result {
    const sides = this.teamDefs.map((team): FlagStanding => {
      const members = this.roster.teamMembers(team.id);
      const health = members.filter((member) => member.state === "alive").reduce((sum, member) => sum + (this.body(member.name)?.getComponent(EntityComponentTypes.Health)?.currentValue ?? 0), 0);
      const damage = members.reduce((sum, member) => sum + Math.max(0, (this.stats.get(member.name)?.dealt ?? 0) - (this.dealtAtStart.get(member.name.toLowerCase()) ?? 0)), 0);
      return { team: team.id, health, damage };
    });
    const winner = flagTimeUpWinner(sides);
    if (!winner) return draw("nobody took the flag, and it was even");
    return this.teamWins(winner.team, winner.by === "health" ? "more health left" : "more damage dealt");
  }

  /** The players in play standing in the flag's circle: within `radius` across, from a block below it to 2 above. */
  private inCircle(at: Vector3, radius: number): { name: string; team: string }[] {
    return this.roster.inState("alive").flatMap((participant) => {
      const body = this.body(participant.name);
      if (!body || participant.team === undefined) return [];
      const { x, y, z } = body.location;
      return Math.hypot(x - at.x, z - at.z) <= radius && y >= at.y - 1 && y <= at.y + 2 ? [{ name: participant.name, team: participant.team }] : [];
    });
  }

  /** The ring's color: the taking team's, else gold. */
  private ringColor(team: string | undefined): number {
    const color = this.teamDefs.find((def) => def.id === team)?.color;
    return (color !== undefined ? codeTint(color) : undefined) ?? OPEN_RING;
  }

  /** "Red", in its color. */
  private teamName(team: string | undefined): string {
    const def = this.teamDefs.find((candidate) => candidate.id === team);
    return def ? nameOf(def.name, def.color) : "A team";
  }

  /** Everyone's HUD line again now (the flag's bubble came or went). */
  private refreshEveryone(): void {
    for (const player of world.getAllPlayers()) this.refreshHud(player.name);
  }

  /** The held gun's ammo, top right above the clock and the rounds. */
  protected override hud(name: string): string | undefined {
    const player = this.player(name);
    return (player && this.arsenal?.ammoLine(player)) ?? super.hud(name);
  }

  /** The Sniper Rifle's scope over the screen while it's raised, and "Capture the flag!" while the flag's circle is up. */
  protected override hudCodes(name: string): string {
    return `${this.arsenal?.guns.isScoped(name) ? SCOPE_CODE : ""}${this.flagUp ? FLAG_CODE : ""}`;
  }

  /** The loadout in its slots, each locked there, and a crossbow's arrows above the hotbar. */
  private giveLoadout(player: Player, loadout: Loadout): void {
    const { slots } = this.config;
    try {
      const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
      if (!inventory) return;
      const put = (slot: number, item: string) => {
        const stack = new ItemStack(item, 1);
        stack.lockMode = ItemLockMode.slot;
        inventory.setItem(slot, stack);
      };
      put(slots.primary, loadout.primary);
      put(slots.secondary, loadout.secondary);
      put(slots.grenade, loadout.grenade);
      put(slots.stimpack, arsenalItem(STIMPACK));
      if (loadout.primary === CROSSBOW || loadout.secondary === CROSSBOW) inventory.setItem(9, new ItemStack("minecraft:arrow", ARROWS));
    } catch (error) {
      log.warn(`gunfight: could not give ${player.name} the loadout: ${describeError(error)}`);
    }
  }

  /** A knife picked up off the map goes back in the grenade slot, when it's free. */
  private giveGrenade(player: Player, item: string): boolean {
    try {
      const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
      const slot = this.config.slots.grenade;
      if (!inventory || inventory.getItem(slot)) return false;
      const stack = new ItemStack(item, 1);
      stack.lockMode = ItemLockMode.slot;
      inventory.setItem(slot, stack);
      return true;
    } catch {
      return false;
    }
  }
}
