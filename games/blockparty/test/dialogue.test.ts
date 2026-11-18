// The dialogue box (dialogue-codes.ts, dialogue.ts): what goes on the sidebar, one card (a whole
// line) at a time with its speaker's color and face, going on at the party leader's jump (or the
// jump of the player whose turn brought the line), a question's buttons steered by the one it's
// asked of, skip votes by holding use (the strip's words as the votes come in), a wide box for long
// button labels, and skipped cutscenes; and the pack's JSON UI reading the same codes.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GAME_SIDEBAR_MARK, Scope } from "@minecade/minigame-core";
import { system, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../../packages/minigame-core/test/util.ts";
import { whoOf, type Who } from "../behavior_pack/scripts/bots.ts";
import { HOLDING_CODE, holdingCode } from "../behavior_pack/scripts/bar-codes.ts";
import { RIGHT_X } from "../behavior_pack/scripts/board-view.ts";
import { BOX_EVERYONE, BOX_MARK, BOX_ONE, BOX_WIDE, BUTTON_ICONS, FACE_AT, FORK_MARK, FORK_WAYS, NAMED, ROW, SELECTED, SKIP_WORDS, WIDE_FACE_WORD, WIDE_LABEL, Steering, STEER_HOLD, STEER_REPEAT, boxRows, boxTitle, forkTitle, readTicks, rowsOf, safe, sentences, skipText, visible, wideButtons } from "../behavior_pack/scripts/dialogue-codes.ts";
import { Dialogue } from "../behavior_pack/scripts/dialogue.ts";
import { GameSidebar } from "../behavior_pack/scripts/sidebar-rows.ts";
import { line, look, moment } from "../behavior_pack/scripts/lines.ts";
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
  it("title the sidebar with the mark, who it's for and the speaker in their color", () => {
    expect(boxTitle("one", "Chris")).toBe(`${GAME_SIDEBAR_MARK}${BOX_MARK}${BOX_ONE}${NAMED}§rChris`);
    expect(boxTitle("one", "Chris", "§d§l")).toBe(`${GAME_SIDEBAR_MARK}${BOX_MARK}${BOX_ONE}${NAMED}§r§d§lChris`);
    expect(boxTitle("everyone", "")).toBe(`${GAME_SIDEBAR_MARK}${BOX_MARK}${BOX_EVERYONE}§r`);
    expect(visible(boxTitle("one", "Chris", "§d"))).toBe("Chris");
    // Something that isn't a name color is left out, so it can't read as the title's codes.
    expect(boxTitle("one", "Chris", "§k§1")).toBe(boxTitle("one", "Chris"));
    expect(boxTitle("everyone", "", "§d")).toBe(boxTitle("everyone", ""));
  });

  it("make a row of the face, each row of the line, each button (the selected one marked), the prompt and the skip strip", () => {
    const rows = boxRows({ face: "chris", words: ["Hi!", "Hi!"], buttons: ["Buy", "Not now"], selected: 1, prompt: "", skip: "1/2" });
    expect(rows).toEqual([`${ROW.face}§0§rchris`, `${ROW.words}§0§rHi!`, `${ROW.words}§1§rHi!`, `${ROW.button}§0§rBuy`, `${ROW.selected}§1§rNot now`, `${ROW.prompt}§0§r`, `${ROW.skip}§0§r1/2`]);
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.map(visible)).toEqual(["chris", "Hi!", "Hi!", "Buy", "Not now", "", "1/2"]);
    // The UI tests one code per thing it draws: a selected button is a button too.
    expect(ROW.selected).toContain(ROW.button);
    expect(ROW.selected).toContain(SELECTED);
    // The UI cuts the face's name out of its row at FACE_AT bytes.
    expect(Buffer.from(rows[0], "utf8").subarray(FACE_AT).toString("utf8")).toBe("chris");
    // No face for a name that can't be a picture's.
    expect(boxRows({ face: "Chris P", words: [] })).toEqual([]);
  });

  it("mark a wide face (the Warden's) by its row's index, its name still where the UI cuts it", () => {
    const codes = [...WIDE_FACE_WORD].map((ch) => `§${ch}`).join("");
    const [wide] = boxRows({ face: "warden", faceWide: true, words: [] });
    const [square] = boxRows({ face: "chris", words: [] });
    expect(wide).toContain(codes);
    expect(square).not.toContain(codes);
    expect(Buffer.from(wide, "utf8").subarray(FACE_AT).toString("utf8")).toBe("warden");
    expect(wide.startsWith(ROW.face)).toBe(true);
  });

  it("put a button's picture (Chance Time's potions) as a code after its index", () => {
    const rows = boxRows({ words: [], buttons: ["Gold potion", "Brew new ones"], icons: ["potion.coins", undefined], selected: 1 });
    expect(rows).toEqual([`${ROW.button}§0${BUTTON_ICONS["potion.coins"]}§rGold potion`, `${ROW.selected}§1§rBrew new ones`]);
    expect(rows.map(visible)).toEqual(["Gold potion", "Brew new ones"]);
    // Each potion's code is its own, and none reads as a row's kind.
    const codes = Object.values(BUTTON_ICONS);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) for (const kind of Object.values(ROW)) expect(code).not.toContain(kind);
  });

  it("title the fork box with its own mark and how many ways go across, never the dialogue box's", () => {
    expect(forkTitle(2)).toBe(`${GAME_SIDEBAR_MARK}${FORK_MARK}${FORK_WAYS.two}§r`);
    expect(forkTitle(3)).toBe(`${GAME_SIDEBAR_MARK}${FORK_MARK}${FORK_WAYS.three}§r`);
    expect(forkTitle(4)).toBe(forkTitle(3));
    expect(forkTitle(2)).not.toContain(BOX_MARK);
    expect(visible(forkTitle(2))).toBe("");
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

  it("split a line into sentences (one voice sound each), keeping a color that runs on", () => {
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

  it("cut a long line into rows at spaces, a color carrying into the next row", () => {
    const long = `${"word ".repeat(40)}end.`;
    const rows = rowsOf(long);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(visible(row).length).toBeLessThanOrEqual(110);
    expect(rows.join(" ")).toBe(long);
    const colored = rowsOf(`§d${"pink ".repeat(30)}end.`);
    expect(colored[1].startsWith("§d")).toBe(true);
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
  /** How often the box has gone from the sidebar. */
  let closed: number;
  /** Who holds use down now (the host's holdingUse). */
  const using = new Set<string>();
  let alex: FakePlayer;
  let sam: FakePlayer;
  /** The party leader's name (Alex, unless a test says otherwise). */
  let leaderName: string | undefined;

  beforeEach(() => {
    world.reset();
    system.reset();
    scope = new Scope("test");
    closed = 0;
    leaderName = "Alex";
    // The box hands its rows to the game's one sidebar, as in game (sidebar-rows.ts).
    const sidebar = new GameSidebar(scope);
    dialogue = new Dialogue({
      scope,
      random: first,
      show: (box) => {
        if (!box) closed++;
        sidebar.set("dialogue", box);
      },
      leader: () => world.getAllPlayers().find((player) => player.name === leaderName) as never,
      holdingUse: (player) => using.has(player.name),
    });
    using.clear();
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

  it("shows the whole line at once, in its speaker's color with their face, and only the leader's jump goes on", async () => {
    const id = "pregame.welcome";
    const text = line(id, {}, first);
    expect(sentences(text).length).toBeGreaterThan(1);
    const done = dialogue.say(id);
    await ticks(2);
    const chris = look(moment(id).character);
    expect(shown()?.title).toBe(boxTitle("everyone", moment(id).character, chris.color));
    expect(words()).toEqual(rowsOf(text).map(visible));
    if (chris.face) expect(rowsOfKind(ROW.face)).toEqual([chris.face]);
    expect(rowsOfKind(ROW.prompt)).toEqual([""]);
    // A jump in the card's first moments doesn't count.
    dialogue.jumped(alex as never);
    await ticks(10);
    expect(words()).toEqual(rowsOf(text).map(visible));
    // Anyone but the leader: nothing, however long.
    expect(dialogue.jumped(sam as never)).toBe(true);
    await ticks(200);
    expect(words()).toEqual(rowsOf(text).map(visible));
    dialogue.jumped(alex as never);
    await until(done, 3);
    if (hasCue(voiceCue("Chris"))) expect(alex.sounds.length).toBeGreaterThanOrEqual(1);
    await ticks(5);
    expect(shown()).toBeUndefined();
    expect(closed).toBe(1);
  });

  it("goes on at the jump of the player whose turn brought the line, not the leader's", async () => {
    // Sam (not the leader) landed on the Star: the line is Sam's to go on from.
    const done = dialogue.say("star.chris.declined", {}, false, whoOf(sam as never));
    await ticks(12);
    expect(rowsOfKind(ROW.prompt)).toEqual([""]);
    expect(dialogue.jumped(alex as never)).toBe(true);
    await ticks(5);
    expect(words().length).toBeGreaterThan(0);
    dialogue.jumped(sam as never);
    await until(done, 3);
  });

  it("lets the leader go on from a line a bot's turn brought, or once its player has left", async () => {
    const bot: Who = { name: "Bot", key: "bot", body: {} as never };
    const done = dialogue.say("star.chris.declined", {}, false, bot);
    await ticks(12);
    dialogue.jumped(sam as never);
    await ticks(5);
    expect(words().length).toBeGreaterThan(0);
    dialogue.jumped(alex as never);
    await until(done, 3);
    const gone = dialogue.say("star.chris.declined", {}, false, whoOf(sam as never));
    await ticks(12);
    world.leave("Sam");
    await ticks(1);
    dialogue.jumped(alex as never);
    await until(gone, 3);
  });

  it("shows a notice with no speaker, prompt or skip strip, a row for each line, for its time", async () => {
    dialogue.notify("Alex's turn\nPick a die and jump to roll", 20);
    await ticks(1);
    expect(shown()?.title).toBe(boxTitle("everyone", ""));
    expect(words()).toEqual(["Alex's turn", "Pick a die and jump to roll"]);
    expect(rowsOfKind(ROW.face)).toEqual([]);
    expect(rowsOfKind(ROW.prompt)).toEqual([]);
    expect(rowsOfKind(ROW.skip)).toEqual([]);
    // Nobody's jump takes it down.
    dialogue.jumped(alex as never);
    await ticks(10);
    expect(words().length).toBe(2);
    await ticks(12);
    expect(shown()).toBeUndefined();
  });

  it("gives a notice's box to a line said meanwhile, and shows it again after while it's still up", async () => {
    const hide = dialogue.notify("Round 2 of 15");
    await ticks(1);
    const said = dialogue.say("pregame.length", { rounds: 15 });
    await ticks(2);
    expect(words()).toEqual(rowsOf(line("pregame.length", { rounds: 15 }, first)).map(visible));
    await ticks(10);
    dialogue.jumped(alex as never);
    await until(said, 3);
    await ticks(5);
    expect(words()).toEqual(["Round 2 of 15"]);
    hide();
    await ticks(1);
    expect(shown()).toBeUndefined();
  });

  it("lets a newer notice take the place of an older one, whose hide then does nothing", async () => {
    const hideOld = dialogue.notify("3");
    dialogue.notify("2");
    await ticks(1);
    hideOld();
    await ticks(1);
    expect(words()).toEqual(["2"]);
  });

  it("goes on by itself after the time to read it when no player is here", async () => {
    leaderName = undefined;
    const done = dialogue.say("pregame.length", { rounds: 15 });
    await ticks(2);
    expect(rowsOfKind(ROW.prompt)).toEqual([]);
    await until(done, 400);
  });

  it("lets the one it's asked of steer its buttons with W and S and pick with jump", async () => {
    const who: Who = whoOf(sam as never);
    const fills = { player: "Sam", price: "20 coins", coins: "25 coins" };
    const picked = dialogue.talk("star.chris.offer", fills, { to: who, buttons: ["Buy a Star", "Not now"], back: 1 });
    await ticks(2);
    // The whole line and the buttons at once, and a prompt that names nobody.
    expect(words()).toEqual(rowsOf(line("star.chris.offer", fills, first)).map(visible));
    expect(rowsOfKind(ROW.selected)).toEqual(["Buy a Star"]);
    expect(rowsOfKind(ROW.prompt)).toEqual([""]);
    expect(dialogue.steerer).toBe("sam");
    // Someone else (the leader too) can't steer or pick.
    expect(dialogue.jumped(alex as never)).toBe(false);
    sam.movementVector = { x: 0, y: -1 };
    await ticks(1);
    sam.movementVector = { x: 0, y: 0 };
    await ticks(1);
    expect(rowsOfKind(ROW.selected)).toEqual(["Not now"]);
    // The selected one is a button too.
    expect(rowsOfKind(ROW.button)).toEqual(["Buy a Star", "Not now"]);
    await ticks(10);
    expect(dialogue.jumped(sam as never)).toBe(true);
    expect(await until(picked)).toBe(1);
  });

  it("picks the back button on a tap of sneak", async () => {
    const who: Who = whoOf(alex as never);
    const picked = dialogue.talk("pregame.rules", { player: "Alex" }, { to: who, buttons: ["Yes", "No"], back: 1 });
    await ticks(2);
    expect(dialogue.sneaked(alex as never)).toBe(true);
    expect(await until(picked)).toBe(1);
  });

  it("puts a fork's ways side by side in the fork box, A and D stepping through them, the camera told each one", async () => {
    const who: Who = whoOf(sam as never);
    const focused: number[] = [];
    const picked = dialogue.fork({ to: who, labels: ["Left", "Right"], focus: (index) => focused.push(index) });
    await ticks(2);
    // Its buttons alone: no words, face, prompt or skip strip.
    expect(shown()?.title).toBe(forkTitle(2));
    expect(rowsOfKind(ROW.selected)).toEqual(["Left"]);
    expect(rowsOfKind(ROW.button)).toEqual(["Left", "Right"]);
    for (const kind of [ROW.words, ROW.face, ROW.prompt, ROW.skip]) expect(rowsOfKind(kind)).toEqual([]);
    expect(focused).toEqual([0]);
    expect(dialogue.steerer).toBe("sam");
    const press = async (vector: { x: number; y: number }) => {
      sam.movementVector = vector;
      await ticks(1);
      sam.movementVector = { x: 0, y: 0 };
      await ticks(1);
    };
    // D: the way on the right.
    await press({ x: RIGHT_X, y: 0 });
    expect(rowsOfKind(ROW.selected)).toEqual(["Right"]);
    expect(focused).toEqual([0, 1]);
    // W and S do nothing here, and the ends don't wrap round.
    await press({ x: 0, y: -1 });
    await press({ x: RIGHT_X, y: 0 });
    expect(rowsOfKind(ROW.selected)).toEqual(["Right"]);
    expect(focused).toEqual([0, 1]);
    // A: back to the left.
    await press({ x: -RIGHT_X, y: 0 });
    expect(focused).toEqual([0, 1, 0]);
    // Nobody else picks, and sneak does nothing.
    expect(dialogue.jumped(alex as never)).toBe(false);
    expect(dialogue.sneaked(sam as never)).toBe(true);
    await ticks(10);
    expect(rowsOfKind(ROW.selected)).toEqual(["Left"]);
    dialogue.jumped(sam as never);
    expect(await until(picked)).toBe(0);
  });

  it("lays three ways across in threes, and moves a bot's pick to the way it takes", async () => {
    const bot: Who = { name: "Bot", key: "bot", body: {} as never };
    const focused: number[] = [];
    const picked = dialogue.fork({ to: bot, labels: ["Left", "Middle", "Right"], botPick: 2, focus: (index) => focused.push(index) });
    await ticks(2);
    expect(shown()?.title).toBe(forkTitle(3));
    expect(await until(picked)).toBe(2);
    expect(focused).toEqual([0, 2]);
  });

  it("says a line to one player with no buttons like any line, going on at their jump", async () => {
    const who: Who = whoOf(sam as never);
    const done = dialogue.talk("star.chris.short", { price: "20 coins" }, { to: who });
    await ticks(12);
    expect(rowsOfKind(ROW.button)).toEqual([]);
    dialogue.jumped(alex as never);
    await ticks(5);
    expect(words().length).toBeGreaterThan(0);
    dialogue.jumped(sam as never);
    expect(await until(done, 5)).toBe(0);
  });

  it("counts skip votes from holding use 4 seconds, its words changing as they come in", async () => {
    const done = dialogue.say("announce.final", {}, true);
    await ticks(2);
    expect(rowsOfKind(ROW.skip)).toEqual([SKIP_WORDS.hold]);
    using.add("Alex");
    await ticks(40);
    // Holding isn't a vote yet: everyone's strip is as it was.
    expect(rowsOfKind(ROW.skip)).toEqual([SKIP_WORDS.hold]);
    // Letting go starts again.
    using.delete("Alex");
    await ticks(1);
    using.add("Alex");
    await ticks(80);
    using.delete("Alex");
    // One of two has voted: waiting for the other, by name.
    expect(rowsOfKind(ROW.skip)).toEqual([SKIP_WORDS.waitingFor("Sam")]);
    await ticks(2);
    using.add("Sam");
    await until(done, 85);
  });

  it("says Hold, Waiting to skip, Waiting for the last one, and Skipping, for the players here", () => {
    const three = ["Alex", "Sam", "Kai"];
    expect(skipText([], three)).toBe("Hold use to skip");
    expect(skipText(["Alex"], three)).toBe("Waiting to skip 1 / 3");
    expect(skipText(["Alex", "Kai"], three)).toBe("Waiting for Sam to skip");
    expect(skipText(three, three)).toBe("Skipping");
    // A vote from someone who left doesn't count.
    expect(skipText(["Gone"], three)).toBe("Hold use to skip");
    expect(skipText(["Alex"], ["Alex"])).toBe("Skipping");
  });

  it("shows a player holding use their own Skipping, its dots lit as they hold, until their vote is in", async () => {
    const done = dialogue.say("announce.final", {}, true);
    await ticks(2);
    expect(dialogue.holdStep("Alex")).toBeUndefined();
    using.add("Alex");
    await ticks(2);
    expect(dialogue.holdStep("Alex")).toBe(0);
    expect(dialogue.holdStep("Sam")).toBeUndefined();
    await ticks(40);
    expect(dialogue.holdStep("Alex")).toBe(2);
    expect(holdingCode(2)).toBe(`${HOLDING_CODE}§2`);
    expect(holdingCode(undefined)).toBe("");
    await ticks(40);
    // Voted: the strip says what everyone's says again.
    expect(dialogue.holdStep("Alex")).toBeUndefined();
    using.delete("Alex");
    using.add("Sam");
    await until(done, 85);
  });

  it("skips the rest of a cutscene once everyone has held use", async () => {
    let after = false;
    const scene = dialogue.cutscene(true, async () => {
      await dialogue.say("pregame.welcome");
      await dialogue.say("pregame.length", { rounds: 15 });
      await dialogue.wait(400);
      after = true;
    });
    await ticks(3);
    using.add("Alex");
    using.add("Sam");
    await until(scene, 90);
    expect(after).toBe(true);
    expect(dialogue.skipping).toBe(false);
  });

  it("drops a question that's up once its cutscene is skipped", async () => {
    const who: Who = whoOf(sam as never);
    let asked: number | undefined = -1;
    const scene = dialogue.cutscene(true, async () => {
      asked = await dialogue.talk("pregame.rules", { player: "Sam" }, { to: who, buttons: ["Yes", "No"], back: 1 });
    });
    await ticks(3);
    using.add("Alex");
    using.add("Sam");
    await until(scene, 90);
    expect(asked).toBeUndefined();
  });

  it("asks no question in a cutscene that's being skipped", async () => {
    const who: Who = whoOf(alex as never);
    let asked: number | undefined = -1;
    const scene = dialogue.cutscene(true, async () => {
      await dialogue.say("pregame.welcome");
      asked = await dialogue.talk("pregame.rules", { player: "Alex" }, { to: who, buttons: ["Yes", "No"], back: 1 });
    });
    await ticks(3);
    using.add("Alex");
    using.add("Sam");
    await until(scene, 90);
    expect(asked).toBeUndefined();
  });

  it("asks a question with long button labels in the wide box, the buttons under the words", async () => {
    const who: Who = whoOf(alex as never);
    void dialogue.talk("pregame.rules", { player: "Alex" }, { to: who, buttons: ["Yes", "No"], back: 1 });
    await ticks(2);
    expect(shown()?.title).toContain(BOX_ONE);
    dialogue.close();
    void dialogue.talk("pregame.rules", { player: "Alex" }, { to: who, buttons: ["Buy the Golden Totem for 15 coins", "Back"], back: 1 });
    await ticks(2);
    expect(shown()?.title).toContain(BOX_WIDE);
    expect(shown()?.title).not.toContain(BOX_ONE);
    expect(wideButtons(["§lShort one"])).toBe(false);
    expect(wideButtons([`${"x".repeat(WIDE_LABEL + 1)}`])).toBe(true);
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
    for (const code of [BOX_MARK, NAMED, ROW.words, ROW.button, SELECTED, ROW.skip, ROW.prompt, ROW.face]) expect(ui).toContain(`'${code}'`);
    // The face's picture is named from its row, cut at FACE_AT bytes.
    expect(ui).toContain(`'%.${FACE_AT}s'`);
    expect(ui).toContain("textures/blockparty/faces/");
    expect(read("../resource_pack/ui/_ui_defs.json")).toContain("ui/jui_blockparty_dialogue.json");
    expect(read("../resource_pack/ui/hud_screen.json")).toContain("@jui_blockparty_dialogue.layout");
    // The potions' pictures, each shown by its button's code.
    for (const code of Object.values(BUTTON_ICONS)) expect(ui).toContain(`'${code}'`);
    // A wide face's own slot, shown by its row's word.
    expect(ui).toContain(`'${[...WIDE_FACE_WORD].map((ch) => `§${ch}`).join("")}'`);
    // "Skipping..." in place of everyone's words for a player holding use, a strip for each step of the hold.
    for (let step = 0; step < 4; step++) expect(ui).toContain(`'${holdingCode(step)}'`);
    expect(ui).toContain(`'${HOLDING_CODE}'`);
    expect(ui).toContain("$actionbar_text");
    // The wide box for long button labels, and the prompt is a punch now.
    expect(ui).toContain(`'${BOX_WIDE}'`);
    expect(ui).toContain('"Punch"');
  });

  it("has the fork box, reading the codes the game writes", () => {
    const ui = read("../resource_pack/ui/jui_blockparty_fork.json");
    for (const code of [FORK_MARK, FORK_WAYS.two, FORK_WAYS.three, ROW.button, SELECTED]) expect(ui).toContain(`'${code}'`);
    expect(read("../resource_pack/ui/_ui_defs.json")).toContain("ui/jui_blockparty_fork.json");
    expect(read("../resource_pack/ui/hud_screen.json")).toContain("@jui_blockparty_fork.layout");
  });

  it("hides the vanilla sidebar for the mark (the core pack)", () => {
    expect(read("../../../packages/minigame-core/resource_pack/ui/hud_screen.json")).toContain(`'${GAME_SIDEBAR_MARK}'`);
  });
});
