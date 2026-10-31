import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scope, stripColors, type InboundMessage, type OutboundEvent, type Registry } from "@minecade/minigame-core";
import { system } from "../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../packages/minigame-core/test/util.ts";
import { demoGames } from "../behavior_pack/scripts/demo-games.ts";
import { LobbyController, type CountdownView, type LobbyOptions, type LobbyPorts } from "../behavior_pack/scripts/lobby-controller.ts";

const registry: Registry = {
  games: [
    { id: "probe", name: "Probe", minPlayers: 1, maxPlayers: 8, maps: [{ id: "default", name: "Default" }] },
    {
      id: "sumo",
      name: "Sumo",
      minPlayers: 2,
      maxPlayers: 2,
      maps: [
        { id: "arena_1", name: "Arena 1" },
        { id: "arena_2", name: "Arena 2" },
      ],
    },
  ],
};

function setup(online: string[] = ["Steve", "Alex"], options: Partial<LobbyOptions> = {}) {
  const players = [...online];
  const sent: OutboundEvent[] = [];
  const transfers: [string, number][] = [];
  const notes: [string, string][] = [];
  const countdowns: CountdownView[] = [];
  const closed: string[] = [];
  const chimes: [string, string][] = [];
  const teamForms: string[] = [];
  const teamFormsClosed: string[] = [];
  /** Each ended start: true when the players were sent. */
  const startsEnded: boolean[] = [];
  let requests = 0;
  const ports: LobbyPorts = {
    send: (event) => sent.push(event),
    onlinePlayers: () => [...players],
    transfer: (name, port) => transfers.push([name, port]),
    // Tests read what players see, without the color codes.
    notify: (to, text) => notes.push([to, stripColors(text)]),
    chime: (to, chime) => chimes.push([to, chime]),
    closeForms: (name) => closed.push(name),
    teamPicks: {
      open: (name) => teamForms.push(name),
      update: () => {},
      close: (name) => teamFormsClosed.push(name),
      hologram: () => {},
    },
    countdown: (view) => countdowns.push(view),
    startEnded: (started) => startsEnded.push(started),
  };
  const root = new Scope("lobby");
  const lobby = new LobbyController(ports, root, { registry, newRequestId: () => `r${++requests}`, ...options });
  const say = (message: InboundMessage) => lobby.onMessage(message);
  const notesTo = (to: string) => notes.filter(([who]) => who === to).map(([, text]) => text);
  return { players, sent, transfers, notes, notesTo, countdowns, chimes, closed, teamForms, teamFormsClosed, startsEnded, root, lobby, say };
}

/** Steve presses Start on Sumo, Arena 1 (request "r1"). */
function startSumo(t: ReturnType<typeof setup>, settings?: Record<string, string>) {
  expect(t.lobby.request("Steve", "sumo", "arena_1", settings)).toBeUndefined();
}

const plain = (text: string | undefined) => (text === undefined ? undefined : stripColors(text));

beforeEach(() => {
  system.reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LobbyController: starting a game", () => {
  it("starts the game with the lobby's players and the game screen's settings", () => {
    const t = setup();
    startSumo(t, { teams: "random" });
    expect(t.sent).toEqual([
      { t: "start_game", requestId: "r1", game: "sumo", map: "arena_1", players: ["Steve", "Alex"], settings: { teams: "random" } },
    ]);
    expect(t.notesTo("all")).toEqual(["Steve is starting Sumo on Arena 1."]);
    // The hologram's countdown screen, while the server boots (no titles on players' screens).
    expect(t.countdowns).toEqual([{ game: "Sumo", map: "Arena 1" }]);
    expect(t.lobby.starting).toBe(true);
  });

  it("sends at most maxPlayers players", () => {
    const t = setup(["Steve", "Alex", "Bob"]);
    startSumo(t);
    expect(t.sent[0]).toMatchObject({ players: ["Steve", "Alex"], settings: {} });
  });

  it("lists every game, marks the ones that need more players, and refuses those", () => {
    const t = setup(["Steve"]);
    expect(t.lobby.choices().map(({ game, playable, reason }) => [game.id, playable, reason])).toEqual([
      ["probe", true, undefined],
      ["sumo", false, "needs at least 2 players"],
    ]);
    expect(plain(t.lobby.request("Steve", "sumo", "random"))).toBe("Sumo needs at least 2 players.");
    expect(plain(t.lobby.request("Steve", "nope", "random"))).toBe("There's no game called nope.");
    expect(t.sent).toEqual([]);

    const solo = setup(["Steve"], { devMinPlayers: 1 });
    expect(solo.lobby.choices().every((choice) => choice.playable)).toBe(true);
  });

  it("lists demo games after the real ones, but never starts them", () => {
    const t = setup(["Steve", "Alex"], { demoGames: demoGames(2) });
    expect(t.lobby.choices().map(({ game }) => game.id)).toEqual(["probe", "sumo", "demo_paintball", "demo_block_drop"]);
    expect(plain(t.lobby.request("Steve", "demo_block_drop", "random"))).toBe("Block Drop is a demo game, so it can't start.");
    expect(t.sent).toEqual([]);
  });

  it("refuses while a game is running, starting or wrapping up, and says why", () => {
    const t = setup();
    expect(t.lobby.busy()).toBeUndefined();
    t.say({ t: "status", state: "running", sessionId: "s1", game: "sumo", map: "arena_1", players: ["Bob", "Eve"] });
    expect(plain(t.lobby.busy())).toBe("Sumo is in progress (2 playing). You'll join the next round.");
    expect(plain(t.lobby.request("Steve", "probe", "random"))).toBe("Sumo is in progress (2 playing). You'll join the next round.");
    t.say({ t: "status", state: "stopping", sessionId: "s1", game: "sumo", map: "arena_1", players: [] });
    expect(plain(t.lobby.request("Steve", "probe", "random"))).toBe("Wrapping up the last game. Try again in a moment.");
    expect(t.sent).toEqual([]);

    const starting = setup();
    startSumo(starting);
    expect(plain(starting.lobby.request("Alex", "probe", "random"))).toBe("Starting Sumo, hang on.");
    expect(starting.sent).toHaveLength(1);
  });

  it("tells a player who joins mid-game what's going on", () => {
    const t = setup();
    t.lobby.onPlayerJoined("Eve");
    expect(t.notes).toEqual([]);
    t.say({ t: "status", state: "running", sessionId: "s1", game: "probe", map: "default", players: ["Steve"] });
    t.lobby.onPlayerJoined("Eve");
    expect(t.notesTo("Eve")).toEqual(["Probe is in progress (1 playing). You'll join the next round."]);
  });
});

describe("LobbyController: sending players", () => {
  it("counts down, then transfers the listed players who are still here", async () => {
    const t = setup(["Steve", "Alex", "Bob"], { registry: { games: [{ ...registry.games[1], maxPlayers: 2 }] } });
    startSumo(t);
    t.say({ t: "game_starting", requestId: "r1", sessionId: "s1", game: "sumo", map: "arena_1" });
    t.say({ t: "game_ready", requestId: "r1", sessionId: "s1", game: "sumo", map: "arena_1", port: 19133, hosts: { public: "x", lan: "y" } });
    expect(t.closed).toEqual(["Steve", "Alex"]);
    const countdown = () => t.countdowns.filter((view) => view.left !== undefined);
    expect(countdown()).toEqual([{ game: "Sumo", map: "Arena 1", left: 3 }]);
    for (let second = 0; second < 3; second++) {
      system.advanceTicks(20);
      await flushPromises();
    }
    expect(countdown().map((view) => view.left)).toEqual([3, 2, 1]);
    expect(t.chimes).toEqual(["Steve", "Alex", "Steve", "Alex", "Steve", "Alex"].map((name) => [name, "bell"]));
    expect(t.transfers).toEqual([
      ["Steve", 19133],
      ["Alex", 19133],
    ]);
    expect(t.notesTo("Bob")).toEqual(["Sumo started without you. You'll join the next round."]);
    expect(t.lobby.starting).toBe(false);
  });

  it("skips listed players who left during the countdown", async () => {
    const t = setup();
    startSumo(t);
    t.say({ t: "game_ready", requestId: "r1", sessionId: "s1", game: "sumo", map: "arena_1", port: 19133, hosts: { public: "x", lan: "y" } });
    t.players.splice(t.players.indexOf("Alex"), 1);
    for (let second = 0; second < 3; second++) {
      system.advanceTicks(20); // each second is scheduled after the previous one ends
      await flushPromises();
    }
    expect(t.transfers).toEqual([["Steve", 19133]]);
  });

  it("ignores replies to other requests, including stale ones from before a restart", async () => {
    const t = setup();
    startSumo(t);
    t.say({ t: "game_ready", requestId: "old", sessionId: "s0", game: "probe", map: "default", port: 19133, hosts: { public: "x", lan: "y" } });
    t.say({ t: "start_rejected", requestId: "old", reason: "busy", status: { state: "idle", players: [] } });
    system.advanceTicks(100);
    await flushPromises();
    expect(t.transfers).toEqual([]);
  });

  it("cancels the countdown if the game fails meanwhile", async () => {
    const t = setup();
    startSumo(t);
    t.say({ t: "game_ready", requestId: "r1", sessionId: "s1", game: "sumo", map: "arena_1", port: 19133, hosts: { public: "x", lan: "y" } });
    system.advanceTicks(20);
    await flushPromises();
    t.say({ t: "game_failed", requestId: "r1", sessionId: "s1", reason: "crashed" });
    for (let second = 0; second < 4; second++) {
      system.advanceTicks(20);
      await flushPromises();
    }
    expect(t.transfers).toEqual([]);
  });
});

describe("LobbyController: recovering", () => {
  it("resets after a rejection or a failed start, so a game can be started again", () => {
    const t = setup();
    startSumo(t);
    t.say({ t: "start_rejected", requestId: "r1", reason: "busy: Probe is running", status: { state: "running", players: [] } });
    expect(t.notesTo("all").at(-1)).toBe("Couldn't start Sumo: busy: Probe is running");

    t.say({ t: "status", state: "idle", players: [] });
    startSumo(t);
    t.say({ t: "game_failed", requestId: "r2", reason: "the game server did not become ready in time" });
    expect(t.notesTo("all").at(-1)).toBe("Sumo failed to start: the game server did not become ready in time");
    expect(t.lobby.busy()).toBeUndefined();
  });

  it("drops its request when the orchestrator reports a different session", () => {
    const t = setup();
    startSumo(t);
    t.say({ t: "game_starting", requestId: "r1", sessionId: "s1", game: "sumo", map: "arena_1" });
    t.say({ t: "status", state: "starting", sessionId: "s1", game: "sumo", map: "arena_1", players: [] });
    expect(t.lobby.starting).toBe(true);
    t.say({ t: "status", state: "idle", players: [] }); // the orchestrator restarted
    expect(t.lobby.starting).toBe(false);
  });

  it("asks the orchestrator for the real state when no answer comes for 150 s", () => {
    const t = setup();
    startSumo(t);
    system.advanceTicks(150 * 20 - 1);
    expect(t.sent).toHaveLength(1);
    system.advanceTicks(1);
    expect(t.sent.at(-1)).toEqual({ t: "status_request" });
    expect(t.notesTo("all").at(-1)).toBe("Sumo didn't start in time. Try again.");
  });

  it("announces the end of a game", () => {
    const t = setup();
    t.say({ t: "game_ended", sessionId: "s1", reason: "finished" });
    expect(t.notesTo("all")).toEqual(["The last game ended (finished). Use the terminal to start another."]);
  });

  it("leaves nothing running once the lobby scope is disposed", () => {
    const t = setup();
    startSumo(t);
    t.root.dispose();
    expect(system.pendingRuns).toBe(0);
  });
});

describe("LobbyController: team picks", () => {
  const teamGame: Registry = {
    games: [{ id: "paint", name: "Paint", minPlayers: 2, maxPlayers: 4, teams: { count: 2 }, maps: [{ id: "yard", name: "Yard" }] }],
  };
  const ready = { t: "game_ready", requestId: "r1", sessionId: "s1", game: "paint", map: "yard", port: 19133, hosts: { public: "x", lan: "y" } } as const;

  it("lets everyone pick a team while the game server boots, then sends the picks before the players", async () => {
    const t = setup(["Steve", "Alex"], { registry: teamGame });
    expect(t.lobby.request("Steve", "paint", "yard", { teams: "pick" })).toBeUndefined();
    expect(t.sent).toEqual([{ t: "start_game", requestId: "r1", game: "paint", map: "yard", players: ["Steve", "Alex"], settings: { teams: "pick" } }]);
    expect(t.teamForms).toEqual(["Steve", "Alex"]);
    t.say({ t: "game_starting", requestId: "r1", sessionId: "s1", game: "paint", map: "yard" });
    t.lobby.pickTeam("Steve", "blue");
    t.lobby.pickTeam("Alex", "red");
    expect(t.lobby.reopenTeamPick("Steve")).toBe(true);
    t.say(ready);
    expect(t.transfers).toEqual([]); // picking lasts at least 5 s
    expect(t.countdowns).toEqual([]); // the team view owns the hologram while picking
    system.advanceTicks(100);
    expect(t.sent.at(-1)).toEqual({ t: "team_picks", sessionId: "s1", picks: { Steve: "blue", Alex: "red" } });
    expect(t.countdowns).toEqual([{ game: "Paint", map: "Yard", left: 3 }]);
    expect(t.teamFormsClosed).toEqual(["Steve", "Alex"]);
    expect(t.lobby.reopenTeamPick("Steve")).toBe(false);
    for (let second = 0; second < 3; second++) {
      system.advanceTicks(20);
      await flushPromises();
    }
    expect(t.transfers).toEqual([
      ["Steve", 19133],
      ["Alex", 19133],
    ]);
    expect(t.startsEnded).toEqual([true]);
  });

  it("skips picking when the game screen chose random teams, or the game has no teams", () => {
    const t = setup(["Steve", "Alex"], { registry: teamGame });
    t.lobby.request("Steve", "paint", "yard", { teams: "random" });
    expect(t.teamForms).toEqual([]);
    t.say(ready);
    expect(t.closed).toEqual(["Steve", "Alex"]); // straight to the countdown
    expect(t.sent.some((event) => event.t === "team_picks")).toBe(false);

    const sumo = setup();
    startSumo(sumo);
    expect(sumo.teamForms).toEqual([]);
  });

  it("closes the team forms when the start fails", () => {
    const t = setup(["Steve", "Alex"], { registry: teamGame });
    t.lobby.request("Steve", "paint", "yard", { teams: "pick" });
    t.say({ t: "game_failed", requestId: "r1", reason: "no room" });
    expect(t.teamFormsClosed).toEqual(["Steve", "Alex"]);
    expect(t.lobby.starting).toBe(false);
    expect(t.startsEnded).toEqual([false]);
    expect(t.root.live()).toEqual({ scopes: 1, subscriptions: 0, runs: 0 });
  });

  it("drops the pick of a player who leaves the lobby", () => {
    const t = setup(["Steve", "Alex"], { registry: teamGame });
    t.lobby.request("Steve", "paint", "yard", { teams: "pick" });
    t.say({ t: "game_starting", requestId: "r1", sessionId: "s1", game: "paint", map: "yard" });
    t.lobby.pickTeam("Steve", "red");
    t.lobby.pickTeam("Alex", "blue");
    t.players.splice(t.players.indexOf("Alex"), 1);
    t.lobby.onPlayerLeft("Alex");
    t.say(ready);
    system.advanceTicks(100);
    expect(t.sent.at(-1)).toEqual({ t: "team_picks", sessionId: "s1", picks: { Steve: "red" } });
  });
});
