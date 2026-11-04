// Paintball against the fake world, on a yard with two spawns for each of the four teams and eight
// power-up spots. Each hit colors a piece of armor and takes a quarter of a player's health, four
// put them out and score for the shooter's team; balls paint where they land; power-ups hand out a
// rifle or shotgun for 30 seconds, or a grenade that paints a ball of blocks and hits twice.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GRENADE, GUNS, GUN_PICKUP, KIND_PROPERTY, PAINTBALL, PICKUP_KINDS, THROWN_GRENADE, gunItem } from "@minecade/guns/defs";
import { possibleTeams, runtimeMapConfig, stripColors, validateMapConfig, type MapConfig, type MapPosition } from "@minecade/minigame-core/config";
import { EntitySwingSource, ItemStack, world, type FakeMob, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { createHarness, everyoneLeaves, expectBaseline, playToEnd, snapshot, statsRows, ticks, type Harness } from "../../../packages/minigame-core/test/game-harness.ts";
import { bestOfCodes } from "../../../packages/minigame-core/src/hud.ts";
import { paintBlockFiles } from "../../../tools/assets/paint-blocks.ts";
import { validateGameConfig } from "../../../tools/build/validate.ts";
import config from "../game.config.ts";
import { blend, nearestDye, nextPiece, pieceAt } from "../behavior_pack/scripts/armor.ts";
import { Painter, paintTarget, toggled, type BlockLook, type PaintPort, type Vec } from "../behavior_pack/scripts/paint.ts";
import { Paintball } from "../behavior_pack/scripts/paintball.ts";
import { freeSpot } from "../behavior_pack/scripts/powerups.ts";
import { PAINT_SHAPES, SHAPE_STATES, paintBlock, parsePaintBlock } from "../behavior_pack/scripts/shapes.ts";

/** Eight spots on a ring, 20 blocks out. */
const SPOTS: MapPosition[] = [
  [20, 65, 0], [14, 65, 14], [0, 65, 20], [-14, 65, 14], [-20, 65, 0], [-14, 65, -14], [0, 65, -20], [14, 65, -14],
];
const YARD: MapConfig = runtimeMapConfig({
  name: "Yard",
  spawns: [],
  spectatorSpawn: [0, 80, 0],
  teamSpawns: {
    red: [[-10, 65, 0], [-10, 65, 2]],
    blue: [[10, 65, 0], [10, 65, 2]],
    yellow: [[0, 65, -10], [2, 65, -10]],
    green: [[0, 65, 10], [2, 65, 10]],
  },
  bounds: { min: [-30, 40, -30], max: [30, 100, 30] },
  points: { powerup: SPOTS },
});
const NAMES = ["A", "B", "C", "D"];
const COUNTDOWN_TICKS = config.countdownSeconds * 20 + 5;
const RESPAWN_TICKS = config.respawn.delaySeconds * 20 + 2;

let harness: Harness;

beforeAll(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
});

/** A match on the yard: A and B on Red, C and D on Blue, by the lobby's team picks (unless `picks` says otherwise). */
function begin(options: { settings?: Record<string, string>; overrides?: Partial<typeof config>; picks?: Record<string, string> } = {}) {
  const [a, b, c, d] = NAMES.map((name) => world.join(name));
  const baseline = snapshot(harness.root);
  const from = harness.sent.length;
  const game = new Paintball(harness.context(NAMES, YARD, options.settings), { ...config, ...options.overrides }, "pack-uuid");
  game.setTeamPicks(options.picks ?? { A: "red", B: "red", C: "blue", D: "blue" });
  return { a, b, c, d, baseline, from, game };
}

/** A left click with what's in the hand. */
const click = (player: FakePlayer) =>
  world.afterEvents.playerSwingStart.emit({ player, heldItemStack: player.inventory.slots[player.selectedSlotIndex], swingSource: EntitySwingSource.Attack });
const live = (typeId: string) => world.overworld.spawned.filter((mob) => mob.typeId === typeId && mob.isValid);

/** `shooter` fires once and the ball lands on `victim`, `height` blocks over their feet. */
async function shoot(shooter: FakePlayer, victim: FakePlayer, height = 1): Promise<void> {
  const before = new Set(live(PAINTBALL));
  click(shooter);
  const ball = live(PAINTBALL).find((mob) => !before.has(mob));
  expect(ball, `${shooter.name} fired`).toBeDefined();
  world.projectileHitsEntity(ball!, victim, { x: victim.location.x, y: victim.location.y + height, z: victim.location.z }, shooter);
  await ticks(GUNS.pistol.everyTicks + 1);
}

const armor = (player: FakePlayer) => ["Head", "Chest", "Legs", "Feet"].map((slot) => player.equipment.get(slot)?.typeId);
const chat = () => stripColors(world.chat.join("\n"));

describe("Paintball's config and map", () => {
  const rules = { kind: "game" as const, maxPlayers: config.maxPlayers, requires: config.map, teams: possibleTeams(config.teams) };

  it("passes the build's checks, and maps need spawns for all four teams, bounds and 8 power-up spots", () => {
    expect(validateGameConfig(config, "paintball")).toEqual([]);
    expect(possibleTeams(config.teams).map((team) => `${team.id} ${team.color}`)).toEqual(["red §c", "blue §9", "yellow §e", "green §2"]);
    expect(validateMapConfig(YARD, rules)).toEqual([]);
    const { yellow: _yellow, ...three } = YARD.teamSpawns!;
    const problems = validateMapConfig({ ...YARD, teamSpawns: three, points: { powerup: SPOTS.slice(0, 7) } }, rules).join("\n");
    expect(problems).toMatch(/yellow/i);
    expect(problems).toMatch(/needs 8 "points.powerup" entries/);
    expect(config.options[0]).toMatchObject({ id: "teamCount", label: "Team count" });
    expect(config.options[0].values.map((value) => value.value)).toEqual(["2", "3", "4"]);
  });

  it("writes the painted blocks and the Power-up spot marker as the committed files say", () => {
    for (const [path, content] of Object.entries(paintBlockFiles())) {
      const file = fileURLToPath(new URL(`../${path}`, import.meta.url));
      expect(existsSync(file), path).toBe(true);
      const disk = readFileSync(file);
      if (typeof content === "string") expect(disk.toString("utf8").replace(/\r\n/g, "\n"), path).toBe(content);
      else expect(disk.equals(content), path).toBe(true);
    }
  });

  it("gives every painted block the states its shape names, and draws only bones its geometry has", () => {
    const files = paintBlockFiles();
    for (const shape of PAINT_SHAPES) {
      const geometry = JSON.parse(files[`resource_pack/models/blocks/paint_${shape}.geo.json`] as string)["minecraft:geometry"][0];
      const bones = new Set(geometry.bones.map((bone: { name: string }) => bone.name));
      for (const dye of ["red", "blue", "yellow", "green"]) {
        const block = JSON.parse(files[`behavior_pack/blocks/paint_${dye}_${shape}.json`] as string)["minecraft:block"];
        expect(block.description.identifier).toBe(paintBlock(dye, shape));
        expect(block.description.states).toEqual(SHAPE_STATES[shape]);
        for (const bone of Object.keys(block.components["minecraft:geometry"].bone_visibility)) expect(bones.has(bone), `${shape} ${bone}`).toBe(true);
      }
    }
    expect(parsePaintBlock("minecade:paint_red_fence_gate")).toEqual({ dye: "red", shape: "fence_gate" });
    expect(parsePaintBlock("minecade:paint_green_fence")).toEqual({ dye: "green", shape: "fence" });
    expect(parsePaintBlock("minecade:red_bricks")).toBeUndefined();
  });
});

describe("Paintball's armor", () => {
  it("knows the piece a ball hit by its height, and moves on to the nearest piece not yet colored", () => {
    expect([1.6, 1.0, 0.5, 0.1].map(pieceAt)).toEqual(["helmet", "chestplate", "leggings", "boots"]);
    expect(nextPiece("chestplate", new Set())).toBe("chestplate");
    expect(nextPiece("chestplate", new Set(["chestplate"]))).toBe("helmet");
    expect(nextPiece("helmet", new Set(["helmet", "chestplate"]))).toBe("leggings");
    expect(nextPiece("boots", new Set(["helmet", "chestplate", "leggings", "boots"]))).toBeUndefined();
  });

  it("mixes the piece's dye and the shooter's by Minecraft's recipes, else to the nearest dye", () => {
    expect(blend("red", "yellow")).toBe("orange");
    expect(blend("blue", "red")).toBe("purple");
    expect(blend("red", "blue")).toBe("purple");
    expect(blend("green", "blue")).toBe("cyan");
    expect(blend("red", "green")).toBe("brown");
    expect(blend("yellow", "green")).toBe("lime");
    expect(blend("red", "red")).toBe("red");
    expect(nearestDye({ red: 1, green: 1, blue: 1 })).toBe("white");
  });
});

describe("Paintball's paint", () => {
  const look = (typeId: string, states: BlockLook["states"] = {}): BlockLook => ({ typeId: `minecraft:${typeId}`, states });

  it("turns full blocks into concrete, stairs and slabs into concrete's, and carpets into carpet, in the dye", () => {
    expect(paintTarget(look("stone"), "red")).toEqual({ typeId: "minecraft:red_concrete", states: {} });
    expect(paintTarget(look("oak_leaves"), "blue")?.typeId).toBe("minecraft:blue_concrete");
    expect(paintTarget(look("white_concrete"), "green")?.typeId).toBe("minecraft:green_concrete");
    expect(paintTarget(look("oak_double_slab"), "red")?.typeId).toBe("minecraft:red_concrete");
    // Already that color: nothing to do.
    expect(paintTarget(look("red_concrete"), "red")).toBeUndefined();
    const stairs = { weirdo_direction: 2, upside_down_bit: true, "minecraft:corner": "inner_left" };
    expect(paintTarget(look("oak_stairs", stairs), "yellow")).toEqual({ typeId: "minecraft:yellow_concrete_stairs", states: stairs });
    expect(paintTarget(look("oak_slab", { "minecraft:vertical_half": "top", wood_type: "oak" }), "red")).toEqual({ typeId: "minecraft:red_concrete_slab", states: { "minecraft:vertical_half": "top" } });
    expect(paintTarget(look("white_carpet", { color: "white" }), "blue")).toEqual({ typeId: "minecraft:blue_carpet", states: {} });
  });

  it("turns walls, fences, panes, gates, trapdoors and doors into painted ones that keep their shape", () => {
    const wall = { wall_post_bit: true, wall_connection_type_north: "short", wall_connection_type_east: "none", wall_connection_type_south: "tall", wall_connection_type_west: "none", wall_block_type: "cobblestone" };
    expect(paintTarget(look("cobblestone_wall", wall), "red")).toEqual({
      typeId: "minecade:paint_red_wall",
      states: { "minecade:up": "true", "minecade:north": "low", "minecade:east": "none", "minecade:south": "tall", "minecade:west": "none" },
    });
    const sides = { "minecraft:connection_north": true, "minecraft:connection_east": false, "minecraft:connection_south": true, "minecraft:connection_west": false };
    expect(paintTarget(look("oak_fence", sides), "blue")?.states).toEqual({ "minecade:north": "true", "minecade:east": "false", "minecade:south": "true", "minecade:west": "false" });
    expect(paintTarget(look("glass_pane", sides), "blue")?.typeId).toBe("minecade:paint_blue_pane");
    expect(paintTarget(look("iron_bars", sides), "blue")?.typeId).toBe("minecade:paint_blue_pane");
    expect(paintTarget(look("fence_gate", { "minecraft:cardinal_direction": "west", open_bit: true, in_wall_bit: false }), "green")).toEqual({
      typeId: "minecade:paint_green_fence_gate",
      states: { "minecade:facing": "west", "minecade:open": "true", "minecade:in_wall": "false" },
    });
    expect(paintTarget(look("spruce_trapdoor", { direction: 3, open_bit: false, upside_down_bit: true }), "red")?.states).toEqual({ "minecade:facing": "north", "minecade:half": "top", "minecade:open": "false" });
    // A door's cardinal direction is a quarter turn from Java's facing (measured on BDS: spike/paint).
    expect(paintTarget(look("wooden_door", { "minecraft:cardinal_direction": "south", open_bit: false, upper_block_bit: false, door_hinge_bit: true }), "red")?.states).toEqual({
      "minecade:facing": "east",
      "minecade:half": "lower",
      "minecade:hinge": "right",
      "minecade:open": "false",
    });
  });

  it("leaves small and see-through things, liquids and air", () => {
    for (const name of ["air", "water", "torch", "redstone_torch", "rail", "oak_sign", "stone_button", "ladder", "chest", "poppy", "short_grass", "lantern", "barrier", "light_block_15", "skeleton_skull", "snow_layer"]) {
      expect(paintTarget(look(name), "red"), name).toBeUndefined();
    }
  });

  it("paints the shared blocks pack's blocks by their shape, and painted blocks again in a new color", () => {
    const stairs = { "minecade:facing": "south", "minecade:half": "top", "minecade:shape": "outer_left" };
    expect(paintTarget({ typeId: "minecade:bricks_stairs", states: stairs }, "red", "stairs")).toEqual({
      typeId: "minecraft:red_concrete_stairs",
      states: { weirdo_direction: 2, upside_down_bit: true, "minecraft:corner": "outer_left" },
    });
    expect(paintTarget({ typeId: "minecade:bricks", states: {} }, "red", "cube")?.typeId).toBe("minecraft:red_concrete");
    expect(paintTarget({ typeId: "minecade:bricks_slab", states: { "minecade:type": "double" } }, "red", "slab")?.typeId).toBe("minecraft:red_concrete");
    expect(paintTarget({ typeId: "minecade:bricks_slab", states: { "minecade:type": "top" } }, "red", "slab")?.states).toEqual({ "minecraft:vertical_half": "top" });
    expect(paintTarget({ typeId: "minecade:bricks_vertical_slab", states: { "minecade:type": "east" } }, "red", "vertical_slab")).toEqual({ typeId: "minecade:paint_red_vertical_slab", states: { "minecade:type": "east" } });
    const pane = { "minecade:north": "true", "minecade:east": "false", "minecade:south": "true", "minecade:west": "false", "minecade:up": "false", "minecade:down": "false" };
    expect(paintTarget({ typeId: "minecade:window_pane", states: pane }, "blue", "pane")?.states).toEqual({ "minecade:north": "true", "minecade:east": "false", "minecade:south": "true", "minecade:west": "false" });
    expect(paintTarget({ typeId: "minecade:rope_fence_gate", states: { "minecade:facing": "east", "minecade:open": "false", "minecade:in_wall": "true" } }, "blue", "gate")?.typeId).toBe("minecade:paint_blue_fence_gate");
    expect(paintTarget({ typeId: "minecade:oak_chair", states: {} }, "red", undefined)).toBeUndefined();
    const painted = { "minecade:up": "true", "minecade:north": "low", "minecade:east": "none", "minecade:south": "none", "minecade:west": "tall" };
    expect(paintTarget({ typeId: "minecade:paint_red_wall", states: painted }, "blue")).toEqual({ typeId: "minecade:paint_blue_wall", states: painted });
    expect(toggled({ "minecade:open": "false", "minecade:facing": "north" })).toEqual({ "minecade:open": "true", "minecade:facing": "north" });
  });

  /** A world of blocks by "x,y,z" for the painter, inside x and z from -`reach` to `reach`. */
  function blocks(entries: [Vec, BlockLook][], reach = 10) {
    const map = new Map(entries.map(([at, block]) => [`${at.x},${at.y},${at.z}`, block]));
    const port: PaintPort = {
      read: (at) => map.get(`${at.x},${at.y},${at.z}`) ?? { typeId: "minecraft:air", states: {} },
      write: (at, block) => (map.set(`${at.x},${at.y},${at.z}`, block), true),
      inside: (at) => Math.abs(at.x) <= reach && Math.abs(at.z) <= reach,
      modShape: () => undefined,
    };
    return { map, painter: new Painter(port) };
  }
  const floor = (size: number, y = 64): [Vec, BlockLook][] => {
    const out: [Vec, BlockLook][] = [];
    for (let x = -size; x <= size; x++) for (let z = -size; z <= size; z++) out.push([{ x, y, z }, look("stone")]);
    return out;
  };
  const painted = (map: Map<string, BlockLook>, dye: string) => [...map].filter(([, block]) => block.typeId === `minecraft:${dye}_concrete`).map(([key]) => key);

  it("splashes the block hit and touching blocks of the same open surface, inside the bounds", () => {
    const { map, painter } = blocks([...floor(3), [{ x: 1, y: 65, z: 0 }, look("stone")]]);
    expect(painter.splash({ x: 0, y: 64, z: 0 }, "Up", "red", 5, () => 0.5)).toBe(5);
    const splash = painted(map, "red");
    expect(splash).toContain("0,64,0");
    // Under a block the surface isn't open: never painted.
    expect(splash).not.toContain("1,64,0");
    expect(splash.every((key) => key.split(",")[1] === "64")).toBe(true);
    const edge = blocks(floor(3), 0);
    expect(edge.painter.splash({ x: 0, y: 64, z: 0 }, "Up", "blue", 5, () => 0.5)).toBe(1);
  });

  it("bursts over every block of a ball that shows, and paints both halves of a door", () => {
    const solid: [Vec, BlockLook][] = [];
    for (let x = -3; x <= 3; x++) for (let y = 60; y <= 64; y++) for (let z = -3; z <= 3; z++) solid.push([{ x, y, z }, look("stone")]);
    const { map, painter } = blocks(solid);
    const count = painter.burst({ x: 0.5, y: 65, z: 0.5 }, 2.5, "green");
    expect(count).toBeGreaterThan(9);
    expect(painted(map, "green").every((key) => key.split(",")[1] === "64")).toBe(true);

    const door = blocks([
      [{ x: 0, y: 65, z: 0 }, look("wooden_door", { "minecraft:cardinal_direction": "south", open_bit: true, upper_block_bit: false, door_hinge_bit: false })],
      [{ x: 0, y: 66, z: 0 }, look("wooden_door", { "minecraft:cardinal_direction": "north", open_bit: false, upper_block_bit: true, door_hinge_bit: true })],
    ]);
    expect(door.painter.paint({ x: 0, y: 66, z: 0 }, "red")).toBe(2);
    const halves = ["0,65,0", "0,66,0"].map((key) => door.map.get(key));
    expect(halves.map((half) => half?.typeId)).toEqual(["minecade:paint_red_door", "minecade:paint_red_door"]);
    // Facing and open from the lower half, the hinge from the upper.
    expect(halves.map((half) => half?.states)).toEqual([
      { "minecade:facing": "east", "minecade:half": "lower", "minecade:hinge": "right", "minecade:open": "true" },
      { "minecade:facing": "east", "minecade:half": "upper", "minecade:hinge": "right", "minecade:open": "true" },
    ]);
  });
});

describe("Paintball's power-up spots", () => {
  it("picks a free spot at random", () => {
    expect(freeSpot(3, new Set([0, 2]), () => 0.9)).toBe(1);
    expect(freeSpot(2, new Set([0, 1]), () => 0.5)).toBeUndefined();
  });
});

describe("a match of Paintball", () => {
  it("colors a piece with each hit, puts a player out at the 4th for a kill, spares teammates, and the first team to the target wins", async () => {
    const { a, b, c, baseline, from, game } = begin({ overrides: { scoring: { ...config.scoring, target: 2 } } });
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      expect(game.phase).toBe("playing");
      expect(a.inventory.getItem(0)?.typeId).toBe(gunItem("pistol", "red"));
      expect(armor(a)).toEqual(["minecade:red_leather_helmet", "minecade:red_leather_chestplate", "minecade:red_leather_leggings", "minecade:red_leather_boots"]);
      expect(armor(c)[0]).toBe("minecade:blue_leather_helmet");

      // Blue and red make purple, piece by piece; each hit takes a quarter of the health.
      await shoot(a, c, 1.0);
      expect(armor(c)).toEqual(["minecade:blue_leather_helmet", "minecade:purple_leather_chestplate", "minecade:blue_leather_leggings", "minecade:blue_leather_boots"]);
      expect(c.health.currentValue).toBe(15);
      await shoot(a, c, 1.0);
      expect(armor(c)[0]).toBe("minecade:purple_leather_helmet");
      expect(c.health.currentValue).toBe(10);
      // A teammate's ball does nothing.
      await shoot(b, a, 1.0);
      expect(a.health.currentValue).toBe(20);
      await shoot(a, c, 0.5);
      await shoot(a, c, 0.1);
      expect(game.roster.get("C")?.state).not.toBe("alive");
      expect(chat()).toMatch(/C was (painted|splattered|\w+) by A/);
      // Red's kill shows top right, beside Blue's none.
      await ticks(12);
      expect(a.actionBar).toContain(bestOfCodes({ display: "score", sides: [{ color: "§c", wins: 1 }, { color: "§9", wins: 0 }] }));

      // Back with clean armor and full health, and protected for a moment.
      await ticks(RESPAWN_TICKS);
      expect(game.roster.get("C")?.state).toBe("alive");
      expect(armor(c)[1]).toBe("minecade:blue_leather_chestplate");
      expect(c.health.currentValue).toBe(20);
      await shoot(a, c);
      expect(c.health.currentValue).toBe(20);
      await ticks(config.respawn.protectSeconds * 20);
      for (let hit = 0; hit < config.hitsToOut; hit++) await shoot(a, c);
    });
    expect(result).toMatchObject({ kind: "win", team: "red" });
    expect(statsRows(harness.sent, from).find((row) => row.n === "A")).toMatchObject({ k: 2 });
    expectBaseline(harness.root, baseline);
  });

  it("plays as many teams as the Team count, Red, Blue, Yellow, then Green", async () => {
    for (const [count, teams] of [
      ["2", ["red", "blue"]],
      ["3", ["red", "blue", "yellow"]],
      ["4", ["red", "blue", "yellow", "green"]],
    ] as const) {
      const { baseline, game } = begin({ settings: { teamCount: count }, picks: {} });
      await playToEnd(game, harness.root, baseline, async () => {
        await ticks(COUNTDOWN_TICKS);
        expect(game.teamDefs.map((team) => team.id)).toEqual(teams);
        expect(new Set(NAMES.map((name) => game.teamOf(name)?.id)).size).toBe(teams.length);
        everyoneLeaves();
      });
      expectBaseline(harness.root, baseline);
    }
  });

  it("puts two power-ups out, hands a rifle in place of the pistol for 30 seconds, and paints where balls land", async () => {
    const { a, c, baseline, from, game } = begin({ overrides: { powerUps: { ...config.powerUps, kinds: ["rifle"] } } });
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      const pickups = live(GUN_PICKUP);
      expect(pickups).toHaveLength(2);
      expect(pickups.map((pickup) => pickup.properties.get(KIND_PROPERTY))).toEqual([PICKUP_KINDS.indexOf("rifle"), PICKUP_KINDS.indexOf("rifle")]);

      // A walks onto one: the rifle replaces the pistol, and the level counts its seconds.
      a.location = { ...pickups[0].location };
      await ticks(5);
      expect(a.inventory.getItem(0)?.typeId).toBe(gunItem("rifle", "red"));
      expect(a.level).toBe(config.powerUps.gunSeconds);
      expect(live(GUN_PICKUP)).toHaveLength(1);
      // One gun at a time: the other stays where it is.
      a.location = { ...live(GUN_PICKUP)[0].location };
      await ticks(5);
      expect(live(GUN_PICKUP)).toHaveLength(1);

      // A ball on the stone floor paints a splash in Red's concrete.
      for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) world.overworld.blocks.set(`${x},64,${z}`, "minecraft:stone");
      a.location = { x: 0, y: 65, z: -2 };
      const before = new Set(live(PAINTBALL));
      a.inventory.setItem(0, new ItemStack(gunItem("pistol", "red")));
      click(a);
      const ball = live(PAINTBALL).find((mob) => !before.has(mob))!;
      world.projectileHitsBlock(ball, { x: 0, y: 64, z: 0 }, "Up", a);
      const red = [...world.overworld.blocks.values()].filter((id) => id === "minecraft:red_concrete").length;
      expect(red).toBeGreaterThanOrEqual(config.splash.min);
      expect(red).toBeLessThanOrEqual(config.splash.max);

      // The rifle's time runs out: the pistol is back, and A can take a gun again.
      a.inventory.setItem(0, new ItemStack(gunItem("rifle", "red")));
      await ticks(config.powerUps.gunSeconds * 20);
      expect(a.inventory.getItem(0)?.typeId).toBe(gunItem("pistol", "red"));
      expect(a.level).toBe(0);
      expect(c.inventory.getItem(0)?.typeId).toBe(gunItem("pistol", "blue"));
      everyoneLeaves();
    });
    expect(statsRows(harness.sent, from).find((row) => row.n === "A")?.x?.painted).toBeGreaterThanOrEqual(config.splash.min);
    expectBaseline(harness.root, baseline);
  });

  it("hands a grenade out, one at a time, that hits every enemy near its burst twice", async () => {
    const { a, b, c, d, baseline, game } = begin({ overrides: { powerUps: { ...config.powerUps, kinds: ["grenade"] } } });
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      a.location = { ...live(GUN_PICKUP)[0].location };
      await ticks(5);
      expect(a.inventory.getItem(config.slots.grenade)?.typeId).toBe(gunItem("grenade", "red"));
      // Carrying one already: the other stays out.
      a.location = { ...live(GUN_PICKUP)[0].location };
      await ticks(5);
      expect(live(GUN_PICKUP)).toHaveLength(1);

      a.selectedSlotIndex = config.slots.grenade;
      world.afterEvents.itemUse.emit({ source: a, itemStack: a.inventory.getItem(config.slots.grenade)! });
      const thrown = live(THROWN_GRENADE)[0] as FakeMob;
      expect(thrown).toBeDefined();
      c.location = { x: 5, y: 65, z: 5 };
      d.location = { x: 15, y: 65, z: 15 };
      b.location = { x: 5, y: 65, z: 6 };
      thrown.location = { x: 5, y: 65.2, z: 5 };
      world.projectileHitsBlock(thrown, { x: 5, y: 64, z: 5 }, "Up", a);
      await ticks(GRENADE.fuseTicks + 2);
      expect(c.health.currentValue).toBe(10);
      expect(armor(c).filter((piece) => piece?.startsWith("minecade:purple_"))).toHaveLength(2);
      // Too far, and a teammate: untouched.
      expect(d.health.currentValue).toBe(20);
      expect(b.health.currentValue).toBe(20);
      everyoneLeaves();
    });
    expectBaseline(harness.root, baseline);
  });
});
