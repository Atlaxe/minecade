// Flies transfers' tokens (tokens.ts says what and how): coins, Stars, items and dice going from one
// head to another, one after another, with the count over the heads, and the user's sounds for each
// (the dialogue tool's events gain.coins, gain.star, gain.item as one lands on a seat, and loss.* as
// one leaves a seat's head).
//
// The count over a head is blockparty:tally, drawn as the moves left are (counts.ts): "+3" or "-3" in
// Minecraft Ten, in the dice file's gain or loss look, facing each player's camera, with no name tag
// plate. It stands just over the head (over the moves left when they're showing), and rises a little
// as it comes (its own animation, animation.blockparty.tally_rise); nothing moves it.
import type { Dimension, Entity, Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { MAX_COUNT, TALLY_ENTITY, TALLY_PROPERTY, TONE_GAIN, TONE_LOSS, TONE_PROPERTY } from "./dice.ts";
import { eventCue, playCue } from "./sounds.ts";
import { FLIGHT_TICKS, LAUNCH_EVERY, SKY, TOKEN_TICKS, counted, flightOf, flightProperties, isSeat, labelSteps, lookOf, shownCount, soundOf, type Party, type Token } from "./tokens.ts";

const TOKEN = "blockparty:token";
const SHAPE = "blockparty:shape";
const LOOK = "blockparty:look";
const REACH = "blockparty:reach";
const RISE = "blockparty:rise";
const ARC = "blockparty:arc";
const HEADING = "blockparty:heading";
/** How far over a head a token comes in or goes out. */
const OVER_HEAD = 0.3;
/**
 * How far over the feet a count's entity stands (its number's middle half a block higher, a little
 * over the head: the user asked for it closer, 2026-11-18), and how much higher while the moves left
 * show over the same head.
 */
const TALLY_OVER = 1.6;
const OVER_MOVES = 1.2;
/** Ticks a count stays after the last token lands. */
const TALLY_LINGER = 24;

export interface TransfersDeps {
  scope: Scope;
  dimension(): Dimension;
  random(): number;
  /** Whether a seat's moves left are showing over their head (counts.ts): a count stands over them. */
  movesShown?(key: string): boolean;
}

export class Transfers {
  private readonly deps: TransfersDeps;
  /** The warnings said this game (warnOnce). */
  private readonly warned = new Set<string>();

  constructor(deps: TransfersDeps) {
    this.deps = deps;
  }

  /**
   * `count` of `token` going from one to another (a seat, an NPC, or the bank): the tokens fly one
   * after another, the counts ride over the seats' heads. Resolves once the last has landed.
   */
  async give(from: Party, to: Party, token: Token, count: number): Promise<void> {
    const giver = bodyOf(from);
    const taker = bodyOf(to);
    const look = lookOf(token);
    if (count <= 0 || (!giver && !taker) || !look) return;
    const shown = shownCount(token, count);
    const steps = labelSteps(count, shown);
    const sound = soundOf(token);
    const outTally = counted(count) && isSeat(from) ? this.tally(from.key, from.body, TONE_LOSS) : undefined;
    const inTally = counted(count) && isSeat(to) ? this.tally(to.key, to.body, TONE_GAIN) : undefined;
    for (let i = 0; i < shown && !this.deps.scope.disposed; i++) {
      const start = giver ? headOf(giver) : skyOver(taker);
      const end = taker ? headOf(taker) : this.awayFrom(giver);
      if (start && end) this.launch(start, end, look);
      const step = steps[i];
      if (outTally) setTally(outTally, step);
      if (isSeat(from)) playCue(eventCue(`loss.${sound}`), () => this.deps.random());
      this.deps.scope.timeout(() => {
        if (inTally) setTally(inTally, step);
        if (isSeat(to)) playCue(eventCue(`gain.${sound}`), () => this.deps.random());
      }, FLIGHT_TICKS);
      if (i < shown - 1) await this.deps.scope.wait(LAUNCH_EVERY);
    }
    await this.deps.scope.wait(FLIGHT_TICKS);
    this.deps.scope.timeout(() => {
      remove(outTally);
      remove(inTally);
    }, TALLY_LINGER);
  }

  /**
   * One token: put at the middle of its way, facing where it goes; its own animation flies it
   * (tokens.ts). Its removal is set before anything else, so a token never stays behind; one whose
   * properties can't be set is taken away at once rather than shown standing still.
   */
  private launch(from: Vector3, to: Vector3, look: { shape: number; look: number }): void {
    const flight = flightOf([from.x, from.y, from.z], [to.x, to.y, to.z]);
    let token: Entity | undefined;
    try {
      token = this.deps.dimension().spawnEntity(TOKEN, { x: flight.at[0], y: flight.at[1], z: flight.at[2] });
      const spawned = token;
      this.deps.scope.timeout(() => remove(spawned), TOKEN_TICKS);
      token.setRotation({ x: 0, y: flight.yaw });
      const properties = flightProperties(flight);
      token.setProperty(SHAPE, look.shape);
      token.setProperty(LOOK, look.look);
      token.setProperty(REACH, properties.reach);
      token.setProperty(RISE, properties.rise);
      token.setProperty(ARC, properties.arc);
      token.setProperty(HEADING, properties.heading);
    } catch (error) {
      remove(token);
      this.warnOnce(`blockparty: a transfer's token failed: ${describeError(error)}`);
    }
  }

  /**
   * A count over a seat's head: where the moves left stand (over them while they show), empty until
   * the first token goes or lands. Its tone is its sign and look: "+" coming in, "-" going out.
   */
  private tally(key: string, body: Entity, tone: number): Entity | undefined {
    if (!body.isValid) return undefined;
    try {
      const feet = body.location;
      const over = TALLY_OVER + (this.deps.movesShown?.(key) ? OVER_MOVES : 0);
      const tally = this.deps.dimension().spawnEntity(TALLY_ENTITY, { x: feet.x, y: feet.y + over, z: feet.z });
      // Like the moves left, it never turns of its own accord (the model undoes any turn anyway).
      tally.setRotation({ x: 0, y: 0 });
      tally.setProperty(TONE_PROPERTY, tone);
      return tally;
    } catch (error) {
      this.warnOnce(`blockparty: a transfer's count failed: ${describeError(error)}`);
      return undefined;
    }
  }

  /** A warning, once a game for each kind (a broken entity would say it for every token). */
  private warnOnce(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    log.warn(message);
  }

  /** Where a token goes with no taker: up off the giver's head and a little to one side. */
  private awayFrom(giver: Entity | undefined): Vector3 | undefined {
    const head = giver ? headOf(giver) : undefined;
    if (!head) return undefined;
    const angle = this.deps.random() * Math.PI * 2;
    return { x: head.x + Math.cos(angle) * 0.8, y: head.y + SKY, z: head.z + Math.sin(angle) * 0.8 };
  }
}

/** A party's entity: a seat's body, an NPC itself, nobody for the bank. */
function bodyOf(party: Party): Entity | undefined {
  const body = isSeat(party) ? party.body : party;
  return body?.isValid ? body : undefined;
}

/** Just over an entity's head (its eyes, a little up), where tokens leave and land. */
function headOf(entity: Entity): Vector3 | undefined {
  try {
    const head = entity.getHeadLocation();
    return { x: head.x, y: head.y + OVER_HEAD, z: head.z };
  } catch {
    return undefined;
  }
}

/** Where the bank's tokens come from: high over the taker's head. */
function skyOver(taker: Entity | undefined): Vector3 | undefined {
  const head = taker ? headOf(taker) : undefined;
  return head ? { x: head.x, y: head.y + SKY, z: head.z } : undefined;
}

/** A count's number (its sign is its tone's). */
function setTally(tally: Entity, value: number): void {
  try {
    if (tally.isValid) tally.setProperty(TALLY_PROPERTY, Math.max(0, Math.min(MAX_COUNT, Math.round(value))));
  } catch {
    // gone
  }
}

function remove(entity: Entity | undefined): void {
  try {
    if (entity?.isValid) entity.remove();
  } catch {
    // gone
  }
}
