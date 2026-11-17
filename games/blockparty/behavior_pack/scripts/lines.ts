// Block Party's lines (docs/plans/block-party.md, "Dialogue"): everything the game says, by id, from
// games/blockparty/dialogue.json. That file is written by the user's dialogue editor (not in this
// repo), which keeps each line's scene, character and notes; change the lines there and install
// them, never in the file by hand.
import { log } from "@minecade/minigame-core";
import dialogue from "../../dialogue.json";

const LINES: Readonly<Record<string, readonly string[]>> = dialogue.lines;

/** What a line's {name}s are filled with: {player} takes fills.player. */
export type Fills = Readonly<Record<string, string | number>>;

/**
 * One of `id`'s lines (alternates picked by `random`), each {name} filled from `fills`. An id with
 * no line comes back as the id itself, so it shows plainly in game; a {name} with no fill stays as
 * typed.
 */
export function line(id: string, fills: Fills = {}, random: () => number = Math.random): string {
  const texts = LINES[id];
  if (!texts || texts.length === 0) {
    log.warn(`blockparty: dialogue.json has no line "${id}"`);
    return id;
  }
  const text = texts.length === 1 ? texts[0] : texts[Math.min(texts.length - 1, Math.floor(random() * texts.length))];
  return text.replace(/\{([^{}]*)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(fills, name) ?String(fills[name]) : whole));
}
