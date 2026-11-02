// Bridges against the fake world, on a two-island map: a hole by each team's spawn, inside its spawn
// guard. Getting into the other team's hole wins the round, your own puts you down, the arrow comes
// back after 10 seconds or with a kill, the Leap leaps once, and placed blocks stay or go between
// rounds by the lobby's setting.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runtimeMapConfig, stripColors, validateMapConfig, type MapConfig } from "@minecade/minigame-core/config";
import { ItemStack, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { openLiveForm } from "../../../packages/minigame-core/test/fake-mc-server-ui.ts";
import { createHarness, everyoneLeaves, expectBaseline, playToEnd, snapshot, statsRows, ticks, type Harness } from "../../../packages/minigame-core/test/game-harness.ts";
import { validateGameConfig } from "../../../tools/build/validate.ts";
import config from "../game.config.ts";
import { Bridges, HOLE, OWN_HOLE, holeColumn, holesOf, inHole, leapPush } from "../behavior_pack/scripts/bridges.ts";
import { MapView } from "../../../packages/minigame-core/src/game/map-view.ts";

const GAP: MapConfig = runtimeMapConfig({
  name: "Gap",
  spawns: [[0, 70, 0]],
  spectatorSpawn: [0, 80, 0],
  teamSpawns: { red: [[-20, 65, 0]], blue: [[20, 65, 0]] },
  bounds: { min: [-30, 40, -10], max: [30, 100, 10] },
  killY: 50,
  points: { "hole.red": [[-25, 62, 0]], "hole.blue": [[25, 62, 0]] },
  regions: {
    "spawnGuard.red": [{ min: [-29, 60, -4], max: [-17, 75, 4] }],
    "spawnGuard.blue": [{ min: [17, 60, -4], max: [29, 75, 4] }],
  },
});
const RED_HOLE = { x: -24.5, y: 62, z: 0.5 };
const BLUE_HOLE = { x: 25.5, y: 62, z: 0.5 };
const COUNTDOWN_TICKS = config.countdownSeconds * 20 + 5;
/** A round's break, then the next round's frozen countdown. */
const NEXT_ROUND_TICKS = 40 + 3 * 20 + 5;

let harness: Harness;

beforeAll(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
});

/** A match between A and B, picked from the lobby with Teams: Random; both pick their kits. */
async function begin(settings: Record<string, string> = {}, kits: [string, string] = ["Snowballs", "Leap"]) {
  const [a, b] = [world.join("A"), world.join("B")];
  const baseline = snapshot(harness.root);
  const from = harness.sent.length;
  const game = new Bridges(harness.context(["A", "B"], GAP, { teams: "random", ...settings }), config, "pack-uuid");
  return { a, b, baseline, from, game, kits };
}

async function pickAndStart(game: Bridges, kits: [string, string]): Promise<void> {
  await ticks(2);
  expect(game.phase).toBe("picking");
  openLiveForm("A")!.click(`Pick ${kits[0]}`);
  openLiveForm("B")!.click(`Pick ${kits[1]}`);
  await ticks(6 + COUNTDOWN_TICKS);
  expect(game.phase).toBe("playing");
}

/** The red player first. */
function byTeam(game: Bridges, a: FakePlayer, b: FakePlayer): [FakePlayer, FakePlayer] {
  return game.teamOf("A")?.id === "red" ? [a, b] : [b, a];
}

const ids = (player: FakePlayer) => player.inventory.items().map((item) => `${item.amount} ${item.typeId.replace("minecraft:", "")}`);

describe("Bridges' config and map", () => {
  it("passes the build's checks, and its map needs holes, spawn guards, bounds and kill Y", () => {
    expect(validateGameConfig(config, "bridges")).toEqual([]);
    const rules = { kind: "game" as const, maxPlayers: config.maxPlayers, requires: config.map, teams: [{ id: "red", name: "Red" }, { id: "blue", name: "Blue" }] };
    expect(validateMapConfig(GAP, rules)).toEqual([]);
    expect(validateMapConfig({ ...GAP, points: {}, regions: {} }, rules)).toEqual([
      'this game needs a "points.hole.red" entry',
      'this game needs a "points.hole.blue" entry',
      'this game needs a "regions.spawnGuard.red" entry',
      'this game needs a "regions.spawnGuard.blue" entry',
    ]);
  });

  it("finds the holes, and touches them from inside their sides below the rim", () => {
    const holes = holesOf(new MapView(GAP));
    expect(holes).toEqual([
      { team: "red", at: RED_HOLE },
      { team: "blue", at: BLUE_HOLE },
    ]);
    const size = config.hole;
    expect(inHole({ x: -24.5, y: 64.9, z: 0.5 }, holes[0], size)).toBe(true);
    expect(inHole({ x: -23, y: 63, z: 2 }, holes[0], size)).toBe(true); // a shoulder over the side
    expect(inHole({ x: -24.5, y: 65, z: 0.5 }, holes[0], size)).toBe(false); // on the rim
    expect(inHole({ x: -22.5, y: 63, z: 0.5 }, holes[0], size)).toBe(false);
    expect(holeColumn(holes[0], size.halfWidth, 100)).toEqual({ min: [-26, 62, -1], max: [-24, 100, 1] });
    expect(leapPush({ x: 0, y: -1, z: 0 }, 1.6)).toEqual({ x: 0, z: 0 });
    expect(leapPush({ x: 3, y: 5, z: 4 }, 2)).toEqual({ x: 1.2, z: 1.6 });
  });
});

describe("a match of Bridges", () => {
  it("gives the kits, places the holes, and the first to 3 rounds wins", async () => {
    const { a, b, baseline, from, game, kits } = await begin();
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await pickAndStart(game, kits);
      const [red, blue] = byTeam(game, a, b);
      expect(ids(a)).toEqual(["1 wooden_sword", "1 bow", `64 ${game.teamOf("A")!.id}_wool`, "8 snowball", "1 arrow"]);
      expect(ids(b)).toEqual(["1 wooden_sword", "1 bow", `64 ${game.teamOf("B")!.id}_wool`, "1 feather", "1 arrow"]);
      expect(a.gameMode).toBe("Survival");
      const holes = world.overworld.spawned.filter((mob) => mob.typeId === HOLE);
      expect(holes.map((hole) => [hole.location, hole.properties.get("minecade:team")])).toEqual([
        [RED_HOLE, 0],
        [BLUE_HOLE, 1],
      ]);

      for (let round = 1; round <= 3; round++) {
        expect(game.roundInPlay).toBe(true);
        red.location = { ...BLUE_HOLE, y: 63 };
        await ticks(3);
        expect(game.roundInPlay).toBe(false);
        if (round < 3) await ticks(NEXT_ROUND_TICKS);
      }
      expect(stripColors(world.chat.join("\n"))).toContain(`Red wins round 3! (${red.name} scored)`);
    });
    const [red] = byTeam(game, a, b);
    expect(result).toMatchObject({ kind: "win", team: "red", reason: "won 3 rounds" });
    expect(game.bestOf?.history).toEqual(["red", "red", "red"]);
    expect(statsRows(harness.sent, from).find((row) => row.n === red.name)?.x).toMatchObject({ goals: 3 });
    expect(holesLeft()).toBe(0);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("shows the rounds as circles top right, in each round's winner's color, by the lobby's Best of", async () => {
    const { a, b, baseline, game, kits } = await begin({ bestOf: "3" });
    await playToEnd(game, harness.root, baseline, async () => {
      await pickAndStart(game, kits);
      const [red, blue] = byTeam(game, a, b);
      await ticks(10);
      expect(a.actionBar).toContain("§k§i§3§r");
      blue.location = { ...RED_HOLE, y: 63 };
      await ticks(3 + NEXT_ROUND_TICKS);
      expect(a.actionBar).toContain("§k§i§3§k§j§1§9§r");
      red.location = { ...BLUE_HOLE, y: 63 };
      await ticks(3 + NEXT_ROUND_TICKS);
      expect(a.actionBar).toContain("§k§i§3§k§j§1§9§k§j§2§c§r");
      red.location = { ...BLUE_HOLE, y: 63 };
      await ticks(3);
    });
    expect(game.bestOf?.history).toEqual(["blue", "red", "red"]);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("puts down a player in their own hole, brings the arrow back after 10 seconds or with a kill, and leaps once", async () => {
    const { a, b, baseline, game, kits } = await begin();
    await playToEnd(game, harness.root, baseline, async () => {
      await pickAndStart(game, kits);
      const [red] = byTeam(game, a, b);
      // Into your own hole: down, as from a fall, and no round for anyone.
      red.location = { ...RED_HOLE, y: 63 };
      await ticks(3);
      expect(game.roster.get(red.name)?.state).toBe("respawning");
      expect(game.roundInPlay).toBe(true);
      expect(stripColors(world.chat.join("\n"))).toContain(`${red.name} jumped into their own hole`);
      await ticks(config.respawn.delaySeconds * 20 + 2);
      expect(game.roster.get(red.name)?.state).toBe("alive");

      // A shoots: the arrow comes back in 10 seconds, the level counting down.
      a.inventory.setItem(8, undefined);
      await ticks(10);
      expect(a.level).toBe(10);
      await ticks(5 * 20);
      expect(a.level).toBeLessThanOrEqual(5);
      await ticks(5 * 20);
      expect(ids(a)).toContain("1 arrow");
      expect(a.level).toBe(0);

      // B shoots, then kills A: the arrow is back at once.
      b.inventory.setItem(8, undefined);
      world.hurt(a, 25, "entityAttack", { attacker: b });
      await ticks(1);
      expect(ids(b)).toContain("1 arrow");

      // B leaps: a push the way they look, and the feather is gone. A respawned A keeps their snowballs (all 8 here).
      b.viewDirection = { x: 1, y: 0, z: 0 };
      b.selectedSlotIndex = 3;
      world.afterEvents.itemUse.emit({ source: b, itemStack: new ItemStack("minecraft:feather") });
      expect(b.knockbacks).toEqual([{ x: config.leap.horizontal, z: 0, vertical: config.leap.vertical }]);
      expect(ids(b)).not.toContain("1 feather");
      world.afterEvents.itemUse.emit({ source: b, itemStack: new ItemStack("minecraft:feather") });
      expect(b.knockbacks).toHaveLength(1);
      await ticks(config.respawn.delaySeconds * 20 + 2);
      expect(ids(a)).toContain("8 snowball");
      game.finish({ kind: "draw", reason: "test over" });
    });
    expect(world.chat.some((line) => line.includes(OWN_HOLE))).toBe(false);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("keeps placed blocks all match by default, never lets a block go over a hole, and clears them each round when set", async () => {
    for (const [settings, kept] of [[{}, true], [{ blocks: "clear" }, false]] as const) {
      const { a, b, baseline, game, kits } = await begin(settings);
      await playToEnd(game, harness.root, baseline, async () => {
        await pickAndStart(game, kits);
        const [red, blue] = byTeam(game, a, b);
        const wool = `minecraft:${game.teamOf(red.name)!.id}_wool`;
        expect(world.placeBlock(red, { x: 0, y: 64, z: 0 }, "Up", wool)).toBe(true);
        expect(world.placeBlock(red, { x: -20, y: 64, z: 0 }, "Up", wool)).toBe(false); // red's own spawn guard
        expect(world.placeBlock(blue, { x: 25, y: 90, z: 0 }, "Up", wool)).toBe(false); // above blue's hole
        red.location = { ...BLUE_HOLE, y: 63 };
        await ticks(3);
        expect(world.overworld.blocks.has("0,65,0")).toBe(kept);
        game.finish({ kind: "draw", reason: "test over" });
      });
      expectBaseline(harness.root, baseline);
      everyoneLeaves();
    }
  });
});

function holesLeft(): number {
  return world.overworld.spawned.filter((mob) => mob.typeId === HOLE && mob.isValid).length;
}
