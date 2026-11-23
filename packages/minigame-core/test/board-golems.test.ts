// A board's path bends and golems (src/board: board-map.ts's bends, board-golems.ts; the user's
// design for Golem Gardens, 2026-11-22; docs/plans/block-party.md "Golems" and "Bends").
import { describe, expect, it } from "vitest";
import { addGolemBend, checkGolems, golemPath, golemProblems, golemsOf, golemsWithoutSpace, moveGolemBend, removeGolemBend, setGolem, type BoardGolem } from "../src/board/board-golems.ts";
import { addBend, addSpace, bendSlot, clearBends, linkPath, moveBend, removeBend, removeSpace, spaceProblems, unlinkSpaces, type BoardSpace } from "../src/board/board-map.ts";
import { applyEdit } from "../src/map-edit.ts";
import type { MapConfig } from "../src/map-config.ts";

/** Start at the origin, then spaces 2 and 3 along x, 3 leading back to Start, and 1 also to 3 (a fork). */
function board(): BoardSpace[] {
  let spaces = addSpace([], [0, 64, 0], "start").spaces;
  spaces = addSpace(spaces, [10, 64, 0], "blue", 1).spaces;
  spaces = addSpace(spaces, [10, 64, 10], "blue", 2).spaces;
  return spaces.map((space) => (space.id === 3 ? { ...space, next: [1] } : space.id === 1 ? { ...space, next: [2, 3] } : space));
}

describe("a link's bends", () => {
  it("slots each bend into the leg it's nearest, whatever order they're clicked in", () => {
    let spaces = board();
    spaces = addBend(spaces, 1, 2, [7, 64, 2]);
    spaces = addBend(spaces, 1, 2, [3, 64, 2]);
    spaces = addBend(spaces, 1, 2, [5, 64, 3]);
    expect(spaces[0].bends).toEqual({ "2": [[3, 64, 2], [5, 64, 3], [7, 64, 2]] });
    expect(linkPath(spaces, 1, 2)).toEqual([[0, 64, 0], [3, 64, 2], [5, 64, 3], [7, 64, 2], [10, 64, 0]]);
    expect(bendSlot([0, 0, 0], [], [10, 0, 0], [5, 0, 1])).toBe(0);
  });

  it("moves, removes and clears bends, and a link with none is straight", () => {
    let spaces = addBend(addBend(board(), 1, 2, [3, 64, 2]), 1, 3, [2, 64, 6]);
    spaces = moveBend(spaces, 1, 2, 0, [4, 65, 2]);
    expect(spaces[0].bends).toEqual({ "2": [[4, 65, 2]], "3": [[2, 64, 6]] });
    spaces = removeBend(spaces, 1, 2, 0);
    expect(spaces[0].bends).toEqual({ "3": [[2, 64, 6]] });
    spaces = clearBends(spaces, 1, 3);
    expect(spaces[0].bends).toBeUndefined();
    expect(() => addBend(spaces, 2, 1, [0, 0, 0])).toThrow("doesn't lead to");
    expect(() => removeBend(spaces, 1, 2, 0)).toThrow("no bend 1");
  });

  it("drops a link's bends when the link or a space goes", () => {
    const bent = addBend(addBend(board(), 1, 2, [3, 64, 2]), 1, 3, [2, 64, 6]);
    expect(unlinkSpaces(bent, 1, 2)[0].bends).toEqual({ "3": [[2, 64, 6]] });
    expect(removeSpace(bent, 3)[0]).toEqual({ id: 1, at: [0, 64, 0], type: "start", next: [2], bends: { "2": [[3, 64, 2]] } });
  });

  it("names badly shaped bends", () => {
    const spaces = [
      { id: 1, at: [0, 64, 0], next: [2], bends: { "2": [[1, 2]], "3": [[1, 2, 3]] } },
      { id: 2, at: [4, 64, 0], bends: [] },
    ];
    expect(spaceProblems(spaces, undefined)).toEqual(["spaces[0].bends.2 must be a list of [x, y, z]", "spaces[0].bends.3: it doesn't lead to space 3", "spaces[1].bends must map the spaces it leads to to lists of [x, y, z]"]);
  });
});

describe("golems", () => {
  const post: [number, number, number, number, number] = [5, 64, 0, 90, 0];
  const rest: [number, number, number, number, number] = [5, 64, 4, 0, 0];
  const set = (golems: BoardGolem[], i: number, before = 1, after = 2) => setGolem(golems, i, { post, rest, before, after });

  it("keeps all four golems once any is set, and none when nothing is", () => {
    const golems = setGolem([], 2, { before: 1 });
    expect(golems).toEqual([{}, {}, { before: 1 }, {}]);
    expect(setGolem(golems, 2, { clear: ["before"] })).toEqual([]);
    expect(golemsOf({ golems: [{ after: 2 }] })).toEqual([{ after: 2 }, {}, {}, {}]);
  });

  it("slots a golem's bends into its walk, its post to its rest spot", () => {
    let golems = set([], 0);
    golems = addGolemBend(golems, 0, [6, 64, 3]);
    golems = addGolemBend(golems, 0, [6, 64, 1]);
    expect(golemPath(golems[0])).toEqual([[5, 64, 0], [6, 64, 1], [6, 64, 3], [5, 64, 4]]);
    golems = moveGolemBend(golems, 0, 1, [7, 64, 3]);
    golems = removeGolemBend(golems, 0, 0);
    expect(golems[0].bends).toEqual([[7, 64, 3]]);
    expect(() => removeGolemBend(golems, 0, 4)).toThrow("Golem 1 has no bend 5");
    expect(() => setGolem(golems, 4, {})).toThrow("golems 1 to 4");
  });

  it("checks that every golem is set and stands on a path between two spaces, one golem a path", () => {
    const spaces = board();
    expect(checkGolems([], spaces)).toEqual([]);
    let golems = set(set(set([], 0), 1, 1, 3), 2, 2, 3);
    expect(checkGolems(golems, spaces).map((finding) => finding.text)).toEqual(["Golem 4 needs a post, a rest spot, the space before it and the space after it."]);
    golems = set(golems, 3, 1, 2);
    expect(checkGolems(golems, spaces).map((finding) => finding.text)).toEqual(["Golem 1 and Golem 4 block the same path, space 1 to 2."]);
    golems = set(golems, 3, 2, 1);
    expect(checkGolems(golems, spaces).map((finding) => finding.text)).toEqual(["Golem 4: space 2 doesn't lead to space 1."]);
    golems = set(golems, 3, 3, 9);
    expect(checkGolems(golems, spaces).map((finding) => finding.text)).toEqual(["Golem 4's space 9 isn't on the map."]);
    golems = set(golems, 3, 3, 1);
    expect(checkGolems(golems, spaces)).toEqual([]);
    // A removed space's golem no longer names it.
    expect(golemsWithoutSpace(golems, 3)[3]).toEqual({ post, rest, after: 1 });
  });

  it("names badly shaped golems", () => {
    expect(golemProblems(undefined)).toEqual([]);
    expect(golemProblems([{ post: [1, 2], before: 0, bends: [[1, 2, 3]], hat: true }])).toEqual(["golems[0].post must be [x, y, z] or [x, y, z, yaw, pitch]", "golems[0].before must be a space id", "golems[0].hat isn't a golem's part"]);
  });

  it("are map edits: a removed space's golems forget it", () => {
    let config: MapConfig = { name: "Gardens", spawns: [], spaces: board() };
    config = applyEdit(config, { op: "setGolem", golem: 1, post, rest, before: 3, after: 1 });
    config = applyEdit(config, { op: "addBend", from: 1, to: 2, at: [5, 64, 1] });
    expect(Object.keys(config)).toEqual(["name", "spawns", "spaces", "golems"]);
    config = applyEdit(config, { op: "removeSpace", id: 3 });
    expect(config.golems?.[0]).toEqual({ post, rest, after: 1 });
    expect(config.spaces?.[0].bends).toEqual({ "2": [[5, 64, 1]] });
  });
});
