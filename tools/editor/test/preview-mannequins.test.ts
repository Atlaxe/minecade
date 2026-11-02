import { describe, expect, it } from "vitest";
import { FAKE_COLORS, FAKE_SKINS, runtimeMapConfig, type MapConfig } from "@minecade/minigame-core/config";
import type { MannequinSkin } from "../fake-player.ts";
import { previewMannequins } from "../preview-template.ts";

const blue = FAKE_COLORS.find((color) => color.id === "blue")!;
const players: MannequinSkin[] = [{ skin: { name: "get a waffle", key: "pabc", slim: true }, image: { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) } }];
const config: MapConfig = {
  name: "Temples",
  spawns: [],
  mannequinsInPreview: true,
  mannequins: {
    "Mannequin 1": { at: [1.5, 65, 2, 90], skin: "color", color: "blue", pose: "running", hold: "minecraft:{color}_wool" },
    "Mannequin 2": { at: [3, 65, 4, 0], skin: "pabc", pose: "standing", hold: "minecraft:bow" },
    "Mannequin 3": { at: [5, 65, 6, 0], skin: "pgone", pose: "standing" },
  },
};

describe("a preview's mannequins", () => {
  it("stand where they stand in Edit, each look as the preview pack's properties", () => {
    expect(previewMannequins(config, players)).toEqual([
      // The plain color: its tint, and the item in its dye.
      { at: [1.5, 65, 2, 90], skin: 0, tint: blue.tint + 1, pose: 2, hold: "minecraft:blue_wool" },
      // A player's skin comes after the fake player's own.
      { at: [3, 65, 4, 0], skin: FAKE_SKINS.length, tint: 0, pose: 0, hold: "minecraft:bow" },
      // A skin this PC doesn't have: the plain color.
      { at: [5, 65, 6, 0], skin: 0, tint: FAKE_COLORS[0].tint + 1, pose: 0 },
    ]);
  });

  it("aren't the servers' business otherwise: the switch and the mannequins stay out of their map", () => {
    const runtime = runtimeMapConfig(config);
    expect(runtime.mannequins).toBeUndefined();
    expect(runtime.mannequinsInPreview).toBeUndefined();
  });
});
