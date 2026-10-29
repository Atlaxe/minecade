import { describe, expect, it } from "vitest";
import { CHIMES, TIMER_MARK, TIMER_URGENT_MARK, countdownChime, hudLine, playChime } from "../src/hud.ts";
import { world } from "./fake-mc-server.ts";

describe("hudLine", () => {
  it("prefixes the line with the mark and a fixed-width clock", () => {
    expect(hudLine(299)).toBe("::T 4:59|");
    expect(hudLine(65, "Lives: 2")).toBe("::T 1:05|Lives: 2");
    expect(hudLine(4.2)).toBe("::R 0:05|"); // partial seconds round up
    expect(hudLine(600)).toBe("::T10:00|");
  });

  it("turns urgent in the last 30 seconds, and stays 9 characters for the resource pack to split", () => {
    expect(hudLine(31).startsWith(TIMER_MARK)).toBe(true);
    expect(hudLine(30).startsWith(TIMER_URGENT_MARK)).toBe(true);
    for (const seconds of [0, 9, 59, 60, 599, 3599, 5999, 6000, 100000]) {
      const line = hudLine(seconds, "rest");
      expect(line.slice(9)).toBe("rest");
      expect(line[8]).toBe("|");
    }
    expect(hudLine(100000)).toBe("::T99:59|");
  });

  it("is just the line without a clock", () => {
    expect(hudLine(undefined, "Respawning in 3")).toBe("Respawning in 3");
    expect(hudLine(undefined)).toBe("");
  });
});

describe("countdown chimes", () => {
  it("ticks above 3, rings a bell for 3, 2 and 1, and plays the flourish at 0", () => {
    expect([10, 5, 4, 3, 2, 1, 0].map(countdownChime)).toEqual(["tick", "tick", "tick", "bell", "bell", "bell", "go"]);
  });

  it("plays the chime's sound, and skips a player who left", () => {
    const player = world.join("Alex");
    playChime(player as never, "bell");
    expect(player.sounds).toEqual([{ id: CHIMES.bell.id, pitch: CHIMES.bell.pitch, volume: CHIMES.bell.volume }]);
    player.isValid = false;
    playChime(player as never, "go");
    expect(player.sounds).toHaveLength(1);
    world.reset();
  });
});
