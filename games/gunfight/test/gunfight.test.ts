// Gunfight against the fake world, on a fort with two spawns a team: the loadouts dealt each round,
// the teams switching sides, the arsenal's bullets taking health through core's combat, one-hit
// vanilla weapons, rounds decided by the last team standing or by who's left when time runs out.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ARSENAL_GUN_DEFS, arsenalItem, arsenalItemName as itemName } from "@minecade/guns/defs";
import { mapRequirements, runtimeMapConfig, stripColors, uncoveredRequirements, validateMapConfig, type MapConfig } from "@minecade/minigame-core/config";
import { EntitySwingSource, ItemStack, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { createHarness, everyoneLeaves, expectBaseline, playToEnd, snapshot, statsRows, ticks, type Harness } from "../../../packages/minigame-core/test/game-harness.ts";
import { validateGameConfig } from "../../../tools/build/validate.ts";
import siege from "../../siege/game.config.ts";
import config from "../game.config.ts";
import { Gunfight, LoadoutDeck, loadoutText } from "../behavior_pack/scripts/gunfight.ts";

const FORT: MapConfig = runtimeMapConfig({
  name: "Fort",
  spawns: [[0, 65, 0]],
  spectatorSpawn: [0, 80, 0],
  teamSpawns: { red: [[-10, 65, 0], [-10, 65, 2]], blue: [[10, 65, 0], [10, 65, 2]] },
  bounds: { min: [-30, 40, -30], max: [30, 100, 30] },
});
const NAMES = ["A", "B", "C", "D"];
const COUNTDOWN_TICKS = config.countdownSeconds * 20 + 5;
/** A round's break, then the next round's frozen countdown. */
const BETWEEN_ROUNDS_TICKS = 42 + 3 * 20 + 5;
const TEAMS = [
  { id: "red", name: "Red" },
  { id: "blue", name: "Blue" },
];

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
  const game = new Gunfight(harness.context(NAMES, FORT, settings), config);
  game.setTeamPicks({ A: "red", B: "red", C: "blue", D: "blue" });
  return { a, b, c, d, baseline, from, game };
}

/** `shooter` holds `item` and looks level at `target`'s head. */
function aim(shooter: FakePlayer, target: FakePlayer, item: string): void {
  shooter.inventory.slots[0] = new ItemStack(item, 1);
  shooter.selectedSlotIndex = 0;
  const [dx, dz] = [target.location.x - shooter.location.x, target.location.z - shooter.location.z];
  const across = Math.hypot(dx, dz);
  shooter.viewDirection = { x: dx / across, y: 0, z: dz / across };
}

/**
 * `target` steps up to 3 blocks in front of `shooter`: the Pistol doesn't aim, and from the hip its
 * shots stray enough to miss at 20 blocks, but not to leave the head this close.
 */
function closeIn(target: FakePlayer, shooter: FakePlayer): void {
  target.location = { x: shooter.location.x + 3, y: shooter.location.y, z: shooter.location.z };
}

/** Red takes the round in play: C and D go down to A and B. */
async function redTakesRound(players: Record<"a" | "b" | "c" | "d", FakePlayer>): Promise<void> {
  world.hurt(players.c, 30, "entityAttack", { attacker: players.a });
  world.hurt(players.d, 30, "entityAttack", { attacker: players.b });
  await ticks(2);
}

const click = (player: FakePlayer) =>
  world.afterEvents.playerSwingStart.emit({ player, heldItemStack: player.inventory.slots[player.selectedSlotIndex], swingSource: EntitySwingSource.Attack });
const slot = (player: FakePlayer, index: number) => player.inventory.slots[index];
const armor = (player: FakePlayer) => ["Head", "Chest", "Legs", "Feet"].map((part) => player.equipment.get(part)?.typeId);
const chat = () => stripColors(world.chat.join("\n"));

describe("Gunfight's config", () => {
  it("passes the build's checks, and plays every Siege map: Siege asks at least what it asks of a map", () => {
    expect(validateGameConfig(config, "gunfight")).toEqual([]);
    const rules = { kind: "game" as const, maxPlayers: config.maxPlayers, requires: config.map, teams: TEAMS };
    expect(validateMapConfig(FORT, rules)).toEqual([]);
    const needs = mapRequirements(config.map, { kind: "game", maxPlayers: config.maxPlayers, teams: TEAMS });
    const siegeHas = mapRequirements(siege.map, { kind: "game", maxPlayers: siege.maxPlayers, teams: TEAMS });
    expect(uncoveredRequirements(needs, siegeHas)).toEqual([]);
    // A game asking more (a point Siege's maps don't have) couldn't borrow them.
    const more = mapRequirements({ ...config.map, points: ["flag"] }, { kind: "game", maxPlayers: config.maxPlayers, teams: TEAMS });
    expect(uncoveredRequirements(more, siegeHas).map((requirement) => requirement.key)).toEqual(["points.flag"]);
    expect(validateGameConfig({ ...config, map: { ...config.map, borrow: ["gunfight"] } }, "gunfight")).toEqual(["map.borrow can't name the game itself: its own maps are its own"]);
  });
});

describe("the loadouts", () => {
  const lists = config.loadouts;

  it("deal every primary once before any comes again, and never the same secondary or grenade twice running", () => {
    let seed = 1;
    const deck = new LoadoutDeck(lists, () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646);
    const rounds = Array.from({ length: lists.primary.length * 2 }, (_, index) => deck.forRound(index + 1));
    expect(new Set(rounds.slice(0, lists.primary.length).map((loadout) => loadout.primary)).size).toBe(lists.primary.length);
    expect(new Set(rounds.slice(lists.primary.length).map((loadout) => loadout.primary)).size).toBe(lists.primary.length);
    for (let index = 1; index < rounds.length; index++) {
      expect(rounds[index].primary).not.toBe(rounds[index - 1].primary);
      expect(rounds[index].secondary).not.toBe(rounds[index - 1].secondary);
      expect(rounds[index].grenade).not.toBe(rounds[index - 1].grenade);
    }
    // A round asked for again is the same.
    expect(deck.forRound(3)).toBe(rounds[2]);
  });

  it("names them as players do", () => {
    expect(itemName(arsenalItem("sniper_rifle"))).toBe("Sniper Rifle");
    expect(itemName(arsenalItem("handgun"))).toBe("Pistol");
    expect(itemName("minecraft:netherite_sword")).toBe("Netherite Sword");
    expect(itemName(arsenalItem("stimpack"))).toBe("Stimpack");
    expect(loadoutText({ primary: "minecraft:crossbow", secondary: arsenalItem("rpg"), grenade: arsenalItem("molotov") })).toBe("Crossbow and RPG, with a Molotov");
  });
});

describe("a match of Gunfight", () => {
  it("deals everyone the round's loadout, switches sides every round, and the first team to 3 rounds wins", async () => {
    const { a, b, c, d, baseline, from, game } = begin();
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      expect(game.phase).toBe("playing");
      expect(game.roundInPlay).toBe(true);
      const loadouts: string[] = [];
      for (let round = 1; round <= 3; round++) {
        if (round > 1) await ticks(BETWEEN_ROUNDS_TICKS);
        expect(game.roundInPlay).toBe(true);
        // Everyone has the same four items, locked in their slots, and the team's leather.
        const items = [0, 1, 2, 8].map((index) => slot(a, index)?.typeId);
        expect([0, 1, 2, 8].map((index) => slot(c, index)?.typeId)).toEqual(items);
        expect(items[3]).toBe(arsenalItem("stimpack"));
        expect(slot(a, 0)?.lockMode).toBe("slot");
        loadouts.push(items[0]!);
        expect(stripColors(a.messages.join("\n"))).toContain(`Round ${round}: ${itemName(items[0]!)} and ${itemName(items[1]!)}, with a ${itemName(items[2]!)}.`);
        // Odd rounds at their own spawns, even ones at the other team's.
        expect(Math.sign(a.location.x)).toBe(round % 2 === 1 ? -1 : 1);
        expect(Math.sign(c.location.x)).toBe(round % 2 === 1 ? 1 : -1);
        world.hurt(c, 30, "entityAttack", { attacker: a });
        world.hurt(d, 30, "entityAttack", { attacker: b });
        await ticks(2);
        expect(game.roundInPlay).toBe(false);
      }
      expect(new Set(loadouts).size).toBe(3);
      expect(armor(c)).toEqual(["minecade:blue_leather_helmet", "minecade:blue_leather_chestplate", "minecade:blue_leather_leggings", "minecade:blue_leather_boots"]);
      expect(stripColors(a.messages.join("\n"))).toContain("The teams have switched sides.");
      expect(chat()).toContain("Everyone gets the same guns, new every round, and the teams switch sides every round.");
    });
    expect(result).toMatchObject({ kind: "win", team: "red", reason: "won 3 rounds" });
    expect(game.bestOf?.history).toEqual(["red", "red", "red"]);
    expect(statsRows(harness.sent, from).find((row) => row.n === "A")).toMatchObject({ k: 3 });
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("fires the arsenal: a bullet takes its damage straight off (more in the head), shot after shot, and puts players out; nothing fires between rounds", async () => {
    const { a, b, c, d, baseline, from, game } = begin({ bestOf: "3" });
    await playToEnd(game, harness.root, baseline, async () => {
      // Not during the countdown.
      await ticks(10);
      closeIn(c, a);
      aim(a, c, arsenalItem("handgun"));
      click(a);
      expect(c.health.currentValue).toBe(20);
      await ticks(COUNTDOWN_TICKS);
      closeIn(c, a);
      aim(a, c, arsenalItem("handgun"));
      const { everyTicks, damage } = ARSENAL_GUN_DEFS.handgun;
      click(a);
      expect(c.health.currentValue).toBe(20 - damage.head);
      // The next shot right after (no hurt cooldown for direct hits).
      await ticks(everyTicks);
      click(a);
      expect(c.health.currentValue).toBe(20 - 2 * damage.head);
      // The ammo shows top right.
      expect(stripColors(a.actionBar)).toContain(`${ARSENAL_GUN_DEFS.handgun.ammo.magazine - 2}/${ARSENAL_GUN_DEFS.handgun.ammo.magazine}`);
      await ticks(everyTicks);
      click(a);
      await ticks(1);
      expect(game.roster.get("C")?.state).toBe("out");
      // Teammates are spared.
      closeIn(b, a);
      aim(a, b, arsenalItem("handgun"));
      await ticks(everyTicks);
      click(a);
      expect(b.health.currentValue).toBe(20);
      // A netherite sword kills in one hit.
      b.inventory.slots[0] = new ItemStack("minecraft:netherite_sword", 1);
      b.selectedSlotIndex = 0;
      world.melee(b, d, 8);
      await ticks(2);
      expect(game.roster.get("D")?.state).toBe("out");
      expect(game.roundInPlay).toBe(false);
      await ticks(BETWEEN_ROUNDS_TICKS);
      await redTakesRound({ a, b, c, d });
    });
    const rows = statsRows(harness.sent, from);
    expect(rows.find((row) => row.n === "A")).toMatchObject({ k: 2 });
    expect(rows.find((row) => row.n === "A")?.x?.headshots).toBe(3);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });

  it("gives a round that runs out of time to more players standing, then more health", async () => {
    const { a, b, c, d, baseline, game } = begin({ bestOf: "3" });
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      world.hurt(d, 30, "entityAttack", { attacker: a });
      await ticks(config.bestOf.roundSeconds * 20 + 5);
      expect(game.bestOf?.history).toEqual(["red"]);
      expect(chat()).toContain("Red wins round 1! (more players standing)");
      await ticks(BETWEEN_ROUNDS_TICKS);
      c.health.currentValue = 20;
      a.health.currentValue = 7;
      await ticks(config.bestOf.roundSeconds * 20 + 5);
      expect(game.bestOf?.history).toEqual(["red", "blue"]);
      expect(chat()).toContain("Blue wins round 2! (more health left)");
      await ticks(BETWEEN_ROUNDS_TICKS);
      await redTakesRound({ a, b, c, d });
    });
    expect(game.bestOf?.history).toEqual(["red", "blue", "red"]);
    expectBaseline(harness.root, baseline);
    everyoneLeaves();
  });
});
