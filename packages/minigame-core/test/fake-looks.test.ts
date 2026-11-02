import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAKE_COLORS, FAKE_POSES, FAKE_SKINS, NEW_MANNEQUIN_LOOK, lookFromIds, lookIds, lookProperties, lookText, nextPose } from "../src/fake-looks.ts";
import { applyEdit, describeEdit } from "../src/map-edit.ts";
import { runtimeMapConfig, type MapConfig } from "../src/map-config.ts";
import { validateMapConfig } from "../src/map-validate.ts";

const preview = (path: string) => JSON.parse(readFileSync(new URL(`../../../editor/preview/${path}`, import.meta.url), "utf8"));

describe("fake player looks", () => {
  it("tints only the plain color skin, in its color, as dark as its concrete", () => {
    expect(lookProperties({ skin: 0, color: 1, pose: 2 })).toEqual({ skin: 0, tint: 0x2d2f8f + 1, pose: 2 });
    expect(lookProperties({ skin: 2, color: 1, pose: 0 })).toEqual({ skin: 2, tint: 0, pose: 0 });
    expect(lookProperties({ skin: 99, color: 99, pose: 99 })).toEqual({ skin: 0, tint: FAKE_COLORS[0].tint + 1, pose: 0 });
    // A skin from a longer list (Edit's, with the players' skins).
    const skins = [...FAKE_SKINS, { id: "p0123456789", label: "Sam", slim: false }];
    expect(lookProperties({ skin: 3, color: 0, pose: 0 }, skins).skin).toBe(3);
    expect(lookIds({ skin: 3, color: 0, pose: 0 }, skins).skin).toBe("p0123456789");
    expect(lookFromIds({ skin: "p0123456789", pose: "standing" }, skins).skin).toBe(3);
    expect(lookText({ skin: 3, color: 0, pose: 0 }, undefined, skins)).toBe("Sam, Standing");
  });

  it("keeps a look in map.json by ids, the color only for the plain color", () => {
    expect(lookIds({ skin: 0, color: 3, pose: 4, hold: "minecraft:bow" })).toEqual({ skin: "color", color: "yellow", pose: "aiming", hold: "minecraft:bow" });
    expect(lookIds({ skin: 2, color: 3, pose: 0 })).toEqual({ skin: "alex", pose: "standing" });
    expect(lookFromIds({ skin: "color", color: "gray", pose: "cheering", hold: "minecraft:bow" })).toEqual({ skin: 0, color: 6, pose: 7, hold: "minecraft:bow" });
    expect(lookFromIds({ skin: "nobody", pose: 3 })).toEqual(NEW_MANNEQUIN_LOOK);
  });

  it("cycles the poses back to the first after the last", () => {
    expect(nextPose(0)).toBe(1);
    expect(nextPose(FAKE_POSES.length - 1)).toBe(0);
  });

  it("says a look in a few words", () => {
    expect(lookText(NEW_MANNEQUIN_LOOK)).toBe("Red, Standing");
    expect(lookText({ skin: 2, color: 0, pose: 2, hold: "minecraft:bow" }, "Bow")).toBe("Alex, Running, holding Bow");
  });

  it("has the pack draw each skin on its own model, in the same order, and every pose", () => {
    const controller = preview("resource_pack/render_controllers/fake_player.render_controllers.json").render_controllers["controller.render.minecade.fake_player"];
    expect(controller.arrays.textures["Array.skins"]).toEqual(FAKE_SKINS.map((skin) => `Texture.${skin.id}`));
    expect(controller.arrays.geometries["Array.models"]).toEqual(FAKE_SKINS.map((skin) => (skin.slim ? "Geometry.slim" : "Geometry.default")));
    const entity = preview("resource_pack/entity/fake_player.entity.json")["minecraft:client_entity"].description;
    expect(Object.keys(entity.textures)).toEqual(FAKE_SKINS.map((skin) => skin.id));
    expect(entity.scripts.animate).toHaveLength(FAKE_POSES.length - 1);
    const properties = preview("behavior_pack/entities/fake_player.json")["minecraft:entity"].description.properties;
    expect(properties["minecade:skin"].range[1]).toBeGreaterThanOrEqual(FAKE_SKINS.length - 1);
    expect(properties["minecade:skin"].default).toBe(1);
  });
});

describe("mannequins in map.json", () => {
  const base: MapConfig = { name: "Bridge", spawns: [[0, 65, 0]] };
  const mannequin = { at: [1, 65, 2, 90] as [number, number, number, number], skin: "color", color: "red", pose: "standing" };

  it("places, changes and removes one, after the cameras, never on a server", () => {
    let map = applyEdit(base, { op: "mannequin", name: "Mannequin 1", mannequin });
    map = applyEdit(map, { op: "camera", name: "Camera 1", camera: { at: [0, 70, 0, 0, 0], kind: "game" } });
    expect(Object.keys(map)).toEqual(["name", "spawns", "cameras", "mannequins"]);
    expect(validateMapConfig(map, { kind: "lobby" })).toEqual([]);
    expect(runtimeMapConfig(map).mannequins).toBeUndefined();
    map = applyEdit(map, { op: "mannequin", name: "Mannequin 1" });
    expect(map.mannequins).toBeUndefined();
    expect(() => applyEdit(base, { op: "mannequin", name: "Mannequin 9" })).toThrow('there is no mannequin "Mannequin 9"');
    expect(describeEdit({ op: "mannequin", name: "Mannequin 1", mannequin })).toBe("set mannequin Mannequin 1");
  });

  it("stand in previews only once that's switched on, a key servers never get", () => {
    let map = applyEdit(base, { op: "mannequin", name: "Mannequin 1", mannequin });
    map = applyEdit(map, { op: "mannequinsInPreview", on: true });
    expect(map.mannequinsInPreview).toBe(true);
    expect(Object.keys(map)).toEqual(["name", "spawns", "mannequins", "mannequinsInPreview"]);
    expect(validateMapConfig(map, { kind: "lobby" })).toEqual([]);
    expect(runtimeMapConfig(map).mannequinsInPreview).toBeUndefined();
    expect(describeEdit({ op: "mannequinsInPreview", on: true })).toBe("show mannequins in previews");
    expect(applyEdit(map, { op: "mannequinsInPreview", on: false }).mannequinsInPreview).toBeUndefined();
    expect(validateMapConfig({ ...base, mannequinsInPreview: "yes" } as unknown as MapConfig, { kind: "lobby" })).toEqual(['"mannequinsInPreview" must be true or false']);
  });

  it("must have a place, a skin and a pose", () => {
    expect(validateMapConfig({ ...base, mannequins: { M: { ...mannequin, at: [1, 2, 3] } } }, { kind: "lobby" })).toEqual(['mannequins.M must be { "at": [x, y, z, yaw], "skin", "pose" }']);
  });
});
