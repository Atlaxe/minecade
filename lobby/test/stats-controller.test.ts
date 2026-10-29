import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Scope, type OutboundEvent, type Registry, type StatsQuery, type StatsReply, type StatsTotals } from "@minecade/minigame-core";
import { system } from "../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../packages/minigame-core/test/util.ts";
import { StatsController, describe as describeTotals, formatDuration, type StatsForm, type StatsPorts } from "../behavior_pack/scripts/stats-controller.ts";

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

interface OpenForm extends StatsForm {
  name: string;
  answer(index: number | undefined): void;
}

function setup() {
  const sent: OutboundEvent[] = [];
  const notes: [string, string][] = [];
  const forms: OpenForm[] = [];
  let requests = 0;
  const ports: StatsPorts = {
    send: (event) => sent.push(event),
    notify: (name, text) => notes.push([name, text]),
    show: (name, scope, form) => scope.guard(new Promise((answer) => forms.push({ ...form, name, answer }))),
  };
  const root = new Scope("lobby");
  const stats = new StatsController(ports, root, { registry, newRequestId: () => `q${++requests}` });
  const queries = () => sent.filter((event): event is StatsQuery => event.t === "stats_query");
  const reply = (requestId: string, more: Partial<StatsReply>) =>
    stats.onMessage({ t: "stats_reply", requestId, player: "Steve", status: "ok", ...more });
  return { sent, notes, forms, root, stats, queries, reply };
}

beforeEach(() => system.reset());
afterEach(() => system.reset());

describe("StatsController", () => {
  it("shows overall totals with a button per game, then a game's page, and Back returns to the overview", async () => {
    const t = setup();
    const done = t.stats.openStats("Steve");
    expect(t.queries()).toEqual([{ t: "stats_query", requestId: "q1", player: "Steve" }]);
    t.reply("q1", { totals: totals(), games: [{ id: "snd", games: 2 }, { id: "sumo", games: 1 }] });
    await flushPromises();
    expect(t.forms[0]).toMatchObject({ name: "Steve", title: "Your stats", buttons: ["Search and Destroy\n2 games", "Sumo\n1 game", "Close"] });
    expect(t.forms[0].body).toContain("K/D: 3.5");

    t.forms[0].answer(0);
    await flushPromises();
    expect(t.queries()[1]).toEqual({ t: "stats_query", requestId: "q2", player: "Steve", game: "snd" });
    t.reply("q2", { totals: totals({ games: 2, extras: { plants: 3 } }) });
    await flushPromises();
    expect(t.forms[1]).toMatchObject({ title: "Search and Destroy", buttons: ["Back", "Close"] });
    expect(t.forms[1].body).toContain("Bombs planted: 3");

    t.forms[1].answer(0); // Back: the overview again, without asking again
    await flushPromises();
    expect(t.forms[2].title).toBe("Your stats");
    expect(t.queries()).toHaveLength(2);
    t.forms[2].answer(2); // Close
    await done;
    expect(t.root.live()).toEqual({ scopes: 1, subscriptions: 0, runs: 0 });
  });

  it("tells the player when there are no stats, or the orchestrator doesn't answer in 5 s", async () => {
    const t = setup();
    void t.stats.openStats("Steve");
    t.reply("q1", { status: "none" });
    await flushPromises();
    expect(t.notes.at(-1)).toEqual(["Steve", "No stats yet. Matches with at least 2 players count."]);

    void t.stats.openStats("Steve"); // the book opens again after a message
    t.reply("q2", { status: "unavailable" });
    await flushPromises();
    expect(t.notes.at(-1)?.[1]).toBe("Stats are unavailable right now. Try again later.");

    void t.stats.openStats("Steve");
    system.advanceTicks(99);
    await flushPromises();
    expect(t.notes).toHaveLength(2);
    system.advanceTicks(1);
    await flushPromises();
    expect(t.notes).toHaveLength(3);
    t.reply("q3", { totals: totals(), games: [{ id: "sumo", games: 1 }] }); // too late: ignored
    await flushPromises();
    expect(t.forms).toHaveLength(0);
    expect(t.root.live()).toEqual({ scopes: 1, subscriptions: 0, runs: 0 });
  });

  it("ignores a second tap while open and other players' replies, and stops when the player leaves", async () => {
    const t = setup();
    void t.stats.openStats("Steve");
    void t.stats.openStats("Steve");
    expect(t.queries()).toHaveLength(1);
    t.reply("other", { totals: totals(), games: [] });
    await flushPromises();
    expect(t.forms).toHaveLength(0);

    t.stats.onPlayerLeft("Steve");
    t.reply("q1", { totals: totals(), games: [{ id: "sumo", games: 1 }] });
    await flushPromises();
    expect(t.forms).toHaveLength(0);
    expect(t.notes).toEqual([]);
    expect(t.root.live()).toEqual({ scopes: 1, subscriptions: 0, runs: 0 });
  });

  it("says so when every game so far was co-op", async () => {
    const t = setup();
    void t.stats.openStats("Steve");
    t.reply("q1", { totals: totals({ games: 0, wins: 0, losses: 0, kills: 0, deaths: 0 }), games: [{ id: "zombies", games: 2 }] });
    await flushPromises();
    expect(t.forms[0].body).toBe("No solo or team games yet.");
    expect(t.forms[0].buttons[0]).toBe("zombies\n2 games"); // a game the lobby doesn't know shows its id
  });
});

describe("stats formatting", () => {
  it("formats durations", () => {
    expect([0, 45, 60, 719, 3600, 3900, 36000].map(formatDuration)).toEqual(["0s", "45s", "1m", "11m", "1h 00m", "1h 05m", "10h 00m"]);
  });

  it("describes totals, with draws, leavers and the game's counters only when they apply", () => {
    expect(describeTotals(totals())).toBe(
      [
        "Games: 3   Wins: 2   Losses: 1",
        "Win rate: 66.7%",
        "Kills: 7   Deaths: 2   K/D: 3.5",
        "Damage dealt: 140.5   Damage taken: 60",
        "Best kill streak: 4   Time played: 1h 05m",
      ].join("\n"),
    );
    const more = describeTotals(totals({ draws: 1, left: 2, extras: { plants: 3 } }), [
      ["plants", "Bombs planted"],
      ["defuses", "Bombs defused"],
    ]);
    expect(more).toContain("Losses: 1   Draws: 1");
    expect(more.split("\n").slice(-3)).toEqual(["Left early: 2", "Bombs planted: 3", "Bombs defused: 0"]);
  });
});
