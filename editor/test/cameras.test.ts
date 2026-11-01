import { describe, expect, it } from "vitest";
import type { MapConfig } from "@minecade/minigame-core/config";
import { cameraActions, cameraAt, cameraMarkers, camerasOf, cameraText, nextCameraName, nudgeCamera } from "../behavior_pack/scripts/cameras.ts";
import { MARKER_KINDS, MARKER_STYLES } from "../behavior_pack/scripts/lists.ts";
import { MARK, dangerText } from "../behavior_pack/scripts/marks.ts";
import { cameraSettings } from "../behavior_pack/scripts/menu.ts";

const map: MapConfig = {
  name: "Arena",
  spawns: [[0, 65, 0]],
  cameras: {
    "Camera 2": { at: [3.25, 70.62, -14, 0, 25], kind: "map" },
    "Camera 10": { at: [0, 90, 0, 90, 90], kind: "game" },
    broken: { at: [0, 1], kind: "map" } as unknown as NonNullable<MapConfig["cameras"]>[string],
  },
};

describe("cameras", () => {
  it("lists the cameras that read right, in number order", () => {
    expect(camerasOf(map).map(([name]) => name)).toEqual(["Camera 2", "Camera 10"]);
    expect(camerasOf({ name: "Empty", spawns: [] })).toEqual([]);
  });

  it("names a new camera with the first free number", () => {
    expect(nextCameraName({ name: "Empty", spawns: [] })).toBe("Camera 1");
    expect(nextCameraName({ ...map, cameras: { "camera 1": map.cameras!["Camera 2"] } })).toBe("Camera 2");
    expect(nextCameraName(map)).toBe("Camera 1");
  });

  it("saves the eye point to hundredths and the view to tenths of a degree, yaw within -180 to 180", () => {
    expect(cameraAt({ x: 3.256, y: 70.6213, z: -14.004 }, { x: 25.04, y: 181.26 }, "map")).toEqual({ at: [3.26, 70.62, -14, -178.7, 25], kind: "map" });
    expect(cameraAt({ x: 0, y: 64, z: 0 }, { x: -95, y: -180 }, "game")).toEqual({ at: [0, 64, 0, 180, -90], kind: "game" });
  });

  it("puts each camera's head on its lens, its line where it looks", () => {
    expect(cameraMarkers(map)[0]).toEqual({
      key: "camera:Camera 2",
      camera: "Camera 2",
      label: "§dCamera 2\n§7Map preview",
      at: { x: 3.25, y: 70.37, z: -14 },
      facing: { yaw: 0, pitch: 25 },
      kind: MARKER_KINDS.camera,
      style: MARKER_STYLES.camera,
    });
  });

  it("describes a camera, and offers only its kind and Delete (the Snapshot takes its picture)", () => {
    expect(cameraText(map.cameras!["Camera 2"])).toBe("Map preview at 3.3 70.6 -14, looking south, 25 degrees down");
    expect(cameraText({ at: [0, 90, 0, 90, -10], kind: "game" })).toBe("Game picture at 0 90 0, looking west, 10 degrees up");
    expect(cameraActions(map.cameras!["Camera 2"]).map((entry) => entry.action)).toEqual(["kind", "delete"]);
    expect(cameraActions(map.cameras!["Camera 10"])[0].text).toContain(MARK.on);
    expect(cameraActions(map.cameras!["Camera 2"])[0].text).not.toContain(MARK.on);
    expect(cameraActions(map.cameras!["Camera 2"]).at(-1)?.text).toBe(dangerText("Delete"));
  });

  it("nudges a camera along an axis, turns it round past 180, and tilts it no further than straight up or down", () => {
    const camera = { at: [3.25, 70.6, -14, 175, 85] as [number, number, number, number, number], kind: "map" as const };
    expect(nudgeCamera(camera, { axis: 1, by: 0.1 }).at).toEqual([3.25, 70.7, -14, 175, 85]);
    expect(nudgeCamera(camera, { axis: 0, by: -2 }).at).toEqual([1.25, 70.6, -14, 175, 85]);
    expect(nudgeCamera(camera, { turn: 15 }).at[3]).toBe(-170);
    expect(nudgeCamera({ ...camera, at: [0, 0, 0, -175, 0] }, { turn: -15 }).at[3]).toBe(170);
    expect(nudgeCamera(camera, { tilt: 15 }).at[4]).toBe(90);
    expect(nudgeCamera(camera, { tilt: -5 }).at[4]).toBe(80);
    expect(nudgeCamera(camera, { tilt: 1 }).kind).toBe("map");
  });

  it("has the tool's settings: the kind for new cameras, then each camera", () => {
    const entries = cameraSettings(map, "map");
    expect(entries.map((entry) => entry.action)).toEqual([
      { kind: "none" },
      { kind: "cameraKind" },
      { kind: "none" },
      { kind: "camera", name: "Camera 2" },
      { kind: "camera", name: "Camera 10" },
    ]);
    expect(entries[1].text).toBe(`${MARK.toggle}Game picture\n§7off: a map preview, nobody in the shot`);
    expect(entries[4].text).toBe("Camera 10\n§7Game picture");
    expect(cameraSettings({ name: "Empty", spawns: [] }, "game")[1].text).toContain(MARK.on);
  });
});
