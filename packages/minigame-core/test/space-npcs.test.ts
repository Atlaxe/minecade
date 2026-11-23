// A space's NPC spot and a Shop space's Villager (src/board/board-map.ts; the user, 2026-11-23;
// docs/plans/block-party.md "NPC spots").
import { describe, expect, it } from "vitest";
import { setSpaceNpc, setVillager, spaceNpc, spaceProblems, villagerIndexes, type BoardSpace } from "../src/board/board-map.ts";
import { applyEdit } from "../src/map-edit.ts";
import { validateMapConfig } from "../src/map-validate.ts";
import type { MapConfig } from "../src/map-config.ts";
import { BLOCK_PARTY_BOARD } from "../src/board/board-map.ts";

const SPACES: BoardSpace[] = [
  { id: 1, at: [0, 64, 0], type: "start", next: [2] },
  { id: 2, at: [4, 64, 0], type: "shop", next: [3] },
  { id: 3, at: [8, 64, 0], type: "blue", next: [1], star: true },
];

describe("a space's NPC spot", () => {
  it("names who stands there: the space type's NPC, else Chris at a Star candidate", () => {
    expect(SPACES.map(spaceNpc)).toEqual([undefined, "Villager", "Chris"]);
    expect(spaceNpc({ type: "versus" })).toBe("Referee");
    expect(spaceNpc({ type: "red" })).toBeUndefined();
  });

  it("is placed with a facing and taken away", () => {
    const placed = setSpaceNpc(SPACES, 2, [5, 64, 2, 180, 0]);
    expect(placed[1].npc).toEqual([5, 64, 2, 180, 0]);
    expect(setSpaceNpc(placed, 2, undefined)[1]).toEqual(SPACES[1]);
  });

  it("must be a position, and inside the map's bounds", () => {
    expect(spaceProblems([{ id: 1, at: [0, 64, 0], npc: [1, 2] }], undefined)).toEqual(["spaces[0].npc must be [x, y, z] or [x, y, z, yaw, pitch]"]);
    const config: MapConfig = { name: "Gardens", spawns: [], bounds: { min: [-10, 60, -10], max: [10, 80, 10] }, spaces: setSpaceNpc(SPACES, 2, [50, 64, 0]) };
    expect(validateMapConfig(config, { kind: "game", requires: { board: BLOCK_PARTY_BOARD } }).filter((problem) => problem.includes("NPC"))).toEqual([`space 2's NPC spot [50,64,0] is outside "bounds"`]);
  });
});

describe("a Shop space's Villager", () => {
  it("keeps only what isn't the plain look, in lower case", () => {
    const dressed = setVillager(SPACES, 2, { biome: "Desert", profession: "unskilled", level: "Gold" });
    expect(dressed[1].villager).toEqual({ biome: "desert", level: "gold" });
    expect(setVillager(dressed, 2, { biome: "plains" })[1].villager).toBeUndefined();
    expect(() => setVillager(SPACES, 2, { biome: "Moon" })).toThrow("villager.biome must be one of Plains");
  });

  it("is its entity's properties by index, 0 for what's left out", () => {
    expect(villagerIndexes({ biome: "snow", profession: "librarian", level: "diamond" })).toEqual({ biome: 4, profession: 5, level: 4 });
    expect(villagerIndexes(undefined)).toEqual({ biome: 0, profession: 0, level: 0 });
  });

  it("is a map edit, and a badly shaped one is named", () => {
    let config: MapConfig = { name: "Gardens", spawns: [], spaces: SPACES };
    config = applyEdit(config, { op: "spaceVillager", id: 2, villager: { profession: "cleric" } });
    config = applyEdit(config, { op: "spaceNpc", id: 2, at: [4, 64, 2, 0, 0] });
    expect(config.spaces?.[1]).toEqual({ ...SPACES[1], npc: [4, 64, 2, 0, 0], villager: { profession: "cleric" } });
    expect(spaceProblems([{ id: 1, at: [0, 64, 0], villager: { hat: "top", level: 9 } }], undefined)).toEqual(["spaces[0].villager.hat isn't a Villager's look (biome, profession or level)", "spaces[0].villager.level must be one of Stone, Iron, Gold, Emerald, Diamond"]);
  });
});
