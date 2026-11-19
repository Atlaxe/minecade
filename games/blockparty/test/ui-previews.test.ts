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
import { DICE } from "../behavior_pack/scripts/dice.ts";
import { ITEMS } from "../behavior_pack/scripts/dice-items.ts";
import { resultFrames } from "../behavior_pack/scripts/results.ts";
import { SCREEN_WORDS, announceRows, cardRows, codesOf, menuRow, panelRows, resultRows, tutorialRows, type AnnounceScreen, type CardSeat, type MenuState, type PanelShow, type TutorialScreen } from "../behavior_pack/scripts/screen-codes.ts";
import { READY_CODE, SIDE_TWO_CODE, starsCode } from "../behavior_pack/scripts/bar-codes.ts";
import { HOT_FLOOR } from "../behavior_pack/scripts/minigames/hot-floor.ts";
import { HUNTER } from "../behavior_pack/scripts/minigames/hunter.ts";
import { compose, type PartId, type SidebarPart } from "../behavior_pack/scripts/sidebar-rows.ts";

interface Box {
  mode: BoxMode;
  name: string;
  /** The speaker's name color and face, as the workshop's characters.json sets them (lines.ts look()). */
  color?: string;
  face?: string;
  /** The line on show (the box shows one card, the whole line, at a time). */
  text: string;
  buttons?: string[];
  selected?: number;
  /** The skip strip's votes ("1/3"). */
  skip?: string;
  /** The jump prompt (its text is always ""); none, no prompt. */
  prompt?: string;
}

const box = (preview: string, about: string, sample: Box) => ({
  name: preview,
  about,
  hud: {
    actionbar: HUD_MARK,
    sidebar: {
      title: boxTitle(sample.mode, sample.name, sample.color),
      lines: boxRows({ face: sample.face, words: rowsOf(sample.text), buttons: sample.buttons, selected: sample.selected ?? 0, skip: sample.skip, prompt: sample.prompt }),
    },
  },
});

/** A state of the board's screens, put together as the game's sidebar does (sidebar-rows.ts), with any action bar codes of the player looking. */
const screens = (preview: string, about: string, parts: Partial<Record<PartId, SidebarPart>>, codes = "") => {
  const { title, rows } = compose(parts);
  return { name: preview, about, hud: { actionbar: HUD_MARK + codes, sidebar: { title, lines: rows } } };
};

/** The minigame announcement's part, and the tutorial's. */
const announce = (screen: AnnounceScreen): SidebarPart => ({ title: codesOf(SCREEN_WORDS.announce), rows: announceRows(screen) });
const tutorial = (screen: TutorialScreen): SidebarPart => ({ title: codesOf(SCREEN_WORDS.tutorial), rows: tutorialRows(screen) });
const WHEEL = ["Hot Floor", "Mob Freeze", "Item Scramble", "Anvil Rain", "TNT Run", "King of the Hill"];

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
    box("Dialogue box: Chris to everyone", "A line said to everyone, whole: Chris's face and pink name on the border, the words (colors and all) on the left, the jump prompt at the bottom right (only the leader's jump goes on).", {
      mode: "everyone",
      name: "Chris",
      color: "§d",
      face: "chris",
      text: "Welcome to Block Party! I'm §dChris P. Bacon§r, and it's time to start a new adventure!",
      prompt: "",
    }),
    box("Dialogue box: Chris asks one player", "A question to one player: the line and its buttons in the right column at once, the first selected, and the prompt.", {
      mode: "one",
      name: "Chris",
      color: "§d",
      face: "chris",
      text: "Would you like me to oink-splain the rules?",
      buttons: ["Yes, please!", "No, let's play!"],
      prompt: "",
    }),
    box("Dialogue box: a long line", "A line long enough to wrap over two rows.", {
      mode: "everyone",
      name: "Chris",
      color: "§d",
      face: "chris",
      text: "Here's the deal: collect the most §eStars §rby the end of the game. §gCoins §rbuy §eStars§r, and Stars win. Nobody remembers who had the most coins.",
      prompt: "",
    }),
    box("Dialogue box: the skip strip", "A skippable line: the strip on the top border, Hold, the sneak button for the player's way of playing, to skip, and how many players have voted.", {
      mode: "everyone",
      name: "Chris",
      color: "§d",
      face: "chris",
      text: "Okay! We're playing §615§r rounds tonight. Whoever has the most Stars at the end wins!",
      skip: "1/3",
      prompt: "",
    }),
    box("Dialogue box: the Witch", "Another character: her face and her color from characters.json.", {
      mode: "everyone",
      name: "Witch",
      color: "§5",
      face: "witch",
      text: "Heh heh heh... Chance Time! Pick a potion, any potion.",
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
      dialogue: { title: boxTitle("everyone", "Chris", "§d"), rows: boxRows({ face: "chris", words: rowsOf("Sam is in the lead! Who will catch up?"), prompt: "" }) },
    }),
    screens("Minigame: the announcement", "Minigame! over the full star field (its stars zoom in game, not here), the format under it, the wheel's light on its way down.", { cards: cards(), announce: announce({ format: "Free for all", wheel: { names: WHEEL, at: 2, landed: false } }) }, starsCode(8, "down", 0)),
    screens("Minigame: the wheel lands", "The wheel has landed on the pick.", { cards: cards(), announce: announce({ format: "Free for all", wheel: { names: WHEEL, at: 0, landed: true } }) }, starsCode(8, "down", 0)),
    screens("Minigame: the tutorial", "Over the rules camera: the minigame's name, what to do and its controls on the left, the Ready strip bottom right (one of four ready).", { cards: cards(), tutorial: tutorial({ name: HOT_FLOOR.name, sides: HOT_FLOOR.tutorial ?? [], ready: 1, total: 4 }) }),
    screens("Minigame: a 1v3's runner, ready", "Hunter's tutorial as a runner sees it (the second side's objective and controls) once they've jumped: Ready!", { cards: cards(), tutorial: tutorial({ name: HUNTER.name, sides: HUNTER.tutorial ?? [], ready: 3, total: 4 }) }, SIDE_TWO_CODE + READY_CODE),
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
