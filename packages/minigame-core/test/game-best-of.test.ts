// Best-of rounds, the kit form and building, end to end against the fake world: a two-team best of
// 3 whose players pick a kit before every round, with a base kit in team colors.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameConfig } from "../src/config.ts";
import { Minigame } from "../src/game/minigame.ts";
import type { MapConfig } from "../src/map-config.ts";
import { world, type FakePlayer } from "./fake-mc-server.ts";
import { liveForms, openLiveForm } from "./fake-mc-server-ui.ts";
import { createHarness, everyoneLeaves, expectBaseline, playToEnd, snapshot, ticks, type Harness } from "./game-harness.ts";

class TestGame extends Minigame {}

const DUEL: MapConfig = {
  name: "Duel",
  spawns: [[0, 65, 0]],
  teamSpawns: { red: [[-10, 65, 0]], blue: [[10, 65, 0]] },
  spectatorSpawn: [0, 75, 0],
  bounds: { min: [-20, 40, -20], max: [20, 100, 20] },
  killY: 50,
  regions: { "guard.red": [{ min: [-12, 60, -2], max: [-8, 70, 2] }] },
};

const CONFIG: GameConfig = {
  id: "duel",
  name: "Duel",
  minPlayers: 2,
  maxPlayers: 2,
  countdownSeconds: 3,
  endDelaySeconds: 1,
  timeLimitSeconds: 600,
  teams: { count: 2 },
  respawn: { mode: "unlimited", delaySeconds: 1 },
  bestOf: { rounds: 3 },
  kits: {
    select: "round",
    base: { id: "base", name: "Base", items: [{ item: "minecraft:{color}_wool", count: 64 }] },
    list: [
      { id: "snow", name: "Snowballs", refill: "round", items: [{ item: "minecraft:snowball", count: 8 }] },
      { id: "leap", name: "Leap", refill: "round", items: [{ item: "minecraft:feather", name: "Leap" }] },
    ],
  },
  build: { noBuild: ["guard"] },
};

let harness: Harness;

beforeAll(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
});

const items = (player: FakePlayer) => player.inventory.items().map((item) => `${item.amount} ${item.typeId}`);

describe("a best-of team game with kits every round and building", () => {
  it("picks kits at the team spawns, keeps round kits through a respawn, builds by the rules and wins 2 rounds to 0", async () => {
    const [a, b] = [world.join("A"), world.join("B")];
    const baseline = snapshot(harness.root);
    // Teams: Random from the lobby, so teams are dealt before the kit form.
    const game = new TestGame(harness.context(["A", "B"], DUEL, { teams: "random" }), CONFIG);
    let aTeam = "";

    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(2);
      expect(game.phase).toBe("picking");
      // Each waits at their own team's spawn, frozen, with the form open.
      const aRed = a.location.x < 0;
      aTeam = aRed ? "red" : "blue";
      const [aWool, aColor] = aRed ? ["minecraft:red_wool", "c"] : ["minecraft:blue_wool", "9"];
      expect([a.location.x, b.location.x]).toEqual(aRed ? [-9.5, 10.5] : [10.5, -9.5]);
      expect(a.unlocked).toBe(false);
      // Each kit's items as text (this game has no pictures) over a button with its name, and not
      // the base kit everyone gets.
      const texts = openLiveForm("A")!.texts();
      expect(texts).toEqual(expect.arrayContaining(["§78x Snowball", "Snowballs", "Leap"]));
      expect(texts.join("\n")).not.toContain("Wool");

      openLiveForm("A")!.click("Snowballs");
      openLiveForm("B")!.click("Leap");
      await ticks(6);
      expect(game.phase).toBe("countdown");
      await ticks(3 * 20 + 5);
      expect(game.phase).toBe("playing");
      expect(a.gameMode).toBe("Survival");
      expect(items(a)).toEqual([`64 ${aWool}`, "8 minecraft:snowball"]);
      expect(b.inventory.items().map((item) => item.typeId)).toEqual([aRed ? "minecraft:blue_wool" : "minecraft:red_wool", "minecraft:feather"]);
      expect(b.inventory.items()[1].nameTag).toBe("Leap");
      await ticks(10);
      expect(a.actionBar).toContain("§k§i§3§r"); // three white circles
      expect(a.actionBar).toMatch(/^§r§m§c§r§f(10:00|9:5\d)/); // the clock over all the rounds

      // A throws three snowballs, then goes down: they come back with five, and their wool.
      a.inventory.slots[1]!.amount = 5;
      world.hurt(a, 25, "entityAttack", { attacker: b });
      await ticks(25);
      expect(items(a)).toEqual([`64 ${aWool}`, "5 minecraft:snowball"]);

      // Building: inside the bounds, never in a guard region, and only placed blocks break (nothing drops).
      expect(world.placeBlock(a, { x: 0, y: 64, z: 0 }, "Up", aWool)).toBe(true);
      expect(game.build?.placedCount).toBe(1);
      expect(world.placeBlock(a, { x: -10, y: 64, z: 0 }, "Up", aWool)).toBe(false); // the red guard, whoever builds
      expect(world.placeBlock(a, { x: 0, y: 100, z: 0 }, "Up", aWool)).toBe(false); // above the bounds
      world.overworld.blocks.set("5,60,0", "minecraft:stone");
      expect(world.breakBlock(b, { x: 5, y: 60, z: 0 })).toBe(false);
      expect(world.overworld.blocks.get("5,60,0")).toBe("minecraft:stone");
      expect(world.breakBlock(b, { x: 0, y: 65, z: 0 })).toBe(false); // canceled, then removed without a drop
      await ticks(1);
      expect(world.overworld.blocks.has("0,65,0")).toBe(false);
      expect(game.build?.placedCount).toBe(0);

      // A's team scores: a short break, then everyone picks again.
      game.endRound(game.teamWins(aTeam, "A scored"));
      await ticks(41);
      expect(openLiveForm("A")).toBeDefined();
      expect(items(a)).toEqual([`64 ${aWool}`]); // the round's kit comes with the pick
      openLiveForm("A")!.click("Leap");
      openLiveForm("B")!.click("Snowballs");
      await ticks(6);
      expect(items(a)).toEqual([`64 ${aWool}`, "1 minecraft:feather"]);
      expect(items(b)).toContain("8 minecraft:snowball");
      await ticks(3 * 20 + 10);
      expect(game.roundInPlay).toBe(true);
      expect(a.actionBar).toContain(`§k§i§3§k§j§1§${aColor}§r`); // circle 1 in the winner's color
      expect(a.titles.some((title) => title.includes("wins round 1"))).toBe(true);

      game.endRound(game.teamWins(aTeam, "A scored"));
      await ticks(2);
    });

    expect(result).toMatchObject({ kind: "win", team: aTeam, players: ["A"], reason: "won 2 rounds" });
    expect(game.bestOf?.history).toHaveLength(2);
    expect(liveForms.filter((form) => form.isShowing())).toEqual([]);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });
  it("plays elimination rounds: the last team standing takes a round, and the match goes on to the next", async () => {
    const [a, b] = [world.join("A"), world.join("B")];
    const baseline = snapshot(harness.root);
    const config: GameConfig = { ...CONFIG, respawn: { mode: "none" }, kits: undefined, build: undefined };
    const game = new TestGame(harness.context(["A", "B"], DUEL, { teams: "random" }), config);
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(2 + 3 * 20 + 5);
      expect(game.roundInPlay).toBe(true);
      world.hurt(b, 25, "entityAttack", { attacker: a });
      await ticks(2);
      expect(game.roster.get("B")?.state).toBe("out");
      expect(game.roundInPlay).toBe(false);
      // The break, with B still out: once-a-second win checks don't end the match.
      await ticks(40 + 3 * 20 + 5);
      expect(game.bestOf?.history).toHaveLength(1);
      expect(game.roundInPlay).toBe(true);
      expect(game.roster.get("B")?.state).toBe("alive");
      world.hurt(b, 25, "entityAttack", { attacker: a });
      await ticks(2);
    });
    expect(result).toMatchObject({ kind: "win", team: game.teamOf("A")?.id, reason: "won 2 rounds" });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });
});
