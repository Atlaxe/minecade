// Flies transfers' tokens (tokens.ts says what and how): coins, Stars, items and dice going from one
// head to another, one after another, with the count over the heads, and the user's sounds for each
// (the dialogue tool's events gain.coins, gain.star, gain.item as one lands on a seat, and loss.* as
// one leaves a seat's head).
import type { Dimension, Entity, Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { eventCue, playCue } from "./sounds.ts";
import { FLIGHT_TICKS, LAUNCH_EVERY, SKY, TOKEN_TICKS, counted, flightOf, isSeat, labelSteps, lookOf, shownCount, soundOf, type Party, type Token } from "./tokens.ts";

const TOKEN = "blockparty:token";
const LABEL = "blockparty:label";
const SHAPE = "blockparty:shape";
const LOOK = "blockparty:look";
const REACH = "blockparty:reach";
const RISE = "blockparty:rise";
const ARC = "blockparty:arc";
/** The properties' ranges (the entity's), so a far flight is cut short rather than refused. */
const REACH_MAX = 64;
const RISE_MAX = 64;
const ARC_MAX = 8;
/** How far over a head a token comes in or goes out, and a count rides. */
const OVER_HEAD = 0.3;
const LABEL_OVER = 0.9;
/** Ticks a count stays after the last token lands, and its slow rise (an impulse up, slowed by the air). */
const LABEL_LINGER = 24;
const LABEL_RISE = 0.05;
/** The count's look: gold and bold coming in, red going out. */
const GAIN_STYLE = "§6§l";
const LOSS_STYLE = "§c§l";

export interface TransfersDeps {
  scope: Scope;
  dimension(): Dimension;
  random(): number;
}

export class Transfers {
  private readonly deps: TransfersDeps;

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
    const outLabel = counted(count) && isSeat(from) ? this.label(giver) : undefined;
    const inLabel = counted(count) && isSeat(to) ? this.label(taker) : undefined;
    for (let i = 0; i < shown && !this.deps.scope.disposed; i++) {
      const start = giver ? headOf(giver) : skyOver(taker);
      const end = taker ? headOf(taker) : this.awayFrom(giver);
      if (start && end) this.launch(start, end, look);
      const step = steps[i];
      if (outLabel) setText(outLabel, `${LOSS_STYLE}-${step}`);
      if (isSeat(from)) playCue(eventCue(`loss.${sound}`), () => this.deps.random());
      this.deps.scope.timeout(() => {
        if (inLabel) setText(inLabel, `${GAIN_STYLE}+${step}`);
        if (isSeat(to)) playCue(eventCue(`gain.${sound}`), () => this.deps.random());
      }, FLIGHT_TICKS);
      if (i < shown - 1) await this.deps.scope.wait(LAUNCH_EVERY);
    }
    await this.deps.scope.wait(FLIGHT_TICKS);
    this.deps.scope.timeout(() => {
      remove(outLabel);
      remove(inLabel);
    }, LABEL_LINGER);
  }

  /** One token: put at the middle of its way, facing where it goes; its own animation flies it (tokens.ts). */
  private launch(from: Vector3, to: Vector3, look: { shape: number; look: number }): void {
    const flight = flightOf([from.x, from.y, from.z], [to.x, to.y, to.z]);
    try {
      const token = this.deps.dimension().spawnEntity(TOKEN, { x: flight.at[0], y: flight.at[1], z: flight.at[2] });
      token.setRotation({ x: 0, y: flight.yaw });
      token.setProperty(SHAPE, look.shape);
      token.setProperty(LOOK, look.look);
      token.setProperty(REACH, Math.min(REACH_MAX, flight.reach));
      token.setProperty(RISE, Math.max(-RISE_MAX, Math.min(RISE_MAX, flight.rise)));
      token.setProperty(ARC, Math.min(ARC_MAX, flight.arc));
      this.deps.scope.timeout(() => remove(token), TOKEN_TICKS);
    } catch (error) {
      log.warn(`blockparty: a transfer's token failed: ${describeError(error)}`);
    }
  }

  /** A count over a head, rising slowly (empty until the first token goes or lands). */
  private label(body: Entity | undefined): Entity | undefined {
    if (!body?.isValid) return undefined;
    try {
      const at = headOf(body);
      if (!at) return undefined;
      const label = this.deps.dimension().spawnEntity(LABEL, { x: at.x, y: at.y + LABEL_OVER - OVER_HEAD, z: at.z });
      label.nameTag = "";
      try {
        label.applyImpulse({ x: 0, y: LABEL_RISE, z: 0 });
      } catch {
        // it stays where it is
      }
      return label;
    } catch (error) {
      log.warn(`blockparty: a transfer's count failed: ${describeError(error)}`);
      return undefined;
    }
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

function setText(label: Entity, text: string): void {
  try {
    if (label.isValid) label.nameTag = text;
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
