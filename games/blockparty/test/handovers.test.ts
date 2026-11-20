import { describe, expect, it } from "vitest";
import { HALF_AWAY, beatsOf, offToward, sameToken, shotsOf, type Pass } from "../behavior_pack/scripts/handovers.ts";
import { SKY } from "../behavior_pack/scripts/tokens.ts";

const coins = (from: string, to: string, count: number): Pass => ({ from, to, token: "coin", count });

describe("Block Party's hand-overs", () => {
  it("shows one seat losing coins, then the one gaining them", () => {
    const beats = beatsOf([coins("sam", "kim", 10)]);
    expect(beats).toEqual([{ from: "sam", out: [{ token: "coin", ways: [{ to: "kim", count: 10 }] }], takers: [{ to: "kim", lands: [{ token: "coin", count: 10 }] }] }]);
    expect(shotsOf(beats)).toEqual(["sam", "kim"]);
  });

  it("cuts to each seat gaining from the same one before the next one losing (Hush Money)", () => {
    const beats = beatsOf([coins("alex", "sam", 5), coins("alex", "kim", 5), coins("alex", "jo", 5)]);
    expect(beats).toHaveLength(1);
    // Everything Alex pays leaves in one stream, then each taker in the order paid.
    expect(beats[0].out).toEqual([{ token: "coin", ways: [{ to: "sam", count: 5 }, { to: "kim", count: 5 }, { to: "jo", count: 5 }] }]);
    expect(shotsOf(beats)).toEqual(["alex", "sam", "kim", "jo"]);
  });

  it("goes giver by giver in the order each first gave, and shoots a seat once when it gains then gives (Gift Exchange)", () => {
    const glove: Pass = { from: "alex", to: "sam", token: { kind: "item", id: "glove" }, count: 1 };
    const pearl: Pass = { from: "sam", to: "kim", token: { kind: "item", id: "ender_pearl" }, count: 1 };
    const totem: Pass = { from: "kim", to: "alex", token: { kind: "item", id: "golden_totem" }, count: 1 };
    const beats = beatsOf([glove, pearl, totem]);
    expect(beats.map((beat) => beat.from)).toEqual(["alex", "sam", "kim"]);
    expect(shotsOf(beats)).toEqual(["alex", "sam", "kim", "alex"]);
  });

  it("shows a swap both ways as two givers", () => {
    const mine: Pass = { from: "alex", to: "sam", token: { kind: "item", id: "glove" }, count: 1 };
    const theirs: Pass = { from: "sam", to: "alex", token: { kind: "item", id: "lightning" }, count: 1 };
    expect(shotsOf(beatsOf([mine, theirs]))).toEqual(["alex", "sam", "alex"]);
  });

  it("makes one pass of the same thing passed twice between the same two, and leaves out nothing and oneself", () => {
    const beats = beatsOf([coins("sam", "kim", 3), coins("sam", "kim", 4), coins("kim", "kim", 9), coins("alex", "kim", 0)]);
    expect(beats).toEqual([{ from: "sam", out: [{ token: "coin", ways: [{ to: "kim", count: 7 }] }], takers: [{ to: "kim", lands: [{ token: "coin", count: 7 }] }] }]);
  });

  it("keeps a giver's coins and Star apart, each in its own stream", () => {
    const beats = beatsOf([coins("sam", "kim", 5), { from: "sam", to: "kim", token: "star", count: 1 }]);
    expect(beats[0].out.map((flow) => flow.token)).toEqual(["coin", "star"]);
    expect(beats[0].takers[0].lands).toEqual([
      { token: "coin", count: 5 },
      { token: "star", count: 1 },
    ]);
  });

  it("tells tokens apart: coins, Stars, and each item or die", () => {
    expect(sameToken("coin", "coin")).toBe(true);
    expect(sameToken("coin", "star")).toBe(false);
    expect(sameToken({ kind: "item", id: "glove" }, { kind: "item", id: "glove" })).toBe(true);
    expect(sameToken({ kind: "item", id: "glove" }, { kind: "item", id: "lightning" })).toBe(false);
    expect(sameToken({ kind: "die", id: "golden" }, "coin")).toBe(false);
  });

  it("sends half a flight up off the head toward the other seat, no further than halfway to them", () => {
    const far = offToward([0, 66, 0], [10, 66, 0]);
    expect(far[0]).toBeCloseTo(HALF_AWAY);
    expect(far[1]).toBeCloseTo(66 + SKY);
    expect(far[2]).toBeCloseTo(0);
    const near = offToward([0, 66, 0], [0, 66, -2]);
    expect(near[2]).toBeCloseTo(-1);
    // Together, or the other not known: straight up.
    expect(offToward([0, 66, 0], [0, 66, 0])).toEqual([0, 66 + SKY, 0]);
    expect(offToward([0, 66, 0], undefined)).toEqual([0, 66 + SKY, 0]);
  });
});
