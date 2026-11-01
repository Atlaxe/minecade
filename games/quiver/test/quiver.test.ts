// One in the Quiver against the fake world, on a ring of 10 spawns: an arrow kills in one hit, every
// kill earns an arrow, missed arrows are removed, respawns land away from everyone, and the first to
// the lobby's kill target wins.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runtimeMapConfig, stripColors, validateMapConfig, type MapConfig, type MapPosition } from "@minecade/minigame-core/config";
import { FakePlayer, ItemStack, world } from "../../../packages/minigame-core/test/fake-mc-server.ts";
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
import { validateGameConfig } from "../../../tools/build/validate.ts";
import config from "../game.config.ts";
import { ARROW_SLOT, ARROW_VERBS, Quiver, giveArrows, pickSpawn, rankSpawns } from "../behavior_pack/scripts/quiver.ts";

const ARROW = "minecraft:arrow";
/** Ten spawns on a ring 12 blocks out: spawn 0 is east, spawn 5 west, 2 and 3 south, 7 and 8 north. */
const SPAWNS: MapPosition[] = [
  [12, 65, 0], [10, 65, 7], [4, 65, 11], [-4, 65, 11], [-10, 65, 7],
  [-12, 65, 0], [-10, 65, -7], [-4, 65, -11], [4, 65, -11], [10, 65, -7],
];
const RANGE: MapConfig = runtimeMapConfig({
  name: "Range",
  spawns: SPAWNS,
  spectatorSpawn: [0, 80, 0],
  bounds: { min: [-30, 40, -30], max: [30, 100, 30] },
  killY: 50,
});
const COUNTDOWN_TICKS = config.countdownSeconds * 20 + 5;
const RESPAWN_TICKS = config.respawn.delaySeconds * 20 + 2;

let harness: Harness;

beforeAll(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
});

function start(names: string[], options: { settings?: Record<string, string>; overrides?: Partial<typeof config> } = {}) {
  const players = names.map((name) => world.join(name));
  const baseline = snapshot(harness.root);
  const from = harness.sent.length;
  const game = new Quiver(harness.context(names, RANGE, options.settings), { ...config, ...options.overrides });
  return { players, baseline, from, game };
}

/** An arrow from `shooter` hits `victim` (it already left the shooter's quiver): its damage, then the hit, as on BDS. */
function shoot(shooter: FakePlayer, victim: FakePlayer): void {
  shooter.inventory.setItem(ARROW_SLOT, undefined);
  world.hurt(victim, 9, "projectile", { attacker: shooter, projectile: ARROW });
  world.projectileHits(victim, shooter);
}

const at = (player: FakePlayer, x: number, z: number) => (player.location = { x, y: 65, z });
const arrowsOf = (player: FakePlayer) => player.inventory.items().filter((item) => item.typeId === ARROW).reduce((sum, item) => sum + item.amount, 0);
const ARROW_LINE = new RegExp(`^B was (${ARROW_VERBS.join("|")}) by A \\(10 blocks\\)$`);

describe("One in the Quiver", () => {
  it("has a valid config, and maps need 10 spawns, a spectator spawn and kill Y", () => {
    expect(validateGameConfig(config, "quiver")).toEqual([]);
    const rules = { kind: "game" as const, maxPlayers: config.maxPlayers, requires: config.map };
    expect(validateMapConfig(RANGE, rules)).toEqual([]);
    const { spectatorSpawn: _spectator, killY: _killY, ...bare } = RANGE;
    const problems = validateMapConfig({ ...bare, spawns: SPAWNS.slice(0, 8) }, rules).join("\n");
    expect(problems).toMatch(/spawn/i);
    expect(problems).toMatch(/spectator/i);
    expect(problems).toMatch(/kill ?y/i);
  });

  it("an arrow kills in one hit and earns the shooter another; a missed arrow is removed; first to the target wins", async () => {
    const { players, baseline, from, game } = start(["A", "B", "C"], { settings: { target: "2" } });
    const [a, b, c] = players;
    const chatFrom = world.chat.length;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      expect(game.phase).toBe("playing");
      expect(stripColors(world.chat.at(-1) ?? "")).toBe("First to 2 kills wins. An arrow kills in one hit, and every kill earns another.");
      expect(a.inventory.getItem(0)?.typeId).toBe("minecraft:stone_sword");
      expect(a.inventory.getItem(1)?.typeId).toBe("minecraft:bow");
      expect(a.inventory.getItem(ARROW_SLOT)).toMatchObject({ typeId: ARROW, amount: 1, lockMode: "inventory" });

      at(a, 0.5, 0.5);
      at(b, 10.5, 0.5);
      shoot(a, b);
      expect(b.health.currentValue).toBe(20); // a down, never a death screen
      await ticks(2);
      expect(b.gameMode).toBe("Spectator");
      expect(arrowsOf(a)).toBe(1);
      expect(a.inventory.getItem(ARROW_SLOT)?.amount).toBe(1);
      await ticks(10); // the action bar's next refresh
      expect(stripColors(a.actionBar)).toContain("+1 arrow");
      expect(a.sounds.at(-1)?.id).toBe("random.orb");

      const missed = world.projectileLands(c);
      expect(missed.isValid).toBe(false);
      expect(world.projectileLands(c, "minecraft:snowball").isValid).toBe(true);

      at(c, -5.5, 0.5);
      shoot(a, c);
      await ticks(2);
    });

    expect(result).toMatchObject({ kind: "win", players: ["A"], reason: "first to 2 kills" });
    const feed = world.chat.slice(chatFrom).map(stripColors);
    expect(feed).toContainEqual(expect.stringMatching(ARROW_LINE));
    expect(feed).toContain("A wins One in the Quiver! (first to 2 kills)");
    const rows = statsRows(harness.sent, from);
    expect(rows.find((row) => row.n === "A")).toMatchObject({ r: "w", k: 2, d: 0, x: { bowKills: 2, longestShot: 10 } });
    expect(rows.find((row) => row.n === "B")).toMatchObject({ r: "l", k: 0, d: 1 });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("swords hurt as usual and a sword kill earns an arrow too; an arrow can't hurt its own shooter", async () => {
    const { players, baseline, from, game } = start(["A", "B"], { settings: { target: "1" } });
    const [a, b] = players;
    const chatFrom = world.chat.length;
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      world.hurt(a, 9, "projectile", { attacker: a, projectile: ARROW });
      expect(a.health.currentValue).toBe(20);
      expect(game.roster.get("A")?.state).toBe("alive");

      world.melee(a, b, 6);
      expect(b.health.currentValue).toBe(14);
      world.melee(a, b, 20);
      await ticks(2);
      expect(arrowsOf(a)).toBe(2);
    });
    const feed = world.chat.slice(chatFrom).map(stripColors);
    expect(feed.find((line) => / was .+ by A/.test(line))).not.toMatch(/blocks\)$/);
    const row = statsRows(harness.sent, from).find((entry) => entry.n === "A");
    expect(row).toMatchObject({ k: 1, r: "w" });
    expect(row?.x).toBeUndefined(); // no bow kills, no shots
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("an arrow kills in the victim's hit cooldown too, when BDS sends no damage for it", async () => {
    const { players, baseline, from, game } = start(["A", "B"], { settings: { target: "1" } });
    const [a, b] = players;
    const chatFrom = world.chat.length;
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      world.projectileHits(a, a); // its own arrow
      world.projectileHits(a, b, "minecraft:snowball");
      expect(game.roster.get("A")?.state).toBe("alive");
      at(a, 0.5, 0.5);
      at(b, 10.5, 0.5);
      world.melee(a, b, 6);
      a.inventory.setItem(ARROW_SLOT, undefined);
      world.projectileHits(b, a); // weaker than the sword hit, in its cooldown: no damage event at all
      await ticks(1);
      expect(b.gameMode).toBe("Spectator");
      expect(arrowsOf(a)).toBe(1);
    });
    expect(world.chat.slice(chatFrom).map(stripColors)).toContainEqual(expect.stringMatching(ARROW_LINE));
    expect(statsRows(harness.sent, from).find((row) => row.n === "B")).toMatchObject({ d: 1 });
    expect(statsRows(harness.sent, from).find((row) => row.n === "A")).toMatchObject({ k: 1, x: { bowKills: 1, longestShot: 10 } });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("respawns after 2 seconds at one of the spawns farthest from everyone, with one arrow and spawn protection", async () => {
    const { players, baseline, game } = start(["A", "B", "C"], { overrides: { timeLimitSeconds: 8 } });
    const [a, b, c] = players;
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      at(a, 12.5, 0.5); // on spawn 0, east
      at(c, -11.5, 0.5); // on spawn 5, west
      shoot(a, b);
      await ticks(RESPAWN_TICKS);
      expect(game.roster.get("B")?.state).toBe("alive");
      expect(b.gameMode).toBe("Adventure");
      // Spawns 2, 3, 7 and 8 (south and north) are farthest from both; the safest 3 are 2, 3 and 7.
      const safest = [SPAWNS[2], SPAWNS[3], SPAWNS[7]].map(([x, y, z]) => ({ x: x + 0.5, y, z: z + 0.5 }));
      expect(safest).toContainEqual(b.location);
      expect(arrowsOf(b)).toBe(1);
      shoot(c, b); // protected for 2 seconds
      await ticks(2);
      expect(game.roster.get("B")?.state).toBe("alive");
    });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("when time runs out, the most kills wins", async () => {
    const { players, baseline, game } = start(["A", "B"], { overrides: { timeLimitSeconds: 3 } });
    const [a, b] = players;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      shoot(b, a);
      await ticks(3 * 20);
    });
    expect(result).toMatchObject({ kind: "win", players: ["B"], reason: "highest score" });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("a late arrival joins in with a kit, on the sidebar at 0; the last player left wins once everyone else has gone", async () => {
    const { baseline, game } = start(["A", "B"]);
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      const late = world.join("Late");
      await ticks(12); // in, and the sidebar's next refresh
      expect(game.roster.get("Late")?.state).toBe("alive");
      expect(late.gameMode).toBe("Adventure");
      expect(arrowsOf(late)).toBe(1);
      expect([...(world.scoreboard.sidebar?.scores.keys() ?? [])].map(stripColors).sort()).toEqual(["A", "B", "Late"]);
      world.leave("B");
      world.leave("Late");
      await ticks(3);
    });
    expect(result).toMatchObject({ kind: "win", players: ["A"], reason: "last one standing" });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });
});

describe("respawn points", () => {
  const line: MapPosition[] = [[0, 65, 0], [10, 65, 0], [20, 65, 0], [30, 65, 0]];

  it("in a preview, an arrow kills a fake player in one hit and pays the shooter", async () => {
    const a = world.join("A");
    const baseline = snapshot(harness.root);
    const context = harness.context(["A"], RANGE, { target: "1" });
    context.vars.preview = "One in the Quiver: Range";
    const previewed = new Quiver(context, config);
    const result = await playToEnd(previewed, harness.root, baseline, async () => {
      await ticks(1);
      previewed.addFakes(1);
      await ticks(20 + COUNTDOWN_TICKS);
      expect(previewed.phase).toBe("playing");
      const fake = world.overworld.spawned.find((mob) => mob.isValid && mob.nameTag === "Fake 1");
      expect(fake).toBeDefined();
      at(a, 0.5, 0.5);
      fake!.location = { x: 10.5, y: 65, z: 0.5 };
      a.inventory.setItem(ARROW_SLOT, undefined);
      world.projectileHits(fake!, a);
      await ticks(2);
      expect(fake!.isValid).toBe(false);
      expect(arrowsOf(a)).toBe(1);
    });
    expect(result).toMatchObject({ kind: "win", players: ["A"], reason: "first to 1 kills" });
    expect(stripColors(world.chat.find((line) => /Fake 1 was/.test(stripColors(line))) ?? "")).toMatch(/^Fake 1 was .* by A \(10 blocks\)$/);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("ranks spawns by their distance to the nearest enemy, map order breaking ties", () => {
    expect(rankSpawns(line, [{ x: 0.5, y: 65, z: 0.5 }])).toEqual([[30, 65, 0], [20, 65, 0], [10, 65, 0], [0, 65, 0]]);
    expect(rankSpawns(line, [{ x: 0.5, y: 65, z: 0.5 }, { x: 30.5, y: 65, z: 0.5 }])).toEqual([[10, 65, 0], [20, 65, 0], [0, 65, 0], [30, 65, 0]]);
  });

  it("picks one of the safest 30% (at least one) at random, any spawn with nobody else alive, and nothing without spawns", () => {
    const enemy = [{ x: 0.5, y: 65, z: 0.5 }];
    expect(pickSpawn(line, enemy, () => 0)).toEqual([30, 65, 0]);
    expect(pickSpawn(line, enemy, () => 0.99)).toEqual([30, 65, 0]);
    expect(pickSpawn(SPAWNS, [{ x: 12.5, y: 65, z: 0.5 }], () => 0.99)).toEqual(rankSpawns(SPAWNS, [{ x: 12.5, y: 65, z: 0.5 }])[2]);
    expect(pickSpawn(line, [], () => 0.6)).toEqual([20, 65, 0]);
    expect(pickSpawn([], enemy, () => 0)).toBeUndefined();
  });
});

describe("giveArrows", () => {
  it("stacks arrows in the last hotbar slot, locked, and puts the rest anywhere free", () => {
    const player = new FakePlayer("Archer");
    giveArrows(player, 1);
    expect(player.inventory.getItem(ARROW_SLOT)).toMatchObject({ typeId: ARROW, amount: 1, lockMode: "inventory" });
    giveArrows(player, 2);
    expect(player.inventory.getItem(ARROW_SLOT)?.amount).toBe(3);
    player.inventory.setItem(ARROW_SLOT, new ItemStack(ARROW, 63));
    giveArrows(player, 3);
    expect(player.inventory.getItem(ARROW_SLOT)?.amount).toBe(64);
    expect(player.inventory.getItem(0)).toMatchObject({ typeId: ARROW, amount: 2 });
    player.inventory.clearAll();
    player.inventory.setItem(ARROW_SLOT, new ItemStack("minecraft:stick"));
    giveArrows(player, 1);
    expect(player.inventory.getItem(0)).toMatchObject({ typeId: ARROW, amount: 1 });
    giveArrows(player, 0);
    expect(player.inventory.items()).toHaveLength(2);
  });
});
