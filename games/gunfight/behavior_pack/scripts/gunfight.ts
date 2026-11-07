// Gunfight on the minigame framework. Core already runs the rest: two teams, best-of rounds with one
// life each (the last team standing takes a round), the teams taking each other's spawns every other
// round (bestOf.swapSides), the stats. This class deals each round's loadout (LoadoutDeck: the same
// primary, secondary and grenade for everyone, and a stimpack) and fires the arsenal (packages/guns,
// Arsenal): bullets take health straight off through core's combat, a crossbow's arrow and a
// netherite sword kill in one hit, and the held gun's ammo shows top right.
import { EntityComponentTypes, ItemLockMode, ItemStack, type Player } from "@minecraft/server";
import { ARSENAL_GUN_DEFS, ARSENAL_THROWABLE_DEFS, Arsenal, STIM, STIMPACK, arsenalItem, parseArsenalItem } from "@minecade/guns";
import { Minigame, describeError, log, say, type Down, type DownDecision, type GameContext, type Hit, type Result, type SpawnReason } from "@minecade/minigame-core";
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

/** What players call an item: an arsenal item's name ("Sniper Rifle"), or a vanilla one's id in words ("Netherite Sword"). */
export function itemName(item: string): string {
  const model = parseArsenalItem(item);
  if (model === STIMPACK) return STIM.name;
  if (model) return (ARSENAL_GUN_DEFS as Record<string, { name: string }>)[model]?.name ?? (ARSENAL_THROWABLE_DEFS as Record<string, { name: string }>)[model]?.name ?? model;
  const words = item.replace(/^minecraft:/, "").split("_");
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** A loadout as a line: "Sniper Rifle and Pistol, with a Molotov". */
export function loadoutText(loadout: Loadout): string {
  return `${itemName(loadout.primary)} and ${itemName(loadout.secondary)}, with a ${itemName(loadout.grenade)}`;
}

export class Gunfight extends Minigame<typeof config> {
  private readonly deck: LoadoutDeck;
  private arsenal?: Arsenal;

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
      { random: () => this.ctx.random(), onAmmo: (player) => this.refreshHud(player.name) },
    );
  }

  protected override onStart(): void {
    const rounds = this.bestOf?.rounds ?? this.config.bestOf.rounds;
    this.broadcast(say.info(`Best of ${rounds}: one life a round, and the last team standing takes it.`));
    this.broadcast(say.minor("Everyone gets the same guns, new every round, and the teams switch sides every round."));
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

  protected override onRoundTimeUp(): Result {
    return this.standingResult();
  }

  /** The held gun's ammo, top right above the clock and the rounds. */
  protected override hud(name: string): string | undefined {
    const player = this.player(name);
    return (player && this.arsenal?.ammoLine(player)) ?? super.hud(name);
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
