// Runs a Minigame against the fake world: core's own framework tests and every game's tests use
// it. One server root lives across the games of a test file, as on a real game server, so each
// test can check that its game left nothing behind (expectBaseline).
import { expect, vi } from "vitest";
import type { ServerContext } from "../src/context.ts";
import type { GameContext, Minigame } from "../src/game/minigame.ts";
import type { Result } from "../src/game/results.ts";
import { playSession } from "../src/game/session.ts";
import type { MapConfig } from "../src/map-config.ts";
import { normalizePlayer } from "../src/player.ts";
import type { MatchStats, OutboundEvent, StatsRow } from "../src/protocol/index.ts";
import { Scope } from "../src/scope.ts";
import { TransferService } from "../src/transfer.ts";
import type { ServerVars } from "../src/vars.ts";
import { resetAdmin } from "./fake-mc-server-admin.ts";
import { system, world } from "./fake-mc-server.ts";
import { openForms, resetForms } from "./fake-mc-server-ui.ts";
import { flushPromises } from "./util.ts";

/** The game rules a fresh server has; every game must put them back. */
export const SERVER_RULES = { pvp: true, showDeathMessages: true, doImmediateRespawn: false, keepInventory: false, fallDamage: true };

export const ARENA: MapConfig = {
  name: "Arena",
  spawns: [[0, 65, 0], [4, 65, 0], [-4, 65, 0], [0, 65, 4]],
  spectatorSpawn: [0, 75, 0],
  bounds: { min: [-20, 40, -20], max: [20, 100, 20] },
  killY: 50,
};

/** A repeatable stand-in for Math.random. */
export function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

export interface Harness {
  root: Scope;
  /** Everything the games sent to the orchestrator. */
  sent: OutboundEvent[];
  context(expectedPlayers: string[], mapConfig?: MapConfig): GameContext;
}

/** Resets the fake world and console spies. Call once per test file (beforeAll). */
export function createHarness(): Harness {
  system.reset();
  world.reset();
  Object.assign(world.gameRules, SERVER_RULES);
  resetForms();
  resetAdmin();
  for (const level of ["info", "warn", "error", "log"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  const root = new Scope("server");
  const sent: OutboundEvent[] = [];
  return {
    root,
    sent,
    context(expectedPlayers, mapConfig = ARENA) {
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
        mapConfig,
        devMinPlayers: undefined,
      };
      const server: ServerContext = {
        vars,
        transport: { kind: "log", send: (event) => sent.push(event), onMessage: () => () => {}, dispose: () => {} },
        transfer: new TransferService(vars),
        root,
      };
      return { ...server, random: seeded(7), match: 1 };
    },
  };
}

/** Moves time on, letting promise callbacks run after every tick. */
export async function ticks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    system.advanceTicks(1);
    await flushPromises(2);
  }
}

export interface Baseline {
  listeners: Record<string, number>;
  pending: number;
  live: ReturnType<Scope["live"]>;
}

export function snapshot(root: Scope): Baseline {
  return { listeners: world.listenerCounts(), pending: system.pendingRuns, live: root.live() };
}

/**
 * Runs a game through the session wrapper while `act` plays it, then until it is fully over
 * (everyone "goes back" by being reset). Resolves with the game's result.
 */
export async function playToEnd(game: Minigame, root: Scope, baseline: Baseline, act: () => Promise<void>): Promise<Result | undefined> {
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

/** Nothing the game used is left: listeners, runs, scopes, forms, objectives, game rules, player state. */
export function expectBaseline(root: Scope, baseline: Baseline): void {
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

/** The stats rows sent since `from` (an index into `sent`). */
export function statsRows(sent: OutboundEvent[], from = 0): StatsRow[] {
  return sent.slice(from).filter((event): event is MatchStats => event.t === "match_stats").flatMap((part) => part.rows);
}

export function everyoneLeaves(): void {
  for (const player of world.getAllPlayers()) world.leave(player.name);
}
