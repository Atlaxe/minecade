import { describe, expect, it } from "vitest";
import { Timeline } from "../src/timeline.ts";

describe("Timeline", () => {
  it("lists each step's time since the start, in order, keeping a step's first time", () => {
    const timeline = new Timeline(1000);
    timeline.mark("ready", 9400);
    timeline.mark("created", 1300);
    timeline.mark("created", 5000);
    expect(timeline.summary()).toBe("created 0.3 s, ready 8.4 s");
    expect(timeline.has("created")).toBe(true);
    expect(timeline.has("started")).toBe(false);
  });

  it("reads the entrypoint's step lines and nothing else", () => {
    const timeline = new Timeline(1_800_000_000_000);
    expect(timeline.markStep("[minecade] step world 1800000001250")).toBe(true);
    expect(timeline.markStep("[minecade] step packs 1800000003000 ")).toBe(true);
    expect(timeline.markStep("[minecade] lobby: lobby/spaceship on port 19132")).toBe(false);
    expect(timeline.markStep("[2026-10-29 00:47:10:058 INFO] Server started.")).toBe(false);
    expect(timeline.summary()).toBe("world 1.3 s, packs 3.0 s");
  });
});
