import { describe, expect, it } from "vitest";
import { portFormProblem, viewerUrl } from "../port.ts";

describe("Port to another game's dialog", () => {
  it("says what's wrong with the name or the id as they're typed", () => {
    const taken = { strife: `Gunfight plays Siege's maps too, and Siege has a map "strife".` };
    expect(portFormProblem("kgb", "KGB", taken)).toBeUndefined();
    expect(portFormProblem("kgb", " ", taken)).toBe("The map needs a name.");
    expect(portFormProblem("kgb", "x".repeat(49), taken)).toMatch(/at most 48/);
    expect(portFormProblem("KGB", "KGB", taken)).toMatch(/lower case letters/);
    expect(portFormProblem("-kgb", "KGB", taken)).toMatch(/starting with a letter or digit/);
    expect(portFormProblem("strife", "Strife", taken)).toBe(taken.strife);
  });

  it("opens the new map in the viewer", () => {
    expect(viewerUrl({ target: "gunfight", targetName: "Gunfight", map: "kgb", name: "KGB" })).toBe("/viewer?target=gunfight&map=kgb&name=KGB&game=Gunfight");
  });
});
