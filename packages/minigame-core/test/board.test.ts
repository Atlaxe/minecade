// The board kit (src/board): spaces on a map, their edits, the dealer and the board's checks
// (docs/plans/block-party.md, "Board maps" and "/boardcheck").
import { describe, expect, it } from "vitest";
import { boardLoop, checkBoard, dealAgain, dealType, reportLines, typeForNewSpace } from "../src/board/board-check.ts";
import { addSpace, BLOCK_PARTY_BOARD, linkSpaces, moveSpace, removeSpace, retypeSpaces, setSpace, spaceProblems, unlinkSpaces, type BoardSpace } from "../src/board/board-map.ts";

const BOARD = BLOCK_PARTY_BOARD;

/** A ring of `count` spaces placed one after another as an editor would (each dealt as it's placed), closed back to Start. */
function ring(count: number): BoardSpace[] {
  let spaces: BoardSpace[] = [];
  let previous: number | undefined;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const at: [number, number, number] = [Math.round(Math.cos(angle) * 30), 64, Math.round(Math.sin(angle) * 30)];
    const type = typeForNewSpace(spaces, at, BOARD, previous);
    const placed = addSpace(spaces, at, type, previous);
    spaces = placed.spaces;
    previous = placed.id;
  }
  return linkSpaces(spaces, previous!, spaces[0].id);
}

/** A seeded random, so dealing again is the same every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("spaces", () => {
  it("chains each new space from the previous one, the first being Start", () => {
    const one = addSpace([], [0, 64, 0], "start");
    const two = addSpace(one.spaces, [4, 64, 0], "blue", one.id);
    const branch = addSpace(two.spaces, [4, 64, 4], "red", one.id);
    expect(branch.spaces).toEqual([
      { id: 1, at: [0, 64, 0], type: "start", next: [2, 3] },
      { id: 2, at: [4, 64, 0], type: "blue" },
      { id: 3, at: [4, 64, 4], type: "red" },
    ]);
    expect(typeForNewSpace([], [0, 64, 0], BOARD)).toBe("start");
  });

  it("links, unlinks, moves and removes, keeping ids and dropping links to what's gone", () => {
    let spaces = addSpace(addSpace([], [0, 64, 0], "start").spaces, [4, 64, 0], "blue", 1).spaces;
    spaces = linkSpaces(spaces, 2, 1);
    expect(linkSpaces(spaces, 2, 1)).toEqual(spaces);
    expect(() => linkSpaces(spaces, 1, 1)).toThrow();
    expect(spaces[1].next).toEqual([1]);
    expect(unlinkSpaces(spaces, 2, 1)[1].next).toBeUndefined();
    expect(moveSpace(spaces, 2, [8, 65, 0])[1]).toEqual({ id: 2, at: [8, 65, 0], type: "blue", next: [1] });
    expect(removeSpace(spaces, 2)).toEqual([{ id: 1, at: [0, 64, 0], type: "start" }]);
    expect(() => removeSpace(spaces, 9)).toThrow();
  });

  it("allows at most three exits", () => {
    let spaces = addSpace([], [0, 64, 0], "start").spaces;
    for (let i = 0; i < 3; i++) spaces = addSpace(spaces, [i, 64, 4], "blue", 1).spaces;
    expect(() => addSpace(spaces, [9, 64, 9], "blue", 1)).toThrow(/3 spaces/);
  });

  it("keeps an opening spot a Star candidate, and retypes several at once", () => {
    const spaces = addSpace([], [0, 64, 0], "start").spaces;
    expect(setSpace(spaces, 1, { opening: true })[0].opening).toBeUndefined();
    expect(setSpace(spaces, 1, { star: true, opening: true, locked: true })[0]).toMatchObject({ star: true, opening: true, locked: true });
    expect(setSpace(setSpace(spaces, 1, { star: true, opening: true }), 1, { star: false })[0].opening).toBeUndefined();
    expect(retypeSpaces(spaces, { 1: "blue" })[0].type).toBe("blue");
  });

  it("names a map's badly shaped spaces", () => {
    expect(spaceProblems(undefined, BOARD)).toEqual([]);
    expect(spaceProblems({}, BOARD)).toEqual(['"spaces" must be a list of { "id", "at": [x, y, z], "next": [ids] }']);
    expect(
      spaceProblems(
        [
          { id: 1, at: [0, 64, 0], next: [2, 7], type: "start" },
          { id: 1, at: [0, 64], type: "lava", star: "yes" },
        ],
        BOARD,
      ),
    ).toEqual([
      "spaces[1].id 1 is used twice",
      "spaces[1].at must be [x, y, z]",
      "spaces[1].type must be one of start, blue, red, item, shop, chance, warden, versus, happening",
      "spaces[1].star must be true or false",
      "spaces[0].next names space 2, which isn't on the map",
      "spaces[0].next names space 7, which isn't on the map",
    ]);
  });
});

describe("dealing", () => {
  it("keeps the spaces after Start safe and never puts two Reds in a row", () => {
    const spaces = ring(40);
    const loop = boardLoop(spaces, BOARD);
    expect(loop.closed).toBe(true);
    const types = loop.spaces.map((id) => spaces.find((space) => space.id === id)!.type);
    expect(types[0]).toBe("start");
    for (const type of types.slice(1, 5)) expect(["blue", "item"]).toContain(type);
    types.forEach((type, i) => expect(type === "red" && types[(i + 1) % types.length] === "red").toBe(false));
  });

  it("deals close to the shares", () => {
    const report = checkBoard(ring(40), BOARD);
    const blue = report.counts.find((count) => count.type === "blue")!;
    expect(Math.abs(blue.have - blue.target)).toBeLessThanOrEqual(2);
    expect(report.counts.reduce((sum, count) => sum + count.have, 0)).toBe(39);
  });

  it("deals the first space Start and falls back to the biggest share when every type breaks a rule", () => {
    const spaces = addSpace([], [0, 64, 0], "start").spaces;
    expect(dealType([{ id: 5, at: [0, 64, 0] }], 5, BOARD)).toBe("start");
    expect(["blue", "item"]).toContain(dealType(addSpace(spaces, [4, 64, 0], "", 1).spaces, 2, BOARD));
  });

  it("deals again, leaving locked spaces and Start alone, and never doing worse than the board was", () => {
    const spaces = setSpace(ring(40), 6, { type: "warden", locked: true });
    const before = checkBoard(spaces, BOARD);
    const changed = dealAgain(spaces, BOARD, seeded(7), 10);
    expect(changed[1]).toBeUndefined();
    expect(changed[6]).toBeUndefined();
    const after = checkBoard(retypeSpaces(spaces, changed), BOARD);
    expect(after.errors.length * 1000 + after.warnings.length).toBeLessThanOrEqual(before.errors.length * 1000 + before.warnings.length);
    expect(dealAgain(spaces, BOARD, seeded(7), 10)).toEqual(changed);
  });
});

describe("the board's checks", () => {
  it("passes a closed loop with its Star candidates and two opening spots", () => {
    let spaces = ring(40);
    for (const id of [6, 13, 20, 27, 34, 39, 17]) spaces = setSpace(spaces, id, { star: true });
    spaces = setSpace(setSpace(spaces, 13, { opening: true }), 20, { opening: true });
    const report = checkBoard(spaces, BOARD);
    expect(report.errors).toEqual([]);
    expect(report.loop).toEqual({ spaces: Array.from({ length: 40 }, (_, i) => i + 1), closed: true });
  });

  it("names a missing Start, dead ends, spaces cut off, and too few Star candidates and opening spots", () => {
    const open = addSpace(addSpace([], [0, 64, 0], "start").spaces, [4, 64, 0], "blue", 1).spaces;
    const report = checkBoard([...open, { id: 9, at: [9, 64, 9], type: "blue", next: [1] }], BOARD);
    expect(report.errors.map((error) => error.text)).toEqual([
      "1 space can't be reached from Start.",
      "1 space leads nowhere: link it on.",
      "A board this size needs at least 1 Star candidate (about one per 4 to 6 spaces); it has 0.",
      "A board needs 2 opening spots (Star candidates the first Star can be at); it has 0.",
    ]);
    expect(report.errors[0].spaces).toEqual([9]);
    expect(checkBoard(retypeSpaces(open, { 1: "blue" }), BOARD).errors[0].text).toBe("A board needs exactly one Start; it has 0.");
    expect(checkBoard([], BOARD).errors).toEqual([]);
  });

  it("measures a shortcut against the loop", () => {
    let spaces = ring(40);
    // From space 10 straight to space 16: one space between them instead of five.
    const placed = addSpace(spaces, [0, 64, 0], "blue", 10);
    spaces = linkSpaces(placed.spaces, placed.id, 16);
    const report = checkBoard(spaces, BOARD);
    expect(report.shortcuts).toEqual([{ from: 10, rejoins: 16, length: 2, saves: 4 }]);
    expect(report.warnings.some((warning) => warning.text.startsWith("The shortcut from space 10 saves 4 spaces (10% of the loop)"))).toBe(false);
  });

  it("warns about Reds in a row, Wardens too close and a long stretch with no Item", () => {
    let spaces = ring(40);
    const items = spaces.filter((space) => space.type === "item" || space.type === "shop").map((space) => space.id);
    spaces = retypeSpaces(spaces, Object.fromEntries([...items.map((id) => [id, "blue"]), [20, "red"], [21, "red"], [30, "warden"], [32, "warden"]]));
    const texts = checkBoard(spaces, BOARD).warnings.map((warning) => warning.text);
    expect(texts).toContain("Two Red spaces in a row (space 20).");
    expect(texts.some((text) => text.startsWith("Warden spaces 30 and 32 are 2 spaces apart"))).toBe(true);
    expect(texts).toContain("The loop has no Item or Shop.");
  });

  it("writes the report for chat", () => {
    const lines = reportLines(checkBoard(ring(12), BOARD), (id) => `space ${id} at 1, 2, 3`);
    expect(lines[0]).toMatch(/^Error: /);
    expect(lines.some((line) => line.startsWith("Types: Blue "))).toBe(true);
    expect(lines).toContain("The loop: 12 spaces.");
  });
});
