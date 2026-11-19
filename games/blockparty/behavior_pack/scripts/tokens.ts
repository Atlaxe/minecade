// Transfers' tokens (the user, 2026-11-18: transaction animations "similar to Super Mario Party"):
// what flies from one to another when coins, a Star, an item or a die changes hands, and how. Pure,
// so the tests (and the build, for the token's pictures) can use it; transfers.ts flies them.
//   - A token is one entity of the game's own (blockparty:token) that shows a coin or a Star (the
//     private icons pack's models) or an item's or die's icon (a flat picture: the build copies each
//     one's icon to its slot's picture, textures/blockparty/icons/token_<slot>, items first in the
//     game's order, then the dice in the dice file's).
//   - It flies on its own client: put at the middle of its way, its heading (the way it goes), reach,
//     rise and arc as properties, and the pack's animation (animation.blockparty.token.fly) carries
//     it over its own life from the giver's head, up in an arc, down into the taker's head, spinning,
//     popping in as it leaves and shrinking away as it lands. Nothing moves it from the server, so it
//     never jitters. Its model's bone "upright" undoes whatever way the entity's body faces (a spawned
//     entity's body doesn't keep the turn it's given, so the coins flew off any which way, the user saw
//     2026-11-18) and "heading" turns it the way it goes, as the moves left face the camera. The properties are whole numbers, hundredths of a block
//     (flightProperties): float properties never reached the client (the first tokens stood still as
//     the first slot's picture, the client logging "query.property called on an actor without a
//     property component" every frame), as the RPG's rocket's didn't (guns, 1ab028e).
//   - Several go one after another, a stream of them, up to a few (10 coins); with two or more a
//     count rides over the taker's head, "+1" up to "+X" as they land, and "-1" to "-X" over a
//     giving player's head as they go.
//   - With no giver (the bank: a Blue space, a minigame's coins) they drop in from above the head;
//     with no taker (a Red space, coins lost) they fly up off the head and away.
import type { Entity } from "@minecraft/server";
import type { Who } from "./bots.ts";
import { DICE } from "./dice.ts";
import { ITEMS, ITEM_IDS } from "./items.ts";
import type { Prize } from "./space-rules.ts";

/** What changes hands. */
export type Token = "coin" | "star" | Prize;

/** One side of a transfer: a seat (a player or a bot), an NPC's entity, or nobody (the bank, the sky). */
export type Party = Who | Entity | undefined;

/** Whether a party is a seat (its coins and Stars are the loop's). */
export function isSeat(party: Party): party is Who {
  return party !== undefined && "key" in party && "body" in party;
}

/** How many picture slots the token has (items, then dice): the build fills each, a clear one past the last. */
export const TOKEN_SLOTS = 32;
/** The token's shapes (its property SHAPE): an icon picture, the coin model, the Star model. */
export const SHAPE_ICON = 0;
export const SHAPE_COIN = 1;
export const SHAPE_STAR = 2;
/** Its pictures past the slots (its property LOOK): the coin's, the Star's. */
export const LOOK_COIN = TOKEN_SLOTS;
export const LOOK_STAR = TOKEN_SLOTS + 1;

/** The letters of what's in each slot, items in the game's order then the dice in the dice file's (the build copies each one's icon to its slot). */
export function slotLetters(): string[] {
  return [...ITEM_IDS.map((id) => ITEMS[id].letters), ...Object.values(DICE).map((die) => die.letters)];
}

/** A slot's picture in the pack. */
export function slotPicture(slot: number): string {
  return `textures/blockparty/icons/token_${slot}`;
}

/** The slot of an item or a die (undefined for a die not in the dice file, or past the slots). */
export function slotOf(prize: Prize): number | undefined {
  const at = prize.kind === "item" ? ITEM_IDS.indexOf(prize.id) : ITEM_IDS.length + Object.keys(DICE).indexOf(prize.id);
  if (prize.kind === "die" && !Object.keys(DICE).includes(prize.id)) return undefined;
  return at >= 0 && at < TOKEN_SLOTS ? at : undefined;
}

/** A token's shape and picture. */
export function lookOf(token: Token): { shape: number; look: number } | undefined {
  if (token === "coin") return { shape: SHAPE_COIN, look: LOOK_COIN };
  if (token === "star") return { shape: SHAPE_STAR, look: LOOK_STAR };
  const slot = slotOf(token);
  return slot === undefined ? undefined : { shape: SHAPE_ICON, look: slot };
}

/** The sound kind a token's landing and leaving play (the dialogue tool's events gain.<kind> and loss.<kind>). */
export function soundOf(token: Token): "coins" | "star" | "item" {
  return token === "coin" ? "coins" : token === "star" ? "star" : "item";
}

type Vec = readonly [number, number, number];

/** How long a token's flight is (the pack's animation has it too: 0.7 s), and when it's taken away (after it shrinks). */
export const FLIGHT_TICKS = 14;
export const TOKEN_TICKS = 18;
/** Ticks between one token and the next. */
export const LAUNCH_EVERY = 3;
/** How high over a head the bank's tokens come from, and fly off to. */
export const SKY = 2.6;
/** How far below the way the token's entity stands: its model's middle is half a block up. */
export const MODEL_MIDDLE = 0.5;

/** Where a token's entity goes, which way it faces, and its flight's reach (across), rise (up, to the end) and arc (how high over the line it goes). */
export interface Flight {
  at: Vec;
  yaw: number;
  reach: number;
  rise: number;
  arc: number;
}

/** A token's flight from one head to another: its entity at the middle of the way, facing the taker. */
export function flightOf(from: Vec, to: Vec): Flight {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const reach = Math.hypot(dx, dz);
  const yaw = reach > 0.01 ? (Math.atan2(-dx, dz) * 180) / Math.PI : 0;
  const arc = Math.min(2.5, 0.7 + reach * 0.12);
  return { at: [from[0] + dx / 2, from[1] - MODEL_MIDDLE, from[2] + dz / 2], yaw, reach: round(reach), rise: round(to[1] - from[1]), arc: round(arc) };
}

/** The flight's properties' ranges on the entity (behavior_pack/entities/token.json): reach, rise and arc in hundredths of a block, heading in degrees. */
export const FLIGHT_RANGES = { reach: [0, 6400], rise: [-6400, 6400], arc: [0, 800], heading: [-180, 180] } as const;

/**
 * A flight as the token's properties hold it: reach, rise and arc in hundredths of a block, cut to
 * their ranges (a far flight is cut short rather than refused), and its heading (Minecraft's yaw
 * toward the taker) in whole degrees.
 */
export function flightProperties(flight: Flight): { reach: number; rise: number; arc: number; heading: number } {
  const hundredths = (value: number, [low, high]: readonly [number, number]) => Math.max(low, Math.min(high, Math.round(value * 100)));
  const [low, high] = FLIGHT_RANGES.heading;
  return {
    reach: hundredths(flight.reach, FLIGHT_RANGES.reach),
    rise: hundredths(flight.rise, FLIGHT_RANGES.rise),
    arc: hundredths(flight.arc, FLIGHT_RANGES.arc),
    heading: Math.max(low, Math.min(high, Math.round(flight.yaw))) + 0,
  };
}

/** How many tokens fly for `count`: each coin up to 10, each Star up to 5, each item or die up to 3. */
export function shownCount(token: Token, count: number): number {
  const most = token === "coin" ? 10 : token === "star" ? 5 : 3;
  return Math.max(0, Math.min(count, most));
}

/** The count over a head as each of `shown` tokens lands (or leaves), ending at `count`: 10 coins in 10 steps, 30 in steps of 3. */
export function labelSteps(count: number, shown: number): number[] {
  return Array.from({ length: shown }, (_, i) => Math.round((count * (i + 1)) / shown));
}

/** Whether a transfer shows a count over the heads: when more than one changes hands. */
export function counted(count: number): boolean {
  return count >= 2;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
