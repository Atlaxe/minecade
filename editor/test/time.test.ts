import { describe, expect, it } from "vitest";
import { applyEdit, describeEdit, stripColors, type MapConfig } from "@minecade/minigame-core/config";
import { saveBarText } from "../behavior_pack/scripts/marks.ts";
import { timeScreenEntries, timeSettings } from "../behavior_pack/scripts/menu.ts";
import { clockText, hoursLater, parseClock, presetOf, timeText } from "../behavior_pack/scripts/time-of-day.ts";

describe("the time of day", () => {
  it("shows ticks on the 24-hour clock (Minecraft's day starts at 6:00)", () => {
    expect([0, 6000, 12000, 18000, 23000, 23999, 1500].map(clockText)).toEqual(["06:00", "12:00", "18:00", "00:00", "05:00", "05:59", "07:30"]);
  });

  it("reads a typed time, and gives back the same minute", () => {
    expect(parseClock("12:00")).toBe(6000);
    expect(parseClock("0:00")).toBe(18000);
    expect(parseClock("05:00")).toBe(23000);
    expect(parseClock("1430")).toBe(8500);
    expect(parseClock(" 9 ")).toBe(3000);
    for (const text of ["", "24:00", "12:60", "noon", "1:2"]) expect(parseClock(text)).toBeUndefined();
    for (let minute = 0; minute < 60; minute++) expect(clockText(parseClock(`13:${String(minute).padStart(2, "0")}`)!)).toBe(`13:${String(minute).padStart(2, "0")}`);
  });

  it("nudges an hour around the clock", () => {
    expect(hoursLater(6000, 1)).toBe(7000);
    expect(hoursLater(23500, 1)).toBe(500);
    expect(hoursLater(500, -1)).toBe(23500);
  });

  it("names the common times, and says a map's time in a few words", () => {
    expect(presetOf("sunset")).toBe("sunset");
    expect(presetOf("day")).toBeUndefined();
    expect(presetOf(8500)).toBeUndefined();
    expect([timeText("noon"), timeText("sunset"), timeText("midnight"), timeText("sunrise")]).toEqual(["Noon (12:00)", "Dusk (18:00)", "Midnight (00:00)", "Dawn (05:00)"]);
    expect([timeText(8500), timeText("night"), timeText(undefined)]).toEqual(["14:30", "19:00", "not set"]);
  });
});

describe("the Time tool's menus", () => {
  it("shows the map's time in its settings", () => {
    const map: MapConfig = { name: "M", spawns: [], time: "sunset" };
    expect(timeSettings(map).map((entry) => stripColors(entry.text))).toEqual(["Time of day", "Time\nDusk (18:00)"]);
    expect(timeSettings(map)[1].action).toEqual({ kind: "time" });
  });

  it("has the Time list first, Custom's clock rows only for Custom, Remove once set, and Set time at the bottom", () => {
    const preset = timeScreenEntries({ preset: "noon", ticks: 6000, open: false, set: false, back: true });
    expect(preset.map((entry) => entry.action.kind)).toEqual(["back", "open", "save"]);
    expect(stripColors(preset[1].text)).toContain("Noon");
    expect(preset.at(-1)?.text).toBe(saveBarText("Set time"));
    const open = timeScreenEntries({ preset: "noon", ticks: 6000, open: true, set: true });
    expect(open.slice(1, 6).map((entry) => stripColors(entry.text))).toEqual(["Noon", "Dusk", "Midnight", "Dawn", "Custom"]);
    expect(open.slice(1, 6).map((entry) => entry.action)).toEqual([
      { kind: "preset", preset: "noon" },
      { kind: "preset", preset: "sunset" },
      { kind: "preset", preset: "midnight" },
      { kind: "preset", preset: "sunrise" },
      { kind: "custom" },
    ]);
    expect(open.map((entry) => entry.action.kind).slice(-2)).toEqual(["remove", "save"]);
    const custom = timeScreenEntries({ ticks: 8500, open: false, set: true });
    expect(custom.map((entry) => entry.action.kind)).toEqual(["open", "type", "hour", "hour", "remove", "save"]);
    expect(stripColors(custom[0].text)).toContain("Custom");
    expect(stripColors(custom[1].text)).toContain("14:30");
    expect(custom.slice(2, 4).map((entry) => entry.action)).toEqual([
      { kind: "hour", by: -1 },
      { kind: "hour", by: 1 },
    ]);
  });
});

describe("the time edit", () => {
  const base: MapConfig = { name: "M", spawns: [], cameras: { "Camera 1": { at: [0, 70, 0, 0, 0], kind: "game" } } };

  it("sets a name or ticks where map.json keeps it, removes it, and refuses a time that isn't one", () => {
    const map = applyEdit(base, { op: "time", time: "sunset" });
    expect(map.time).toBe("sunset");
    expect(Object.keys(map)).toEqual(["name", "spawns", "time", "cameras"]);
    expect(applyEdit(map, { op: "time", time: 8500 }).time).toBe(8500);
    expect(applyEdit(map, { op: "time" }).time).toBeUndefined();
    expect(() => applyEdit(base, { op: "time", time: 24000 })).toThrow("is not a time of day");
    expect([describeEdit({ op: "time", time: "noon" }), describeEdit({ op: "time" })]).toEqual(["set time noon", "clear time"]);
  });
});
