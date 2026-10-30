import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { Scope, stripColors, type RegistryGame } from "@minecade/minigame-core";
import { system } from "../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../packages/minigame-core/test/util.ts";
import type { GameChoice } from "../behavior_pack/scripts/lobby-controller.ts";
import { LAYOUT, MAIN_MENU_CHOICES, type GameView } from "../behavior_pack/scripts/menus.ts";
import { gameContent, gamesContent, idleContent, mainContent, type HoloContent } from "../behavior_pack/scripts/holo-content.ts";
import { TerminalController, type TerminalPorts } from "../behavior_pack/scripts/terminal-controller.ts";

const sumo: RegistryGame = {
  id: "sumo",
  name: "Sumo",
  minPlayers: 2,
  maxPlayers: 6,
  maps: [
    { id: "arena_1", name: "Arena" },
    { id: "pit", name: "Pit" },
  ],
};
const paintball: RegistryGame = {
  id: "paintball",
  name: "Paintball",
  minPlayers: 2,
  maxPlayers: 8,
  maps: [{ id: "yard", name: "Yard" }],
  teams: { count: 2 },
};
/** Button places on the game screen (the Random switch, the settings, the maps, then Start). */
const RANDOM = 0;
const SUMO_ARENA = 1;
const SUMO_PIT = 2;
const SUMO_START = 3;
const PAINTBALL_TEAMS = 1;
const PAINTBALL_START = 3;

interface Pending<T> {
  name: string;
  answer(value: T | undefined): void;
}

function setup() {
  const mains: Pending<"play" | "stats">[] = [];
  const grids: (Pending<number> & { choices: GameChoice[] })[] = [];
  const screens: (Pending<number> & { view: GameView })[] = [];
  const notes: [string, string][] = [];
  const closed: string[] = [];
  const holo: HoloContent[] = [];
  const requests: [string, string, string, Record<string, string>][] = [];
  const distances = new Map<string, number | undefined>();
  let finishStats: (() => void) | undefined;
  let statsShow: ((content: HoloContent) => void) | undefined;
  let starting = false;
  let busy: string | undefined;
  let refusal: string | undefined;
  const picking = new Set<string>();
  const reopened: string[] = [];
  let choices: GameChoice[] = [
    { game: sumo, playable: true },
    { game: paintball, playable: true },
  ];
  const ports: TerminalPorts = {
    mainMenu: (name, scope) => scope.guard(new Promise((answer) => mains.push({ name, answer }))),
    gamesMenu: (name, scope, list) => scope.guard(new Promise((answer) => grids.push({ name, answer, choices: list }))),
    gameMenu: (name, scope, view) => scope.guard(new Promise((answer) => screens.push({ name, answer, view }))),
    stats: (_name, show) => {
      statsShow = show;
      return new Promise<void>((done) => (finishStats = done));
    },
    choices: () => choices,
    busy: () => busy,
    starting: () => starting,
    reopenTeamPick: (name) => {
      if (!picking.has(name)) return false;
      reopened.push(name);
      return true;
    },
    request: (name, game, map, settings) => {
      requests.push([name, game, map, settings]);
      if (refusal === undefined) starting = true;
      return refusal;
    },
    notify: (name, text) => notes.push([name, stripColors(text)]),
    closeForms: (name) => closed.push(name),
    distance: (name) => (distances.has(name) ? distances.get(name) : 2),
    hologram: (view) => holo.push(view),
  };
  const root = new Scope("lobby");
  const terminal = new TerminalController(ports, root, { now: () => system.currentTick, idleTicks: 200 });
  return {
    mains,
    grids,
    screens,
    notes,
    closed,
    holo,
    requests,
    distances,
    picking,
    reopened,
    root,
    terminal,
    finishStats: () => finishStats?.(),
    statsShow: (content: HoloContent) => statsShow?.(content),
    setStarting: (value: boolean) => (starting = value),
    setBusy: (value: string | undefined) => (busy = value),
    setRefusal: (value: string | undefined) => (refusal = value),
    setChoices: (value: GameChoice[]) => (choices = value),
  };
}

beforeEach(() => system.reset());

describe("TerminalController: the lock", () => {
  it("lets one player use it at a time, and tells the others who has it", async () => {
    const t = setup();
    void t.terminal.tap("Steve");
    expect(t.terminal.current).toBe("Steve");
    expect(t.holo.at(-1)).toEqual(mainContent());
    void t.terminal.tap("Alex");
    void t.terminal.tap("Steve"); // already in the menu: nothing new
    expect(t.mains.map((menu) => menu.name)).toEqual(["Steve"]);
    expect(t.notes).toEqual([["Alex", "Steve is using the terminal."]]);

    t.mains[0].answer(undefined); // closed the menu
    await flushPromises();
    expect(t.terminal.current).toBeUndefined();
    expect(t.holo.at(-1)).toEqual(idleContent());
    void t.terminal.tap("Alex");
    expect(t.terminal.current).toBe("Alex");
  });

  it("refuses taps while a game is starting, but gives players picking teams their team form back", () => {
    const t = setup();
    t.setStarting(true);
    t.picking.add("Steve");
    void t.terminal.tap("Alex");
    void t.terminal.tap("Steve");
    expect(t.terminal.current).toBeUndefined();
    expect(t.notes).toEqual([["Alex", "A game is starting, hang on."]]);
    expect(t.reopened).toEqual(["Steve"]);
  });

  it("keeps the hologram on the starting game until the start is over", () => {
    const t = setup();
    t.setStarting(true);
    t.terminal.refresh();
    expect(t.holo).toEqual([]);
    t.setStarting(false);
    t.terminal.refresh();
    expect(t.holo).toEqual([idleContent()]);
  });

  it("ends the session when its player leaves, walks away or leaves it alone", async () => {
    const t = setup();
    void t.terminal.tap("Steve");
    t.terminal.onPlayerLeft("Steve");
    expect(t.terminal.current).toBeUndefined();
    t.mains[0].answer("play"); // the closed menu's late answer does nothing
    await flushPromises();
    expect(t.holo.at(-1)).toEqual(idleContent());

    void t.terminal.tap("Alex");
    t.distances.set("Alex", 12);
    system.advanceTicks(10);
    expect(t.terminal.current).toBeUndefined();
    expect(t.closed).toEqual(["Alex"]);
    expect(t.notes.at(-1)).toEqual(["Alex", "You walked away from the terminal."]);

    t.distances.set("Alex", 3);
    void t.terminal.tap("Alex");
    system.advanceTicks(190);
    expect(t.terminal.current).toBe("Alex");
    system.advanceTicks(10);
    expect(t.terminal.current).toBeUndefined();
    expect(t.notes.at(-1)).toEqual(["Alex", "The terminal timed out."]);
    expect(t.root.live()).toEqual({ scopes: 1, subscriptions: 0, runs: 0 });
  });

  it("shows the idle screen on refresh, but not while someone is using it", () => {
    const t = setup();
    t.terminal.refresh();
    expect(t.holo).toEqual([idleContent()]);
    void t.terminal.tap("Steve");
    const shown = t.holo.length;
    t.terminal.refresh();
    expect(t.holo).toHaveLength(shown);
  });
});

describe("TerminalController: Play", () => {
  it("goes from the grid to a game's screen, picks a map, and starts the game", async () => {
    const t = setup();
    void t.terminal.tap("Steve");
    t.mains[0].answer("play");
    await flushPromises();
    expect(t.holo.at(-2)).toEqual(mainContent("play"));
    expect(t.holo.at(-1)).toEqual(gamesContent(t.grids[0].choices));
    expect(t.grids[0].choices.map((choice) => choice.game.id)).toEqual(["sumo", "paintball"]);

    t.grids[0].answer(0); // Sumo
    await flushPromises();
    const first = { choice: { game: sumo, playable: true }, random: true, map: "arena_1", settings: {} };
    expect(t.screens[0].view).toEqual(first);
    expect(t.holo.at(-1)).toEqual(gameContent(first));

    t.screens[0].answer(SUMO_PIT); // a tile while Random is on: picks it and turns Random off
    await flushPromises();
    expect(t.screens[1].view).toMatchObject({ random: false, map: "pit" });
    expect(t.holo.at(-1)?.elements.find((element) => element.text.trim() === "Pit")?.box).toBe("selected");

    t.screens[1].answer(SUMO_ARENA);
    await flushPromises();
    t.screens[2].answer(SUMO_START);
    await flushPromises();
    expect(t.requests).toEqual([["Steve", "sumo", "arena_1", {}]]);
    expect(t.terminal.current).toBeUndefined(); // the session ends once the game is starting
    expect(t.holo.at(-1)?.elements[0].text).toBe("Sumo"); // the starting game stays up until the start is over
    expect(t.root.live()).toEqual({ scopes: 1, subscriptions: 0, runs: 0 });
  });

  it("switches Random map off and on; with it on, Start sends random", async () => {
    const t = setup();
    void t.terminal.tap("Steve");
    t.mains[0].answer("play");
    await flushPromises();
    t.grids[0].answer(0);
    await flushPromises();
    t.screens[0].answer(RANDOM);
    await flushPromises();
    expect(t.screens[1].view).toMatchObject({ random: false, map: "arena_1" });
    expect(t.holo.at(-1)?.picture).toBe("textures/minecade/ui/map_placeholder");
    t.screens[1].answer(RANDOM);
    await flushPromises();
    expect(t.screens[2].view).toMatchObject({ random: true, map: "arena_1" });
    t.screens[2].answer(SUMO_START);
    await flushPromises();
    expect(t.requests).toEqual([["Steve", "sumo", "random", {}]]);
  });

  it("switches a team game's teams between Pick and Random, and sends the choice", async () => {
    const t = setup();
    void t.terminal.tap("Steve");
    t.mains[0].answer("play");
    await flushPromises();
    t.grids[0].answer(1); // Paintball
    await flushPromises();
    expect(t.screens[0].view.settings).toEqual({ teams: "pick" });
    t.screens[0].answer(PAINTBALL_TEAMS);
    await flushPromises();
    expect(t.screens[1].view.settings).toEqual({ teams: "random" });
    expect(t.holo.at(-1)?.elements.some((element) => element.text.trim() === "Teams: Random")).toBe(true);
    t.screens[1].answer(PAINTBALL_START);
    await flushPromises();
    expect(t.requests).toEqual([["Steve", "paintball", "random", { teams: "random" }]]);
  });

  it("goes back one step when a menu is closed", async () => {
    const t = setup();
    void t.terminal.tap("Steve");
    t.mains[0].answer("play");
    await flushPromises();
    t.grids[0].answer(0);
    await flushPromises();
    t.screens[0].answer(undefined); // closed the game screen: back to the grid
    await flushPromises();
    expect(t.grids).toHaveLength(2);
    t.grids[1].answer(undefined); // closed the grid: back to the main menu
    await flushPromises();
    expect(t.mains).toHaveLength(2);
    expect(t.holo.at(-1)).toEqual(mainContent());
  });

  it("stays on the game screen when Start is refused, and leaves when a game is running", async () => {
    const t = setup();
    t.setRefusal("Sumo needs at least 2 players.");
    void t.terminal.tap("Steve");
    t.mains[0].answer("play");
    await flushPromises();
    t.grids[0].answer(0);
    await flushPromises();
    t.screens[0].answer(SUMO_START);
    await flushPromises();
    expect(t.notes).toEqual([["Steve", "Sumo needs at least 2 players."]]);
    expect(t.screens).toHaveLength(2);

    t.setBusy("Probe is in progress (1 playing).");
    t.screens[1].answer(SUMO_START);
    await flushPromises();
    expect(t.mains).toHaveLength(2); // back on the main menu
  });

  it("explains instead of showing the grid while a game is running, and handles stats", async () => {
    const t = setup();
    t.setBusy("Probe is in progress (1 playing). You'll join the next round.");
    void t.terminal.tap("Steve");
    t.mains[0].answer("play");
    await flushPromises();
    expect(t.grids).toHaveLength(0);
    expect(t.notes).toEqual([["Steve", "Probe is in progress (1 playing). You'll join the next round."]]);

    t.mains[1].answer("stats");
    await flushPromises();
    expect(t.holo.at(-1)).toEqual(mainContent("stats"));
    t.statsShow(idleContent()); // the stats screens put their own content up through the terminal
    expect(t.holo.at(-1)).toEqual(idleContent());
    t.finishStats();
    await flushPromises();
    expect(t.mains).toHaveLength(3);
  });

  it("drops out of a game's screen if the game disappears from the list", async () => {
    const t = setup();
    void t.terminal.tap("Steve");
    t.mains[0].answer("play");
    await flushPromises();
    t.grids[0].answer(0);
    await flushPromises();
    t.setChoices([]);
    t.screens[0].answer(SUMO_ARENA);
    await flushPromises();
    expect(t.grids).toHaveLength(2);
  });
});

describe("menus", () => {
  it("uses layout marks the lobby resource pack knows, and that never render", () => {
    const pack = (file: string) => readFileSync(new URL(`../resource_pack/ui/${file}`, import.meta.url), "utf8");
    for (const mark of Object.values(LAYOUT)) {
      expect(stripColors(mark)).toBe("");
      expect(pack("server_form.json")).toContain(`'${mark}'`);
      expect(pack("minecade_forms.json")).toContain(`'${mark}'`);
    }
    expect(MAIN_MENU_CHOICES).toEqual(["play", "stats"]);
  });
});
