// Arena maps: the Arena box every arena map has (its size rules), how an arena fits a slot, and where
// a map's markup lands once its box is placed, turned or not.
import { describe, expect, it } from "vitest";
import { STRUCTURE_REGION, arenaRequirements, arenaTargetId, placeArena, turnedSize, turnsToFit } from "../src/arena-map.ts";
import type { ArenaConfig } from "../src/config.ts";
import { mapChecklist } from "../src/map-checklist.ts";
import type { MapConfig } from "../src/map-config.ts";
import { fitsWithin } from "../src/map-requirements.ts";
import { validateMapConfig } from "../src/map-validate.ts";

const ARENA: ArenaConfig = {
  id: "hotfloor",
  name: "Hot Floor",
  maxPlayers: 4,
  box: { footprint: [40, 60], height: 48 },
  map: { spawns: { min: 4, inside: STRUCTURE_REGION }, spectatorSpawn: true, regions: { floor: { label: "Floor", inside: STRUCTURE_REGION } } },
};

const rules = { kind: "game" as const, maxPlayers: 4, requires: arenaRequirements(ARENA) };

/** A map with an Arena box from 100, 50, 200 to 109, 59, 229 (10 x 10 x 30) and its markup inside. */
function arenaMap(extra: Partial<MapConfig> = {}): MapConfig {
  return {
    name: "Test",
    spawns: [
      [101, 51, 201],
      [102, 51, 201],
      [103, 51, 201],
      [104, 51, 201],
    ],
    spectatorSpawn: [105, 58, 215],
    regions: { [STRUCTURE_REGION]: [{ min: [100, 50, 200], max: [109, 59, 229] }], floor: [{ min: [101, 50, 201], max: [108, 50, 228] }] },
    ...extra,
  };
}

describe("an arena's maps", () => {
  it("are their game's editor entry of their own", () => {
    expect(arenaTargetId("blockparty", "hotfloor")).toBe("blockparty-hotfloor");
  });

  it("need the Arena box besides the arena's own markup", () => {
    const checklist = mapChecklist(arenaMap(), rules);
    expect(checklist.ready).toBe(true);
    expect(checklist.rows.map((row) => row.label)).toEqual(["Spawns", "Spectator spawn", "Arena", "Floor"]);
    const { regions } = arenaMap();
    const without = mapChecklist(arenaMap({ regions: { floor: regions!.floor } }), rules);
    expect(without.ready).toBe(false);
  });

  it("keep the Arena box within the arena's most, either way round", () => {
    const box = (x: number, y: number, z: number) => ({ min: [0, 0, 0] as [number, number, number], max: [x - 1, y - 1, z - 1] as [number, number, number] });
    expect(fitsWithin(box(40, 48, 60), [40, 60], 48)).toBe(true);
    expect(fitsWithin(box(60, 10, 40), [40, 60], 48)).toBe(true);
    expect(fitsWithin(box(40, 10, 40), [40, 60], 48)).toBe(true);
    expect(fitsWithin(box(41, 10, 41), [40, 60], 48)).toBe(false);
    expect(fitsWithin(box(41, 10, 61), [40, 60], 48)).toBe(false);
    expect(fitsWithin(box(10, 49, 10), [40, 60], 48)).toBe(false);
    const big = arenaMap({ regions: { [STRUCTURE_REGION]: [{ min: [100, 50, 200], max: [150, 59, 244] }], floor: arenaMap().regions!.floor } });
    expect(validateMapConfig(big, rules)).toContain("regions.structure[0] is 51x10x45; it must be at most 40 by 60 across");
    const tall = arenaMap({ regions: { [STRUCTURE_REGION]: [{ min: [100, 0, 200], max: [109, 59, 229] }], floor: arenaMap().regions!.floor } });
    expect(validateMapConfig(tall, rules)).toContain("regions.structure[0] is 10x60x30; it must be at most 48 tall");
  });
});

describe("fitting an arena into a slot", () => {
  it("keeps it as it is when it fits, and turns it a quarter when only that fits", () => {
    expect(turnsToFit([30, 10, 50], [40, 60])).toBe(0);
    expect(turnsToFit([50, 10, 30], [40, 60])).toBe(1);
    expect(turnsToFit([30, 10, 30], [40, 60])).toBe(0);
    expect(turnsToFit([70, 10, 30], [40, 60])).toBeUndefined();
    expect(turnedSize([50, 10, 30], 1)).toEqual([30, 10, 50]);
    expect(turnedSize([50, 10, 30], 2)).toEqual([50, 10, 30]);
  });
});

describe("a placed arena map's markup", () => {
  it("moves with its box when it isn't turned", () => {
    const placed = placeArena(arenaMap(), [0, 64, 0]);
    expect(placed.size).toEqual([10, 10, 30]);
    // A whole x and z is the block's middle.
    expect(placed.point([101, 51, 201])).toEqual({ x: 1.5, y: 65, z: 1.5 });
    expect(placed.point([101.25, 51, 201.75, 90, 10])).toEqual({ x: 1.25, y: 65, z: 1.75, yaw: 90, pitch: 10 });
    expect(placed.box({ min: [101, 50, 201], max: [108, 50, 228] })).toEqual({ min: [1, 64, 1], max: [8, 64, 28] });
  });

  it("turns with its box, a quarter clockwise taking east to south", () => {
    // 10 across x, 30 across z: turned, 30 across x and 10 across z.
    const placed = placeArena(arenaMap(), [0, 64, 0], 1);
    expect(placed.size).toEqual([30, 10, 10]);
    // The block at x 1, z 1 of the box (near its west and north sides) ends up at its north-east: x 28, z 1.
    expect(placed.point([101, 51, 201])).toEqual({ x: 28.5, y: 65, z: 1.5 });
    // Facing east (-90) turns to facing south (0); south to west (90); north (180) to east (-90).
    expect(placed.yaw(-90)).toBe(0);
    expect(placed.yaw(0)).toBe(90);
    expect(placed.yaw(180)).toBe(-90);
    expect(placed.point([101, 51, 201, -90, 0])).toMatchObject({ yaw: 0 });
    // The floor, 8 x 28 from x 1, z 1 of the box, becomes 28 x 8 inside the turned box.
    expect(placed.box({ min: [101, 50, 201], max: [108, 50, 228] })).toEqual({ min: [1, 64, 1], max: [28, 64, 8] });
  });

  it("lands every corner inside the turned box, whichever way it turns", () => {
    for (const turns of [0, 1, 2, 3] as const) {
      const placed = placeArena(arenaMap(), [-5, 0, 7], turns);
      const whole = placed.box({ min: [100, 50, 200], max: [109, 59, 229] });
      expect(whole).toEqual({ min: [-5, 0, 7], max: [-5 + placed.size[0] - 1, 9, 7 + placed.size[2] - 1] });
      const corner = placed.point([100, 50, 200]);
      expect(corner.x).toBeGreaterThan(-5);
      expect(corner.x).toBeLessThan(-5 + placed.size[0]);
      expect(corner.z).toBeGreaterThan(7);
      expect(corner.z).toBeLessThan(7 + placed.size[2]);
    }
    // Half a turn puts the box's first block in its far corner.
    expect(placeArena(arenaMap(), [0, 0, 0], 2).point([100, 50, 200])).toEqual({ x: 9.5, y: 0, z: 29.5 });
    // Three quarters: the first block's north-west corner goes to the south-west.
    expect(placeArena(arenaMap(), [0, 0, 0], 3).point([100, 50, 200])).toEqual({ x: 0.5, y: 0, z: 9.5 });
  });

  it("needs the Arena box", () => {
    expect(() => placeArena({ regions: {} }, [0, 0, 0])).toThrow("no Arena box");
  });
});
