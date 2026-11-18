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
