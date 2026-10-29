import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { Scope, stripColors } from "@minecade/minigame-core";
import { system } from "../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../packages/minigame-core/test/util.ts";
import { LAYOUT, MAIN_MENU_CHOICES } from "../behavior_pack/scripts/menus.ts";
import { TerminalController, type HoloScreen, type TerminalPorts } from "../behavior_pack/scripts/terminal-controller.ts";

interface Menu {
  name: string;
  answer(choice: "play" | "stats" | undefined): void;
}

function setup() {
  const menus: Menu[] = [];
  const notes: [string, string][] = [];
  const closed: string[] = [];
  const holo: [HoloScreen, string][] = [];
  const distances = new Map<string, number | undefined>();
  let finishPlay: (() => void) | undefined;
  let finishStats: (() => void) | undefined;
  let starting = false;
  let status = "Tap the terminal to play";
  const ports: TerminalPorts = {
    mainMenu: (name, scope) => scope.guard(new Promise((answer) => menus.push({ name, answer }))),
    play: () => new Promise<void>((done) => (finishPlay = done)),
    stats: () => new Promise<void>((done) => (finishStats = done)),
    starting: () => starting,
    statusLine: () => status,
    notify: (name, text) => notes.push([name, stripColors(text)]),
    closeForms: (name) => closed.push(name),
    distance: (name) => (distances.has(name) ? distances.get(name) : 2),
    hologram: (screen, caption) => holo.push([screen, caption]),
  };
  const root = new Scope("lobby");
  const terminal = new TerminalController(ports, root, { now: () => system.currentTick, idleTicks: 200 });
  return {
    menus,
    notes,
    closed,
    holo,
    distances,
    root,
    terminal,
    finishPlay: () => finishPlay?.(),
    finishStats: () => finishStats?.(),
    setStarting: (value: boolean) => (starting = value),
    setStatus: (value: string) => (status = value),
  };
}

beforeEach(() => system.reset());

describe("TerminalController", () => {
  it("lets one player use it at a time, and tells the others who has it", async () => {
    const t = setup();
    void t.terminal.tap("Steve");
    expect(t.terminal.current).toBe("Steve");
    expect(t.holo.at(-1)).toEqual(["main", "Steve is at the terminal"]);
    void t.terminal.tap("Alex");
    void t.terminal.tap("Steve"); // already in the menu: nothing new
    expect(t.menus.map((menu) => menu.name)).toEqual(["Steve"]);
    expect(t.notes).toEqual([["Alex", "Steve is using the terminal."]]);

    t.menus[0].answer(undefined); // closed the menu
    await flushPromises();
    expect(t.terminal.current).toBeUndefined();
    expect(t.holo.at(-1)).toEqual(["idle", "Tap the terminal to play"]);
    void t.terminal.tap("Alex");
    expect(t.terminal.current).toBe("Alex");
  });

  it("mirrors the menu on the hologram and comes back to the main menu after stats", async () => {
    const t = setup();
    void t.terminal.tap("Steve");
    t.menus[0].answer("stats");
    await flushPromises();
    expect(t.holo.at(-1)).toEqual(["main_stats", "Steve is browsing stats"]);
    t.finishStats();
    await flushPromises();
    expect(t.menus).toHaveLength(2);
    expect(t.holo.at(-1)).toEqual(["main", "Steve is at the terminal"]);

    t.menus[1].answer("play");
    await flushPromises();
    expect(t.holo.at(-1)).toEqual(["main_play", "Steve is picking a game"]);
    t.finishPlay(); // backed out of the picker: main menu again
    await flushPromises();
    expect(t.menus).toHaveLength(3);
  });

  it("frees up once a game starts, and refuses taps while it's starting", async () => {
    const t = setup();
    void t.terminal.tap("Steve");
    t.menus[0].answer("play");
    await flushPromises();
    t.setStarting(true);
    t.setStatus("Starting Sumo...");
    t.finishPlay();
    await flushPromises();
    expect(t.terminal.current).toBeUndefined();
    expect(t.holo.at(-1)).toEqual(["idle", "Starting Sumo..."]);
    void t.terminal.tap("Alex");
    expect(t.notes).toEqual([["Alex", "A game is starting, hang on."]]);
    expect(t.root.live()).toEqual({ scopes: 1, subscriptions: 0, runs: 0 });
  });

  it("ends the session when its player leaves, walks away or leaves it alone", async () => {
    const t = setup();
    void t.terminal.tap("Steve");
    t.terminal.onPlayerLeft("Steve");
    expect(t.terminal.current).toBeUndefined();
    t.menus[0].answer("play"); // the closed menu's late answer does nothing
    await flushPromises();
    expect(t.holo.at(-1)?.[0]).toBe("idle");

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

  it("keeps the idle hologram's status line current, but not while someone is using it", () => {
    const t = setup();
    t.setStatus("Sumo in progress (3 playing)");
    t.terminal.refresh();
    expect(t.holo.at(-1)).toEqual(["idle", "Sumo in progress (3 playing)"]);
    void t.terminal.tap("Steve");
    const shown = t.holo.length;
    t.terminal.refresh();
    expect(t.holo).toHaveLength(shown);
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
