// The framework end to end against the fake world: three different games run back to back on
// one server root, and after each one nothing may be left behind (listeners, runs, scopes,
// objectives, game rules, locked or spectating players, open forms).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameConfig } from "../src/config.ts";
import type { ServerContext } from "../src/context.ts";
import { Minigame, type GameContext } from "../src/game/minigame.ts";
import { removeLeftoverObjectives } from "../src/game/sidebar.ts";
import type { Result } from "../src/game/results.ts";
import { playSession } from "../src/game/session.ts";
import { normalizePlayer } from "../src/player.ts";
import type { MatchStats, OutboundEvent } from "../src/protocol/index.ts";
import { Scope } from "../src/scope.ts";
import { TransferService } from "../src/transfer.ts";
import type { ServerVars } from "../src/vars.ts";
import { resetAdmin } from "./fake-mc-server-admin.ts";
import { ItemStack, system, world, type FakePlayer } from "./fake-mc-server.ts";
import { closedFor, openForms, queueFormResponses, resetForms } from "./fake-mc-server-ui.ts";
import { flushPromises } from "./util.ts";

const SERVER_RULES = { pvp: true, showDeathMessages: true, doImmediateRespawn: false, keepInventory: false, fallDamage: true };

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const root = new Scope("server");
const sent: OutboundEvent[] = [];

function context(expectedPlayers: string[]): GameContext {
  const vars: ServerVars = {
    serverId: "s1",
    role: "game",
    game: "test",
    map: "arena",
    sessionId: "s1",
    orchestratorUrl: "",
    transport: "log",
    lanHost: "192.168.40.98",
    publicHost: "203.0.113.7",
    serverPort: 19133,
    lobbyPort: 19132,
    lanPlayers: [],
    expectedPlayers,
    mapConfig: {
      name: "Arena",
      spawns: [[0, 65, 0], [4, 65, 0], [-4, 65, 0], [0, 65, 4]],
      spectatorSpawn: [0, 75, 0],
      bounds: { min: [-20, 40, -20], max: [20, 100, 20] },
      killY: 50,
    },
    devMinPlayers: undefined,
  };
  const server: ServerContext = {
    vars,
    transport: { kind: "log", send: (event) => sent.push(event), onMessage: () => () => {}, dispose: () => {} },
    transfer: new TransferService(vars),
    root,
  };
  return { ...server, random: seeded(7), match: 1 };
}

class TestGame extends Minigame {
  onEndHook: ((result: Result) => void) | undefined;

  protected override onEnd(result: Result): void {
    this.onEndHook?.(result);
  }
}

/** Moves time on, letting promise callbacks run after every tick. */
async function ticks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    system.advanceTicks(1);
    await flushPromises(2);
  }
}

interface Baseline {
  listeners: Record<string, number>;
  pending: number;
  live: ReturnType<Scope["live"]>;
}

const snapshot = (): Baseline => ({ listeners: world.listenerCounts(), pending: system.pendingRuns, live: root.live() });

/** Runs a game through the session wrapper until it is fully over, then everyone "goes back". */
async function playToEnd(game: Minigame, baseline: Baseline, act: () => Promise<void>): Promise<Result | undefined> {
  let result: Result | undefined;
  let done = false;
  const runGame = game.run.bind(game);
  game.run = async () => (result = await runGame());
  void playSession(game, root, baseline.live, async () => {
    for (const player of world.getAllPlayers()) normalizePlayer(player as never);
    done = true;
  });
  await act();
  for (let i = 0; i < 2000 && !done; i++) await ticks(1);
  expect(done).toBe(true);
  return result;
}

function expectBaseline(baseline: Baseline): void {
  expect(world.listenerCounts()).toEqual(baseline.listeners);
  expect(system.pendingRuns).toBe(baseline.pending);
  expect(root.live()).toEqual(baseline.live);
  expect(openForms).toHaveLength(0);
  expect(world.scoreboard.getObjectives()).toEqual([]);
  expect(world.gameRules).toEqual(SERVER_RULES);
  for (const player of world.getAllPlayers()) {
    expect(player.unlocked, `${player.name} unlocked`).toBe(true);
    expect(player.gameMode, `${player.name} game mode`).toBe("Adventure");
    expect(player.effects.size).toBe(0);
    expect(player.health.currentValue).toBe(20);
  }
  expect(vi.mocked(console.warn).mock.calls.flat().join("\n")).not.toMatch(/left resources behind|cleanup failed/);
}

const statsOf = (from: number) =>
  sent.slice(from).filter((event): event is MatchStats => event.t === "match_stats").flatMap((part) => part.rows);

function everyoneLeaves(): void {
  for (const player of world.getAllPlayers()) world.leave(player.name);
}

beforeAll(() => {
  system.reset();
  world.reset();
  Object.assign(world.gameRules, SERVER_RULES);
  resetForms();
  resetAdmin();
  for (const level of ["info", "warn", "error", "log"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
});

describe("three games in a row on one server", () => {
  it("1: a free-for-all with kits, a projectile kill and a leaver", async () => {
    const config: GameConfig = {
      id: "ffa",
      name: "FFA",
      minPlayers: 2,
      maxPlayers: 4,
      countdownSeconds: 3,
      endDelaySeconds: 1,
      kits: { pick: true, list: [{ id: "sword", name: "Sword", items: [{ item: "minecraft:iron_sword" }] }, { id: "bow", name: "Bow", items: [{ item: "minecraft:bow" }] }] },
      stats: { mode: "solo", pvp: true },
    };
    const players = ["A", "B", "C", "D"].map((name) => world.join(name));
    const [a, b, c, d] = players;
    const baseline = snapshot();
    const from = sent.length;
    const game = new TestGame(context(["A", "B", "C", "D"]), config);

    const result = await playToEnd(game, baseline, async () => {
      await ticks(2);
      expect(game.phase).toBe("countdown");
      expect(a.unlocked).toBe(false); // frozen during the countdown
      // A picks the bow; B opens the picker and never answers.
      queueFormResponses({ canceled: false, selection: 1 });
      world.afterEvents.itemUse.emit({ source: a, itemStack: new ItemStack("minecraft:nether_star") });
      world.afterEvents.itemUse.emit({ source: b, itemStack: new ItemStack("minecraft:nether_star") });
      await ticks(15 * 20 + 5);
      expect(game.phase).toBe("playing");
      expect(closedFor).toContain("B"); // the open picker closed with the pregame
      expect(a.unlocked).toBe(true);
      expect(a.inventory.items().map((item) => item.typeId)).toEqual(["minecraft:bow"]);
      expect(c.inventory.items().map((item) => item.typeId)).toEqual(["minecraft:iron_sword"]);

      world.hurt(c, 25, "entityAttack", { attacker: a }); // lethal: intercepted, no vanilla death
      expect(c.health.currentValue).toBe(20);
      await ticks(1);
      expect(c.gameMode).toBe("Spectator");
      // Spectators can't hurt anyone, or be hurt.
      world.hurt(d, 5, "entityAttack", { attacker: c });
      world.hurt(c, 5, "entityAttack", { attacker: d });
      expect([d.health.currentValue, c.health.currentValue]).toEqual([20, 20]);

      world.hurt(d, 20, "projectile", { attacker: b, projectile: "minecraft:arrow" });
      world.leave("B"); // the shooter leaves before the down is handled: credit still holds
      await ticks(2);
    });

    expect(result).toMatchObject({ kind: "win", players: ["A"] });
    const rows = statsOf(from);
    expect(rows.map(({ n, r, k, d, dd, dt }) => ({ n, r, k, d, dd, dt }))).toEqual([
      { n: "A", r: "w", k: 1, d: 0, dd: 20, dt: 0 },
      { n: "B", r: "l", k: 1, d: 1, dd: 20, dt: 0 },
      { n: "C", r: "l", k: 0, d: 1, dd: 0, dt: 20 },
      { n: "D", r: "l", k: 0, d: 1, dd: 0, dt: 20 },
    ]);
    expect(rows.find((row) => row.n === "B")?.q).toBe(1);
    expectBaseline(baseline);
    everyoneLeaves();
  });

  it("2: a countdown that loses a player goes back to waiting, then gives up", async () => {
    const config: GameConfig = { id: "duel", name: "Duel", minPlayers: 2, maxPlayers: 2, countdownSeconds: 3, waitForPlayersSeconds: 2 };
    const [a] = [world.join("A"), world.join("B")];
    const baseline = snapshot();
    const from = sent.length;
    const game = new TestGame(context(["A", "B"]), config);

    const result = await playToEnd(game, baseline, async () => {
      await ticks(2);
      expect(game.phase).toBe("countdown");
      expect(a.unlocked).toBe(false);
      world.leave("B");
      await ticks(25);
      expect(a.unlocked).toBe(true); // released when the countdown stopped
    });

    expect(result).toEqual({ kind: "aborted", reason: "not_enough_players" });
    expect(statsOf(from)).toEqual([]);
    expectBaseline(baseline);
    everyoneLeaves();
  });

  it("3: teams with respawns: a win while a respawn is pending, a rejoin, no friendly fire", async () => {
    const config: GameConfig = {
      id: "teams",
      name: "Teams",
      minPlayers: 2,
      maxPlayers: 4,
      countdownSeconds: 3,
      endDelaySeconds: 1,
      teams: { count: 2, pick: false },
      respawn: { mode: "unlimited", delaySeconds: 2 },
      scoring: { per: "team", perKill: 1, target: 2 },
      stats: { mode: "team", pvp: true },
    };
    const players = new Map(["A", "B", "C", "D"].map((name) => [name, world.join(name)]));
    const baseline = snapshot();
    const from = sent.length;
    const game = new TestGame(context(["A", "B", "C", "D"]), config);
    let winner = "";

    const result = await playToEnd(game, baseline, async () => {
      await ticks(3 * 20 + 5);
      expect(game.phase).toBe("playing");
      const teamOf = (name: string) => game.roster.get(name)!.team!;
      const names = [...players.keys()];
      const killer = names[0];
      const mate = names.find((name) => name !== killer && teamOf(name) === teamOf(killer))!;
      const [first, second] = names.filter((name) => teamOf(name) !== teamOf(killer));
      winner = teamOf(killer);
      const player = (name: string) => players.get(name) as FakePlayer;
      expect(world.scoreboard.sidebar).toBeDefined();

      world.hurt(player(mate), 5, "entityAttack", { attacker: player(killer) }); // teammates can't hurt each other
      expect(player(mate).health.currentValue).toBe(20);

      players.set(mate, world.rejoin(mate)); // back mid-game: spectating
      await ticks(3);
      expect(player(mate).gameMode).toBe("Spectator");

      world.hurt(player(first), 30, "entityAttack", { attacker: player(killer) });
      await ticks(1);
      expect(player(first).gameMode).toBe("Spectator"); // respawning in 2 s
      world.hurt(player(second), 30, "entityAttack", { attacker: player(killer) });
      await ticks(1);
      const teleportsAtWin = player(first).teleports.length;
      await ticks(3 * 20);
      expect(player(first).teleports.length).toBe(teleportsAtWin); // the pending respawn never ran
    });

    expect(result).toMatchObject({ kind: "win", team: winner });
    const rows = statsOf(from);
    expect(rows.reduce((sum, row) => sum + row.k, 0)).toBe(2); // nothing carried over from game 1
    expect(rows.filter((row) => row.r === "w").every((row) => row.tm === winner)).toBe(true);
    expectBaseline(baseline);
    everyoneLeaves();
  });
});

describe("Minigame details", () => {
  it("several lethal hits in one tick make one death and one kill", async () => {
    const config: GameConfig = { id: "ffa2", name: "FFA", minPlayers: 2, maxPlayers: 3, countdownSeconds: 1, endDelaySeconds: 1, stats: { mode: "solo" } };
    const [a, b, c] = ["A", "B", "C"].map((name) => world.join(name));
    const baseline = snapshot();
    const from = sent.length;
    const game = new TestGame(context(["A", "B", "C"]), config);
    await playToEnd(game, baseline, async () => {
      await ticks(25);
      world.hurt(c, 30, "entityAttack", { attacker: a });
      world.hurt(c, 30, "entityAttack", { attacker: b });
      world.hurt(c, 30, "entityAttack", { attacker: a });
      await ticks(1);
      world.hurt(b, 30, "entityAttack", { attacker: a });
      await ticks(1);
    });
    const rows = statsOf(from);
    // Only the first lethal hit on C counts: the later ones, B's included, are canceled.
    expect(rows.find((row) => row.n === "C")).toMatchObject({ d: 1, dt: 20 });
    expect(rows.find((row) => row.n === "A")).toMatchObject({ k: 2, dd: 40, r: "w" });
    expect(rows.find((row) => row.n === "B")).toMatchObject({ k: 0, dd: 0 });
    expectBaseline(baseline);
    everyoneLeaves();
  });

  it("handles a death it couldn't intercept (absorption) once, through the backstop", async () => {
    const config: GameConfig = { id: "ffa3", name: "FFA", minPlayers: 2, maxPlayers: 3, countdownSeconds: 1, endDelaySeconds: 1, stats: { mode: "solo" } };
    const [a, b, c] = ["A", "B", "C"].map((name) => world.join(name));
    const baseline = snapshot();
    const from = sent.length;
    const game = new TestGame(context(["A", "B", "C"]), config);
    await playToEnd(game, baseline, async () => {
      await ticks(25);
      c.addEffect("absorption", 100);
      world.hurt(c, 30, "entityAttack", { attacker: a }); // let through: absorption might save them
      await ticks(10);
      expect(c.gameMode).toBe("Spectator");
      world.kill(b); // /kill fires the before-event too: intercepted like any lethal hit
      await ticks(2);
    });
    const rows = statsOf(from);
    expect(rows.find((row) => row.n === "C")).toMatchObject({ d: 1 });
    expect(rows.find((row) => row.n === "B")).toMatchObject({ d: 1 });
    expect(rows.find((row) => row.n === "A")).toMatchObject({ k: 1, r: "w" });
    expectBaseline(baseline);
    everyoneLeaves();
  });

  it("restores game rules even when onEnd throws, and ends cleanly when finished from a before-event", async () => {
    class Finisher extends TestGame {
      protected override onDamage(): "cancel" {
        this.finish({ kind: "draw", reason: "ended from a damage hook" });
        return "cancel";
      }
    }
    const config: GameConfig = { id: "fin", name: "Fin", minPlayers: 2, maxPlayers: 2, countdownSeconds: 1, endDelaySeconds: 1 };
    const [a, b] = ["A", "B"].map((name) => world.join(name));
    const baseline = snapshot();
    const game = new Finisher(context(["A", "B"]), config);
    game.onEndHook = () => {
      throw new Error("onEnd blew up");
    };
    const result = await playToEnd(game, baseline, async () => {
      await ticks(25);
      world.hurt(b, 2, "entityAttack", { attacker: a });
      await ticks(2);
    });
    expect(result).toEqual({ kind: "draw", reason: "ended from a damage hook" });
    expectBaseline(baseline);
    everyoneLeaves();
  });

  it("removes a sidebar objective left behind by a crashed game", () => {
    world.scoreboard.addObjective("mc_crashed", "Old");
    world.scoreboard.addObjective("other", "Not ours");
    removeLeftoverObjectives();
    expect(world.scoreboard.getObjectives().map((objective) => objective.id)).toEqual(["other"]);
    world.scoreboard.removeObjective("other");
  });
});
