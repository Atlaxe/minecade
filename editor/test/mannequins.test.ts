import { afterEach, describe, expect, it } from "vitest";
import { NEW_MANNEQUIN_LOOK, stripColors, type MapConfig, type MapMannequin } from "@minecade/minigame-core/config";
import { facingMannequin, itemColorOf, mannequinAt, mannequinLook, mannequinSkins, mannequinsOf, nextMannequinName, nudgeMannequin, useMannequinSkins, withLook } from "../behavior_pack/scripts/mannequins.ts";
import { MARK, dangerText, headingText, switchText } from "../behavior_pack/scripts/marks.ts";
import { mannequinScreenEntries, mannequinSettings } from "../behavior_pack/scripts/menu.ts";

const red: MapMannequin = { at: [1.5, 65, -2.25, 180], skin: "color", color: "red", pose: "standing" };
const map: MapConfig = { name: "Bridge", spawns: [[0, 65, 0]], mannequins: { "Mannequin 2": { ...red, skin: "alex", pose: "running", hold: "minecraft:bow" }, "Mannequin 1": red, Broken: { at: [1, 2] } as unknown as MapMannequin } };

afterEach(() => useMannequinSkins([]));

describe("mannequins", () => {
  it("lists the map's mannequins in name order, and names the next one", () => {
    expect(mannequinsOf(map).map(([name]) => name)).toEqual(["Mannequin 1", "Mannequin 2"]);
    expect(nextMannequinName(map)).toBe("Mannequin 3");
    expect(nextMannequinName({ name: "Empty", spawns: [] })).toBe("Mannequin 1");
  });

  it("stands a new one where aimed, turned to face the player, in the first choices", () => {
    expect(mannequinAt({ x: 3.456, y: 64, z: -1 }, 30, NEW_MANNEQUIN_LOOK)).toEqual({ at: [3.46, 64, -1, -150], skin: "color", color: "red", pose: "standing" });
    expect(mannequinAt({ x: 0, y: 64, z: 0 }, -170, NEW_MANNEQUIN_LOOK).at[3]).toBe(10);
  });

  it("nudges one along an axis or turns it, and changes its look in place", () => {
    expect(nudgeMannequin(red, { axis: 1, by: 0.5 }).at).toEqual([1.5, 65.5, -2.25, 180]);
    expect(nudgeMannequin(red, { turn: 15 }).at).toEqual([1.5, 65, -2.25, -165]);
    expect(withLook(red, { ...mannequinLook(red), skin: 1 })).toEqual({ at: red.at, skin: "steve", pose: "standing" });
  });

  it("takes the player's facing where it stands", () => {
    expect(facingMannequin(red, -90.4).at).toEqual([1.5, 65, -2.25, -90]);
    expect(facingMannequin(red, 270).at[3]).toBe(-90);
  });

  it("wears the players' skins the build put in the pack after Color, Steve and Alex, kept by key", () => {
    useMannequinSkins([{ name: "get a waffle", key: "p0123456789", slim: false }, { name: "Slim Sam", key: "pabcdefabcd", slim: true }]);
    expect(mannequinSkins().map((skin) => [skin.label, skin.slim])).toEqual([
      ["Color", false],
      ["Steve", false],
      ["Alex", true],
      ["get a waffle", false],
      ["Slim Sam", true],
    ]);
    expect(mannequinLook({ ...red, skin: "p0123456789" }).skin).toBe(3);
    expect(withLook(red, { ...mannequinLook(red), skin: 4 }).skin).toBe("pabcdefabcd");
    // A skin this build doesn't have: the plain color.
    useMannequinSkins([]);
    expect(mannequinLook({ ...red, skin: "p0123456789" }).skin).toBe(0);
  });

  it("colors held items in a plain color's dye, and white on Minecraft's skins", () => {
    expect(itemColorOf(mannequinLook({ ...red, color: "blue" }))).toBe("§9");
    expect(itemColorOf(mannequinLook({ ...red, skin: "alex" }))).toBeUndefined();
  });
});

describe("the Mannequin tool's menus", () => {
  const items = [{ item: "minecraft:bow", label: "Bow" }];

  it("lists the mannequins in its settings, each with its look", () => {
    const off = switchText("Show in previews", "off: previews have no mannequins", false);
    expect(mannequinSettings(map, items).map((entry) => entry.text)).toEqual([off, headingText("Mannequins (2)"), "Mannequin 1\n§7Red, Standing", "Mannequin 2\n§7Alex, Running, holding Bow"]);
    expect(mannequinSettings(map, items)[0].action).toEqual({ kind: "mannequinsInPreview" });
    expect(mannequinSettings(map, items)[2].action).toEqual({ kind: "mannequin", name: "Mannequin 1" });
    expect(mannequinSettings({ name: "Empty", spawns: [] }, [])).toEqual([
      { action: { kind: "mannequinsInPreview" }, text: off },
      { action: { kind: "none" }, text: headingText("No mannequins yet") },
    ]);
    // Switched on: previews show them.
    expect(mannequinSettings({ ...map, mannequinsInPreview: true }, items)[0].text).toBe(switchText("Show in previews", "they stand in this map's previews", true));
  });

  it("has Skin first, Color under it only for the plain color, Hold for the kit items, Pose, then Position and Delete", () => {
    const screen = (mannequin: MapMannequin, open?: "skin" | "color", withItems = items) =>
      mannequinScreenEntries({ look: mannequinLook(mannequin), items: withItems, at: mannequin.at, step: 1, ...(open ? { open } : {}), back: true });
    const rows = (entries: { text: string }[]) => entries.map((entry) => stripColors(entry.text)).filter((text) => text.includes(":") && !text.includes("("));
    expect(rows(screen(red))).toEqual(["Skin: Color", "Color: Red", "Hold: Nothing", "Pose: Standing"]);
    useMannequinSkins([{ name: "Noor", key: "p0123456789" }]);
    expect(rows(screen({ ...red, skin: "p0123456789" }, undefined, []))).toEqual(["Skin: Noor", "Pose: Standing"]);
    const open = screen(red, "skin");
    expect(open.map((entry) => stripColors(entry.text)).slice(3, 7)).toEqual(["Color", "Steve", "Alex", "Noor"]);
    expect(open[3].text).toBe(`${MARK.lead}${MARK.picked}Color`);
    const colors = screen(red, "color").map((entry) => stripColors(entry.text));
    expect(colors.slice(colors.indexOf("Color: Red") + 1, colors.indexOf("Color: Red") + 8)).toEqual(["Red", "Blue", "Green", "Yellow", "White", "Black", "Gray"]);
    const all = screen(red);
    expect(all[0].action).toEqual({ kind: "back" });
    expect(all.map((entry) => entry.action.kind)).toEqual(["back", "none", "open", "open", "open", "open", "none", "here", "facing", "move", "move", "move", "move", "move", "move", "turn", "turn", "step", "step", "step", "delete"]);
    expect(all.at(-1)?.text).toBe(dangerText("Delete"));
    expect(stripColors(all.find((entry) => entry.action.kind === "turn")?.text ?? "")).toBe("Turn (right +): 180°");
  });
});
