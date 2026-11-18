// Block Party's ready-made HUD states for the workshop's JSON UI tool (its Preview page, "Game
// preview" for the blockparty packs): games/blockparty/ui-previews.json, built here from the codes
// the game writes (dialogue-codes.ts), so the previews can't drift from the game. After changing
// the codes or the samples, write the file again: set WRITE_PREVIEWS=1 and run this test
// (PowerShell: `$env:WRITE_PREVIEWS=1; npx vitest run games/blockparty/test/ui-previews.test.ts`).
// Line endings don't count (a checkout can turn them).
//
// Each preview is the tool's game state for the HUD: the action bar line (the dialogue box rides in
// the core pack's action bar panel, which is there while the game sends its HUD line) and the
// sidebar (its title and its rows, top to bottom).
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HUD_MARK } from "@minecade/minigame-core";
import { boxRows, boxTitle, rowsOf, type BoxMode } from "../behavior_pack/scripts/dialogue-codes.ts";
import { DICE, ITEMS } from "../behavior_pack/scripts/dice-items.ts";
import { resultFrames } from "../behavior_pack/scripts/results.ts";
import { SCREEN_WORDS, cardRows, codesOf, menuRow, panelRows, resultRows, type CardSeat, type MenuState, type PanelShow } from "../behavior_pack/scripts/screen-codes.ts";
import { compose, type PartId, type SidebarPart } from "../behavior_pack/scripts/sidebar-rows.ts";

interface Box {
  mode: BoxMode;
  name: string;
  /** The sentence on show (the box shows one at a time). */
  text: string;
  buttons?: string[];
  selected?: number;
  skip?: string;
  jumped?: string[];
  /** The jump prompt's text: who it waits for ("" for everyone); none, no prompt. */
  prompt?: string;
}

const box = (preview: string, about: string, sample: Box) => ({
  name: preview,
  about,
  hud: {
    actionbar: HUD_MARK,
    sidebar: {
      title: boxTitle(sample.mode, sample.name),
      lines: boxRows({ words: rowsOf(sample.text), buttons: sample.buttons, selected: sample.selected ?? 0, skip: sample.skip, jumped: sample.jumped, prompt: sample.prompt }),
    },
  },
});

/** A state of the board's screens, put together as the game's sidebar does (sidebar-rows.ts). */
const screens = (preview: string, about: string, parts: Partial<Record<PartId, SidebarPart>>) => {
  const { title, rows } = compose(parts);
  return { name: preview, about, hud: { actionbar: HUD_MARK, sidebar: { title, lines: rows } } };
};

const SEATS: CardSeat[] = [
  { name: "Alex", stars: 2, coins: 14, place: 1, items: ["ST", "EP"], turn: false, shown: true },
  { name: "Sam", stars: 1, coins: 22, place: 2, items: [], turn: true, shown: true },
  { name: "Robin", stars: 1, coins: 9, place: 3, items: ["DG", "LS", "V"], turn: false, shown: true },
  { name: "Bot", stars: 0, coins: 5, place: 4, items: [], turn: false, shown: true },
];
const cards = (seats: CardSeat[] = SEATS): SidebarPart => ({ title: codesOf(SCREEN_WORDS.cards), rows: cardRows(seats) });
const menu = (state: MenuState): SidebarPart => ({ title: codesOf(SCREEN_WORDS.menu), rows: [menuRow(state)] });
const panel = (show: PanelShow, chevrons: boolean): SidebarPart => ({ title: codesOf(SCREEN_WORDS.panel), rows: panelRows(show, chevrons) });
const finalResults = resultFrames(
  [
    { key: "alex", name: "Alex", stars: 2, coins: 14 },
    { key: "sam", name: "Sam", stars: 1, coins: 22 },
    { key: "robin", name: "Robin", stars: 1, coins: 9 },
    { key: "bot", name: "Bot", stars: 0, coins: 5 },
  ],
  [
    { key: "alex", name: "Alex", stars: 2, coins: 14 },
    { key: "sam", name: "Sam", stars: 2, coins: 7 },
    { key: "robin", name: "Robin", stars: 1, coins: 19 },
    { key: "bot", name: "Bot", stars: 0, coins: 8 },
  ],
).at(-1)!.rows;

const PREVIEWS = {
  about: "Block Party's HUD states for the workshop's JSON UI tool. Written by games/blockparty/test/ui-previews.test.ts (run it with WRITE_PREVIEWS=1 after changing it); don't edit by hand.",
  previews: [
    box("Dialogue box: Chris to everyone", "A sentence said to everyone: the words on the left, who has jumped in the right column, the jump prompt at its bottom right.", {
      mode: "everyone",
      name: "Chris",
      text: "Hello travelers, and welcome!",
      jumped: ["Alex"],
      prompt: "",
    }),
    box("Dialogue box: Chris asks one player", "The last sentence of a question to one player: its buttons in the right column, the first selected, the prompt naming who it waits for.", {
      mode: "one",
      name: "Chris",
      text: "Want a rundown of the rules before we start?",
      buttons: ["Yes, please!", "No, let's play!"],
      prompt: "Alex",
    }),
    box("Dialogue box: a long sentence", "A sentence long enough to wrap over two rows.", {
      mode: "everyone",
      name: "Chris",
      text: "Collect the most Stars by the end of the game, because coins buy Stars and Stars win, and nobody remembers who had the most coins at the end.",
      prompt: "",
    }),
    box("Dialogue box: the skip strip", "A skippable line: the strip on the top border names who has held sneak to skip, and how far along anyone holding it is.", {
      mode: "everyone",
      name: "Chris",
      text: "Okay! We're playing 15 rounds tonight.",
      skip: "Hold sneak to skip  Alex  Sam 50%",
      jumped: ["Sam"],
      prompt: "",
    }),
    box("Dialogue box: the game's own line", "A line with no speaker: no name tab.", {
      mode: "everyone",
      name: "",
      text: "Everyone, get ready!",
      prompt: "",
    }),
    screens("Board: the player cards", "The cards top right in turn order: Sam's turn (the highlight), places and items under the line, letters standing in for heads.", { cards: cards() }),
    screens("Board: cards being revealed", "The turn order reveal: two cards out, the other two keeping their places.", { cards: cards(SEATS.map((seat, i) => ({ ...seat, place: undefined, turn: false, shown: i < 2 }))) }),
    screens("Board: the menu on Dice block", "Sam's turn: the board menu top left, Dice block selected, the cards top right.", { cards: cards(), menu: menu({ selected: "dice", disabled: [], open: false }) }),
    screens("Board: the menu, no items", "Items disabled (nothing held): dimmed, and the steps skip it.", { cards: cards(), menu: menu({ selected: "board", disabled: ["items"], open: false }) }),
    screens("Board: the dice", "The item panel bottom left on a die: its letters, the name between the chevrons, its six faces.", { cards: cards(), menu: menu({ selected: "dice", disabled: [], open: true }), panel: panel({ die: DICE.golden }, true) }),
    screens("Board: the standard die alone", "Only the standard die: no chevrons.", { cards: cards(), menu: menu({ selected: "dice", disabled: [], open: true }), panel: panel({ die: DICE.standard }, false) }),
    screens("Board: an item", "The item panel on an item: what it does under its name.", { cards: cards(), menu: menu({ selected: "items", disabled: [], open: true }), panel: panel({ item: ITEMS.ender_pearl }, true) }),
    screens("Board: Board's view", "Board picked: the whole board from above (the camera), the menu waiting.", { cards: cards(), menu: menu({ selected: "board", disabled: [], open: true }) }),
    screens("Results: the end of a minigame", "The results screen's last step: the new order, 1st with its border.", { results: { title: codesOf(SCREEN_WORDS.results), rows: resultRows(finalResults) } }),
    screens("Board: cards with the dialogue box", "Chris talking while the cards are up: both on the one sidebar.", {
      cards: cards(),
      dialogue: { title: boxTitle("everyone", "Chris"), rows: boxRows({ words: rowsOf("Sam is in the lead! Who will catch up?"), jumped: ["Alex"], prompt: "" }) },
    }),
  ],
};

describe("Block Party's JSON UI previews", () => {
  it("are the codes the game writes (ui-previews.json)", () => {
    const file = new URL("../ui-previews.json", import.meta.url);
    const text = `${JSON.stringify(PREVIEWS, null, 2)}\n`;
    if (process.env.WRITE_PREVIEWS === "1") writeFileSync(file, text);
    expect(readFileSync(file, "utf8").replace(/\r\n/g, "\n")).toBe(text);
  });
});
