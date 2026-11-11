// Gun Game on the minigame framework. Core already runs the rest: a free-for-all with unlimited
// respawns (2 seconds, then 2 seconds of protection), late joiners, the clock, each player's own
// score top right, the stats. This class walks everyone up the ladder (the config's `ladders`, by
// the lobby's Ladder setting) and fires the arsenal (packages/guns, Arsenal):
//
// - Everyone starts on the first weapon, alone in the first hotbar slot. A kill with the weapon
//   you're on moves you to the next (a shot fired before you moved up doesn't count again), and the
//   first kill with the last weapon, the Netherite Sword, wins.
// - A melee hit (a fist, or a bash with whatever's in hand) takes a quarter of a full health; a
//   Netherite Sword and a crossbow's arrow kill in one hit, as in Gunfight. A melee death puts the
//   victim back one weapon, and so does dying by yourself (falling out of the map, your own rocket).
// - Your score is how far up you are (the kills that counted), top right beside the clock. When
//   time runs out, whoever is furthest up wins, then the most kills.
import { EntityComponentTypes, ItemLockMode, ItemStack, type Player } from "@minecraft/server";
import { Arsenal, CROSSBOW_ARROWS, ONE_HIT, arsenalItemName } from "@minecade/guns";
import {
  Minigame,
  SCOPE_CODE,
  deathMessage as killLine,
  describeError,
  draw,
  log,
  nameOf,
  say,
  type Down,
  type DownDecision,
  type GameContext,
  type Hit,
  type MapPosition,
  type Result,
  type SpawnReason,
} from "@minecade/minigame-core";
import type config from "../../game.config.ts";

/** A full health: what the melee hits (config's meleeHits) take between them. */
const FULL_HEALTH = 20;
/** What a hit did a player in with, for their down: a ladder weapon's item id, or a melee hit. */
export const MELEE = "melee";
/** "<victim> was <verb> by <killer>" for a melee death. */
export const MELEE_VERBS = ["bashed", "beaten down", "clubbed", "pummeled", "knocked out"];
const SOUNDS = {
  up: { id: "random.levelup", pitch: 1.4, volume: 0.7 },
  back: { id: "note.bass", pitch: 0.6, volume: 1 },
} as const;

/**
 * Where everyone is on a ladder of weapons: the index of the weapon they're on (0 for the first),
 * by name, any case. Past the last is the win.
 */
export class Ladder {
  readonly weapons: readonly string[];
  private readonly rungs = new Map<string, number>();

  constructor(weapons: readonly string[]) {
    if (weapons.length === 0) throw new Error("a ladder needs a weapon");
    this.weapons = weapons;
  }

  /** The last weapon's rung: one kill there wins. */
  get top(): number {
    return this.weapons.length - 1;
  }

  has(name: string): boolean {
    return this.rungs.has(name.toLowerCase());
  }

  /** The rung a player is on (0 until they've moved). */
  rungOf(name: string): number {
    return this.rungs.get(name.toLowerCase()) ?? 0;
  }

  /** The weapon a player is on (the last once they've won). */
  weaponOf(name: string): string {
    return this.weapons[Math.min(this.top, this.rungOf(name))];
  }

  /** Puts a player on a rung (a late joiner). */
  place(name: string, rung: number): void {
    this.rungs.set(name.toLowerCase(), Math.max(0, Math.min(this.top, Math.round(rung))));
  }

  /** Up one. True when that was the kill with the last weapon: the win. */
  up(name: string): boolean {
    const rung = this.rungOf(name) + 1;
    this.rungs.set(name.toLowerCase(), rung);
    return rung > this.top;
  }

  /** Down one, never below the first. True when they moved. */
  down(name: string): boolean {
    const rung = this.rungOf(name);
    if (rung === 0) return false;
    this.rungs.set(name.toLowerCase(), rung - 1);
    return true;
  }

  /** The lowest rung any of `names` is on; 0 for nobody. */
  lowest(names: readonly string[]): number {
    return names.length === 0 ? 0 : Math.min(...names.map((name) => this.rungOf(name)));
  }
}

/** The lobby's Ladder setting's weapons, or the first ladder's for anything else. */
export function ladderWeapons(ladders: Readonly<Record<string, readonly string[]>>, picked: string | undefined): readonly string[] {
  return (picked !== undefined && ladders[picked]) || Object.values(ladders)[0];
}

export interface Standing {
  name: string;
  rung: number;
  kills: number;
}

/**
 * Who wins when time runs out: the furthest up the ladder, then the most kills (`by` says which).
 * Undefined for a draw, or nobody.
 */
export function timeUpLeader(standings: readonly Standing[]): { name: string; by: "rung" | "kills" } | undefined {
  const [first, second] = [...standings].sort((a, b) => b.rung - a.rung || b.kills - a.kills);
  if (!first) return undefined;
  if (!second || first.rung > second.rung) return { name: first.name, by: "rung" };
  return first.kills > second.kills ? { name: first.name, by: "kills" } : undefined;
}

/** The last hit a player took: who dealt it, and what with (a ladder weapon's item id, or MELEE). */
interface Blow {
  attacker: string;
  weapon: string;
}

/** What a down does to the ladder: moves the killer up, the victim back, or nothing. */
interface Outcome {
  promote?: string;
  demote: boolean;
  melee: boolean;
}

export class GunGame extends Minigame<typeof config> {
  readonly ladder: Ladder;
  private arsenal?: Arsenal;
  /** Each player's last hit taken (lowercase victim), until their down. */
  private readonly blows = new Map<string, Blow>();
  /** The first to a kill with the last weapon. */
  private winner: string | undefined;

  constructor(ctx: GameContext, gameConfig: typeof config) {
    super(ctx, gameConfig);
    this.ladder = new Ladder(ladderWeapons(gameConfig.ladders, ctx.vars.settings.ladder));
  }

  private get meleeDamage(): number {
    return FULL_HEALTH / this.config.meleeHits;
  }

  /** The arsenal: fired only during the match, by players in play; hits go through core's combat, each noted for the ladder. */
  protected override setup(): void {
    const inPlay = (name: string) => this.roster.get(name)?.state === "alive";
    this.arsenal = new Arsenal(
      this.scope,
      {
        canFire: (player) => this.phase === "playing" && inPlay(player.name),
        targets: () => this.roster.inState("alive").flatMap((participant) => this.body(participant.name) ?? []),
        nameOf: (entity) => this.whoIs(entity),
        hurt: (victim, attacker, amount, cause, headshot, weapon) => {
          const key = this.whoIs(victim)?.toLowerCase();
          const before = key === undefined ? undefined : this.blows.get(key);
          // Noted before the hit, which may put them down at once; put back if it didn't count.
          if (key !== undefined && attacker !== undefined) this.blows.set(key, { attacker, weapon: weapon === undefined ? "" : `minecade:${weapon}` });
          const result = this.combat.hit(victim, attacker, amount, cause, { direct: true });
          if (result === undefined && key !== undefined) {
            if (before) this.blows.set(key, before);
            else this.blows.delete(key);
          }
          if (result && headshot && attacker && this.roster.get(attacker)) this.stats.extra(attacker, "headshots", 1);
          return result;
        },
      },
      { random: () => this.ctx.random(), onAmmo: (player) => this.refreshHud(player.name), onAim: (player) => this.refreshHud(player.name) },
    );
  }

  protected override onStart(): void {
    const last = arsenalItemName(this.ladder.weapons[this.ladder.top]);
    this.broadcast(say.info(`Every kill moves you to the next weapon, ${this.ladder.weapons.length} in all. The first kill with the ${last} wins.`));
    this.broadcast(say.minor("A melee death puts you back one, and so does dying by yourself."));
  }

  /** Every spawn: the weapon you're on, magazine full. A late joiner starts on the lowest weapon anyone's on. */
  protected override onSpawn(player: Player, why: SpawnReason): void {
    const name = player.name;
    if (why === "join" && !this.ladder.has(name)) {
      const others = this.roster.all().filter((participant) => participant.state !== "left" && participant.name.toLowerCase() !== name.toLowerCase());
      this.ladder.place(name, this.ladder.lowest(others.map((participant) => participant.name)));
    }
    if (!this.score.entries().some(([id]) => id === name)) this.score.set(name, this.ladder.rungOf(name));
    this.blows.delete(name.toLowerCase());
    this.arsenal?.refill(name);
    this.arm(player);
  }

  /**
   * A crossbow's arrow and a Netherite Sword kill in one hit; any other melee hit (a fist, a bash)
   * takes a quarter of a full health. Each is noted for the ladder. Runs inside the before-event.
   */
  protected override onDamage(hit: Hit): number | "cancel" | void {
    const oneHit = this.arsenal?.vanillaDamage(hit);
    const melee = hit.cause === "entityAttack" && hit.projectile === undefined;
    if (hit.attacker !== undefined && hit.attacker.toLowerCase() !== hit.victim.toLowerCase()) {
      if (hit.projectile === ONE_HIT.arrow) this.blows.set(hit.victim.toLowerCase(), { attacker: hit.attacker, weapon: ONE_HIT.crossbow });
      else if (melee) this.blows.set(hit.victim.toLowerCase(), { attacker: hit.attacker, weapon: oneHit === undefined ? MELEE : ONE_HIT.sword });
    }
    if (oneHit !== undefined) return oneHit;
    if (melee && hit.attacker !== undefined) return this.meleeDamage;
  }

  protected override onDown(name: string, down: Down): DownDecision | void {
    const outcome = this.outcomeOf(name, down);
    this.blows.delete(name.toLowerCase());
    this.arsenal?.forget(name);
    if (outcome.demote && this.ladder.down(name)) {
      this.score.set(name, this.ladder.rungOf(name));
      const player = this.player(name);
      player?.sendMessage(say.warn(`Back to the ${arsenalItemName(this.ladder.weaponOf(name))}.`));
      play(player, SOUNDS.back);
    }
    if (outcome.promote) this.promote(outcome.promote);
  }

  protected override deathMessage(victim: string, down: Down): string | undefined {
    const outcome = this.outcomeOf(victim, down);
    const back = outcome.demote && this.ladder.rungOf(victim) > 0 ? ` ${say.minor("(back one weapon)")}` : "";
    if (outcome.melee && down.killer !== undefined) return `${killLine({ victim, killer: down.killer, cause: down.cause }, { verbs: MELEE_VERBS, replace: true }, this.ctx.random)}${back}`;
    const line = super.deathMessage(victim, down);
    return line && `${line}${back}`;
  }

  /**
   * The first to a kill with the last weapon, with no reason after the win (the user found "first
   * to a kill with the Netherite Sword" said nothing new). Otherwise core's rule: the last player
   * left wins once everyone else has gone.
   */
  protected override checkWin(): Result | undefined {
    if (this.winner !== undefined) return this.playerWins(this.winner, "");
    return super.checkWin();
  }

  /** Time up: the furthest up the ladder, then the most kills. */
  protected override onTimeUp(): Result {
    const standings = this.score.entries().map(([name]) => ({ name, rung: this.ladder.rungOf(name), kills: this.stats.get(name)?.kills ?? 0 }));
    const leader = timeUpLeader(standings);
    if (!leader) return draw("time ran out");
    return this.playerWins(leader.name, leader.by === "rung" ? "furthest up the ladder when time ran out" : "the most kills when time ran out");
  }

  /** Respawns and late joins land at one of the spawns farthest from everyone still in play. */
  protected override spawnPoint(name: string, why: SpawnReason): MapPosition {
    if (why === "start") return super.spawnPoint(name, why);
    return this.spawnAway(name) ?? super.spawnPoint(name, why);
  }

  /** The held gun's ammo, top right above the clock and the score. */
  protected override hud(name: string): string | undefined {
    const player = this.player(name);
    return (player && this.arsenal?.ammoLine(player)) ?? super.hud(name);
  }

  /** The Sniper Rifle's scope over the screen while it's raised. */
  protected override hudCodes(name: string): string {
    return this.arsenal?.guns.isScoped(name) ? SCOPE_CODE : "";
  }

  /**
   * What a down does: a melee death (the killer's last hit a fist or a bash, or a kill by melee with
   * nothing noted) puts the victim back one, and so does a down with nobody credited (falling out,
   * their own rocket); a kill whose last hit came from the killer's current weapon moves them up.
   * Leaving does nothing. Pure, so the kill feed can ask before onDown acts.
   */
  private outcomeOf(name: string, down: Down): Outcome {
    if (down.cause === "left") return { demote: false, melee: false };
    const killer = down.killer;
    if (killer === undefined) return { demote: true, melee: false };
    const blow = this.blows.get(name.toLowerCase());
    const byKiller = blow && blow.attacker.toLowerCase() === killer.toLowerCase() ? blow : undefined;
    if (down.cause === "entityAttack" && (byKiller ? byKiller.weapon === MELEE : true)) return { demote: true, melee: true };
    return { promote: byKiller && byKiller.weapon === this.ladder.weaponOf(killer) ? killer : undefined, demote: false, melee: false };
  }

  /** A kill that counted: the killer moves up, and a kill with the last weapon wins. */
  private promote(killer: string): void {
    const won = this.ladder.up(killer);
    this.score.set(killer, this.ladder.rungOf(killer));
    if (won) {
      this.winner ??= killer;
      return;
    }
    const rung = this.ladder.rungOf(killer);
    const weapon = arsenalItemName(this.ladder.weaponOf(killer));
    const player = this.player(killer);
    player?.sendMessage(say.info(`Next: the ${weapon} (${rung + 1} of ${this.ladder.weapons.length})`));
    play(player, SOUNDS.up);
    if (rung === this.ladder.top) this.broadcast(say.highlight(`${nameOf(killer)} is on the ${weapon}: one kill to win!`));
    // The new weapon comes a tick later, once the shot that made the kill is done with the old one.
    this.scope.defer(() => {
      const holder = this.player(killer);
      if (!holder || this.roster.get(killer)?.state !== "alive") return;
      this.arsenal?.forget(killer);
      this.arsenal?.refill(killer);
      this.arm(holder);
      this.refreshHud(killer);
    });
  }

  /** The weapon a player is on, alone in its slot and locked there, selected; a crossbow's arrows above the hotbar. */
  private arm(player: Player): void {
    const { slots } = this.config;
    const weapon = this.ladder.weaponOf(player.name);
    try {
      const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
      if (!inventory) return;
      inventory.clearAll();
      const stack = new ItemStack(weapon, 1);
      stack.lockMode = ItemLockMode.slot;
      inventory.setItem(slots.weapon, stack);
      if (weapon === ONE_HIT.crossbow) inventory.setItem(slots.arrows, new ItemStack(ONE_HIT.arrow, CROSSBOW_ARROWS));
      player.selectedSlotIndex = slots.weapon;
    } catch (error) {
      log.warn(`gungame: could not give ${player.name} the ${weapon}: ${describeError(error)}`);
    }
  }
}

function play(player: Player | undefined, sound: { id: string; pitch: number; volume: number }): void {
  try {
    player?.playSound(sound.id, { pitch: sound.pitch, volume: sound.volume });
  } catch {
    // left
  }
}
