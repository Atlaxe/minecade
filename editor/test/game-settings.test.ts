// The Game settings tool's menus and checks: the game's own per-map settings (its config's
// map.settings, such as Build Swap's build padding), each a whole number map.json keeps under its key.
import { describe, expect, it } from "vitest";
import { applyEdit, mapSettingValue, mapSettings, settingText, stripColors, validateMapConfig, type MapConfig, type MapRequirementsConfig } from "@minecade/minigame-core/config";
import { validateGameConfig } from "../../tools/build/validate.ts";
import { dangerText, saveBarText } from "../behavior_pack/scripts/marks.ts";
import { gameSettingScreenEntries, gameSettingsSettings } from "../behavior_pack/scripts/menu.ts";

const REQUIRES: MapRequirementsConfig = {
  settings: {
    buildPadding: { label: "Build padding", hint: "how far builders can go", default: 2, min: 0, max: 32, unit: "blocks" },
    rounds: { label: "Rounds", default: 3, min: 1, max: 9 },
  },
};
const SETTINGS = mapSettings(REQUIRES);
const MAP: MapConfig = { name: "M", spawns: [] };

describe("a game's per-map settings", () => {
  it("are the map's own when it sets one that fits, else the default", () => {
    const [padding] = SETTINGS;
    expect(SETTINGS.map((setting) => setting.key)).toEqual(["buildPadding", "rounds"]);
    expect(mapSettingValue(padding, MAP, "buildPadding")).toBe(2);
    expect(mapSettingValue(padding, { ...MAP, buildPadding: 5 }, "buildPadding")).toBe(5);
    expect(mapSettingValue(padding, { ...MAP, buildPadding: 40 }, "buildPadding")).toBe(2);
    expect([settingText(padding, 1), settingText(padding, 3), settingText(SETTINGS[1], 4)]).toEqual(["1 block", "3 blocks", "4"]);
  });

  it("are checked on maps and in the game's config", () => {
    const rules = { kind: "game" as const, maxPlayers: 1, requires: REQUIRES };
    const map = { ...MAP, spawns: [[0, 64, 0]], spectatorSpawn: [0, 70, 0] };
    expect(validateMapConfig({ ...map, buildPadding: 4 }, rules)).toEqual([]);
    expect(validateMapConfig({ ...map, buildPadding: 2.5, rounds: 0 }, rules)).toEqual([
      '"buildPadding" must be a whole number from 0 to 32',
      '"rounds" must be a whole number from 1 to 9',
    ]);
    const game = { id: "g", name: "G", minPlayers: 1, maxPlayers: 1 };
    expect(validateGameConfig({ ...game, map: REQUIRES }, "g")).toEqual([]);
    expect(validateGameConfig({ ...game, map: { settings: { spawns: { label: "S", default: 9, min: 0, max: 4 } } } }, "g")).toEqual([
      "map.settings.spawns: the key must be letters, digits and _, starting with a letter, and not one map.json has",
      "map.settings.spawns: the default must be from 0 to 4",
    ]);
  });

  it("are set and taken away as the game's own map.json keys", () => {
    const set = applyEdit(MAP, { op: "extra", key: "buildPadding", value: 6 });
    expect(set.buildPadding).toBe(6);
    expect(applyEdit(set, { op: "extra", key: "buildPadding" }).buildPadding).toBeUndefined();
  });
});

describe("the Game settings tool's menus", () => {
  it("lists each setting with its value on this map, the default marked", () => {
    const entries = gameSettingsSettings({ ...MAP, rounds: 5 }, SETTINGS);
    expect(entries.map((entry) => stripColors(entry.text))).toEqual(["Game settings", "Build padding\n2 blocks (default)", "Rounds\n5"]);
    expect(entries[1].action).toEqual({ kind: "gameSetting", key: "buildPadding" });
  });

  it("has the Setting list for more than one, the value typed or nudged, the default once set, and Set at the bottom", () => {
    const one = gameSettingScreenEntries({ settings: SETTINGS.slice(0, 1), key: "buildPadding", value: 3, set: false, open: false, back: true });
    expect(one.map((entry) => entry.action.kind)).toEqual(["back", "none", "type", "nudge", "nudge", "save"]);
    expect(stripColors(one[1].text)).toBe("Build padding: 3 blocks");
    expect(stripColors(one[2].text)).toBe("Type a number\nfrom 0 to 32: how far builders can go");
    expect(one.slice(3, 5).map((entry) => entry.action)).toEqual([
      { kind: "nudge", by: -1 },
      { kind: "nudge", by: 1 },
    ]);
    expect(one.at(-1)?.text).toBe(saveBarText("Set build padding"));
    const both = gameSettingScreenEntries({ settings: SETTINGS, key: "rounds", value: 4, set: true, open: true });
    expect(both.map((entry) => entry.action.kind)).toEqual(["open", "setting", "setting", "none", "type", "nudge", "nudge", "default", "save"]);
    expect(stripColors(both[0].text)).toContain("Rounds");
    expect(both.at(-2)?.text).toBe(dangerText("Use the default (3)"));
  });
});
