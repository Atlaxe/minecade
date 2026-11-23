// A board's path bends and golems in the map viewer (board-points.ts): their keys, the edits a click
// or a drag makes, and how they're drawn and listed.
import { BLOCK_PARTY_BOARD, applyEdit, type EditorRules, type MapConfig } from "@minecade/minigame-core/config";
import { describe, expect, it } from "vitest";
import { bendKey, boardPointFace, boardPointOf, boardPointPosition, boardPointRemove, boardPointSet, golemBendKey, golemOf, golemSpotKey, placeEdit } from "../board-points.ts";
import { buildMarkup } from "../markup.ts";

const RULES: EditorRules = { kind: "game", maxPlayers: 4, requires: { board: BLOCK_PARTY_BOARD } };

const CONFIG: MapConfig = {
  name: "Gardens",
  spawns: [],
  spaces: [
    { id: 1, at: [0, 64, 0], type: "start", next: [2], bends: { "2": [[4, 64, 3]] } },
    { id: 2, at: [10, 64, 0], type: "blue", next: [1] },
  ],
  golems: [{ post: [5, 64, 0, 90, 0], rest: [5, 64, 6, 0, 0], before: 1, after: 2, bends: [[7, 64, 3]] }, {}, {}, {}],
};

describe("board points", () => {
  it("name bends and golem parts by key, and a golem's keys its golem", () => {
    expect(boardPointOf(bendKey(1, 2, 0))).toEqual({ kind: "bend", from: 1, to: 2, index: 0 });
    expect(boardPointOf(golemSpotKey(3, "rest"))).toEqual({ kind: "golem", golem: 3, part: "rest" });
    expect(boardPointOf(golemBendKey(2, 4))).toEqual({ kind: "golemBend", golem: 2, index: 4 });
    expect(boardPointOf("golem:1")).toBeUndefined();
    expect([golemOf("golem:1"), golemOf(golemSpotKey(4, "post")), golemOf(golemBendKey(2, 0)), golemOf("golem:5"), golemOf("space:1")]).toEqual([1, 4, 2, undefined, undefined]);
  });

  it("find, move, turn and remove them as map edits", () => {
    const bend = boardPointOf(bendKey(1, 2, 0))!;
    const post = boardPointOf(golemSpotKey(1, "post"))!;
    expect(boardPointPosition(CONFIG, bend)).toEqual([4, 64, 3]);
    expect(boardPointSet(CONFIG, bend, [4.7, 65, 2.2])).toEqual({ op: "moveBend", from: 1, to: 2, index: 0, at: [4, 65, 2] });
    // A golem's spot keeps its facing when moved.
    expect(boardPointSet(CONFIG, post, [6, 64, 0])).toEqual({ op: "setGolem", golem: 1, post: [6, 64, 0, 90, 0] });
    expect(boardPointFace(CONFIG, post, 45)).toEqual({ op: "setGolem", golem: 1, post: [5, 64, 0, 45, 0] });
    expect(boardPointFace(CONFIG, bend, 45)).toBeUndefined();
    expect(boardPointRemove(post)).toEqual({ op: "setGolem", golem: 1, clear: ["post"] });
    expect(applyEdit(CONFIG, boardPointRemove(bend)).spaces?.[0].bends).toBeUndefined();
  });

  it("place a golem's post facing the space before it, and its rest spot facing its post", () => {
    expect(placeEdit(CONFIG, { kind: "golem", golem: 1, part: "post" }, [5, 64, 4])).toEqual({ op: "setGolem", golem: 1, post: [5, 64, 4, 129, 0] });
    expect(placeEdit(CONFIG, { kind: "golem", golem: 1, part: "rest" }, [5, 64, 9])).toEqual({ op: "setGolem", golem: 1, rest: [5, 64, 9, 180, 0] });
    expect(placeEdit(CONFIG, { kind: "bend", from: 1, to: 2 }, [2.5, 64, 1.5])).toEqual({ op: "addBend", from: 1, to: 2, at: [2, 64, 1] });
  });

  it("are drawn: bends as dots on their link's line, golems' spots, bends and walks, and a Golems list under Board", () => {
    const markup = buildMarkup(CONFIG, RULES);
    const byKey = Object.fromEntries(markup.points.map((point) => [point.key, point]));
    expect(byKey[bendKey(1, 2, 0)]).toMatchObject({ shape: { kind: "dot" }, at: { x: 4.5, y: 64, z: 3.5 } });
    expect(byKey[golemSpotKey(1, "post")]).toMatchObject({ shape: { kind: "player" }, yaw: 90, faced: true });
    expect(byKey[golemBendKey(1, 0)]).toMatchObject({ shape: { kind: "dot" } });
    expect(markup.links.find((link) => link.key === "link:1>2")?.via).toEqual([{ x: 4.5, y: 64, z: 3.5 }]);
    expect(markup.links.find((link) => link.key === "golem:1")).toMatchObject({ from: { x: 5.5, y: 64, z: 0.5 }, via: [{ x: 7.5, y: 64, z: 3.5 }], to: { x: 5.5, y: 64, z: 6.5 } });
    const board = markup.sections.find((section) => section.title === "Board");
    expect(board?.lists.map((list) => list.label)).toEqual(["Spaces", "Golems"]);
    expect(board?.lists[1].entries.map((entry) => entry.detail)).toEqual(["blocks 1 to 2, starts on its post", "not set", "not set", "not set"]);
  });
});
