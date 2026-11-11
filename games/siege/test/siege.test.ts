// Siege against the fake world, on a small fort map with two players a team (the lobby's picks put
// A and B on Red, C and D on Blue). Everyone picks a class before every round, the last team
// standing takes each round, a round out of time goes to the team with more players standing (then
// more health), and each class's ability does what it says.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { matchKits, runtimeMapConfig, stripColors, validateMapConfig, type MapConfig } from "@minecade/minigame-core/config";
import { ItemStack, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { openLiveForm } from "../../../packages/minigame-core/test/fake-mc-server-ui.ts";
import { createHarness, everyoneLeaves, expectBaseline, playToEnd, snapshot, statsRows, ticks, type Harness } from "../../../packages/minigame-core/test/game-harness.ts";
import { validateGameConfig } from "../../../tools/build/validate.ts";
import config from "../game.config.ts";
import { Siege, WATER, fan, timeUpWinner } from "../behavior_pack/scripts/siege.ts";

const FORT: MapConfig = runtimeMapConfig({
  name: "Fort",
  spawns: [[0, 65, 0]],
  spectatorSpawn: [0, 80, 0],
  teamSpawns: { red: [[-10, 65, 0], [-10, 65, 2]], blue: [[10, 65, 0], [10, 65, 2]] },
  bounds: { min: [-30, 40, -30], max: [30, 100, 30] },
  // Gunfight's flag: Siege's maps carry it for Gunfight, which plays them too.
  points: { flag: [[0, 65, 0]] },
});
const NAMES = ["A", "B", "C", "D"];
const COUNTDOWN_TICKS = config.countdownSeconds * 20 + 5;
/** A round's break, before the class form comes back. */
const BREAK_TICKS = 42;
/** The class form closing, then the next round's frozen countdown. */
const ROUND_COUNTDOWN_TICKS = 6 + 3 * 20 + 5;
const ROUND_TICKS = config.bestOf.roundSeconds * 20;

let harness: Harness;

beforeAll(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
});

/** A match on the fort: A and B on Red, C and D on Blue, by the lobby's team picks. */
function begin(settings: Record<string, string> = {}) {
  const [a, b, c, d] = NAMES.map((name) => world.join(name));
  const baseline = snapshot(harness.root);
  const from = harness.sent.length;
  const game = new Siege(harness.context(NAMES, FORT, settings), config, "pack-uuid");
  game.setTeamPicks({ A: "red", B: "red", C: "blue", D: "blue" });
  return { a, b, c, d, baseline, from, game };
}

/** Everyone picks a class (by its name on the form): before the match, then the countdown. */
async function pickAndStart(game: Siege, classes: string[]): Promise<void> {
  await ticks(2);
  expect(game.phase).toBe("picking");
  NAMES.forEach((name, index) => openLiveForm(name)!.click(classes[index]));
  await ticks(6 + COUNTDOWN_TICKS);
  expect(game.phase).toBe("playing");
}

/** After a round is decided: the class form comes back, everyone picks, and the next round starts. */
async function nextRound(game: Siege, classes: string[]): Promise<void> {
  await ticks(BREAK_TICKS);
  NAMES.forEach((name, index) => openLiveForm(name)!.click(classes[index]));
  await ticks(ROUND_COUNTDOWN_TICKS);
  expect(game.roundInPlay).toBe(true);
}

/** A player uses the item in their hand, by id. */
function use(player: FakePlayer, item: string): void {
  world.afterEvents.itemUse.emit({ source: player, itemStack: new ItemStack(item) });
}

const ids = (player: FakePlayer) => player.inventory.items().map((item) => `${item.amount} ${item.typeId.replace("minecraft:", "")}`);
const armor = (player: FakePlayer) => ["Head", "Chest", "Legs", "Feet"].map((slot) => player.equipment.get(slot)?.typeId.replace("minecraft:", ""));
const chat = () => stripColors(world.chat.join("\n"));

describe("Siege's config and map", () => {
  const rules = { kind: "game" as const, maxPlayers: config.maxPlayers, requires: config.map, teams: [{ id: "red", name: "Red" }, { id: "blue", name: "Blue" }], mapKits: config.kits.mapKits };

  it("passes the build's checks, needs team spawns and bounds, and every class has its ability in the last slot", () => {
    expect(validateGameConfig(config, "siege")).toEqual([]);
    expect(validateMapConfig(FORT, rules)).toEqual([]);
    const missing = validateMapConfig({ ...FORT, teamSpawns: {}, bounds: undefined }, rules);
    expect(missing.join("\n")).toMatch(/teamSpawns/);
    expect(missing.join("\n")).toMatch(/bounds/);
    // Gunfight's flag, which Siege itself never uses.
    expect(validateMapConfig({ ...FORT, points: {} }, rules).join("\n")).toMatch(/flag/);
    expect(config.kits.list.map((kit) => kit.id)).toEqual(Object.keys(config.abilities));
    for (const kit of config.kits.list) expect(kit.items.filter((item) => item.slot === config.abilitySlot), kit.id).toHaveLength(1);
  });

  it("keeps the classes the same on every map: a map's own kits are refused, and never used", () => {
    const own = { mode: "replace" as const, list: [{ id: "pirate", name: "Pirate", items: [{ item: "minecraft:iron_sword" }] }] };
    expect(validateMapConfig({ ...FORT, kits: own }, rules)).toEqual([`"kits": this game's kits are the same on every map`]);
    expect(matchKits(config.kits, own).list.map((kit) => kit.id)).toEqual(config.kits.list.map((kit) => kit.id));
  });

  it("fans a Volley around the look, and gives a round out of time to more players standing, then more health", () => {
    const arrows = fan({ x: 0, y: 0, z: 2 }, 5, 10);
    expect(arrows[2]).toEqual({ x: 0, y: 0, z: 1 });
    const round = (value: number) => Math.round(value * 1000) / 1000;
    expect(arrows.map((arrow) => round(Math.atan2(arrow.x, arrow.z) * (180 / Math.PI)) + 0)).toEqual([20, 10, 0, -10, -20]);
    expect(arrows.every((arrow) => round(Math.hypot(arrow.x, arrow.y, arrow.z)) === 1)).toBe(true);

    expect(timeUpWinner([{ team: "red", players: 1, health: 5 }, { team: "blue", players: 2, health: 3 }])).toEqual({ team: "blue", by: "players" });
    expect(timeUpWinner([{ team: "red", players: 2, health: 30 }, { team: "blue", players: 2, health: 31 }])).toEqual({ team: "blue", by: "health" });
    expect(timeUpWinner([{ team: "red", players: 2, health: 30 }, { team: "blue", players: 2, health: 30 }])).toBeUndefined();
  });
});

describe("a match of Siege", () => {
  it("gives each class its gear, picks again every round, and the first team to 3 rounds wins", async () => {
    const { a, b, c, d, baseline, from, game } = begin();
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await pickAndStart(game, ["Soldier", "Medic", "Seaman", "Tank"]);
      expect(game.teamOf("A")?.id).toBe("red");
      expect(game.teamOf("C")?.id).toBe("blue");
      expect(ids(a)).toEqual(["1 iron_sword", "1 blaze_powder"]);
      expect(a.inventory.getItem(config.abilitySlot)?.nameTag).toBe("Rally");
      expect(armor(a)).toEqual(["iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots"]);
      expect(ids(c)).toEqual(["1 trident", "1 heart_of_the_sea"]);
      expect(c.inventory.getItem(0)?.enchantments).toEqual(["minecraft:loyalty 3"]);
      expect(c.equipment.get("Feet")?.enchantments).toEqual(["minecraft:depth_strider 3"]);
      // Leather in the team's dye: the armor pack's blue pieces.
      expect(armor(c)).toEqual(["turtle_helmet", "minecade:blue_leather_chestplate", "chainmail_leggings", "minecade:blue_leather_boots"]);
      expect([...c.effects.keys()].sort()).toEqual(["saturation", "water_breathing"]);
      expect([...d.effects.keys()].sort()).toEqual(["saturation", "slowness"]);
      // Names show over heads in the team's color, and everyone hears what their class does.
      expect([a.nameTag, c.nameTag]).toEqual(["§cA", "§9C"]);
      expect(stripColors(a.messages.join("\n"))).toContain("Soldier: Rally gives you and teammates within 8 blocks Strength and Speed for 6 seconds. Ready every 25 seconds.");
      expect(chat()).toContain("The last team standing takes the round. Best of 5: the first to 3 rounds wins.");

      for (let round = 1; round <= 3; round++) {
        if (round > 1) await nextRound(game, ["Soldier", "Medic", round === 2 ? "Archer" : "Seaman", "Tank"]);
        expect(game.roundInPlay).toBe(true);
        world.hurt(c, 30, "entityAttack", { attacker: a });
        await ticks(1);
        expect(game.roster.get("C")?.state).toBe("out");
        expect(game.roundInPlay).toBe(true);
        world.hurt(d, 30, "entityAttack", { attacker: b });
        await ticks(2);
        expect(game.roundInPlay).toBe(false);
      }
      // A new class is told again; the same one isn't.
      expect(stripColors(c.messages.join("\n"))).toContain("Archer: Volley shoots 5 arrows at once");
      expect(a.messages.filter((line) => stripColors(line).startsWith("Soldier:"))).toHaveLength(1);
    });
    expect(result).toMatchObject({ kind: "win", team: "red", reason: "won 3 rounds" });
    expect(game.bestOf?.history).toEqual(["red", "red", "red"]);
    expect(chat()).toContain("Red wins round 3! (last one standing)");
    const rows = statsRows(harness.sent, from);
    expect(rows.find((row) => row.n === "A")).toMatchObject({ k: 3 });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("Rally, Heal, Leap and Fortify, each ready again when the level over the hotbar is back to 0", async () => {
    const { a, b, c, d, baseline, game } = begin();
    await playToEnd(game, harness.root, baseline, async () => {
      await pickAndStart(game, ["Soldier", "Medic", "Tank", "Scout"]);
      // Rally: Strength and Speed for A and B (8 blocks), not for C and D (Blue). A longer Speed
      // (a Scout's own) stays as it is.
      b.effects.set("speed", { amplifier: 0, duration: 5000 });
      use(a, "minecraft:blaze_powder");
      expect([a, b].map((player) => [player.effects.get("strength")?.duration, player.effects.get("speed")?.duration])).toEqual([
        [120, 120],
        [120, 5000],
      ]);
      expect(c.effects.has("strength")).toBe(false);
      await ticks(5);
      expect(a.level).toBe(25);
      expect(a.levelsGained.filter((level) => level % 5 === 0)).toEqual([]);
      // Too soon: a low note, and nothing happens.
      a.effects.delete("strength");
      use(a, "minecraft:blaze_powder");
      expect(a.effects.has("strength")).toBe(false);
      expect(a.sounds.map((sound) => sound.id)).toContain("note.bass");
      await ticks(25 * 20);
      expect(a.level).toBe(0);
      expect(a.sounds.map((sound) => sound.id)).toContain("random.orb");

      // Heal: 4 hearts back for B and A, never past full.
      a.health.currentValue = 16;
      b.health.currentValue = 6;
      use(b, "minecraft:glistering_melon_slice");
      expect([a.health.currentValue, b.health.currentValue]).toEqual([20, 14]);
      expect(world.overworld.particles.filter((particle) => particle.id === "minecraft:heart_particle")).toHaveLength(2);

      // Leap: a push the way the Scout looks. A Scout takes no fall damage; anyone else does.
      d.viewDirection = { x: 1, y: 0, z: 0 };
      use(d, "minecraft:feather");
      expect(d.knockbacks).toEqual([{ x: config.abilities.scout.forward, z: 0, vertical: config.abilities.scout.lift }]);
      world.hurt(d, 6, "fall");
      expect(d.health.currentValue).toBe(20);
      world.hurt(b, 2, "fall");
      expect(b.health.currentValue).toBe(12);

      // Fortify: Resistance II, and a hit doesn't push the Tank (it's canceled) but its damage comes
      // off on the next tick, once every half second.
      use(c, "minecraft:shulker_shell");
      expect(c.effects.get("resistance")).toEqual({ amplifier: 1, duration: 120 });
      world.hurt(c, 6, "entityAttack", { attacker: a });
      expect(c.health.currentValue).toBe(20);
      await ticks(1);
      expect(c.health.currentValue).toBe(14);
      world.hurt(c, 6, "entityAttack", { attacker: a });
      await ticks(1);
      expect(c.health.currentValue).toBe(14);
      await ticks(10);
      world.hurt(c, 20, "entityAttack", { attacker: a });
      await ticks(2);
      expect(game.roster.get("C")?.state).toBe("out");
      expect(chat()).toMatch(/C was \w+ by A/);
      game.finish({ kind: "draw", reason: "test over" });
    });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("water hurts all but a Seaman, who is fast in it, keeps a trident, and soaks enemies with a Tidal Wave", async () => {
    const { a, b, c, d, baseline, game } = begin();
    await playToEnd(game, harness.root, baseline, async () => {
      await pickAndStart(game, ["Seaman", "Archer", "Assassin", "Soldier"]);
      a.isInWater = true;
      d.isInWater = true;
      await ticks(20);
      expect(a.health.currentValue).toBe(20);
      expect(a.effects.get("speed")?.amplifier).toBe(config.water.seamanSpeed);
      expect(d.health.currentValue).toBe(20 - config.water.damage);
      a.isInWater = false;
      d.isInWater = false;

      // Tidal Wave: C and D, within 6 blocks, are pushed away, slowed and soaked; B, a teammate, isn't.
      a.location = { x: 0, y: 65, z: 0 };
      b.location = { x: -2, y: 65, z: 0 };
      c.location = { x: 3, y: 65, z: 0 };
      d.location = { x: 0, y: 65, z: -5 };
      use(a, "minecraft:heart_of_the_sea");
      expect(c.knockbacks).toEqual([{ x: 2, z: 0, vertical: 0.4 }]);
      expect(d.knockbacks).toEqual([{ x: 0, z: -2, vertical: 0.4 }]);
      expect(b.knockbacks).toEqual([]);
      expect(c.effects.get("slowness")?.duration).toBe(60);
      // Soaked for 3 seconds: a hit each second, wherever they are, then no more.
      const [cBefore, dBefore] = [c.health.currentValue, d.health.currentValue];
      await ticks(config.abilities.seaman.soakSeconds * 20 + 1);
      expect(cBefore - c.health.currentValue).toBe(3 * config.water.damage);
      expect(dBefore - d.health.currentValue).toBe(3 * config.water.damage);
      expect(b.health.currentValue).toBe(20);
      const soaked = d.health.currentValue;
      await ticks(40);
      expect(d.health.currentValue).toBe(soaked);

      // The trident: a thrown one that doesn't come back is replaced after 5 seconds, a returned
      // one is locked again, and a second one is taken away.
      a.inventory.setItem(0, undefined);
      await ticks(config.tridentBackSeconds * 20 + 10);
      expect(a.inventory.getItem(0)?.typeId).toBe("minecraft:trident");
      expect(a.inventory.getItem(0)?.enchantments).toEqual(["minecraft:loyalty 3"]);
      a.inventory.setItem(5, new ItemStack("minecraft:trident"));
      a.inventory.getItem(0)!.lockMode = "none";
      await ticks(10);
      expect(ids(a).filter((item) => item.endsWith("trident"))).toHaveLength(1);
      expect(a.inventory.getItem(0)?.lockMode).toBe("inventory");

      // Volley: 5 arrows, B's, shot where B looks; a landed arrow is gone.
      use(b, "minecraft:flint");
      const arrows = world.overworld.spawned.filter((mob) => mob.typeId === "minecraft:arrow");
      expect(arrows).toHaveLength(config.abilities.archer.arrows);
      expect(arrows.every((arrow) => arrow.projectile.owner === b && arrow.projectile.shot !== undefined)).toBe(true);
      const landed = world.projectileLands(b);
      expect(landed.isValid).toBe(false);

      // Vanish: no armor, no name, invisible, until C hits someone; then all of it is back.
      use(c, "minecraft:ink_sac");
      expect(armor(c)).toEqual([undefined, undefined, undefined, undefined]);
      expect(c.nameTag).toBe("");
      expect(c.effects.has("invisibility")).toBe(true);
      world.hurt(d, 1, "fall");
      expect(c.nameTag).toBe("");
      world.hurt(b, 2, "entityAttack", { attacker: c });
      expect(armor(c)).toEqual(["helmet", "chestplate", "leggings", "boots"].map((piece) => `minecade:blue_leather_${piece}`));
      expect(c.nameTag).toBe("§9C");
      expect(c.effects.has("invisibility")).toBe(false);
      // Next time it runs out by itself.
      await ticks(config.abilities.assassin.cooldownSeconds * 20);
      use(c, "minecraft:ink_sac");
      await ticks(config.abilities.assassin.seconds * 20 + 5);
      expect(c.nameTag).toBe("§9C");
      expect(armor(c)[0]).toBe("minecade:blue_leather_helmet");

      // Water with nobody to credit washes a player away.
      d.health.currentValue = 1;
      d.isInWater = true;
      await ticks(30);
      expect(game.roster.get("D")?.state).toBe("out");
      expect(chat()).toContain("D was washed away");
      game.finish({ kind: "draw", reason: "test over" });
    });
    expect(world.chat.some((line) => line.includes(WATER) && !line.includes("washed"))).toBe(false);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("gives a round out of time to the team with more players standing, then more health left", async () => {
    const { a, c, d, baseline, game } = begin({ bestOf: "3" });
    await playToEnd(game, harness.root, baseline, async () => {
      await pickAndStart(game, ["Soldier", "Soldier", "Soldier", "Soldier"]);
      world.hurt(a, 30, "entityAttack", { attacker: c });
      await ticks(ROUND_TICKS + 5);
      expect(game.bestOf?.history).toEqual(["blue"]);
      expect(chat()).toContain("Blue wins round 1! (more players standing)");
      await nextRound(game, ["Soldier", "Soldier", "Soldier", "Soldier"]);
      d.health.currentValue = 11;
      await ticks(ROUND_TICKS + 5);
      expect(chat()).toContain("Red wins round 2! (more health left)");
      await nextRound(game, ["Soldier", "Soldier", "Soldier", "Soldier"]);
      await ticks(ROUND_TICKS + 5);
    });
    expect(game.bestOf?.history).toEqual(["blue", "red", undefined]);
    expect(chat()).toContain("Round 3 is a draw (time ran out).");
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });
});
