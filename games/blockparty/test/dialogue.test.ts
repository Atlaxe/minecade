// The dialogue box (dialogue-codes.ts, dialogue.ts): what goes on the sidebar, one sentence at a time
// with one voice each, going on by jumps (everyone's, or the one it's said to), the steerer's
// buttons, skip votes by holding sneak, and skipped cutscenes; and the pack's JSON UI reading the
// same codes.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GAME_SIDEBAR_MARK, Scope } from "@minecade/minigame-core";
import { system, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../../packages/minigame-core/test/util.ts";
import { whoOf, type Who } from "../behavior_pack/scripts/bots.ts";
import { BOX_EVERYONE, BOX_MARK, BOX_ONE, NAMED, ROW, SELECTED, Steering, STEER_HOLD, STEER_REPEAT, boxRows, boxTitle, readTicks, rowsOf, safe, sentences, visible } from "../behavior_pack/scripts/dialogue-codes.ts";
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
    expect(boxTitle("one", "Chris")).toBe(`${GAME_SIDEBAR_MARK}${BOX_MARK}${BOX_ONE}${NAMED}§rChris`);
    expect(boxTitle("everyone", "")).toBe(`${GAME_SIDEBAR_MARK}${BOX_MARK}${BOX_EVERYONE}§r`);
    expect(visible(boxTitle("one", "Chris"))).toBe("Chris");
  });

  it("make a row of each row of the sentence, each button (the selected one marked), who has jumped, the prompt and the skip strip", () => {
    const rows = boxRows({ words: ["Hi!", "Hi!"], buttons: ["Buy", "Not now"], selected: 1, jumped: ["Alex"], prompt: "Sam", skip: "Hold sneak to skip  Alex" });
    expect(rows).toEqual([
      `${ROW.words}§0§rHi!`,
      `${ROW.words}§1§rHi!`,
      `${ROW.button}§0§rBuy`,
      `${ROW.selected}§1§rNot now`,
      `${ROW.jumped}§0§rAlex`,
      `${ROW.prompt}§0§rSam`,
      `${ROW.skip}§0§rHold sneak to skip  Alex`,
    ]);
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.map(visible)).toEqual(["Hi!", "Hi!", "Buy", "Not now", "Alex", "Sam", "Hold sneak to skip  Alex"]);
    // The UI tests one code per thing it draws: a selected button is a button too.
    expect(ROW.selected).toContain(ROW.button);
    expect(ROW.selected).toContain(SELECTED);
    expect(boxRows({ words: [], prompt: "" })).toEqual([`${ROW.prompt}§0§r`]);
  });

  it("never let a row's text read as a row's code", () => {
    expect(safe("§k§1Hidden")).toBe("§1§kHidden");
    expect(safe("§2§kfoo§4§kbar")).toBe("§2§kfoo§4§kbar");
    expect(safe("plain §ecolor")).toBe("plain §ecolor");
    const rows = boxRows({ words: ["§k§3sneaky"], buttons: ["§k§1§lBold"] });
    const codes = Object.values(ROW);
    for (const row of rows) {
      const kinds = codes.filter((code) => row.includes(code) && !(code === ROW.button && row.startsWith(ROW.selected)));
      expect(kinds.length).toBeLessThanOrEqual(2);
    }
    expect(rows[0].startsWith(ROW.words)).toBe(true);
    expect(rows[0].slice(ROW.words.length)).not.toContain("§k§");
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
    // What carries is the last color, then each format once.
    expect(sentences("§2§kfoo§4§l bar. Next")).toEqual(["§2§kfoo§4§l bar.", "§4§l§kNext"]);
  });

  it("cut a long sentence into rows at spaces", () => {
    const long = `${"word ".repeat(40)}end.`;
    const rows = rowsOf(long);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(visible(row).length).toBeLessThanOrEqual(110);
    expect(rows.join(" ")).toBe(long);
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
  const rowsOfKind = (code: string) => (shown()?.rows ?? []).filter((row) => row.startsWith(code)).map(visible);
  const words = () => (shown()?.rows ?? []).filter((row) => row.startsWith(ROW.words)).map(visible);

  it("shows one sentence at a time to everyone, going on once every player has jumped", async () => {
    const id = "pregame.welcome";
    const said = sentences(line(id, {}, first));
    expect(said.length).toBeGreaterThan(1);
    const done = dialogue.say(id);
    await ticks(2);
    expect(shown()?.title).toBe(boxTitle("everyone", moment(id).character));
    expect(words()).toEqual([said[0]]);
    expect(rowsOfKind(ROW.prompt)).toEqual([""]);
    // A jump in the sentence's first moments doesn't count.
    dialogue.jumped(alex as never);
    await ticks(1);
    expect(rowsOfKind(ROW.jumped)).toEqual([]);
    await ticks(10);
    dialogue.jumped(alex as never);
    await ticks(1);
    expect(rowsOfKind(ROW.jumped)).toEqual(["Alex"]);
    // Nobody waits forever but it doesn't go on by itself.
    await ticks(200);
    expect(words()).toEqual([said[0]]);
    dialogue.jumped(sam as never);
    await ticks(2);
    // The next sentence alone, and nobody has jumped for it yet.
    expect(words()).toEqual([said[1]]);
    expect(rowsOfKind(ROW.jumped)).toEqual([]);
    for (let s = 1; s < said.length; s++) {
      await ticks(10);
      dialogue.jumped(alex as never);
      dialogue.jumped(sam as never);
      await ticks(2);
    }
    await until(done, 10);
    if (hasCue(voiceCue("Chris"))) expect(alex.sounds.length).toBeGreaterThanOrEqual(said.length);
    await ticks(5);
    expect(shown()).toBeUndefined();
    expect(restored).toBe(1);
  });

  it("goes on at the jumps of the one it's said to, then lets them steer its buttons with W and S and pick with jump", async () => {
    const who: Who = whoOf(alex as never);
    const fills = { player: "Alex", price: "20 coins", coins: "25 coins" };
    const said = sentences(line("star.chris.offer", fills, first));
    const picked = dialogue.talk("star.chris.offer", fills, { to: who, buttons: ["Buy a Star", "Not now"], back: 1 });
    await ticks(2);
    expect(rowsOfKind(ROW.prompt)).toEqual(["Alex"]);
    expect(dialogue.steerer).toBe("alex");
    // Someone else can't go on, steer or pick.
    expect(dialogue.jumped(sam as never)).toBe(false);
    for (let s = 0; s < said.length - 1; s++) {
      expect(words()).toEqual([said[s]]);
      expect(rowsOfKind(ROW.button)).toEqual([]);
      await ticks(10);
      dialogue.jumped(alex as never);
      await ticks(2);
    }
    expect(words()).toEqual([said[said.length - 1]]);
    expect(rowsOfKind(ROW.selected)).toEqual(["Buy a Star"]);
    alex.movementVector = { x: 0, y: -1 };
    await ticks(1);
    alex.movementVector = { x: 0, y: 0 };
    await ticks(1);
    expect(rowsOfKind(ROW.selected)).toEqual(["Not now"]);
    // The selected one is a button too.
    expect(rowsOfKind(ROW.button)).toEqual(["Buy a Star", "Not now"]);
    await ticks(10);
    expect(dialogue.jumped(alex as never)).toBe(true);
    expect(await until(picked)).toBe(1);
  });

  it("picks the back button on a tap of sneak", async () => {
    const who: Who = whoOf(alex as never);
    const picked = dialogue.talk("pregame.rules", { player: "Alex" }, { to: who, buttons: ["Yes", "No"], back: 1 });
    await ticks(2);
    for (let s = 0; s < 5 && rowsOfKind(ROW.button).length === 0; s++) {
      await ticks(10);
      dialogue.jumped(alex as never);
      await ticks(2);
    }
    expect(dialogue.sneaked(alex as never)).toBe(true);
    expect(await until(picked)).toBe(1);
  });

  it("goes on at a jump when a line to one player has no choice (no Next button)", async () => {
    const who: Who = whoOf(alex as never);
    const said = sentences(line("star.chris.short", { price: "20 coins" }, first));
    const done = dialogue.talk("star.chris.short", { price: "20 coins" }, { to: who });
    await ticks(300);
    for (let s = 0; s < said.length; s++) {
      expect(words()).toEqual([said[s]]);
      expect(rowsOfKind(ROW.button)).toEqual([]);
      expect(rowsOfKind(ROW.prompt)).toEqual(["Alex"]);
      await ticks(10);
      dialogue.jumped(alex as never);
      await ticks(2);
    }
    expect(await until(done, 5)).toBe(0);
  });

  it("votes to skip a skippable line by holding sneak 4 seconds, naming who has", async () => {
    const done = dialogue.say("announce.final", {}, true);
    await ticks(2);
    expect(rowsOfKind(ROW.skip)).toEqual([line("dialogue.skip")]);
    alex.isSneaking = true;
    await ticks(20);
    expect(rowsOfKind(ROW.skip)).toEqual([`${line("dialogue.skip")}  Alex 25%`]);
    // Letting go starts again.
    alex.isSneaking = false;
    await ticks(1);
    alex.isSneaking = true;
    await ticks(80);
    alex.isSneaking = false;
    expect(rowsOfKind(ROW.skip)).toEqual([`${line("dialogue.skip")}  Alex`]);
    // A jump isn't a skip vote.
    await ticks(2);
    sam.isSneaking = true;
    await until(done, 85);
  });

  it("skips the rest of a cutscene once everyone has held sneak", async () => {
    let after = false;
    const scene = dialogue.cutscene(true, async () => {
      await dialogue.say("pregame.welcome");
      await dialogue.say("pregame.length", { rounds: 15 });
      await dialogue.wait(400);
      after = true;
    });
    await ticks(3);
    alex.isSneaking = true;
    sam.isSneaking = true;
    await until(scene, 90);
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
    alex.isSneaking = true;
    sam.isSneaking = true;
    await until(scene, 90);
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
    const ui = read("../resource_pack/ui/jui_blockparty_dialogue.json");
    for (const code of [BOX_MARK, NAMED, ROW.words, ROW.button, SELECTED, ROW.skip, ROW.jumped, ROW.prompt]) expect(ui).toContain(`'${code}'`);
    expect(read("../resource_pack/ui/_ui_defs.json")).toContain("ui/jui_blockparty_dialogue.json");
    expect(read("../resource_pack/ui/hud_screen.json")).toContain("@jui_blockparty_dialogue.layout");
  });

  it("hides the vanilla sidebar for the mark (the core pack)", () => {
    expect(read("../../../packages/minigame-core/resource_pack/ui/hud_screen.json")).toContain(`'${GAME_SIDEBAR_MARK}'`);
  });
});
