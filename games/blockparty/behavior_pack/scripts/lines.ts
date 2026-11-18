// Block Party's lines (docs/plans/block-party.md, "Dialogue"): everything the game says, by id, from
// games/blockparty/dialogue.json. That file is written by the user's dialogue editor (not in this
// repo), which keeps each line's scene, character and notes; change the lines there and install
// them, never in the file by hand.
//
// A line the user hasn't written (or took out) is skipped: line() gives "" and the game shows
// nothing for it (the user's call). A form button can't be skipped, since it's a choice, so button()
// falls back to the id.
//
// Each moment also says who says it and how it shows (moment(): its character, its delivery, and the
// dialogue box's switches, docs/plans/block-party-ui.md "The dialogue tool's data"), and each
// character how its name and face look in the dialogue box (look()).
//
// Each line (each alternate of a moment) also has its actions (actionsOf()): who does which of the
// dialogue tool's actions as it starts, as it ends, or seconds in (animations.ts).
import { log } from "@minecade/minigame-core";
import type { LineAction } from "./animations.ts";
import dialogue from "../../dialogue.json";

const LINES: Readonly<Record<string, readonly string[]>> = dialogue.lines;

/** How a moment shows, as the user's file sets it. */
export interface Moment {
  /** Who says it: "Game", or a character ("Chris"). */
  character: string;
  /** Where it shows: "Dialogue box", "Title", "Subtitle", "Action bar" (the dialogue tool's scene deliveries; chat is gone). */
  delivery: string;
  /** Players can vote to skip it. */
  skippable: boolean;
  /** It's part of a cutscene (skipping skips the rest of it). */
  cutscene: boolean;
  /** How the camera gets to the speaker: "Pan", "Cut", "Stay", or "" for the moment's default. */
  camera: string;
}

const MOMENTS: Readonly<Record<string, Partial<Moment>>> = (dialogue as { moments?: Record<string, Partial<Moment>> }).moments ?? {};

/** How `id`'s moment shows: a Game line in chat when the file doesn't say. */
export function moment(id: string): Moment {
  const found = MOMENTS[id];
  return {
    character: found?.character ?? "Game",
    delivery: found?.delivery ?? "Dialogue box",
    skippable: found?.skippable === true,
    cutscene: found?.cutscene === true,
    camera: found?.camera ?? "",
  };
}

/**
 * How a character looks in the dialogue box (the workshop's characters.json): the name's § color,
 * its face's name, and whether the face's picture is wide (twice as wide as it's tall, the Warden's
 * with his tendrils: the install sees it from the picture), which the box gives a wide slot.
 */
export interface Look {
  color: string;
  face: string;
  wide: boolean;
}

const LOOKS: Readonly<Record<string, Partial<Look>>> = (dialogue as { characters?: Record<string, Partial<Look>> }).characters ?? {};

/** How `character` looks: no color and no face when the file doesn't say. */
export function look(character: string): Look {
  const found = LOOKS[character];
  return { color: found?.color ?? "", face: found?.face ?? "", wide: found?.wide === true };
}

/** What a line's {name}s are filled with: {player} takes fills.player. */
export type Fills = Readonly<Record<string, string | number>>;

/** Ids already logged as missing, so a skipped line is logged once, not every time. */
const logged = new Set<string>();

/**
 * One of `id`'s lines (alternates picked by `random`), each {name} filled from `fills`. An id with
 * no line gives "", which the game shows as nothing; a {name} with no fill stays as typed.
 */
export function line(id: string, fills: Fills = {}, random: () => number = Math.random): string {
  return pickLine(id, fills, random).text;
}

/** As line(), and which of the moment's alternates it is (its actions are that one's: actionsOf). */
export function pickLine(id: string, fills: Fills = {}, random: () => number = Math.random): { text: string; index: number } {
  const texts = LINES[id];
  if (!texts || texts.length === 0) {
    if (!logged.has(id)) {
      logged.add(id);
      log.info(`blockparty: no line "${id}" in dialogue.json, so it's skipped`);
    }
    return { text: "", index: 0 };
  }
  const index = texts.length === 1 ? 0 : Math.min(texts.length - 1, Math.floor(random() * texts.length));
  const text = texts[index].replace(/\{([^{}]*)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(fills, name) ? String(fills[name]) : whole));
  return { text, index };
}

/** Each moment's actions, alternate by alternate, as the dialogue tool writes them (only moments with any). */
const ACTIONS: Readonly<Record<string, readonly (readonly LineAction[])[]>> = (dialogue as { actions?: Record<string, LineAction[][]> }).actions ?? {};

/** The actions of `id`'s alternate `index`, as the user's file sets them (none when it doesn't). */
export function actionsOf(id: string, index: number): readonly LineAction[] {
  return ACTIONS[id]?.[index] ?? [];
}

/** A form button's line: as line(), but its id when there's none, since a choice can't be left blank. */
export function button(id: string, fills: Fills = {}, random: () => number = Math.random): string {
  return line(id, fills, random) || id;
}
