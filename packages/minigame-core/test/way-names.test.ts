// A fork's way names (src/board/board-map.ts; the user, 2026-11-24): the word on each way's button in
// Block Party's fork box, set in the Panel's space panel.
import { describe, expect, it } from "vitest";
import { BLOCK_PARTY_BOARD, removeSpace, setWayName, spaceProblems, unlinkSpaces, wayNameLabel, WAY_NAMES, type BoardSpace } from "../src/board/board-map.ts";
import { applyEdit, describeEdit } from "../src/map-edit.ts";
import type { MapConfig } from "../src/map-config.ts";

/** Space 1 forks to 2 and 3, which both come back to 1. */
const SPACES: BoardSpace[] = [
  { id: 1, at: [0, 64, 0], type: "start", next: [2, 3] },
  { id: 2, at: [4, 64, 0], type: "blue", next: [1] },
  { id: 3, at: [0, 64, 4], type: "red", next: [1] },
];

describe("a fork's way names", () => {
  it("names a way, changes it, and takes it away", () => {
    const named = setWayName(SPACES, 1, 3, "straight");
    expect(named[0].ways).toEqual({ "3": "straight" });
    const both = setWayName(named, 1, 2, "left");
    expect(both[0].ways).toEqual({ "2": "left", "3": "straight" });
    expect(setWayName(both, 1, 3, "right")[0].ways).toEqual({ "2": "left", "3": "right" });
    expect(setWayName(setWayName(both, 1, 2, undefined), 1, 3, undefined)[0]).toEqual(SPACES[0]);
  });

  it("refuses a name it doesn't know, and a way the space doesn't lead", () => {
    expect(() => setWayName(SPACES, 1, 2, "sideways")).toThrow(/left, straight, right, up, down/);
    expect(() => setWayName(SPACES, 2, 3, "left")).toThrow(/doesn't lead to space 3/);
    expect(() => setWayName(SPACES, 9, 2, "left")).toThrow();
  });

  it("goes with its link, whether the link or the space it leads to is taken away", () => {
    const named = setWayName(setWayName(SPACES, 1, 2, "left"), 1, 3, "straight");
    expect(unlinkSpaces(named, 1, 3)[0].ways).toEqual({ "2": "left" });
    expect(removeSpace(named, 2)[0].ways).toEqual({ "3": "straight" });
    expect(unlinkSpaces(unlinkSpaces(named, 1, 2), 1, 3)[0]).not.toHaveProperty("ways");
  });

  it("is checked with the map's spaces", () => {
    expect(spaceProblems(setWayName(SPACES, 1, 2, "up"), BLOCK_PARTY_BOARD)).toEqual([]);
    expect(spaceProblems([{ ...SPACES[0], ways: { "2": "back" } as never }, SPACES[1], SPACES[2]], BLOCK_PARTY_BOARD)).toEqual(["spaces[0].ways.2 must be one of left, straight, right, up, down"]);
    expect(spaceProblems([{ ...SPACES[0], ways: { "5": "left" } }, SPACES[1], SPACES[2]], BLOCK_PARTY_BOARD)).toEqual(["spaces[0].ways.5: it doesn't lead to space 5"]);
    expect(spaceProblems([{ ...SPACES[0], ways: ["left"] as never }, SPACES[1], SPACES[2]], BLOCK_PARTY_BOARD)).toEqual(["spaces[0].ways must map the spaces it leads to to way names"]);
  });

  it("is a map edit, with words for the undo history", () => {
    const config: MapConfig = { name: "Board", spawns: [], spaces: SPACES };
    const edited = applyEdit(config, { op: "spaceWay", from: 1, to: 2, name: "straight" });
    expect((edited.spaces as BoardSpace[])[0].ways).toEqual({ "2": "straight" });
    expect((applyEdit(edited, { op: "spaceWay", from: 1, to: 2 }).spaces as BoardSpace[])[0].ways).toBeUndefined();
    expect(() => applyEdit(config, { op: "spaceWay", from: 1, to: 2, name: "back" })).toThrow(/a way's name/);
    expect(describeEdit({ op: "spaceWay", from: 1, to: 2, name: "left" })).toBe("name the way from space 1 to space 2");
  });

  it("shows each name as a word", () => {
    expect(WAY_NAMES.map(wayNameLabel)).toEqual(["Left", "Straight", "Right", "Up", "Down"]);
  });
});
