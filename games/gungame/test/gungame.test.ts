// Gun Game against the fake world, on a ring of 10 spawns: the ladder (a kill with the weapon you're
// on moves you up, a shot from an old one doesn't), the win with the last weapon, melee hits and
// melee deaths, dying by yourself, late joiners, time up, and the short ladder.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ARSENAL_GUN_DEFS, arsenalItem, arsenalItemName } from "@minecade/guns/defs";
import { mapRequirements, runtimeMapConfig, stripColors, uncoveredRequirements, validateMapConfig, type MapConfig, type MapPosition } from "@minecade/minigame-core/config";
import { EntitySwingSource, ItemStack, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { createHarness, everyoneLeaves, expectBaseline, playToEnd, snapshot, statsRows, ticks, type Harness } from "../../../packages/minigame-core/test/game-harness.ts";
import { countCodes } from "../../../packages/minigame-core/src/hud.ts";
import { validateGameConfig } from "../../../tools/build/validate.ts";
import quiver from "../../quiver/game.config.ts";
import config from "../game.config.ts";
import { GunGame, Ladder, MELEE_VERBS, ladderWeapons, timeUpLeader } from "../behavior_pack/scripts/gungame.ts";

const ARROW = "minecraft:arrow";
const SWORD = "minecraft:netherite_sword";
const PISTOL = arsenalItem("handgun");
/** Ten spawns on a ring 12 blocks out. */
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
/** Back in, and past the spawn protection. */
const BACK_TICKS = RESPAWN_TICKS + config.respawn.protectSeconds * 20;
const FULL = config.ladders.full;

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
  const game = new GunGame(harness.context(names, RANGE, options.settings), { ...config, ...options.overrides });
  return { players, baseline, from, game };
}

/** `shooter` stands at the middle looking level (east) at `target`, 3 blocks off: close enough that the Pistol's hip spread stays on the head. */
function lineUp(shooter: FakePlayer, target: FakePlayer): void {
  shooter.location = { x: 0.5, y: 65, z: 0.5 };
  target.location = { x: 3.5, y: 65, z: 0.5 };
  shooter.viewDirection = { x: 1, y: 0, z: 0 };
}

const click = (player: FakePlayer) =>
  world.afterEvents.playerSwingStart.emit({ player, heldItemStack: player.inventory.slots[player.selectedSlotIndex], swingSource: EntitySwingSource.Attack });
const slot = (player: FakePlayer, index: number) => player.inventory.slots[index];
const hold = (player: FakePlayer, item: string) => {
  player.inventory.slots[0] = new ItemStack(item, 1);
  player.selectedSlotIndex = 0;
};
const chat = (from = 0) => world.chat.slice(from).map(stripColors);

describe("Gun Game's config", () => {
  it("passes the build's checks, and plays every One in the Quiver map: Quiver asks at least what it asks of a map", () => {
    expect(validateGameConfig(config, "gungame")).toEqual([]);
    const rules = { kind: "game" as const, maxPlayers: config.maxPlayers, requires: config.map };
    expect(validateMapConfig(RANGE, rules)).toEqual([]);
    const needs = mapRequirements(config.map, { kind: "game", maxPlayers: config.maxPlayers });
    const quiverHas = mapRequirements(quiver.map, { kind: "game", maxPlayers: quiver.maxPlayers });
    expect(uncoveredRequirements(needs, quiverHas)).toEqual([]);
  });

  it("climbs light to heavy, the Netherite Sword last, and the lobby's Ladder setting picks the full or the short one", () => {
    expect(FULL.map(arsenalItemName)).toEqual(["Pistol", "SMG", "Assault Rifle", "Burst Rifle", "Pump Shotgun", "Double Barrel", "Sniper Rifle", "Rail Gun", "RPG", "Crossbow", "Netherite Sword"]);
    expect(config.ladders.short.map(arsenalItemName)).toEqual(["Pistol", "Assault Rifle", "Pump Shotgun", "Sniper Rifle", "RPG", "Netherite Sword"]);
    expect(config.options[0].values.map((value) => value.label)).toEqual(["11 weapons", "6 weapons"]);
    expect(ladderWeapons(config.ladders, "short")).toBe(config.ladders.short);
    expect(ladderWeapons(config.ladders, undefined)).toBe(FULL);
    expect(ladderWeapons(config.ladders, "nonsense")).toBe(FULL);
  });
});

describe("the ladder", () => {
  it("moves players up and back, never below the first, and past the last is the win", () => {
    const ladder = new Ladder(["a", "b", "c"]);
    expect(ladder.rungOf("Zed")).toBe(0);
    expect(ladder.weaponOf("Zed")).toBe("a");
    expect(ladder.down("Zed")).toBe(false);
    expect(ladder.up("zed")).toBe(false);
    expect(ladder.up("ZED")).toBe(false);
    expect(ladder.weaponOf("Zed")).toBe("c");
    expect(ladder.down("Zed")).toBe(true);
    expect(ladder.rungOf("Zed")).toBe(1);
    ladder.up("Zed");
    expect(ladder.up("Zed")).toBe(true);
    expect(ladder.weaponOf("Zed")).toBe("c");
    ladder.place("Amy", 9);
    expect(ladder.rungOf("Amy")).toBe(2);
    ladder.place("Bo", 1);
    expect(ladder.lowest(["Amy", "Bo"])).toBe(1);
    expect(ladder.lowest(["Amy", "New"])).toBe(0);
    expect(ladder.lowest([])).toBe(0);
  });

  it("gives time up to the furthest up, then the most kills, else a draw", () => {
    expect(timeUpLeader([{ name: "A", rung: 3, kills: 1 }, { name: "B", rung: 5, kills: 0 }])).toEqual({ name: "B", by: "rung" });
    expect(timeUpLeader([{ name: "A", rung: 3, kills: 4 }, { name: "B", rung: 3, kills: 6 }])).toEqual({ name: "B", by: "kills" });
    expect(timeUpLeader([{ name: "A", rung: 3, kills: 4 }, { name: "B", rung: 3, kills: 4 }])).toBeUndefined();
    expect(timeUpLeader([{ name: "A", rung: 0, kills: 0 }])).toEqual({ name: "A", by: "rung" });
    expect(timeUpLeader([])).toBeUndefined();
  });
});

describe("a match of Gun Game", () => {
  it("starts everyone on the Pistol; a kill with it moves you to the SMG, and the first kill with the Netherite Sword wins", async () => {
    const { players, baseline, from, game } = start(["A", "B", "C"]);
    const [a, b, c] = players;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      expect(game.phase).toBe("playing");
      expect(chat()).toContain("Every kill moves you to the next weapon, 11 in all. The first kill with the Netherite Sword wins.");
      // The Pistol alone, locked in the first slot and selected.
      expect(slot(a, 0)).toMatchObject({ typeId: PISTOL, lockMode: "slot" });
      expect(a.inventory.items()).toHaveLength(1);
      expect(a.selectedSlotIndex).toBe(0);

      // Three Pistol shots to the head put B down: A is on the SMG, the old gun gone a tick later.
      lineUp(a, b);
      const { everyTicks, damage } = ARSENAL_GUN_DEFS.handgun;
      for (let shot = 0; shot < Math.ceil(20 / damage.head); shot++) {
        if (shot > 0) await ticks(everyTicks);
        click(a);
      }
      await ticks(2);
      expect(game.roster.get("B")?.state).toBe("respawning");
      expect(game.ladder.rungOf("A")).toBe(1);
      expect(stripColors(a.messages.join("\n"))).toContain("Next: the SMG (2 of 11)");
      expect(slot(a, 0)).toMatchObject({ typeId: arsenalItem("smg"), lockMode: "slot" });
      expect(a.inventory.items()).toHaveLength(1);
      await ticks(10);
      // How far up, top right in the skull box.
      expect(a.actionBar.endsWith(countCodes(1))).toBe(true);
      expect(c.actionBar.endsWith(countCodes(0))).toBe(true);
      expect(world.scoreboard.sidebar).toBeUndefined();
      // B comes back on the Pistol, nothing lost.
      await ticks(RESPAWN_TICKS);
      expect(game.roster.get("B")?.state).toBe("alive");
      expect(slot(b, 0)?.typeId).toBe(PISTOL);
      expect(game.ladder.rungOf("B")).toBe(0);

      // On the last weapon: everyone hears it.
      game.ladder.place("A", game.ladder.top - 1);
      world.hurt(c, 9, "projectile", { attacker: a, projectile: ARROW });
      await ticks(2);
      expect(game.ladder.rungOf("A")).toBe(game.ladder.top);
      expect(chat()).toContain("A is on the Netherite Sword: one kill to win!");
      expect(slot(a, 0)?.typeId).toBe(SWORD);
      // A kill by a shot from an old weapon doesn't count: an arrow from the crossbow A was on.
      await ticks(BACK_TICKS);
      world.hurt(c, 9, "projectile", { attacker: a, projectile: ARROW });
      await ticks(2);
      expect(game.roster.get("C")?.state).toBe("respawning");
      expect(game.ladder.rungOf("A")).toBe(game.ladder.top);
      expect(game.phase).toBe("playing");
      // The sword kills in one hit, and that kill wins.
      await ticks(BACK_TICKS);
      world.melee(a, b, 8);
      await ticks(2);
    });
    expect(result).toMatchObject({ kind: "win", players: ["A"], reason: "first to a kill with the Netherite Sword" });
    expect(statsRows(harness.sent, from).find((row) => row.n === "A")).toMatchObject({ k: 4 });
    expect(statsRows(harness.sent, from).find((row) => row.n === "A")?.x?.headshots).toBe(3);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("a melee hit (a fist or a bash) takes a quarter of a full health, and a melee death puts the victim back one; the killer stays", async () => {
    const { players, baseline, game } = start(["A", "B", "C"]);
    const [, b, c] = players;
    const chatFrom = world.chat.length;
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      game.ladder.place("C", 2);
      // B bashes with the Pistol in hand.
      expect(slot(b, 0)?.typeId).toBe(PISTOL);
      for (let hit = 1; hit < config.meleeHits; hit++) {
        world.melee(b, c, 1);
        expect(c.health.currentValue).toBe(20 - hit * 5);
      }
      world.melee(b, c, 1);
      await ticks(2);
      expect(game.roster.get("C")?.state).toBe("respawning");
      expect(game.ladder.rungOf("C")).toBe(1);
      expect(game.ladder.rungOf("B")).toBe(0);
      expect(stripColors(c.messages.join("\n"))).toContain("Back to the SMG.");
      const line = chat(chatFrom).find((text) => text.startsWith("C was"));
      expect(line).toMatch(new RegExp(`^C was (${MELEE_VERBS.join("|")}) by B \\(back one weapon\\)$`));
      // C comes back on the SMG.
      await ticks(RESPAWN_TICKS);
      expect(slot(c, 0)?.typeId).toBe(arsenalItem("smg"));
      world.leave("A");
      world.leave("C");
      await ticks(3);
    });
    everyoneLeaves();
  });

  it("dying by yourself puts you back one (not below the first); leaving costs nothing", async () => {
    const { players, baseline, game } = start(["A", "B", "C"]);
    const [a, b] = players;
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      const chatFrom = world.chat.length;
      game.ladder.place("A", 3);
      a.location = { x: 0.5, y: 45, z: 0.5 };
      b.location = { x: 5.5, y: 45, z: 0.5 };
      await ticks(3);
      expect(game.roster.get("A")?.state).toBe("respawning");
      expect(game.ladder.rungOf("A")).toBe(2);
      expect(game.ladder.rungOf("B")).toBe(0);
      const lines = chat(chatFrom);
      expect(lines.find((text) => text.startsWith("A "))).toMatch(/\(back one weapon\)$/);
      expect(lines.find((text) => text.startsWith("B "))).not.toMatch(/back one weapon/);
      expect(stripColors(a.messages.join("\n"))).toContain("Back to the Assault Rifle.");
      await ticks(RESPAWN_TICKS);
      expect(slot(a, 0)?.typeId).toBe(arsenalItem("assault_rifle"));
      game.ladder.place("C", 4);
      world.leave("C");
      await ticks(2);
      expect(game.ladder.rungOf("C")).toBe(4);
      world.leave("B");
      await ticks(3);
    });
    everyoneLeaves();
  });

  it("a late arrival starts on the lowest weapon anyone's on", async () => {
    const { baseline, game } = start(["A", "B"]);
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      game.ladder.place("A", 3);
      game.ladder.place("B", 5);
      const late = world.join("Late");
      await ticks(12);
      expect(game.roster.get("Late")?.state).toBe("alive");
      expect(game.ladder.rungOf("Late")).toBe(3);
      expect(slot(late, 0)?.typeId).toBe(FULL[3]);
      expect(late.actionBar.endsWith(countCodes(3))).toBe(true);
      world.leave("B");
      world.leave("Late");
      await ticks(3);
    });
    everyoneLeaves();
  });

  it("when time runs out, the furthest up wins, then the most kills", async () => {
    const { players, baseline, game } = start(["A", "B", "C"], { overrides: { timeLimitSeconds: 3 } });
    const [a, , c] = players;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      game.ladder.place("A", 2);
      game.ladder.place("B", 2);
      // A melee kill: a kill in the stats, but no move up.
      for (let hit = 0; hit < config.meleeHits; hit++) world.melee(a, c, 1);
      await ticks(3 * 20);
    });
    expect(result).toMatchObject({ kind: "win", players: ["A"], reason: "the most kills when time ran out" });
    expect(game.ladder.rungOf("A")).toBe(2);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("the lobby's short ladder climbs 6 weapons", async () => {
    const { players, baseline, game } = start(["A", "B"], { settings: { ladder: "short" } });
    const [a, b] = players;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      expect(game.ladder.weapons).toEqual(config.ladders.short);
      expect(chat()).toContain("Every kill moves you to the next weapon, 6 in all. The first kill with the Netherite Sword wins.");
      game.ladder.place("A", game.ladder.top);
      hold(a, SWORD);
      world.melee(a, b, 8);
      await ticks(2);
    });
    expect(result).toMatchObject({ kind: "win", players: ["A"] });
    everyoneLeaves();
  });
});
