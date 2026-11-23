// Block Party's walk over the ground (walk-plan.ts): what a leg's plan does over each kind of ground
// (steps, blocks, hurdles, gaps, cracks, drops, ladders, walls, stairs), the push that carries a
// tick's height, the world reader (terrain.ts) on the fake world and on the server's raycast
// results, the test board (test-board.ts): its layout, its blocks, and a walk over every stretch of
// it doing what that stretch has, and following each stretch's plan tick by tick (walk-follow.ts)
// with a model of a pushed piece.
import { afterEach, describe, expect, it } from "vitest";
import { BlockPermutation, world, type Dimension } from "@minecraft/server";
import { STAND, boardBox, type Space, type Vec3 } from "../behavior_pack/scripts/board.ts";
import { WorldTerrain, onMarker } from "../behavior_pack/scripts/terrain.ts";
import { TEST_SPACES, TEST_SPACING, layTestBoard, testBoardBlocks, testBoardSpaces } from "../behavior_pack/scripts/test-board.ts";
import { AIR_KEEP, GROUND_KEEP, KNOCKBACK_SPEED, followTick, knockbackFor, legOf, newFollow } from "../behavior_pack/scripts/walk-follow.ts";
import { CLIMBABLE, LIP, LOOK_UP, MAX_DROP, PIECE_HALF, heightAt, planLeg, pushUp, stairTop, type LegPlan, type TerrainReader } from "../behavior_pack/scripts/walk-plan.ts";

const PER_TICK = 0.4;

/** Ground that changes only along x, for a leg going east along z 0.5: `at(x)` its top, undefined for a gap; `climb(x, y)` where a ladder is. */
function eastward(at: (x: number) => number | undefined, climb: (x: number, y: number) => boolean = () => false): TerrainReader {
  return { ground: (x) => at(x), climbable: (x, y) => climb(x, y) };
}

const plan = (reader: TerrainReader, length: number, from = 0, to = from): LegPlan => planLeg(reader, [0, from, 0.5], [length, to, 0.5], PER_TICK);
const sOf = (leg: LegPlan, i: number) => i * leg.step;
/** The runs of samples in the air: [first, last] each. */
function airRuns(leg: LegPlan): [number, number][] {
  const runs: [number, number][] = [];
  leg.air.forEach((up, i) => {
    if (!up) return;
    const last = runs.at(-1);
    if (last && last[1] === i - 1) last[1] = i;
    else runs.push([i, i]);
  });
  return runs;
}

describe("a leg's plan over the ground", () => {
  it("walks level ground flat", () => {
    const leg = plan(eastward(() => 0), 8);
    expect(leg.heights.every((h) => h === 0)).toBe(true);
    expect(leg.air.some(Boolean)).toBe(false);
    expect(leg.climbs).toEqual([]);
    expect(leg.blocked).toBeUndefined();
  });

  it("walks up a slab's step on a slope, all the way up by the time its front meets it", () => {
    const leg = plan(eastward((x) => (x < 3 ? 0 : 0.5)), 8);
    expect(leg.air.some(Boolean)).toBe(false);
    for (let i = 1; i < leg.heights.length; i++) expect(leg.heights[i] - leg.heights[i - 1]).toBeLessThanOrEqual(leg.step + 1e-9);
    expect(heightAt(leg, 2)).toBeCloseTo(0);
    expect(heightAt(leg, 2.7)).toBeCloseTo(0.5);
    expect(leg.heights.at(-1)).toBeCloseTo(0.5);
  });

  it("walks down a step once its back leaves it", () => {
    const leg = plan(eastward((x) => (x < 3 ? 0.5 : 0)), 8);
    expect(leg.air.some(Boolean)).toBe(false);
    for (let i = 1; i < leg.heights.length; i++) expect(leg.heights[i]).toBeLessThanOrEqual(leg.heights[i - 1] + 1e-9);
    expect(heightAt(leg, 3.2)).toBeCloseTo(0.5);
    expect(heightAt(leg, 3.8)).toBeCloseTo(0);
  });

  it("jumps up a block, taking off before it and clearing its edge", () => {
    const leg = plan(eastward((x) => (x < 3 ? 0 : 1)), 8);
    const runs = airRuns(leg);
    expect(runs).toHaveLength(1);
    const [first, last] = runs[0];
    // Off the ground before the piece's front gets to the block.
    expect(sOf(leg, first)).toBeLessThan(2.7);
    // Over the block's top whenever any of the piece is over it.
    for (let i = first; i <= last; i++) if (sOf(leg, i) >= 2.7) expect(leg.heights[i]).toBeGreaterThanOrEqual(0.99);
    // A jump's height, not a leap's.
    expect(Math.max(...leg.heights)).toBeLessThan(1.7);
    expect(leg.heights.at(-1)).toBeCloseTo(1);
    expect(leg.climbs).toEqual([]);
  });

  it("jumps a hurdle in one arc, landing past it", () => {
    const leg = plan(eastward((x) => (x >= 3 && x < 4 ? 1 : 0)), 8);
    expect(airRuns(leg)).toHaveLength(1);
    leg.heights.forEach((h, i) => {
      const s = sOf(leg, i);
      if (s > 2.7 && s < 4.3) expect(h).toBeGreaterThanOrEqual(0.99);
    });
    expect(leg.heights.at(-1)).toBeCloseTo(0);
  });

  it("jumps a gap, in the air all the while it's over it, and lands on the far side", () => {
    const leg = plan(eastward((x) => (x >= 3 && x < 5 ? undefined : 0)), 9);
    expect(airRuns(leg)).toHaveLength(1);
    leg.heights.forEach((h, i) => {
      const s = sOf(leg, i);
      if (s >= 3.3 && s <= 4.7) {
        expect(leg.air[i]).toBe(true);
        expect(h).toBeGreaterThan(0);
      }
    });
    const [, last] = airRuns(leg)[0];
    expect(sOf(leg, last + 1)).toBeGreaterThan(4.7);
    expect(leg.blocked).toBeUndefined();
  });

  it("walks over a crack narrower than a piece", () => {
    const leg = plan(eastward((x) => (x >= 3 && x < 3.5 ? undefined : 0)), 8);
    expect(leg.air.some(Boolean)).toBe(false);
    expect(leg.heights.every((h) => Math.abs(h) < 1e-9)).toBe(true);
  });

  it("walks off a drop and falls as a player falls", () => {
    const leg = plan(eastward((x) => (x < 3 ? 0 : -2)), 8);
    const runs = airRuns(leg);
    expect(runs).toHaveLength(1);
    const [first, last] = runs[0];
    expect(sOf(leg, first)).toBeGreaterThan(3.1);
    for (let i = first + 1; i <= last; i++) expect(leg.heights[i]).toBeLessThan(leg.heights[i - 1]);
    // A tick past the edge it has fallen a tick's worth (gravity's 0.08, less drag).
    expect(heightAt(leg, sOf(leg, first - 1) + PER_TICK)).toBeCloseTo(-0.0784, 3);
    expect(leg.heights.at(-1)).toBeCloseTo(-2);
  });

  it("climbs a ladder up a wall taller than a jump", () => {
    const leg = plan(
      eastward(
        (x) => (x < 3 ? 0 : 3),
        (x, y) => x >= 2 && x < 3 && y >= 0 && y < 3,
      ),
      8,
    );
    expect(leg.climbs).toHaveLength(1);
    const [climb] = leg.climbs;
    expect(climb.from).toBeCloseTo(0);
    expect(climb.to).toBeCloseTo(3);
    expect(climb.at).toBeGreaterThan(2.3);
    expect(climb.at).toBeLessThan(2.6);
    expect(leg.air.some(Boolean)).toBe(false);
    expect(leg.blocked).toBeUndefined();
    expect(heightAt(leg, climb.at - 0.2)).toBeCloseTo(0);
    // Past the spot, a lip over the top until all of the piece is over it, then the top.
    expect(heightAt(leg, climb.at + 0.2)).toBeCloseTo(3 + LIP);
    expect(heightAt(leg, 4)).toBeCloseTo(3);
    expect(leg.climbTicks).toBeGreaterThanOrEqual(20);
  });

  it("climbs down a ladder off an edge", () => {
    const leg = plan(
      eastward(
        (x) => (x < 3 ? 2 : 0),
        (x, y) => x >= 3 && x < 4 && y >= 0 && y < 2,
      ),
      8,
      2,
      0,
    );
    expect(leg.climbs).toHaveLength(1);
    const [climb] = leg.climbs;
    expect(climb.from).toBeCloseTo(2);
    expect(climb.to).toBeCloseTo(0);
    expect(climb.at).toBeGreaterThan(3.3);
    expect(climb.at).toBeLessThan(3.7);
    expect(leg.air.some(Boolean)).toBe(false);
    expect(heightAt(leg, climb.at - 0.15)).toBeCloseTo(2);
    expect(heightAt(leg, climb.at + 0.15)).toBeCloseTo(0);
  });

  it("stops at a wall taller than a jump with nothing to climb", () => {
    const leg = plan(eastward((x) => (x < 3 ? 0 : 3)), 8);
    expect(leg.blocked).toBeGreaterThan(2.4);
    expect(leg.blocked).toBeLessThan(2.8);
    expect(leg.climbs).toEqual([]);
  });

  it("goes up straight stairs on a slope, a lip over each edge as its front gets there", () => {
    const east = { weirdo_direction: 0, upside_down_bit: false };
    const ground = (x: number) => (x < 3 ? 0 : x < 4 ? stairTop(east, x - 3, 0.5) : x < 5 ? 1 + stairTop(east, x - 4, 0.5) : 2);
    const leg = plan(eastward(ground), 8);
    expect(leg.air.some(Boolean)).toBe(false);
    for (let i = 1; i < leg.heights.length; i++) {
      // Up a step at most each sample, and down only off a lip.
      expect(leg.heights[i]).toBeGreaterThanOrEqual(leg.heights[i - 1] - LIP - 1e-9);
      expect(leg.heights[i] - leg.heights[i - 1]).toBeLessThanOrEqual(leg.step + 1e-9);
    }
    // At each edge (every half block from 3 to 4.5, where the top stair's high half is the top), over
    // it by a lip as the piece's front meets it.
    for (const edge of [3, 3.5, 4, 4.5]) expect(heightAt(leg, edge - PIECE_HALF - leg.step), `edge ${edge}`).toBeGreaterThanOrEqual(ground(edge) + LIP - 1e-6);
    expect(leg.heights.at(-1)).toBeCloseTo(2);
  });

  it("comes down onto a far side's top, never its side", () => {
    // A gap of 2 to ground at the same height: the arc is over the far edge by a lip as it gets there.
    const leg = plan(eastward((x) => (x >= 3 && x < 5 ? undefined : 0)), 8);
    expect(airRuns(leg)).toHaveLength(1);
    expect(heightAt(leg, 5 - PIECE_HALF - leg.step)).toBeGreaterThanOrEqual(LIP - 1e-6);
  });

  it("gives a stair's high half the side it faces, Java's shape for corners, and a full top upside down", () => {
    const facing = (weirdo_direction: number, corner = "none") => ({ weirdo_direction, upside_down_bit: false, "minecraft:corner": corner });
    // East, west, south, north.
    expect([stairTop(facing(0), 0.75, 0.5), stairTop(facing(0), 0.25, 0.5)]).toEqual([1, 0.5]);
    expect([stairTop(facing(1), 0.25, 0.5), stairTop(facing(1), 0.75, 0.5)]).toEqual([1, 0.5]);
    expect([stairTop(facing(2), 0.5, 0.75), stairTop(facing(2), 0.5, 0.25)]).toEqual([1, 0.5]);
    expect([stairTop(facing(3), 0.5, 0.25), stairTop(facing(3), 0.5, 0.75)]).toEqual([1, 0.5]);
    expect(stairTop({ weirdo_direction: 0, upside_down_bit: true }, 0.25, 0.5)).toBe(1);
    // Facing east, an outer left corner is high only north-east; an inner right one everywhere but north-west.
    expect([stairTop(facing(0, "outer_left"), 0.75, 0.25), stairTop(facing(0, "outer_left"), 0.75, 0.75)]).toEqual([1, 0.5]);
    expect([stairTop(facing(0, "inner_right"), 0.25, 0.75), stairTop(facing(0, "inner_right"), 0.25, 0.25)]).toEqual([1, 0.5]);
  });
});

describe("a push's height", () => {
  /** What a push of upward strength `v` gives a player going `vy` up (the knockback rig's measurements, docs/spike-results.md). */
  const given = (v: number, vy: number) => Math.min(v, 1.2 * v + 0.49 * (vy - 0.08));

  it("matches the rig's falls and its push in the air", () => {
    // Pushed at -0.2 every tick, falling: -0.24, -0.397, -0.474. At -0.5: -0.6, -0.933, -1.097.
    expect(given(-0.2, -0.24)).toBeCloseTo(-0.397, 3);
    expect(given(-0.2, -0.3968)).toBeCloseTo(-0.474, 3);
    expect(given(-0.5, -0.6)).toBeCloseTo(-0.933, 3);
    expect(given(-0.5, -0.9332)).toBeCloseTo(-1.0965, 3);
    // Rising pushes are what they ask; a push of 0.5 falling at -0.15 gives 0.486 (Sumo's double jump).
    expect(given(0.3, 0.3)).toBe(0.3);
    expect(given(0.5, -0.15)).toBeCloseTo(0.487, 2);
  });

  it("asks for the strength that moves a player as far up or down as planned", () => {
    expect(pushUp(0.3, 0)).toBe(0.3);
    for (const move of [-0.9, -0.5, -0.2, -0.05, 0, 0.1, 0.42])
      for (const vy of [-0.8, -0.3, -0.08, 0, 0.2]) {
        const v = pushUp(move, vy);
        if (v > -1.5 && v < 1) expect(given(v, vy)).toBeCloseTo(move, 6);
      }
  });
});

describe("the ground as the world has it", () => {
  afterEach(() => world.reset());
  const dimension = () => world.getDimension("overworld");
  const space: Space = { index: 0, type: "blue", at: [0.5, 64 + STAND, 0.5], floor: 64, next: [] };

  it("finds the top of the block under a point, a wall's top from inside it, and no ground over the void or water", () => {
    const d = dimension();
    for (let x = -3; x <= 6; x++) d.getBlock({ x, y: 63, z: 0 })?.setType("minecraft:stone");
    for (let y = 64; y <= 66; y++) d.getBlock({ x: 4, y, z: 0 })?.setType("minecraft:stone");
    d.getBlock({ x: 5, y: 63, z: 0 })?.setType("minecraft:water");
    const terrain = new WorldTerrain(d, () => []);
    expect(terrain.ground(2.5, 0.5, 64)).toBeCloseTo(64);
    expect(terrain.ground(4.5, 0.5, 64)).toBeCloseTo(67);
    expect(terrain.ground(5.5, 0.5, 64)).toBeUndefined();
    expect(terrain.ground(20.5, 0.5, 64)).toBeUndefined();
  });

  it("reads a full block's top the server reports as 0 inside it, and no footing in water a ray goes through", () => {
    // The server's raycast (checked 2026-11-20): a full block's top comes back as faceLocation.y 0, a
    // slab's as 0.5, and a ray passes through water to the ground under it.
    const blocks = new Map<string, { typeId: string; isAir: boolean; isLiquid: boolean }>();
    const put = (x: number, y: number, typeId: string) => blocks.set(`${x},${y}`, { typeId, isAir: false, isLiquid: typeId === "minecraft:water" });
    for (let x = 0; x <= 6; x++) put(x, 63, "minecraft:stone");
    put(2, 64, "minecraft:smooth_stone_slab");
    put(4, 64, "minecraft:water");
    const air = { typeId: "minecraft:air", isAir: true, isLiquid: false };
    const blockAt = (x: number, y: number) => blocks.get(`${Math.floor(x)},${Math.floor(y)}`) ?? air;
    const stub = {
      getBlock: (at: { x: number; y: number; z: number }) => ({ ...blockAt(at.x, at.y), location: { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) } }),
      getBlockFromRay: (from: { x: number; y: number; z: number }) => {
        for (let y = Math.floor(from.y); y > 50; y--) {
          const block = blockAt(from.x, y);
          if (block.isAir || block.isLiquid) continue;
          return { block: { ...block, location: { x: Math.floor(from.x), y, z: 0 } }, faceLocation: { x: 0.5, y: block.typeId.endsWith("_slab") ? 0.5 : 0, z: 0.5 } };
        }
        return undefined;
      },
    } as unknown as Dimension;
    const terrain = new WorldTerrain(stub, () => []);
    expect(terrain.ground(0.5, 0.5, 64)).toBeCloseTo(64);
    expect(terrain.ground(2.5, 0.5, 64)).toBeCloseTo(64.5);
    expect(terrain.ground(4.5, 0.5, 64)).toBeUndefined();
  });

  it("reads stairs by their states, stands a piece on a marker's top, and knows a ladder", () => {
    const d = dimension();
    for (let x = -3; x <= 3; x++) d.getBlock({ x, y: 63, z: 0 })?.setType("minecraft:stone");
    d.getBlock({ x: 3, y: 64, z: 0 })?.setPermutation(BlockPermutation.resolve("minecraft:stone_brick_stairs", { weirdo_direction: 0, upside_down_bit: false }));
    d.getBlock({ x: -3, y: 64, z: 0 })?.setPermutation(BlockPermutation.resolve("minecraft:ladder", { facing_direction: 5 }));
    const terrain = new WorldTerrain(d, () => [space]);
    expect(terrain.ground(3.75, 0.5, 64)).toBeCloseTo(65);
    expect(terrain.ground(3.25, 0.5, 64)).toBeCloseTo(64.5);
    expect(terrain.ground(0.5, 0.5, 64)).toBeCloseTo(64 + STAND);
    expect(terrain.ground(1.5, 0.5, 64)).toBeCloseTo(64 + STAND);
    expect(terrain.ground(2.5, 0.5, 64)).toBeCloseTo(64);
    expect(terrain.climbable(-2.5, 64.2, 0.5)).toBe(true);
    expect(terrain.climbable(-1.5, 64.2, 0.5)).toBe(false);
  });
});

describe("the test board", () => {
  const middle: Vec3 = [0, 64, 48];
  const spaces = testBoardSpaces(middle);

  it("has 12 spaces in a loop, Start first, 8 apart on block middles, each at its floor's height", () => {
    expect(spaces).toHaveLength(12);
    expect(spaces[0].type).toBe("start");
    spaces.forEach((space, i) => {
      const next = spaces[(i + 1) % spaces.length];
      expect(space.next).toEqual([next.index]);
      expect(Math.hypot(next.at[0] - space.at[0], next.at[2] - space.at[2])).toBeCloseTo(TEST_SPACING);
      expect(space.floor).toBe(64 + TEST_SPACES[i][2]);
      expect(space.at[1]).toBe(64 + TEST_SPACES[i][2] + STAND);
      expect(Math.abs(space.at[0] % 1)).toBeCloseTo(0.5);
      expect(Math.abs(space.at[2] % 1)).toBeCloseTo(0.5);
    });
  });

  it("lays its blocks inside the board's box, floors first and the water last", () => {
    const { fills, blocks } = testBoardBlocks(middle);
    const box = boardBox(spaces);
    const inside = (at: Vec3) => at[0] >= box.min[0] && at[0] <= box.max[0] && at[2] >= box.min[2] && at[2] <= box.max[2] && at[1] >= 62 && at[1] <= 67;
    for (const fill of fills) expect(inside(fill.from) && inside(fill.to)).toBe(true);
    for (const block of blocks) expect(inside(block.at)).toBe(true);
    expect(blocks.at(-1)?.block).toBe("minecraft:water");
    expect(blocks.filter((block) => block.block === "minecraft:ladder")).toHaveLength(3 * 2 + 3 * 3);
    expect(blocks.filter((block) => block.block === "minecraft:vine")).toHaveLength(3 * 2);
  });

  it("puts every block in the world, ladders and vines on their walls", () => {
    const d = world.getDimension("overworld");
    try {
      layTestBoard(d, middle);
      // The ladder up from space 6 to 7: on the wall south of it, facing north.
      const ladder = d.getBlock({ x: 12, y: 64, z: 48 + 8 });
      expect(ladder?.typeId).toBe("minecraft:ladder");
      expect(ladder?.permutation.getAllStates().facing_direction).toBe(2);
      expect(d.getBlock({ x: 12, y: 64, z: 48 + 9 })?.typeId).toBe("minecraft:smooth_stone");
      // The vines up from space 10 to 11: on the wall north of them.
      expect(d.getBlock({ x: -12, y: 65, z: 48 + 8 })?.permutation.getAllStates().vine_direction_bits).toBe(4);
      // The gap from space 4 to 5 is open all the way down; the water from 9 to 10 sits in its basin.
      expect(d.getBlock({ x: 12, y: 63, z: 48 - 9 })?.isAir).toBe(true);
      expect(d.getBlock({ x: -8, y: 63, z: 48 + 12 })?.typeId).toBe("minecraft:water");
      expect(d.getBlock({ x: -8, y: 62, z: 48 + 12 })?.typeId).toBe("minecraft:stone_bricks");
    } finally {
      world.reset();
    }
  });

  it("walks every stretch, doing what that stretch has", () => {
    const reader = boardReader(spaces, middle);
    // What each stretch's walk does: in the air somewhere (a jump or a fall), and its climbs (1 up, -1 down).
    const expected: { air: boolean; climbs: number[] }[] = [
      { air: false, climbs: [] }, // stairs up 2
      { air: false, climbs: [-1] }, // a ladder down 2
      { air: true, climbs: [] }, // a block up, jumped
      { air: true, climbs: [] }, // a gap of 2 over the void
      { air: false, climbs: [] }, // a slab down
      { air: false, climbs: [1] }, // a ladder up 3
      { air: true, climbs: [] }, // a stair down, then a drop of 2
      { air: false, climbs: [] }, // carpet, snow, a daylight detector, a slab
      { air: true, climbs: [] }, // a gap of 3 over water
      { air: false, climbs: [1] }, // vines up 2
      { air: false, climbs: [] }, // stairs down 2
      { air: true, climbs: [] }, // a hurdle, jumped over
    ];
    spaces.forEach((space, i) => {
      const next = spaces[(i + 1) % spaces.length];
      const leg = planLeg(reader, space.at, next.at, PER_TICK);
      const what = `stretch ${i + 1} to ${((i + 1) % spaces.length) + 1}`;
      expect(leg.blocked, what).toBeUndefined();
      expect(leg.air.some(Boolean), what).toBe(expected[i].air);
      expect(
        leg.climbs.map((climb) => Math.sign(climb.to - climb.from)),
        what,
      ).toEqual(expected[i].climbs);
      expect(leg.heights[0], what).toBeCloseTo(space.at[1]);
      expect(leg.heights.at(-1), what).toBeCloseTo(next.at[1]);
      // Never under the ground it's over, nor a step's jump between two heights without being in the air or on a climb.
      for (let k = 1; k < leg.heights.length; k++) {
        if (leg.air[k] || leg.air[k - 1]) continue;
        const jumpBetween = Math.abs(leg.heights[k] - leg.heights[k - 1]);
        if (jumpBetween > 0.2) expect(leg.climbs.some((climb) => Math.abs(climb.at - sOf(leg, k)) < 0.25), `${what} at ${sOf(leg, k).toFixed(1)}`).toBe(true);
      }
    });
    // The hurdle is one arc, the gaps are each one jump.
    for (const i of [3, 8, 11]) expect(airRuns(planLeg(reader, spaces[i].at, spaces[(i + 1) % 12].at, PER_TICK))).toHaveLength(1);
  });

  it("follows every stretch's plan to its end without ever being stopped, a pushed piece moving down before along", () => {
    const reader = boardReader(spaces, middle);
    spaces.forEach((space, i) => {
      const next = spaces[(i + 1) % spaces.length];
      const walk = followModel(reader, space.at, next.at);
      const what = `stretch ${i + 1} to ${((i + 1) % spaces.length) + 1}`;
      expect(walk.outcome, what).toBe("end");
      expect(walk.stopped, what).toBe(0);
      expect(walk.y, what).toBeCloseTo(next.at[1], 1);
    });
  });
});

describe("a tick's push", () => {
  it("asks along for what takes the piece a step from the speed it has (a push keeps part of it)", () => {
    // A push gives 0.4 x its force plus what's kept of the speed before it (the rig's rule).
    for (const onGround of [true, false])
      for (const velocity of [{ x: 0, y: 0, z: 0 }, { x: 0.4, y: 0, z: 0 }, { x: 0.5, y: 0.2, z: -0.1 }]) {
        const push = knockbackFor({ x: 0.4, z: 0 }, 0, velocity, onGround);
        const keep = onGround ? GROUND_KEEP : AIR_KEEP;
        expect(velocity.x * keep + KNOCKBACK_SPEED * push.x).toBeCloseTo(0.4);
        expect(velocity.z * keep + KNOCKBACK_SPEED * push.z).toBeCloseTo(0);
      }
    // On the ground with nothing to go up, nothing goes up; else the strength that moves it as asked.
    expect(knockbackFor({ x: 0.4, z: 0 }, 0, { x: 0.4, y: 0, z: 0 }, true).strength).toBe(0);
    expect(knockbackFor({ x: 0.4, z: 0 }, 0.3, { x: 0.4, y: 0, z: 0 }, true).strength).toBe(pushUp(0.3, 0));
  });

  it("steers a piece that's off its leg's line back onto it, whichever way the leg goes and whichever side it's on", () => {
    // Pass 2 steered away from the line, so a hair of drift grew by 40% a tick and flung pieces off a
    // long straight run (Golem Gardens' spaces 9 to 16, the user, 2026-11-23). A piece moved exactly
    // as each push asks, starting 0.3 off the line, comes back to it and stays.
    const flat: TerrainReader = { ground: () => 0, climbable: () => false };
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.6, 0.8], [-0.8, 0.6]])
      for (const off of [0.3, -0.3]) {
        const a: Vec3 = [0.5, 0, 0.5];
        const b: Vec3 = [0.5 + dx * 12, 0, 0.5 + dz * 12];
        const leg = legOf(a, b);
        const plan = planLeg(flat, a, b, PER_TICK);
        const state = newFollow();
        // Off to the leg's left (-uz, ux) by `off`.
        const at = { x: a[0] - leg.uz * off, y: 0, z: a[2] + leg.ux * off };
        const sideOf = () => (at.x - a[0]) * -leg.uz + (at.z - a[2]) * leg.ux;
        let last = Math.abs(sideOf());
        let ended = false;
        for (let tick = 0; tick < 60; tick++) {
          const step = followTick(plan, leg, state, at, PER_TICK);
          if (step.kind !== "push") {
            ended = step.kind === "end";
            break;
          }
          at.x += step.want.x;
          at.z += step.want.z;
          const side = Math.abs(sideOf());
          expect(side).toBeLessThanOrEqual(last + 1e-9);
          last = side;
        }
        expect(ended).toBe(true);
        expect(last).toBeLessThan(0.01);
        expect(state.drift).toBeCloseTo(Math.abs(off));
      }
  });

  it("walks to a ladder's foot at the height it's on, climbs it to a lip over the top, and walks off without going back on", () => {
    const reader = eastward(
      (x) => (x < 3 ? 0 : 3),
      (x, y) => x >= 2 && x < 3 && y >= 0 && y < 3,
    );
    const walk = followModel(reader, [0, 0, 0.5], [8, 3, 0.5]);
    expect(walk.outcome).toBe("end");
    expect(walk.stopped).toBe(0);
    // Up at a climb's speed from the floor, never more than a climb's step a tick near the wall.
    const climbing = walk.ticks.filter((tick) => tick.climbing);
    expect(climbing.length).toBeGreaterThanOrEqual(20);
    expect(climbing[0].y).toBeCloseTo(0, 1);
    for (const tick of walk.ticks) if (tick.s > 2 && tick.s < 3) expect(Math.abs(tick.dy)).toBeLessThanOrEqual(0.16);
    // One climb: once off it, never on it again.
    const firstOff = walk.ticks.findIndex((tick, k) => k > 0 && !tick.climbing && walk.ticks[k - 1].climbing);
    expect(walk.ticks.slice(firstOff).some((tick) => tick.climbing)).toBe(false);
    expect(walk.y).toBeCloseTo(3, 1);
  });

  it("is lifted when it stops getting anywhere, and put at the leg's end when that doesn't help", () => {
    // A wall the plan doesn't know about (the ground changed after it was planned): stopped there.
    const planned = planLeg(eastward(() => 0), [0, 0, 0.5], [8, 0, 0.5], PER_TICK);
    const walk = followModel(eastward((x) => (x >= 4 && x < 5 ? 3 : 0)), [0, 0, 0.5], [8, 0, 0.5], planned);
    expect(walk.outcome).toBe("stuck");
    expect(walk.ticks.some((tick) => tick.dy > 0.05)).toBe(true);
  });
});

/** The ground under a piece at `s` along a leg (the highest under its footprint), looked for from about `near`. */
function footGround(reader: TerrainReader, leg: ReturnType<typeof legOf>, s: number, near: number): number | undefined {
  let best: number | undefined;
  for (let d = -PIECE_HALF; d <= PIECE_HALF + 1e-9; d += 0.1)
    for (const c of [-0.25, 0, 0.25]) {
      const g = reader.ground(leg.a[0] + leg.ux * (s + d) - leg.uz * c, leg.a[2] + leg.uz * (s + d) + leg.ux * c, near);
      if (g !== undefined && (best === undefined || g > best)) best = g;
    }
  return best;
}

/**
 * A pushed piece following a leg's plan tick by tick (walk-follow.ts), as the server moves a pushed
 * player (spike/blockparty/walk.ts): each push moves it as asked, up or down first (not into the
 * ground still under it), then along, stopped by anything higher than its feet on the way (no step
 * up, as for a piece in the air); on a climb it goes where it's pushed. `stopped`: the ticks it was
 * stopped along.
 */
function followModel(reader: TerrainReader, from: Vec3, to: Vec3, given?: LegPlan) {
  const leg = legOf(from, to);
  const plan = given ?? planLeg(reader, from, to, PER_TICK);
  const state = newFollow();
  let s = 0;
  let y = from[1];
  let stopped = 0;
  const ticks: { s: number; y: number; dy: number; climbing: boolean }[] = [];
  for (let tick = 0; tick < 200; tick++) {
    const step = followTick(plan, leg, state, { x: leg.a[0] + leg.ux * s, y, z: leg.a[2] + leg.uz * s }, PER_TICK);
    if (step.kind === "end") return { outcome: "end", y, stopped, ticks };
    if (step.kind === "skip") return { outcome: step.why, y, stopped, ticks };
    let y2 = y + step.up;
    const under = footGround(reader, leg, s, y);
    if (!step.climbing && under !== undefined && y2 < under) y2 = under;
    let s2 = s + step.want.x * leg.ux + step.want.z * leg.uz;
    if (!step.climbing)
      for (let m = s + 0.05; m <= s2 + 1e-9; m += 0.05) {
        const g = footGround(reader, leg, m, y2);
        if (g !== undefined && g > y2 + 1e-6) {
          s2 = s;
          stopped++;
          break;
        }
      }
    ticks.push({ s, y, dy: y2 - y, climbing: step.climbing });
    s = s2;
    y = y2;
  }
  return { outcome: "out of time", y, stopped, ticks };
}

/**
 * The test board's blocks as a piece stands on them in game: a look down meets each block's top (a
 * slab's half, a carpet's sixteenth, snow's layers, a daylight detector's 6 pixels, a stair's half by
 * its states), passes through ladders and vines, and finds no footing in water; a look that starts
 * inside a block starts from the first open block over it; on a marker's floor, the marker's top.
 */
function boardReader(spaces: readonly Space[], middle: Vec3): TerrainReader {
  const { fills, blocks } = testBoardBlocks(middle);
  type Cell = { block: string; states: Record<string, string | number | boolean> };
  const cells = new Map<string, Cell>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const { from, to, block } of fills)
    for (let x = from[0]; x <= to[0]; x++) for (let y = from[1]; y <= to[1]; y++) for (let z = from[2]; z <= to[2]; z++) cells.set(key(x, y, z), { block, states: {} });
  for (const { at, block, states } of blocks) cells.set(key(at[0], at[1], at[2]), { block, states });
  // As the server's raycast has them (spike/blockparty/walk.ts): it passes through carpet, and meets
  // snow at its collision, a layer under its look.
  const passable = (cell: Cell) => cell.block === "minecraft:ladder" || cell.block === "minecraft:vine" || cell.block === "minecraft:white_carpet";
  const top = (cell: Cell, fx: number, fz: number): number => {
    if (cell.block.endsWith("_stairs")) return stairTop(cell.states, fx, fz);
    if (cell.block === "minecraft:smooth_stone_slab") return 0.5;
    if (cell.block === "minecraft:snow_layer") return Number(cell.states.height) / 8;
    if (cell.block === "minecraft:daylight_detector") return 6 / 16;
    return 1;
  };
  return {
    ground(x, z, near) {
      const bx = Math.floor(x);
      const bz = Math.floor(z);
      const solid = (y: number) => {
        const cell = cells.get(key(bx, y, bz));
        return cell !== undefined && !passable(cell);
      };
      let y = Math.floor(near + LOOK_UP);
      while (solid(y)) y++;
      for (let cy = y; cy >= near - MAX_DROP; cy--) {
        const cell = cells.get(key(bx, cy, bz));
        if (!cell || passable(cell)) continue;
        if (cell.block === "minecraft:water") return undefined;
        return onMarker(spaces, x, z, cy + top(cell, x - bx, z - bz));
      }
      return undefined;
    },
    climbable: (x, y, z) => CLIMBABLE.has(cells.get(key(Math.floor(x), Math.floor(y), Math.floor(z)))?.block ?? ""),
  };
}
