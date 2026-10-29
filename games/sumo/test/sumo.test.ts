// Sumo against the fake world, on its real arena map: hits never hurt, a knock-off below the
// platform is a kill for the last hitter, and the last player standing wins.
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { stripColors, type MapConfig } from "@minecade/minigame-core/config";
import { transfers } from "../../../packages/minigame-core/test/fake-mc-server-admin.ts";
import { world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import {
  createHarness,
  everyoneLeaves,
  expectBaseline,
  playToEnd,
  snapshot,
  statsRows,
  ticks,
  type Harness,
} from "../../../packages/minigame-core/test/game-harness.ts";
import config from "../game.config.ts";
import { Sumo, pushDirection } from "../behavior_pack/scripts/sumo.ts";

const { build: _build, ...arena } = JSON.parse(readFileSync(new URL("../maps/arena_1/map.json", import.meta.url), "utf8")) as MapConfig;
const COUNTDOWN_TICKS = config.countdownSeconds * 20 + 5;

let harness: Harness;

beforeAll(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
});

function start(names: string[], overrides: Partial<typeof config> = {}) {
  const players = names.map((name) => world.join(name));
  const baseline = snapshot(harness.root);
  const from = harness.sent.length;
  const game = new Sumo(harness.context(names, arena), { ...config, ...overrides });
  return { players, baseline, from, game };
}

/** Pushes a player off the edge: below the arena's killY. */
function knockOff(player: FakePlayer): void {
  player.location = { x: 9, y: arena.killY! - 1, z: 0 };
}

describe("Sumo", () => {
  it("hits only push, and the last hitter gets the kill for a knock-off", async () => {
    const { players, baseline, from, game } = start(["A", "B", "C"]);
    const chatFrom = world.chat.length;
    const [a, b, c] = players;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(2);
      world.melee(a, b, 5); // during the countdown: canceled outright
      expect(b.health.currentValue).toBe(20);
      await ticks(COUNTDOWN_TICKS);
      expect(game.phase).toBe("playing");
      // 5, 4 tick; 3, 2, 1 ring; then "Go!" with its flourish.
      expect(a.sounds.map((sound) => sound.id)).toEqual(["note.hat", "note.hat", "note.bell", "note.bell", "note.bell", "random.levelup"]);
      expect(a.titles.map(stripColors).at(-1)).toBe("Go! | Sumo");
      await ticks(10);
      expect(a.actionBar).toMatch(/^::T0(3:00|2:\d\d)\|$/); // Sumo's 3 minutes, drawn top right by the core pack

      world.melee(a, b, 5);
      expect(b.health.currentValue).toBe(20); // the hit landed with 0 damage
      world.hurt(c, 6, "fall");
      expect(c.health.currentValue).toBe(20);
      knockOff(b);
      await ticks(3);
      expect(b.gameMode).toBe("Spectator");

      world.melee(c, a, 5);
      world.melee(b, a, 5, true); // a spectator, and inside A's hit cooldown anyway: no credit
      knockOff(a);
      await ticks(3);
    });

    expect(result).toMatchObject({ kind: "win", players: ["C"] });
    const feed = world.chat.slice(chatFrom).map(stripColors);
    expect(feed.filter((line) => / was .+ by /.test(line))).toEqual([expect.stringMatching(/^B was .+ by A$/), expect.stringMatching(/^A was .+ by C$/)]);
    expect(feed).toContain("C wins Sumo! (last one standing)");
    expect(statsRows(harness.sent, from).map(({ n, r, k, d, dd, dt }) => ({ n, r, k, d, dd, dt }))).toEqual([
      { n: "A", r: "l", k: 1, d: 1, dd: 0, dt: 0 },
      { n: "B", r: "l", k: 0, d: 1, dd: 0, dt: 0 },
      { n: "C", r: "w", k: 1, d: 0, dd: 0, dt: 0 },
    ]);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("has a 5 minute clock when a game doesn't set its own", async () => {
    const { players, baseline, game } = start(["A", "B"], { timeLimitSeconds: undefined });
    const [a, b] = players;
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS + 10);
      expect(a.actionBar).toMatch(/^::T0(5:00|4:5\d)\|$/);
      knockOff(b);
      await ticks(3);
    });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("uses a game's own kill verbs, and a void line when nobody gets the credit", async () => {
    const { players, baseline, game } = start(["A", "B", "C"], { deathMessages: { verbs: ["shoved off"], replace: true } });
    const [a, b, c] = players;
    const chatFrom = world.chat.length;
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      world.melee(a, b, 1);
      knockOff(b);
      await ticks(3);
      knockOff(c); // nobody touched C
      await ticks(3);
    });
    const feed = world.chat.slice(chatFrom).map(stripColors);
    expect(feed[0]).toBe("B was shoved off by A");
    expect(feed[1]).toMatch(/^C (fell into the void|took a long walk off a short platform|forgot how gravity works|found the edge of the map)$/);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("credits the hit that knocked a player off, not a tap that landed in their hit cooldown", async () => {
    const { players, baseline, from, game } = start(["A", "B", "C"]);
    const [a, b, c] = players;
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      world.melee(a, b, 1);
      world.melee(c, b, 1, true); // BDS fires the before-event, then drops the hit
      knockOff(b);
      await ticks(3);
      knockOff(c);
      await ticks(3);
    });
    const kills = Object.fromEntries(statsRows(harness.sent, from).map((row) => [row.n, row.k]));
    expect(kills).toEqual({ A: 1, B: 0, C: 0 });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("in scripted mode, cancels the hit and pushes the victim away from the attacker, once per cooldown", async () => {
    const knockback = { ...config.knockback, mode: "scripted" as const };
    const { players, baseline, from, game } = start(["A", "B"], { knockback });
    const [a, b] = players;
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      a.location = { x: 0.5, y: 65, z: 0.5 };
      b.location = { x: 3.5, y: 65, z: 0.5 };
      world.melee(a, b, 5);
      expect(b.health.currentValue).toBe(20);
      expect(b.knockbacks).toEqual([{ x: knockback.horizontal, z: 0, vertical: knockback.vertical }]);
      await ticks(knockback.cooldownTicks - 1);
      world.melee(a, b, 5); // too soon: no second push
      expect(b.knockbacks).toHaveLength(1);
      await ticks(1);
      a.isSprinting = true;
      world.melee(a, b, 5);
      expect(b.knockbacks).toHaveLength(2);
      expect(b.knockbacks[1]).toEqual({ x: knockback.sprintHorizontal, z: 0, vertical: knockback.sprintVertical });

      knockOff(b); // the push is credited, though no damage ever landed
      await ticks(3);
      world.melee(b, a, 5); // a spectator can't push anyone
      expect(a.knockbacks).toEqual([]);
    });
    expect(statsRows(harness.sent, from).find((row) => row.n === "A")).toMatchObject({ k: 1, r: "w" });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("ends in a draw when time runs out, and sends a late arrival back to the lobby", async () => {
    const { baseline, from, game } = start(["A", "B"], { timeLimitSeconds: 3 });
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS + 20);
      world.join("Late");
      await ticks(5);
      expect(transfers.map((transfer) => transfer.player)).toContain("Late");
      world.leave("Late");
      await ticks(3 * 20);
    });
    expect(result).toMatchObject({ kind: "draw" });
    expect(statsRows(harness.sent, from).map((row) => row.r)).toEqual(["d", "d"]);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });
});

describe("pushDirection", () => {
  it("points from the attacker to the victim on the ground plane", () => {
    expect(pushDirection({ x: 0, y: 65, z: 0 }, { x: 3, y: 70, z: 4 }, { x: 1, y: 0, z: 0 })).toEqual({ x: 0.6, z: 0.8 });
  });

  it("uses the attacker's view when they overlap, and a fixed direction as a last resort", () => {
    const here = { x: 1, y: 65, z: 1 };
    expect(pushDirection(here, here, { x: 0, y: -0.6, z: -0.8 })).toEqual({ x: 0, z: -1 });
    expect(pushDirection(here, here, { x: 0, y: -1, z: 0 })).toEqual({ x: 0, z: 1 });
  });
});
