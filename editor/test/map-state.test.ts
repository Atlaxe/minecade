import { describe, expect, it } from "vitest";
import { applyEdit, mapHash, MapEditError, type MapConfig, type MapEdit } from "@minecade/minigame-core/config";
import { MapState } from "../behavior_pack/scripts/map-state.ts";

const start: MapConfig = { name: "Arena", spawns: [[0, 65, 0]] };
const add = (x: number): MapEdit => ({ op: "add", target: { list: "spawns" }, at: [x, 65, 0] });

describe("MapState", () => {
  it("shows edits at once and stays in step as the host answers them", () => {
    const state = new MapState(start);
    expect(state.apply(add(1))).toBe(1);
    expect(state.apply(add(2))).toBe(2);
    expect(state.current.spawns).toHaveLength(3);
    const host1 = applyEdit(start, add(1));
    expect(state.ack(1, mapHash(host1))).toBe(true);
    expect(state.ack(2, mapHash(applyEdit(host1, add(2))))).toBe(true);
  });

  it("notices when the host's copy differs", () => {
    const state = new MapState(start);
    state.apply(add(1));
    expect(state.ack(1, mapHash(start))).toBe(false);
  });

  it("takes the host's whole map and applies newer edits on top", () => {
    const state = new MapState(start);
    state.apply(add(1));
    state.apply(add(2));
    // The host undid edit 1 after applying it; edit 2 is still on its way.
    state.replace(start, 1);
    expect(state.current.spawns).toEqual([[0, 65, 0], [2, 65, 0]]);
    // An edit that no longer fits is dropped.
    state.apply({ op: "remove", target: { list: "spawns" }, index: 1 });
    state.replace({ name: "Arena", spawns: [[0, 65, 0]] }, 2);
    expect(state.current.spawns).toEqual([[0, 65, 0]]);
  });

  it("refuses edits that don't fit, changing nothing", () => {
    const state = new MapState(start);
    expect(() => state.apply({ op: "remove", target: { list: "spawns" }, index: 4 })).toThrow(MapEditError);
    expect(state.current).toBe(start);
    expect(state.apply(add(1))).toBe(1);
  });
});
