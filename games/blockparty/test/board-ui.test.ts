// The board menu, the item panel and Board's view (board-ui.ts, board-view.ts), and the results
// screen's steps (results.ts).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Scope } from "@minecade/minigame-core";
import { system, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../../packages/minigame-core/test/util.ts";
import { BoardMenu } from "../behavior_pack/scripts/board-ui.ts";
import { RIGHT_X, boardOverview, pushOf, stepThrough } from "../behavior_pack/scripts/board-view.ts";
import { testSpaces } from "../behavior_pack/scripts/board.ts";
import { whoOf, type Who } from "../behavior_pack/scripts/bots.ts";
import type { DieDef } from "../behavior_pack/scripts/dice.ts";
import { holdings, type Holdings, type ItemDef } from "../behavior_pack/scripts/dice-items.ts";
import { STEER_HOLD } from "../behavior_pack/scripts/dialogue-codes.ts";
import { RESULT_EVENTS, placesOf, resultFrames } from "../behavior_pack/scripts/results.ts";
import { MENU, PANEL, codesOf, fieldsOf } from "../behavior_pack/scripts/screen-codes.ts";
import { GameSidebar } from "../behavior_pack/scripts/sidebar-rows.ts";

async function ticks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    system.advanceTicks(1);
    await flushPromises(2);
  }
}

describe("steering", () => {
  it("steps back for W and A, on for S and D, by the stronger push", () => {
    const step = (x: number, y: number) => Math.sign(-pushOf({ x, y }));
    expect(step(0, 1)).toBe(-1);
    expect(step(0, -1)).toBe(1);
    expect(step(RIGHT_X, 0)).toBe(1);
    expect(step(-RIGHT_X, 0)).toBe(-1);
    expect(pushOf({ x: 0.2, y: 0.3 })).toBe(0);
    expect(step(0.6 * RIGHT_X, 0.9)).toBe(-1);
  });

  it("wraps round and skips what's disabled", () => {
    expect(stepThrough(0, 3, 1)).toBe(1);
    expect(stepThrough(2, 3, 1)).toBe(0);
    expect(stepThrough(0, 3, -1)).toBe(2);
    expect(stepThrough(0, 3, 1, (i) => i === 1)).toBe(2);
    expect(stepThrough(0, 1, 1)).toBe(0);
    expect(stepThrough(0, 3, 1, () => true)).toBe(0);
  });
});

describe("Board's view", () => {
  it("looks down at the board's middle from high up, the longer way across", () => {
    const spaces = testSpaces([0, 64, 0], 6);
    const shot = boardOverview(spaces)!;
    const [fx, fy, fz] = shot.facing!;
    expect([fx, fy, fz].map((n) => Math.round(n))).toEqual([1, 64, 1]);
    const [x, y, z] = shot.location;
    expect(x).toBeCloseTo(fx);
    expect(y).toBeGreaterThan(64 + 10);
    expect(z).toBeGreaterThan(fz + 5);
    // A board long in z is seen from the east.
    const long = spaces.map((space) => ({ at: [space.at[0] / 3, space.at[1], space.at[2] * 2] as [number, number, number] }));
    expect(boardOverview(long)!.location[0]).toBeGreaterThan(5);
    expect(boardOverview([])).toBeUndefined();
  });

  it("stands further back for a bigger board", () => {
    const near = boardOverview(testSpaces([0, 64, 0], 4))!;
    const far = boardOverview(testSpaces([0, 64, 0], 12))!;
    expect(far.location[1]).toBeGreaterThan(near.location[1]);
  });
});

describe("the board menu", () => {
  let scope: Scope;
  let sidebar: GameSidebar;
  let menu: BoardMenu;
  let alex: FakePlayer;
  let who: Who;
  let held: Holdings;
  let shown: (DieDef | undefined)[];
  let rolled: DieDef[];
  let used: ItemDef[];
  let views: boolean[];
  let busy: boolean;

  beforeEach(() => {
    world.reset();
    system.reset();
    scope = new Scope("test");
    sidebar = new GameSidebar(scope);
    alex = world.join("Alex");
    who = whoOf(alex as never);
    held = holdings(["golden"], ["stone_totem", "glove"]);
    shown = [];
    rolled = [];
    used = [];
    views = [];
    busy = false;
    menu = new BoardMenu({
      scope,
      sidebar,
      random: () => 0,
      holdingsOf: () => held,
      showDie: (_, die) => shown.push(die),
      roll: (_, die) => rolled.push(die),
      use: (_, item) => used.push(item),
      boardView: (on) => views.push(on),
      busy: () => busy,
    });
  });

  afterEach(() => scope.dispose());

  const rows = () => {
    const board = world.scoreboard.sidebar;
    return board ? [...board.scores.keys()] : [];
  };
  const menuRow = () => rows().find((row) => row.startsWith(codesOf("km")));
  const panelRow = () => rows().find((row) => row.startsWith(codesOf("ki")));
  const title = () => world.scoreboard.sidebar?.displayName ?? "";
  const name = () => {
    const row = panelRow();
    return row ? Buffer.from(row, "utf8").subarray(fieldsOf(PANEL).name.from).toString("utf8") : undefined;
  };
  const push = async (x: number, y: number) => {
    alex.movementVector = { x, y };
    await ticks(1);
    alex.movementVector = { x: 0, y: 0 };
    await ticks(1);
  };

  it("opens on Dice block for everyone to see, and steps with the movement keys", async () => {
    menu.open(who);
    await ticks(1);
    expect(title()).toContain(codesOf("bpm"));
    expect(menuRow()).toContain(codesOf("s0"));
    await push(0, -1);
    expect(menuRow()).toContain(codesOf("s1"));
    await push(0, -1);
    expect(menuRow()).toContain(codesOf("s2"));
    // Wraps round.
    await push(0, -1);
    expect(menuRow()).toContain(codesOf("s0"));
    // A held key steps again after a moment.
    alex.movementVector = { x: 0, y: -1 };
    await ticks(STEER_HOLD + 2);
    alex.movementVector = { x: 0, y: 0 };
    expect(menuRow()).toContain(codesOf("s2"));
    expect(MENU.parts.length).toBeGreaterThan(0);
  });

  it("skips Items while nothing is held", async () => {
    held = holdings([], []);
    menu.open(who);
    await ticks(1);
    expect(menuRow()).toContain(codesOf("v1"));
    await push(0, -1);
    expect(menuRow()).toContain(codesOf("s2"));
  });

  it("opens the dice, steps through them with the die over the head following, and rolls with a jump", async () => {
    menu.open(who);
    await ticks(1);
    expect(menu.jumped(alex as never)).toBe(true);
    await ticks(1);
    expect(shown.map((die) => die?.id)).toEqual(["standard"]);
    expect(name()).toBe("Standard Die");
    expect(panelRow()).toContain(codesOf("a1"));
    expect(menuRow()).toContain(codesOf("n1"));
    await push(RIGHT_X, 0);
    expect(name()).toBe("Golden Die");
    expect(shown.at(-1)?.id).toBe("golden");
    menu.jumped(alex as never);
    await ticks(1);
    expect(rolled.map((die) => die.id)).toEqual(["golden"]);
    // The menu and panel are gone; the die stays up for the hit.
    expect(menuRow()).toBeUndefined();
    expect(panelRow()).toBeUndefined();
    expect(shown.at(-1)?.id).toBe("golden");
  });

  it("steps the item panel with A and D only, not W and S", async () => {
    menu.open(who);
    menu.jumped(alex as never);
    await ticks(1);
    expect(name()).toBe("Standard Die");
    await push(0, -1);
    await push(0, 1);
    expect(name()).toBe("Standard Die");
    expect(shown).toHaveLength(1);
    await push(-RIGHT_X, 0);
    expect(name()).toBe("Golden Die");
  });

  it("goes back from the panel with sneak, the die taken away", async () => {
    menu.open(who);
    menu.jumped(alex as never);
    await ticks(1);
    expect(menu.sneaked(alex as never)).toBe(true);
    await ticks(1);
    expect(shown.at(-1)).toBeUndefined();
    expect(panelRow()).toBeUndefined();
    expect(menuRow()).toContain(codesOf("n0"));
  });

  it("shows an item with what it does, and uses it with a jump", async () => {
    menu.open(who);
    await push(0, -1);
    menu.jumped(alex as never);
    await ticks(1);
    expect(name()).toBe("Stone Totem");
    expect(rows().some((row) => row.startsWith(codesOf("kj")) && row.includes("extra die"))).toBe(true);
    await push(-RIGHT_X, 0);
    expect(name()).toBe("Dueling Glove");
    menu.jumped(alex as never);
    await ticks(1);
    expect(used.map((item) => item.id)).toEqual(["glove"]);
    expect(panelRow()).toBeUndefined();
  });

  it("shows the whole board from Board, and back with sneak", async () => {
    menu.open(who);
    await push(0, 1);
    expect(menuRow()).toContain(codesOf("s2"));
    menu.jumped(alex as never);
    menu.sneaked(alex as never);
    expect(views).toEqual([true, false]);
  });

  it("toggles Board with a jump: one opens it, the next goes back to the menu", async () => {
    menu.open(who);
    await push(0, 1);
    menu.jumped(alex as never);
    await ticks(1);
    expect(menuRow()).toContain(codesOf("n1"));
    menu.jumped(alex as never);
    await ticks(1);
    expect(views).toEqual([true, false]);
    expect(menuRow()).toContain(codesOf("n0"));
    expect(menuRow()).toContain(codesOf("s2"));
  });

  it("leaves the keys alone while the player steers the dialogue box, and takes no one else's jumps", async () => {
    menu.open(who);
    busy = true;
    await push(0, -1);
    expect(menuRow()).toContain(codesOf("s0"));
    const sam = world.join("Sam");
    expect(menu.jumped(sam as never)).toBe(false);
    expect(menu.sneaked(sam as never)).toBe(false);
  });

  it("plays a bot's turn for everyone to see: the menu, the dice, then the roll (a special die, now and then)", async () => {
    const bot: Who = { name: "Bot", key: "bot", body: alex as never };
    const picked = menu.botTurn(bot);
    await ticks(2);
    expect(menuRow()).toBeDefined();
    let die: DieDef | undefined;
    void picked.then((value) => (die = value));
    await ticks(40);
    // random() is 0 here: under the bot's 30% chance of a special die.
    expect(die?.id).toBe("golden");
    expect(menuRow()).toBeUndefined();
  });
});

describe("the results screen's steps", () => {
  const seat = (key: string, stars: number, coins: number) => ({ key, name: key, stars, coins });

  it("starts as the standings were, counts, swaps into the new order a pair at a time, then borders 1st", () => {
    const before = [seat("a", 1, 10), seat("b", 0, 30), seat("c", 0, 5)];
    const after = [seat("a", 1, 10), seat("b", 2, 4), seat("c", 0, 25)];
    const frames = resultFrames(before, after);
    expect(frames[0].sound).toBe(RESULT_EVENTS.open);
    expect(frames[0].rows.map((row) => [row.name, row.stars, row.coins, row.place])).toEqual([
      ["a", 1, 10, 1],
      ["b", 0, 30, 2],
      ["c", 0, 5, 3],
    ]);
    const counts = frames.filter((frame) => frame.sound === RESULT_EVENTS.count);
    // Two Star steps for b, then the coins.
    expect(counts[0].rows.find((row) => row.name === "b")?.stars).toBe(1);
    expect(counts[1].rows.find((row) => row.name === "b")?.stars).toBe(2);
    // The places stay as they were while the numbers count.
    expect(counts.at(-1)!.rows.map((row) => row.place)).toEqual([1, 2, 3]);
    const swaps = frames.filter((frame) => frame.sound === RESULT_EVENTS.swap);
    expect(swaps.length).toBe(1);
    expect(swaps[0].rows.map((row) => [row.name, row.place])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
    const last = frames.at(-1)!;
    expect(last.sound).toBe(RESULT_EVENTS.first);
    expect(last.rows.map((row) => [row.name, row.place, row.border])).toEqual([
      ["b", 1, true],
      ["a", 2, false],
      ["c", 3, false],
    ]);
    // Each player keeps their seat (their rows' own code).
    expect(last.rows.map((row) => row.seat)).toEqual([1, 0, 2]);
  });

  it("counts many coins in at most 20 steps", () => {
    const frames = resultFrames([seat("a", 0, 0)], [seat("a", 0, 300)]);
    expect(frames.filter((frame) => frame.sound === RESULT_EVENTS.count).length).toBeLessThanOrEqual(20);
    expect(frames.at(-1)!.rows[0].coins).toBe(300);
  });

  it("shares a place between ties", () => {
    expect(placesOf([seat("a", 1, 5), seat("b", 1, 5), seat("c", 0, 9)])).toEqual([1, 1, 3]);
  });
});
