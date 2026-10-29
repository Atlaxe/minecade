import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scope, type InboundMessage, type OutboundEvent, type Registry } from "@minecade/minigame-core";
import { system } from "../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../packages/minigame-core/test/util.ts";
import { LobbyController, type GameChoice, type LobbyOptions, type LobbyPorts } from "../behavior_pack/scripts/lobby-controller.ts";

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

interface OpenSelector {
  name: string;
  scope: Scope;
  choices: GameChoice[];
  pick(choice: { game: string; map: string } | undefined): void;
}

function setup(online: string[] = ["Steve", "Alex"], options: Partial<LobbyOptions> = {}) {
  const players = [...online];
  const sent: OutboundEvent[] = [];
  const transfers: [string, number][] = [];
  const notes: [string, string][] = [];
  const titles: [string, string, string | undefined][] = [];
  const closed: string[] = [];
  const selectors: OpenSelector[] = [];
  let requests = 0;
  const ports: LobbyPorts = {
    send: (event) => sent.push(event),
    onlinePlayers: () => [...players],
    transfer: (name, port) => transfers.push([name, port]),
    notify: (to, text) => notes.push([to, text]),
    title: (to, title, subtitle) => titles.push([to, title, subtitle]),
    closeForms: (name) => closed.push(name),
    chooseGame: (name, scope, choices) =>
      scope.guard(new Promise((pick) => selectors.push({ name, scope, choices, pick }))),
  };
  const root = new Scope("lobby");
  const lobby = new LobbyController(ports, root, { registry, newRequestId: () => `r${++requests}`, ...options });
  const say = (message: InboundMessage) => lobby.onMessage(message);
  const notesTo = (to: string) => notes.filter(([who]) => who === to).map(([, text]) => text);
  return { players, sent, transfers, notes, notesTo, titles, closed, selectors, root, lobby, say };
}

/** Steve opens the selector and starts Sumo on Arena 1 (request "r1"). */
async function startSumo(t: ReturnType<typeof setup>) {
  void t.lobby.openSelector("Steve");
  t.selectors.at(-1)!.pick({ game: "sumo", map: "arena_1" });
  await flushPromises();
}

beforeEach(() => {
  system.reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LobbyController: starting a game", () => {
  it("starts the picked game with the lobby's players", async () => {
    const t = setup();
    await startSumo(t);
    expect(t.sent).toEqual([{ t: "start_game", requestId: "r1", game: "sumo", map: "arena_1", players: ["Steve", "Alex"] }]);
    expect(t.notesTo("all")).toEqual(["Steve is starting Sumo on Arena 1."]);
    expect(t.titles).toEqual([["all", "Starting Sumo", "Arena 1"]]);
    expect(t.lobby.actionBar(0)).toBe("Starting Sumo.");
    expect(t.lobby.actionBar(2)).toBe("Starting Sumo...");
  });

  it("sends at most maxPlayers players", async () => {
    const t = setup(["Steve", "Alex", "Bob"]);
    await startSumo(t);
    expect(t.sent[0]).toMatchObject({ players: ["Steve", "Alex"] });
  });

  it("marks games that need more players, and refuses them at confirm", async () => {
    const t = setup(["Steve"]);
    void t.lobby.openSelector("Steve");
    expect(t.selectors[0].choices.map(({ game, playable, reason }) => [game.id, playable, reason])).toEqual([
      ["probe", true, undefined],
      ["sumo", false, "needs at least 2 players"],
    ]);
    t.selectors[0].pick({ game: "sumo", map: "arena_1" });
    await flushPromises();
    expect(t.sent).toEqual([]);
    expect(t.notesTo("Steve")).toEqual(["Sumo needs at least 2 players."]);

    const solo = setup(["Steve"], { devMinPlayers: 1 });
    void solo.lobby.openSelector("Steve");
    expect(solo.selectors[0].choices.every((choice) => choice.playable)).toBe(true);
  });

  it("opens one selector per player, and nothing when the player backs out", async () => {
    const t = setup();
    void t.lobby.openSelector("Steve");
    void t.lobby.openSelector("Steve");
    void t.lobby.openSelector("Alex");
    expect(t.selectors.map((selector) => selector.name)).toEqual(["Steve", "Alex"]);
    t.selectors[0].pick(undefined);
    await flushPromises();
    expect(t.sent).toEqual([]);
    void t.lobby.openSelector("Steve");
    expect(t.selectors).toHaveLength(3);
  });

  it("explains instead of opening the selector while the orchestrator is busy", async () => {
    const t = setup();
    t.say({ t: "status", state: "running", sessionId: "s1", game: "sumo", map: "arena_1", players: ["Bob", "Eve"] });
    await t.lobby.openSelector("Steve");
    t.say({ t: "status", state: "stopping", sessionId: "s1", game: "sumo", map: "arena_1", players: [] });
    await t.lobby.openSelector("Steve");
    expect(t.selectors).toHaveLength(0);
    expect(t.notesTo("Steve")).toEqual([
      "Sumo is in progress (2 playing). You'll join the next round.",
      "Wrapping up the last game. Try again in a moment.",
    ]);
    expect(t.lobby.actionBar(0)).toBe("Wrapping up Sumo");
  });

  it("checks again at confirm time, since someone else may have started a game meanwhile", async () => {
    const t = setup();
    void t.lobby.openSelector("Steve");
    t.say({ t: "status", state: "starting", sessionId: "s1", game: "probe", map: "default", players: [] });
    t.selectors[0].pick({ game: "sumo", map: "arena_1" });
    await flushPromises();
    expect(t.sent).toEqual([]);
    expect(t.notesTo("Steve")).toEqual(["Probe is in progress (0 playing). You'll join the next round."]);
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
    await startSumo(t);
    t.say({ t: "game_starting", requestId: "r1", sessionId: "s1", game: "sumo", map: "arena_1" });
    t.say({ t: "game_ready", requestId: "r1", sessionId: "s1", game: "sumo", map: "arena_1", port: 19133, hosts: { public: "x", lan: "y" } });
    expect(t.closed).toEqual(["Steve", "Alex"]);
    const countdown = () => t.titles.filter(([, title]) => /^\d$/.test(title)).map(([to, title]) => `${to}:${title}`);
    expect(countdown()).toEqual(["Steve:3", "Alex:3"]);
    for (let second = 0; second < 3; second++) {
      system.advanceTicks(20);
      await flushPromises();
    }
    expect(countdown()).toEqual(["Steve:3", "Alex:3", "Steve:2", "Alex:2", "Steve:1", "Alex:1"]);
    expect(t.transfers).toEqual([
      ["Steve", 19133],
      ["Alex", 19133],
    ]);
    expect(t.notesTo("Bob")).toEqual(["Sumo started without you. You'll join the next round."]);
    expect(t.lobby.actionBar(0)).toBe("Use the compass to pick a game");
  });

  it("skips listed players who left during the countdown", async () => {
    const t = setup();
    await startSumo(t);
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
    await startSumo(t);
    t.say({ t: "game_ready", requestId: "old", sessionId: "s0", game: "probe", map: "default", port: 19133, hosts: { public: "x", lan: "y" } });
    t.say({ t: "start_rejected", requestId: "old", reason: "busy", status: { state: "idle", players: [] } });
    system.advanceTicks(100);
    await flushPromises();
    expect(t.transfers).toEqual([]);
    expect(t.lobby.actionBar(0)).toBe("Starting Sumo.");
  });

  it("cancels the countdown if the game fails meanwhile", async () => {
    const t = setup();
    await startSumo(t);
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
  it("resets after a rejection or a failed start, so the selector works again", async () => {
    const t = setup();
    await startSumo(t);
    t.say({ t: "start_rejected", requestId: "r1", reason: "busy: Probe is running", status: { state: "running", players: [] } });
    expect(t.notesTo("all").at(-1)).toBe("Couldn't start Sumo: busy: Probe is running");
    expect(t.lobby.actionBar(0)).toBe("Use the compass to pick a game");

    await startSumo(t);
    t.say({ t: "game_failed", requestId: "r2", reason: "the game server did not become ready in time" });
    expect(t.notesTo("all").at(-1)).toBe("Sumo failed to start: the game server did not become ready in time");
    void t.lobby.openSelector("Steve");
    expect(t.selectors).toHaveLength(3);
  });

  it("drops its request when the orchestrator reports a different session", async () => {
    const t = setup();
    await startSumo(t);
    t.say({ t: "game_starting", requestId: "r1", sessionId: "s1", game: "sumo", map: "arena_1" });
    t.say({ t: "status", state: "starting", sessionId: "s1", game: "sumo", map: "arena_1", players: [] });
    expect(t.lobby.actionBar(0)).toBe("Starting Sumo.");
    t.say({ t: "status", state: "idle", players: [] }); // the orchestrator restarted
    expect(t.lobby.actionBar(0)).toBe("Use the compass to pick a game");
  });

  it("asks the orchestrator for the real state when no answer comes for 150 s", async () => {
    const t = setup();
    await startSumo(t);
    system.advanceTicks(150 * 20 - 1);
    expect(t.sent).toHaveLength(1);
    system.advanceTicks(1);
    expect(t.sent.at(-1)).toEqual({ t: "status_request" });
    expect(t.notesTo("all").at(-1)).toBe("Sumo didn't start in time. Try again.");
  });

  it("announces the end of a game", () => {
    const t = setup();
    t.say({ t: "game_ended", sessionId: "s1", reason: "finished" });
    expect(t.notesTo("all")).toEqual(["The last game ended (finished). Use the compass to start another."]);
  });

  it("closes a player's selector when they leave", () => {
    const t = setup();
    void t.lobby.openSelector("Steve");
    t.lobby.onPlayerLeft("Steve");
    expect(t.selectors[0].scope.disposed).toBe(true);
    void t.lobby.openSelector("Steve");
    expect(t.selectors).toHaveLength(2);
  });

  it("leaves nothing running once the lobby scope is disposed", async () => {
    const t = setup();
    await startSumo(t);
    void t.lobby.openSelector("Alex");
    t.root.dispose();
    expect(system.pendingRuns).toBe(0);
  });
});
