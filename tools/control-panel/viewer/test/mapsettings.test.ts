import type { EditorRules, MapConfig } from "@minecade/minigame-core/config";
import { describe, expect, it } from "vitest";
import { otherKeys, parseValue, requirementHint } from "../mapsettings.ts";

const RULES: EditorRules = {
  kind: "game",
  maxPlayers: 8,
  requires: { settings: { buildPadding: { label: "Build padding", default: 2, min: 0, max: 8, unit: "blocks" } } },
  teams: [],
};

describe("Map settings", () => {
  it("lists the game's other plain keys the map has, leaving out map.json's own and the game's settings", () => {
    const config: MapConfig = { name: "M", spawns: [], killY: 3, buildPadding: 4, eliminationY: 40, theme: "ice", hardcore: false, source: { world: "W", box: { min: [0, 0, 0], max: [1, 1, 1] }, offset: [0, 0, 0] } };
    expect(otherKeys(config, RULES)).toEqual([
      ["eliminationY", 40],
      ["theme", "ice"],
      ["hardcore", false],
    ]);
  });

  it("reads a typed value as the key's kind of value, as game Edit does", () => {
    expect(parseValue(" 12 ", 40)).toBe(12);
    expect(parseValue("1.5", 40)).toBe(1.5);
    expect(parseValue("high", 40)).toBeUndefined();
    expect(parseValue("", 40)).toBeUndefined();
    expect(parseValue("TRUE", false)).toBe(true);
    expect(parseValue("yes", false)).toBeUndefined();
    expect(parseValue(" lava ", "ice")).toBe(" lava ");
  });
});

describe("requirementHint", () => {
  it("says what the game asks and what a map can do instead", () => {
    expect(requirementHint({ key: "killY", label: "Kill Y", off: true }, false)).toBe("The game needs it. A map can turn it off.");
    expect(requirementHint({ key: "regions.kill", label: "Kill region", count: 1, off: false, range: { min: 1, max: 3 } }, false)).toBe("The game asks for 1. A map can ask for 1 to 3.");
    expect(requirementHint({ key: "points.hole", label: "Hole", count: 2, off: true, range: { min: 2, max: 4 } }, false)).toBe("The game asks for 2. A map can ask for 2 to 4, or turn it off.");
    expect(requirementHint({ key: "killY", label: "Kill Y", off: true }, true)).toBe("Off: this map's checklist doesn't ask for it.");
  });
});
