// Block Party's minigame arenas (minigames/arenas.ts): every minigame has its editor entry, each
// plays on its test arena while it has no map, and on an arena map it reads its markup where the
// map's Arena box was placed, turned or not.
import { describe, expect, it } from "vitest";
import { mapChecklist, placeArena, STRUCTURE_REGION, arenaRequirements, type MapConfig } from "@minecade/minigame-core/config";
import { ARENAS, MARKUP } from "../behavior_pack/scripts/minigames/arenas.ts";
import { HOT_FLOOR } from "../behavior_pack/scripts/minigames/hot-floor.ts";
import { HUNTER } from "../behavior_pack/scripts/minigames/hunter.ts";
import { MINIGAMES } from "../behavior_pack/scripts/minigames/index.ts";
import { mapField } from "../behavior_pack/scripts/minigames/kit.ts";
import { PAINTERS } from "../behavior_pack/scripts/minigames/painters.ts";
import config from "../game.config.ts";

const ORIGIN = { x: 1000, y: 64, z: 0 };

describe("Block Party's arenas", () => {
  it("are the game's minigames, each an editor entry of its own", () => {
    expect(config.arenas).toBe(ARENAS);
    expect(ARENAS.map((arena) => [arena.id, arena.name])).toEqual(MINIGAMES.map((def) => [def.id, def.name]));
    for (const arena of ARENAS) expect(arena.box).toEqual({ footprint: [40, 60], height: 48 });
  });

  it("each have a test arena with the markup its minigame reads, enough for every seat", () => {
    for (const def of MINIGAMES) {
      const field = def.testField(ORIGIN);
      expect(def.problem?.(field)).toBeUndefined();
      const sides = def.kind === "ffa" ? [1, 1, 1, 1] : def.kind === "2v2" ? [2, 2] : [1, 3];
      expect(def.spawns(field, sides).map((side) => side.length)).toEqual(sides);
    }
  });

  it("play on an arena map's markup, placed and turned to fit", () => {
    const map: MapConfig = {
      name: "Hot Floor test",
      spawns: [
        [10, 1, 10],
        [12, 1, 10],
        [14, 1, 10],
        [16, 1, 10],
      ],
      spectatorSpawn: [15, 12, 2],
      points: {
        [MARKUP.podium]: [
          [12, 4, 44, 180, 0],
          [10, 3, 44, 180, 0],
          [14, 2, 44, 180, 0],
          [16, 1, 44, 180, 0],
        ],
        [MARKUP.podiumCamera]: [[13, 5, 36, 0, 10]],
      },
      regions: { [STRUCTURE_REGION]: [{ min: [0, 0, 0], max: [29, 15, 49] }], [MARKUP.floor]: [{ min: [5, 0, 5], max: [22, 0, 40] }] },
      time: "night",
    };
    expect(mapChecklist(map, { kind: "game", maxPlayers: 4, requires: arenaRequirements(ARENAS[0]) }).ready).toBe(true);
    // 30 x 50 placed a quarter turn: 50 across x, 30 across z.
    const field = mapField(map, placeArena(map, [100, 64, 200], 1));
    expect(field.size).toEqual([50, 16, 30]);
    expect(field.time).toBe(13000);
    expect(HOT_FLOOR.problem?.(field)).toBeUndefined();
    const floor = field.regions(MARKUP.floor)[0];
    expect(floor).toEqual({ min: { x: 109, y: 64, z: 205 }, max: { x: 144, y: 64, z: 222 } });
    // Every spawn stands over the floor, wherever it turned.
    for (const spawn of HOT_FLOOR.spawns(field, [1, 1, 1, 1]).flat()) {
      expect(spawn.x).toBeGreaterThan(floor.min.x);
      expect(spawn.x).toBeLessThan(floor.max.x + 1);
      expect(spawn.z).toBeGreaterThan(floor.min.z);
      expect(spawn.z).toBeLessThan(floor.max.z + 1);
      expect(spawn.y).toBe(65);
    }
    expect(field.watch).toEqual({ x: 147.5, y: 76, z: 215.5 });
    // The podium turns with the arena (the map's z runs down the world's x here): 1st first, its
    // camera still 8 blocks in front of it.
    const podium = field.points(MARKUP.podium);
    expect(podium).toHaveLength(4);
    expect(podium.map((spot) => spot.y)).toEqual([68, 67, 66, 65]);
    const camera = field.points(MARKUP.podiumCamera)[0];
    expect(camera.x - podium[0].x).toBe(8);
  });

  it("ask every arena map for a minigame podium of 4, its camera one a map can do without", () => {
    const base: MapConfig = {
      name: "No podium",
      spawns: [
        [10, 1, 10],
        [12, 1, 10],
        [14, 1, 10],
        [16, 1, 10],
      ],
      spectatorSpawn: [15, 12, 2],
      regions: { [STRUCTURE_REGION]: [{ min: [0, 0, 0], max: [29, 15, 49] }], [MARKUP.floor]: [{ min: [5, 0, 5], max: [22, 0, 40] }] },
    };
    for (const arena of ARENAS) {
      const points = arena.map?.points as Record<string, { label?: string; count?: number }>;
      expect(points[MARKUP.podium]).toMatchObject({ label: "Minigame podium", count: 4 });
      expect(points[MARKUP.podiumCamera]).toMatchObject({ label: "Podium camera" });
      expect(arena.map?.adjustable?.[`points.${MARKUP.podiumCamera}`]).toEqual({ off: true });
    }
    const requires = arenaRequirements(ARENAS[0]);
    expect(mapChecklist(base, { kind: "game", maxPlayers: 4, requires }).ready).toBe(false);
    const podium = { [MARKUP.podium]: [0, 1, 2, 3].map((i): [number, number, number] => [10 + i * 2, 1, 44]) };
    expect(mapChecklist({ ...base, points: podium }, { kind: "game", maxPlayers: 4, requires }).ready).toBe(false);
    expect(mapChecklist({ ...base, points: podium, requirements: { [`points.${MARKUP.podiumCamera}`]: false } }, { kind: "game", maxPlayers: 4, requires }).ready).toBe(true);
  });

  it("say why an arena map can't be played, and its test arena stands in", () => {
    const base: MapConfig = { name: "Small", spawns: [], regions: { [STRUCTURE_REGION]: [{ min: [0, 0, 0], max: [9, 9, 9] }], [MARKUP.floor]: [{ min: [0, 0, 0], max: [4, 0, 4] }] } };
    const field = mapField(base, placeArena(base, [0, 0, 0]));
    expect(HOT_FLOOR.problem?.(field)).toBe("its Floor box fits 1 x 1 tiles of 3 x 3, and it needs at least 2 each way");
    expect(HUNTER.problem?.(field)).toBe("its arena map has no Goal box");
    expect(PAINTERS.problem?.(field)).toBeUndefined();
  });
});
