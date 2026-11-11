// Chameleon against the fake world, on a small yard: A seeks (the lobby's pick), B and C hide. The
// seekers wait blinded through the hide, then shoot the hiders down with a Pump Shotgun that never
// runs out; a hider shot down joins the seekers, and the seekers win when nobody is left hiding.
// The hiders win when the clock runs out. A hider's hit throws a seeker and takes half a heart,
// never the last; the Detector says how near the nearest hider is.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ARSENAL_GUN_DEFS, arsenalItem } from "@minecade/guns/defs";
import { runtimeMapConfig, stripColors, validateMapConfig, type MapConfig } from "@minecade/minigame-core/config";
import { system, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { createHarness, everyoneLeaves, expectBaseline, playToEnd, snapshot, ticks, type Harness } from "../../../packages/minigame-core/test/game-harness.ts";
import { validateGameConfig } from "../../../tools/build/validate.ts";
import { chameleonItemFiles } from "../../../tools/assets/chameleon-items.ts";
import { ABILITY_ITEMS } from "../behavior_pack/scripts/abilities.ts";
import config from "../game.config.ts";
import {
  Chameleon,
  HIDE_STAGE,
  PACK_EVENTS,
  STAND_IN,
  STAND_IN_OWNER,
  cooldownBar,
  detectorBand,
  hiderHitDamage,
  pointsToNextLevel,
} from "../behavior_pack/scripts/chameleon.ts";

const HIDE_SECONDS = 10;
const YARD: MapConfig = runtimeMapConfig({
  name: "Yard",
  spawns: [[0, 65, 0]],
  spectatorSpawn: [0, 80, 0],
  teamSpawns: { seekers: [[-10, 65, 0]], hiders: [[10, 65, 0], [10, 65, 2]] },
  bounds: { min: [-30, 40, -30], max: [30, 100, 30] },
  hideSeconds: HIDE_SECONDS,
});
const COUNTDOWN_TICKS = config.countdownSeconds * 20 + 5;
const HIDE_TICKS = HIDE_SECONDS * 20 + 5;
const RESPAWN_TICKS = config.respawn.delaySeconds * 20 + 2;
const SHOTGUN = arsenalItem("pump_shotgun");
const DETECTOR = "minecade:chameleon_detector";
const MOVEMENT = 2;

let harness: Harness;

beforeAll(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
});

/** A match in the yard: A seeks (picked in the lobby), B and C hide. */
function begin(names = ["A", "B", "C"], picks: Record<string, string> = { A: "seekers" }) {
  everyoneLeaves();
  const players = names.map((name) => world.join(name));
  const baseline = snapshot(harness.root);
  const context = harness.context(names, YARD);
  // Alone takes DEV_MIN_PLAYERS=1, as on a server.
  if (names.length === 1) context.vars.devMinPlayers = 1;
  const game = new Chameleon(context, config);
  game.setTeamPicks(picks);
  return { players, baseline, game };
}

/** `shooter` stands 2 blocks west of `target`, looking at them, holding what's in `slot`. */
function lineUp(shooter: FakePlayer, target: { location: { x: number; y: number; z: number } }, slot = 0): void {
  target.location = { x: 3.5, y: 65, z: 0.5 };
  shooter.location = { x: 1.5, y: 65, z: 0.5 };
  shooter.viewDirection = { x: 1, y: 0, z: 0 };
  shooter.selectedSlotIndex = slot;
}

/** A right click with what's in the hand. */
function use(player: FakePlayer): void {
  const itemStack = player.inventory.slots[player.selectedSlotIndex]!;
  world.afterEvents.itemUse.emit({ source: player, itemStack });
  world.afterEvents.itemReleaseUse.emit({ source: player, itemStack, useDuration: 0 });
}

/** Shotgun blasts at whoever `shooter` faces until `name` is down (at most 6). */
async function shootDown(game: Chameleon, shooter: FakePlayer, name: string): Promise<void> {
  for (let shot = 0; shot < 6 && game.roster.get(name)?.state === "alive"; shot++) {
    use(shooter);
    await ticks(ARSENAL_GUN_DEFS.pump_shotgun.everyTicks + 1);
  }
}

const sent = (id: string) => system.scriptEventsSent.filter((event) => event.id === id).map((event) => event.message);
const text = (player: FakePlayer) => stripColors(player.messages.join("\n"));

describe("Chameleon's ability items", () => {
  it("hands out its own items with icons, one per ability, named as the chameleon pack knows them", () => {
    expect(ABILITY_ITEMS.map((item) => `${item.item} ${item.name}`)).toEqual([
      "minecade:chameleon_wear_block Wear block",
      "minecade:chameleon_pose Pose",
      "minecade:chameleon_lock Lock position",
      "minecade:chameleon_taunt Taunt",
      "minecade:chameleon_free_look Free look",
      "minecade:chameleon_detector Detector",
    ]);
    const handed = [...config.hotbars.hiders, ...config.hotbars.seekers].map((entry) => entry.item);
    for (const item of ABILITY_ITEMS) expect(handed).toContain(item.item);
    // The map editor's mannequins hold only what Edit mode loads: the shotgun.
    expect(config.mannequinItems).toEqual([SHOTGUN]);
  });

  it("match what tools/assets/chameleon-items.ts writes (rerun it after changing abilities.ts or an icon)", () => {
    for (const [path, content] of Object.entries(chameleonItemFiles())) {
      const file = fileURLToPath(new URL(`../${path}`, import.meta.url));
      expect(existsSync(file), path).toBe(true);
      const disk = readFileSync(file);
      if (typeof content === "string") expect(disk.toString("utf8").replace(/\r\n/g, "\n"), path).toBe(content);
      else expect(disk.equals(content), path).toBe(true);
    }
  });
});

describe("Chameleon's config", () => {
  it("passes the build's checks, and a map needs the seekers' and the hiders' spawns", () => {
    expect(validateGameConfig(config, "chameleon")).toEqual([]);
    const rules = { kind: "game" as const, maxPlayers: config.maxPlayers, requires: config.map };
    expect(validateMapConfig(YARD, rules)).toEqual([]);
    const { teamSpawns: _spawns, ...bare } = YARD;
    expect(validateMapConfig(bare, rules).join("\n")).toMatch(/spawn/i);
    expect(validateMapConfig({ ...YARD, hideSeconds: 500 }, rules).join("\n")).toMatch(/hideSeconds/);
    expect(config.map.settings.hideSeconds.default).toBe(30);
  });

  it("takes half a heart unless it's the last, picks the Detector's band, and draws a cooldown on the experience bar", () => {
    expect(hiderHitDamage(20, 1)).toBe(1);
    expect(hiderHitDamage(2, 1)).toBe(1);
    expect(hiderHitDamage(1.5, 1)).toBe(0);
    const { bands } = config.detector;
    expect(detectorBand(bands, 3).word).toBe("Hot");
    expect(detectorBand(bands, 8).word).toBe("Hot");
    expect(detectorBand(bands, 12).word).toBe("Warm");
    expect(detectorBand(bands, 20).word).toBe("Cool");
    expect(detectorBand(bands, 500).word).toBe("Cold");
    // Just used: 10 seconds as the level, the bar all but full; nearly done: 1, nearly empty; done: nothing.
    expect(cooldownBar(200, 200)).toEqual({ level: 10, points: pointsToNextLevel(10) - 1 });
    expect(cooldownBar(10, 200)).toEqual({ level: 1, points: 0 });
    expect(cooldownBar(0, 200)).toEqual({ level: 0, points: 0 });
  });
});

describe("Chameleon", () => {
  it("holds the seeker blind through the hide, then a found hider joins the seekers, and finding everyone wins", async () => {
    const { players, baseline, game } = begin();
    const [a, b, c] = players;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      expect(game.phase).toBe("playing");
      expect(sent(PACK_EVENTS.match)).toHaveLength(1);
      expect(game.teamOf("A")?.id).toBe("seekers");
      expect(game.teamOf("B")?.id).toBe("hiders");
      // Each side's hotbar, named and locked in its slot; hiders are weak.
      expect(a.inventory.slots[0]).toMatchObject({ typeId: SHOTGUN, lockMode: "slot" });
      expect(a.inventory.slots[1]).toMatchObject({ typeId: DETECTOR, nameTag: "Detector", lockMode: "slot" });
      expect(b.inventory.slots[0]).toBeUndefined();
      expect(b.inventory.slots[1]).toMatchObject({ typeId: "minecade:chameleon_wear_block", nameTag: "Wear block", lockMode: "slot" });
      expect(b.inventory.slots[8]).toMatchObject({ typeId: "minecade:chameleon_free_look", nameTag: "Free look" });
      expect(b.effects.has("weakness")).toBe(true);
      expect(a.effects.has("weakness")).toBe(false);

      // The hide: A can't move, can't see, and can't shoot; a hider's hit doesn't count either.
      expect(game.activeStage?.name).toBe(HIDE_STAGE);
      expect(a.inputPermissions.isPermissionCategoryEnabled(MOVEMENT)).toBe(false);
      expect(a.effects.has("blindness")).toBe(true);
      lineUp(a, b);
      use(a);
      await ticks(2);
      expect(b.health.currentValue).toBe(20);
      world.melee(b, a);
      expect(a.health.currentValue).toBe(20);
      expect(a.knockbacks).toHaveLength(0);

      // The seek: A is free and can see.
      await ticks(HIDE_TICKS);
      expect(game.activeStage?.name).toBe("Seek");
      expect(a.inputPermissions.isPermissionCategoryEnabled(MOVEMENT)).toBe(true);
      expect(a.effects.has("blindness")).toBe(false);
      expect(a.titles.some((title) => stripColors(title).startsWith("Ready or not!"))).toBe(true);
      await ticks(10);
      expect(stripColors(a.actionBar)).toContain("2 hiders left");

      // B hits A: thrown the way B faces, half a heart; again at once, nothing more until the pause is over.
      b.rotation = { x: 0, y: -90 };
      world.melee(b, a);
      expect(a.health.currentValue).toBe(19);
      expect(a.knockbacks).toHaveLength(1);
      expect(a.knockbacks[0].x).toBeCloseTo(config.hiderHit.horizontal);
      world.melee(b, a);
      expect(a.knockbacks).toHaveLength(1);
      // Never the last half heart; and a seeker's own hit finds nobody.
      await ticks(config.hiderHit.pauseTicks);
      a.health.setCurrentValue(1);
      world.melee(b, a);
      expect(a.health.currentValue).toBe(1);
      a.health.setCurrentValue(20);
      world.melee(a, b);
      expect(b.health.currentValue).toBe(20);

      // The Detector: B is 2 blocks off, so it's hot; at once again, nothing, and the wait shows over the hotbar.
      lineUp(a, b, 1);
      c.location = { x: 25, y: 65, z: 0 };
      use(a);
      expect(text(a)).toContain("Hot: a hider is within 8 blocks");
      use(a);
      expect(text(a).match(/Hot:/g)).toHaveLength(1);
      await ticks(4);
      expect(a.level).toBe(config.detector.cooldownSeconds);
      expect(a.xp).toBeGreaterThan(0);

      // A shoots B down: found, out of the hiders' costume, and a seeker 3 seconds later.
      lineUp(a, b);
      await shootDown(game, a, "B");
      expect(game.roster.get("B")?.state).toBe("respawning");
      expect(game.teamOf("B")?.id).toBe("seekers");
      expect(sent(PACK_EVENTS.out)).toEqual(["B"]);
      expect(text(b)).toContain("You were found! You're a seeker now.");
      expect(stripColors(world.chat.join("\n"))).toContain("B was found by A");
      await ticks(RESPAWN_TICKS);
      expect(game.roster.get("B")?.state).toBe("alive");
      expect(b.inventory.slots[0]?.typeId).toBe(SHOTGUN);
      expect(b.effects.has("weakness")).toBe(false);

      // C in free look: the stand-in is what gets shot (past A, in the way: shots pass through seekers), and C is
      // brought back to it. Shot down, nobody is left hiding.
      c.gameMode = "Spectator";
      c.location = { x: 0, y: 90, z: 0 };
      const standIn = world.getDimension("overworld").spawnEntity(STAND_IN, { x: 3.5, y: 65, z: 0.5 });
      standIn.addTag(`${STAND_IN_OWNER}C`);
      lineUp(b, standIn);
      await shootDown(game, b, "C");
      expect(sent(PACK_EVENTS.back)).toContain("C");
      expect(game.roster.get("C")?.state).not.toBe("alive");
      await ticks(2);
    });
    expect(result).toMatchObject({ kind: "win", team: "seekers", reason: "found every hider" });
    expectBaseline(harness.root, baseline);
  });

  it("gives the match to the hiders when the clock runs out with any of them hidden", async () => {
    const { baseline, game } = begin();
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS + HIDE_TICKS + config.timeLimitSeconds * 20 + 5);
    });
    expect(result).toMatchObject({ kind: "win", team: "hiders" });
    expectBaseline(harness.root, baseline);
  });

  it("makes a player alone a hider, and plays on until the clock runs out", async () => {
    const { players, baseline, game } = begin(["Solo"], {});
    const [solo] = players;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      expect(game.teamOf("Solo")?.id).toBe("hiders");
      expect(solo.inventory.slots[1]?.nameTag).toBe("Wear block");
      await ticks(HIDE_TICKS + 40);
      expect(game.phase).toBe("playing");
      game.finish({ kind: "draw", reason: "test over" });
    });
    expect(result?.kind).toBe("draw");
    expectBaseline(harness.root, baseline);
  });
});

