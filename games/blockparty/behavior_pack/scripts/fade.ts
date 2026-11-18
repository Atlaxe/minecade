// The turn fade (the user, 2026-11-18): while it's someone's turn on the board, everyone else fades
// away, so the board camera shows the player whose turn it is alone; when the turn is over they come
// back. Not on the pre-game podium (its turn order roll isn't a turn), and not while a minigame has
// the players (a Versus duel in the middle of a turn shows everyone in the arena).
//   - Who fades: every other seat (players and bots), and whatever follows one of them (the Zombie
//     Spawn item's zombie, registered with follow()). Something following the player whose turn it
//     is stays, as they do (the user: a zombie following the player mustn't fade). The board's NPCs
//     (Chris at the Stars, the Referee) stay too: the turn talks to them.
//   - How: an entity of the game's own that has the FADED property (bots, the zombie) fades on its
//     own client: the property flips and its render controller eases its opacity down in about 0.4 s
//     (the vanilla warden's pulsing spots do it the same way, a color's alpha on a color-masked,
//     blended material), then invisibility takes its shadow away. Coming back, invisibility goes
//     and it eases in. A player can't fade like that without overriding vanilla's player model, so a
//     player goes invisible at once, and comes back at once.
// fadedKeys() is pure, so the tests can check who fades.
import type { Entity } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { isPlayer, type Who } from "./bots.ts";

/** The entity property a fading entity's render controller reads (bot.json, zombie.json). */
export const FADED_PROPERTY = "blockparty:faded";
/** The entities of the game's own that can fade by themselves (they have FADED_PROPERTY). */
export const FADING_TYPES: readonly string[] = ["blockparty:bot", "blockparty:zombie"];
/** Ticks the client takes to fade a fading entity out (its pre_animation: 2.5 a second), before invisibility hides its shadow. */
export const FADE_TICKS = 8;
const INVISIBILITY = "invisibility";
/** Long enough to outlast any turn; taken away when the turn is over. */
const INVISIBLE_TICKS = 1_000_000;

/** A follower: something that walks with a seat (a zombie on a player), fading with them. */
interface Follower {
  entity: Entity;
  owner: string;
}

/**
 * Which seats fade now (their keys): everyone but `turn`, while there's a turn; nobody without one.
 * A follower fades with its owner.
 */
export function fadedKeys(seats: readonly string[], turn: string | undefined): Set<string> {
  if (turn === undefined) return new Set();
  return new Set(seats.filter((key) => key !== turn));
}

interface State {
  entity: Entity;
  faded: boolean;
  /** The tick its fade began (a fading entity gets invisibility FADE_TICKS later). */
  since: number;
  invisible: boolean;
}

export class TurnFade {
  /** What each entity was last set to, by its id. */
  private readonly states = new Map<string, State>();
  private readonly followers: Follower[] = [];
  /** The tick now. */
  private readonly now: () => number;

  constructor(scope: Scope, now: () => number) {
    this.now = now;
    scope.add(() => this.clear());
  }

  /** `entity` follows the seat `owner` (a key): it fades when they do, and stays when it's their turn. */
  follow(entity: Entity, owner: string): void {
    this.unfollow(entity);
    this.followers.push({ entity, owner });
  }

  /** `entity` follows nobody now (it left, or it's gone): it comes back if it was faded. */
  unfollow(entity: Entity): void {
    const at = this.followers.findIndex((follower) => follower.entity === entity);
    if (at < 0) return;
    this.followers.splice(at, 1);
    if (entity.isValid) this.set(entity, false);
  }

  /**
   * Each tick: `seats` (everyone sitting at the board, here now) fade but the seat whose turn it is
   * (`turn`; undefined: nobody fades), with their followers.
   */
  update(seats: readonly Who[], turn: string | undefined): void {
    const faded = fadedKeys(
      seats.map((who) => who.key),
      turn,
    );
    for (const who of seats) this.set(who.body, faded.has(who.key));
    for (let i = this.followers.length - 1; i >= 0; i--) {
      const follower = this.followers[i];
      if (!follower.entity.isValid) {
        this.followers.splice(i, 1);
        continue;
      }
      this.set(follower.entity, faded.has(follower.owner));
    }
    // Forget the entities that are gone (a bot made again elsewhere is a new one).
    for (const [id, state] of this.states) if (!state.entity.isValid) this.states.delete(id);
  }

  /** Everyone this faded back, at once (the game is over). */
  clear(): void {
    for (const state of this.states.values()) if (state.faded) this.show(state.entity, false);
    this.states.clear();
  }

  /** Brings `body` back at once and forgets it (a player spawning again: whatever they wore before goes). */
  reset(body: Entity): void {
    this.states.delete(body.id);
    this.show(body, true);
  }

  private set(body: Entity, faded: boolean): void {
    if (!body.isValid) return;
    const state = this.states.get(body.id);
    const tick = this.now();
    if (!state || state.faded !== faded) {
      // Unknown till now: set as it should be, whatever it wore before (an invisibility left over).
      const next: State = { entity: body, faded, since: tick, invisible: false };
      this.states.set(body.id, next);
      if (!faded) this.show(body, !state);
      else if (isPlayer(body) || !FADING_TYPES.includes(body.typeId)) next.invisible = this.invisible(body);
      else this.property(body, true);
      return;
    }
    // A fading entity has faded out: invisibility takes its shadow away.
    if (faded && !state.invisible && tick - state.since >= FADE_TICKS) state.invisible = this.invisible(body);
  }

  /** Back in: no invisibility, and a fading entity eases in. `always`: take invisibility away even if this never gave it. */
  private show(body: Entity, always: boolean): void {
    if (!body.isValid) return;
    try {
      if (always || body.getEffect(INVISIBILITY)) body.removeEffect(INVISIBILITY);
    } catch (error) {
      log.warn(`blockparty: bringing ${body.typeId} back failed: ${describeError(error)}`);
    }
    if (FADING_TYPES.includes(body.typeId)) this.property(body, false);
  }

  private invisible(body: Entity): boolean {
    try {
      body.addEffect(INVISIBILITY, INVISIBLE_TICKS, { amplifier: 0, showParticles: false });
      return true;
    } catch (error) {
      log.warn(`blockparty: fading ${body.typeId} failed: ${describeError(error)}`);
      return false;
    }
  }

  private property(body: Entity, faded: boolean): void {
    try {
      if (body.getProperty(FADED_PROPERTY) !== faded) body.setProperty(FADED_PROPERTY, faded);
    } catch (error) {
      log.warn(`blockparty: fading ${body.typeId} failed: ${describeError(error)}`);
    }
  }
}
