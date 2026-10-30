import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Scope, stripColors, type OutboundEvent, type Registry, type StatsQuery, type StatsReply, type StatsTotals } from "@minecade/minigame-core";
import { system } from "../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../packages/minigame-core/test/util.ts";
import type { HoloContent } from "../behavior_pack/scripts/holo-content.ts";
import { StatsController, type StatsPorts } from "../behavior_pack/scripts/stats-controller.ts";
import type { PlayersView, StatsView } from "../behavior_pack/scripts/stats-screens.ts";

const registry: Registry = {
  games: [
    { id: "sumo", name: "Sumo", minPlayers: 2, maxPlayers: 6, maps: [{ id: "arena_1", name: "Arena 1" }], stats: { mode: "solo" } },
    {
      id: "snd",
      name: "Search and Destroy",
      minPlayers: 2,
      maxPlayers: 10,
      maps: [{ id: "dust", name: "Dust" }],
      stats: { mode: "team", extras: [{ key: "plants", label: "Bombs planted", agg: "sum" }] },
    },
  ],
};

const totals = (more: Partial<StatsTotals> = {}): StatsTotals => ({
  games: 3,
  wins: 2,
  losses: 1,
  draws: 0,
  kills: 7,
  deaths: 2,
  dealt: 140.5,
  taken: 60,
  seconds: 3900,
  bestStreak: 4,
  left: 0,
  ...more,
});

interface Open<V> {
  name: string;
  view: V;
  answer(index: number | undefined): void;
}

function setup() {
  const sent: OutboundEvent[] = [];
  const notes: [string, string][] = [];
  const lists: Open<PlayersView>[] = [];
  const screens: Open<StatsView>[] = [];
  const holo: HoloContent[] = [];
  let requests = 0;
  const ports: StatsPorts = {
    send: (event) => sent.push(event),
    notify: (name, text) => notes.push([name, stripColors(text)]),
    playersMenu: (name, scope, view) => scope.guard(new Promise((answer) => lists.push({ name, view, answer }))),
    statsMenu: (name, scope, view) => scope.guard(new Promise((answer) => screens.push({ name, view, answer }))),
  };
  const root = new Scope("lobby");
  const stats = new StatsController(ports, root, { registry, newRequestId: () => `q${++requests}` });
  const queries = () => sent.filter((event): event is StatsQuery => event.t === "stats_query");
  const reply = (requestId: string, more: Partial<StatsReply>) => stats.onMessage({ t: "stats_reply", requestId, player: "Steve", status: "ok", ...more });
  const open = (name = "Steve") => stats.openStats(name, (content) => holo.push(content));
  return { sent, notes, lists, screens, holo, root, stats, queries, reply, open };
}

beforeEach(() => system.reset());
afterEach(() => system.reset());

describe("StatsController", () => {
  it("lists the viewer first, then everyone with stats, and shows a player's tabs with their rank", async () => {
    const t = setup();
    const done = t.open();
    expect(t.queries()).toEqual([{ t: "stats_query", requestId: "q1", player: "Steve", kind: "players" }]);
    t.reply("q1", { players: ["Alex", "steve", "Zed"] });
    await flushPromises();
    expect(t.lists[0].view).toEqual({ viewer: "Steve", players: ["Steve", "Alex", "Zed"], more: 0 });
    expect(t.holo.at(-1)?.elements.map((element) => element.text.trim())).toEqual(["Stats", "Steve (me)", "Alex", "Zed"]);

    t.lists[0].answer(1); // Alex
    await flushPromises();
    expect(t.queries()[1]).toEqual({ t: "stats_query", requestId: "q2", player: "Alex" });
    t.reply("q2", { player: "Alex", totals: totals(), games: [{ id: "snd", games: 2 }, { id: "sumo", games: 1 }], rank: 2, of: 5 });
    await flushPromises();
    const global = t.screens[0].view;
    expect(global.player).toBe("Alex");
    expect(global.tabs.map((tab) => tab.name)).toEqual(["Global", "Search and Destroy", "Sumo"]);
    expect(global.tab).toBe("global");
    expect(global.body).toBe("Rank: 2nd of 5");
    expect(global.columns.map((column) => column[0].label)).toEqual(["Games", "Kills", "Damage dealt"]);
    expect(t.holo.at(-1)?.portrait).toBe("textures/minecade/badges/a");
    expect(t.holo.at(-1)?.elements.map((element) => element.text.trim()).slice(0, 3)).toEqual(["Alex", "Global", "Rank 2nd of 5"]);

    t.screens[0].answer(2); // the Search and Destroy tab (button 0 is the portrait)
    await flushPromises();
    expect(t.queries()[2]).toEqual({ t: "stats_query", requestId: "q3", player: "Alex", game: "snd" });
    t.reply("q3", { totals: totals({ games: 2, extras: { plants: 3 } }), rank: 1, of: 3 });
    await flushPromises();
    expect(t.screens[1].view.tab).toBe("snd");
    expect(t.screens[1].view.columns[2].at(-1)).toEqual({ label: "Bombs planted", value: "3" });

    t.screens[1].answer(1); // back to Global: no new query
    await flushPromises();
    t.screens[2].answer(2); // and to Search and Destroy again: cached
    await flushPromises();
    expect(t.queries()).toHaveLength(3);
    expect(t.screens[3].view.tab).toBe("snd");

    t.screens[3].answer(undefined); // back to the list
    await flushPromises();
    expect(t.lists).toHaveLength(2);
    t.lists[1].answer(undefined); // closed: done
    await done;
    expect(t.root.live()).toEqual({ scopes: 1, subscriptions: 0, runs: 0 });
  });

  it("shows the viewer even without stats, and a player with none says so", async () => {
    const t = setup();
    void t.open();
    t.reply("q1", { players: [] });
    await flushPromises();
    expect(t.lists[0].view.players).toEqual(["Steve"]);
    t.lists[0].answer(0);
    await flushPromises();
    t.reply("q2", { status: "none" });
    await flushPromises();
    expect(t.screens[0].view.tabs.map((tab) => tab.id)).toEqual(["global"]);
    expect(t.screens[0].view.body).toBe("No stats yet.\nMatches with at least 2 players count.");
    expect(t.screens[0].view.columns).toEqual([]);
    expect(t.holo.at(-1)?.elements.map((element) => element.text.trim())).toEqual(["Steve", "Global", "No stats yet"]);
  });

  it("says when stats are unavailable or the orchestrator doesn't answer, and ignores late replies", async () => {
    const t = setup();
    void t.open();
    t.reply("q1", { status: "unavailable" });
    await flushPromises();
    expect(t.notes).toEqual([["Steve", "Stats are unavailable right now. Try again later."]]);
    expect(t.lists).toEqual([]);

    void t.open();
    system.advanceTicks(99);
    await flushPromises();
    expect(t.notes).toHaveLength(1);
    system.advanceTicks(1);
    await flushPromises();
    expect(t.notes).toHaveLength(2);
    t.reply("q2", { players: ["Alex"] });
    await flushPromises();
    expect(t.lists).toEqual([]);
    expect(t.root.live()).toEqual({ scopes: 1, subscriptions: 0, runs: 0 });
  });

  it("opens once per player, and stops when the player leaves", async () => {
    const t = setup();
    void t.open();
    void t.open();
    expect(t.queries()).toHaveLength(1);
    t.reply("other", { players: ["Alex"] }); // not ours
    t.stats.onPlayerLeft("Steve");
    await flushPromises();
    expect(t.lists).toEqual([]);
    expect(t.root.live()).toEqual({ scopes: 1, subscriptions: 0, runs: 0 });
  });
});
