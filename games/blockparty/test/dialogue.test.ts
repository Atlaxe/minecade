// The dialogue box (dialogue-codes.ts, dialogue.ts): what goes on the sidebar, a sentence at a time
// with one voice each, the steerer's buttons, votes to skip, and skipped cutscenes; and the pack's
// JSON UI reading the same codes.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GAME_SIDEBAR_MARK, Scope } from "@minecade/minigame-core";
import { system, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../../packages/minigame-core/test/util.ts";
import { whoOf, type Who } from "../behavior_pack/scripts/bots.ts";
import { BOX_EVERYONE, BOX_ONE, NAMED, ROW, Steering, STEER_HOLD, STEER_REPEAT, boxRows, boxTitle, pages, readTicks, rowsOf, sentences, visible } from "../behavior_pack/scripts/dialogue-codes.ts";
import { Dialogue } from "../behavior_pack/scripts/dialogue.ts";
import { line, moment } from "../behavior_pack/scripts/lines.ts";
import { hasCue, voiceCue } from "../behavior_pack/scripts/sounds.ts";

const first = () => 0;

async function ticks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    system.advanceTicks(1);
    await flushPromises(2);
  }
}

/** Runs ticks until `promise` settles (at most `most`), and gives its value. */
async function until<T>(promise: Promise<T>, most = 2000): Promise<T> {
  let done = false;
  let value: T | undefined;
  void promise.then((result) => {
    done = true;
    value = result;
  });
  for (let i = 0; i < most && !done; i++) await ticks(1);
  expect(done).toBe(true);
  return value as T;
}

describe("the dialogue box's codes", () => {
  it("title the sidebar with the mark, who it's for and the speaker", () => {
    expect(boxTitle("one", "Chris")).toBe(`${GAME_SIDEBAR_MARK}${BOX_ONE}${NAMED}§rChris`);
    expect(boxTitle("everyone", "")).toBe(`${GAME_SIDEBAR_MARK}${BOX_EVERYONE}§r`);
    expect(visible(boxTitle("one", "Chris"))).toBe("Chris");
  });

  it("make a row of each sentence, each button (the selected one marked) and the skip strip", () => {
    const rows = boxRows({ words: ["Hi!", "Hi!"], buttons: ["Buy", "Not now"], selected: 1, skip: "Jump to skip  Alex" });
    expect(rows).toEqual([`${ROW.words}§0§rHi!`, `${ROW.words}§1§rHi!`, `${ROW.button}§0§rBuy`, `${ROW.selected}§1§rNot now`, `${ROW.skip}§0§rJump to skip  Alex`]);
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.map(visible)).toEqual(["Hi!", "Hi!", "Buy", "Not now", "Jump to skip  Alex"]);
  });

  it("split a line into sentences, keeping a color that runs on", () => {
    expect(sentences("Welcome to Block Party! I'm Chris, and I keep the coins. Lots of coins.")).toEqual(["Welcome to Block Party!", "I'm Chris, and I keep the coins.", "Lots of coins."]);
    expect(sentences("Wait... what?! Really.")).toEqual(["Wait...", "what?!", "Really."]);
    expect(sentences("A 1.5 coin? No.")).toEqual(["A 1.5 coin?", "No."]);
    // A capital alone before a period is an initial, so "Plan A." doesn't end its sentence.
    expect(sentences("I'm Chris P. Bacon, your guide. Ask Dr. Oink. Plan A. Then B.")).toEqual(["I'm Chris P. Bacon, your guide.", "Ask Dr. Oink.", "Plan A. Then B."]);
    expect(sentences("§eGold! Shiny.§r Plain.")).toEqual(["§eGold!", "§eShiny.§r", "Plain."]);
    expect(sentences("One line\nand another")).toEqual(["One line", "and another"]);
    expect(sentences("")).toEqual([]);
  });

  it("cut a long sentence into rows at spaces, and a long line into pages", () => {
    const long = `${"word ".repeat(40)}end.`;
    const rows = rowsOf(long);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(visible(row).length).toBeLessThanOrEqual(110);
    expect(rows.join(" ")).toBe(long);
    expect(pages("One. Two. Three. Four. Five.")).toEqual([["One.", "Two.", "Three.", "Four."], ["Five."]]);
    expect(readTicks("Hi!")).toBe(24);
    expect(readTicks("x".repeat(500))).toBe(100);
  });

  it("step with the movement keys: once, then again while held", () => {
    const steering = new Steering();
    expect(steering.step(-1)).toBe(1);
    const held: number[] = [];
    for (let i = 0; i < STEER_HOLD + STEER_REPEAT * 2; i++) held.push(steering.step(-1));
    expect(held.filter((step) => step !== 0)).toHaveLength(3);
    expect(steering.step(0)).toBe(0);
    expect(steering.step(1)).toBe(-1);
    expect(steering.step(0.3)).toBe(0);
  });
});

describe("the dialogue box", () => {
  let scope: Scope;
  let dialogue: Dialogue;
  let restored: number;
  let alex: FakePlayer;
  let sam: FakePlayer;

  beforeEach(() => {
    world.reset();
    system.reset();
    scope = new Scope("test");
    restored = 0;
    dialogue = new Dialogue({ scope, random: first, restore: () => restored++ });
    alex = world.join("Alex");
    sam = world.join("Sam");
  });

  afterEach(() => scope.dispose());

  const shown = () => {
    const sidebar = world.scoreboard.sidebar;
    if (!sidebar) return undefined;
    return { title: sidebar.displayName, rows: [...sidebar.scores.entries()].sort((a, b) => b[1] - a[1]).map(([row]) => row) };
  };

  it("brings a line in a sentence at a time, the speaker's voice for each, to everyone", async () => {
    const id = "pregame.welcome";
    const said = sentences(line(id, {}, first));
    expect(said.length).toBeGreaterThan(1);
    const done = dialogue.say(id);
    await ticks(2);
    expect(shown()?.title).toBe(boxTitle("everyone", moment(id).character));
    expect(shown()?.rows.map(visible)).toEqual([said[0]]);
    await ticks(readTicks(said[0]));
    expect(shown()?.rows.map(visible)).toEqual(said.slice(0, 2));
    await until(done);
    if (hasCue(voiceCue("Chris"))) expect(alex.sounds.length).toBe(said.length);
    await ticks(5);
    expect(shown()).toBeUndefined();
    expect(restored).toBe(1);
  });

  it("lets the one it's said to steer its buttons with W and S, and pick with jump", async () => {
    const who: Who = whoOf(alex as never);
    const picked = dialogue.talk("star.chris.offer", { player: "Alex", price: "20 coins", coins: "25 coins" }, { to: who, buttons: ["Buy a Star", "Not now"], back: 1 });
    await ticks(400);
    const rows = shown()?.rows ?? [];
    expect(rows.filter((row) => row.startsWith(ROW.selected)).map(visible)).toEqual(["Buy a Star"]);
    // Someone else can't steer or pick.
    expect(dialogue.jumped(sam as never)).toBe(false);
    alex.movementVector = { x: 0, y: -1 };
    await ticks(1);
    alex.movementVector = { x: 0, y: 0 };
    await ticks(1);
    expect((shown()?.rows ?? []).filter((row) => row.startsWith(ROW.selected)).map(visible)).toEqual(["Not now"]);
    expect(dialogue.jumped(alex as never)).toBe(true);
    expect(await until(picked)).toBe(1);
  });

  it("picks the back button on a sneak, and shows the rest of the words at once on a jump while they come", async () => {
    const who: Who = whoOf(alex as never);
    const picked = dialogue.talk("star.chris.offer", { player: "Alex", price: "20 coins", coins: "25 coins" }, { to: who, buttons: ["Buy a Star", "Not now"], back: 1 });
    await ticks(2);
    dialogue.jumped(alex as never);
    await ticks(2);
    const words = sentences(line("star.chris.offer", { player: "Alex", price: "20 coins" }, first));
    expect((shown()?.rows ?? []).filter((row) => row.startsWith(ROW.words)).map(visible)).toEqual(words);
    await ticks(10);
    expect(dialogue.sneaked(alex as never)).toBe(true);
    expect(await until(picked)).toBe(1);
  });

  it("goes on with Next when a line to one player has no choice", async () => {
    const who: Who = whoOf(alex as never);
    const done = dialogue.talk("star.chris.short", { price: "20 coins" }, { to: who });
    await ticks(300);
    expect((shown()?.rows ?? []).filter((row) => row.startsWith(ROW.selected)).map(visible)).toEqual([line("dialogue.next")]);
    dialogue.jumped(alex as never);
    expect(await until(done)).toBe(0);
  });

  it("skips a skippable line once every player has jumped, naming who has", async () => {
    const done = dialogue.say("announce.final", {}, true);
    await ticks(2);
    dialogue.jumped(alex as never);
    await ticks(1);
    const skip = (shown()?.rows ?? []).find((row) => row.startsWith(ROW.skip));
    expect(visible(skip ?? "")).toBe(`${line("dialogue.skip")}  Alex`);
    dialogue.jumped(sam as never);
    await until(done, 5);
  });

  it("skips the rest of a cutscene once everyone has voted", async () => {
    let after = false;
    const scene = dialogue.cutscene(true, async () => {
      await dialogue.say("pregame.welcome");
      await dialogue.say("pregame.length", { rounds: 15 });
      await dialogue.wait(400);
      after = true;
    });
    await ticks(3);
    dialogue.jumped(alex as never);
    dialogue.jumped(sam as never);
    await until(scene, 10);
    expect(after).toBe(true);
    expect(dialogue.skipping).toBe(false);
  });

  it("asks no question in a cutscene that's being skipped", async () => {
    const who: Who = whoOf(alex as never);
    let asked: number | undefined = -1;
    const scene = dialogue.cutscene(true, async () => {
      await dialogue.say("pregame.welcome");
      asked = await dialogue.talk("pregame.rules", { player: "Alex" }, { to: who, buttons: ["Yes", "No"], back: 1 });
    });
    await ticks(3);
    dialogue.jumped(alex as never);
    dialogue.jumped(sam as never);
    await until(scene, 10);
    expect(asked).toBeUndefined();
  });

  it("shows nothing for a line the user hasn't written", async () => {
    await until(dialogue.say("no.such.line"), 2);
    expect(shown()).toBeUndefined();
  });
});

describe("the pack's dialogue box", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("reads the same codes the game writes", () => {
    const ui = read("../resource_pack/ui/blockparty_dialogue.json");
    for (const code of [GAME_SIDEBAR_MARK, BOX_ONE, NAMED, ROW.words, ROW.button, ROW.selected, ROW.skip]) expect(ui).toContain(`'${code}'`);
    expect(read("../resource_pack/ui/_ui_defs.json")).toContain("ui/blockparty_dialogue.json");
    expect(read("../resource_pack/ui/hud_screen.json")).toContain("bp_dialogue@blockparty_dialogue.box");
  });

  it("hides the vanilla sidebar for the mark (the core pack)", () => {
    expect(read("../../../packages/minigame-core/resource_pack/ui/hud_screen.json")).toContain(`'${GAME_SIDEBAR_MARK}'`);
  });
});
