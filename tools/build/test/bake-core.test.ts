import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import nbt from "prismarine-nbt";
import type { MapConfig } from "@minecade/minigame-core/config";
import { bakeSettings, checkBakeSettings, classifyResponse } from "../bake-core.ts";
import { getTag, readLevelDat, setTag } from "../leveldat.ts";

const BASE_LEVEL_DAT = fileURLToPath(new URL("../fixtures/base-level.dat", import.meta.url));
const map: MapConfig = { name: "Main", spawns: [[0.5, 65, -3.2]], bounds: { min: [-16, 40, -16], max: [16, 100, 16] } };

describe("bakeSettings", () => {
  it("turns a real BDS level.dat into a void world at noon, spawning at the first spawn", async () => {
    const dat = await readLevelDat(BASE_LEVEL_DAT);
    expect(getTag(dat, "Generator")?.value).toBe(1);
    bakeSettings(dat, map);
    expect(getTag(dat, "Generator")?.value).toBe(2);
    const layers = JSON.parse(getTag(dat, "FlatWorldLayers")?.value as string);
    expect(layers).toMatchObject({ block_layers: [{ block_name: "minecraft:air", count: 1 }], encoding_version: 6, world_version: "version.post_1_18" });
    for (const rule of ["dodaylightcycle", "doweathercycle", "domobspawning", "dofiretick", "mobgriefing", "spawnMobs"]) {
      expect(getTag(dat, rule)).toEqual({ type: "byte", value: 0 });
    }
    expect(getTag(dat, "Time")).toEqual({ type: "long", value: [0, 6000] });
    expect([getTag(dat, "SpawnX")?.value, getTag(dat, "SpawnY")?.value, getTag(dat, "SpawnZ")?.value]).toEqual([0, 65, -4]);
    expect(getTag(dat, "spawnradius")?.value).toBe(0);
    expect(checkBakeSettings(dat, map)).toEqual([]);
  });

  it("names the settings that changed afterwards", async () => {
    const dat = await readLevelDat(BASE_LEVEL_DAT);
    bakeSettings(dat, map);
    setTag(dat, "domobspawning", nbt.byte(1) as Parameters<typeof setTag>[2]);
    setTag(dat, "Generator", nbt.int(1) as Parameters<typeof setTag>[2]);
    expect(checkBakeSettings(dat, map)).toEqual(["Generator", "domobspawning"]);
  });
});

describe("classifyResponse", () => {
  // Replies captured from BDS 1.26.60.6 (en_US.lang and a live console).
  const line = (level: string, text: string) => `[2026-10-29 02:24:21:027 ${level}] ${text}`;

  it("accepts successful replies, including fills with nothing to change", () => {
    expect(classifyResponse([line("INFO", "225 blocks filled")])).toEqual({ result: "ok" });
    expect(classifyResponse([line("INFO", "No blocks filled")])).toEqual({ result: "ok" });
    expect(classifyResponse([line("INFO", "Added ticking area from 0, 0, 0 to 15, 0, 15 marked for preload."), "1/10 ticking areas in use."])).toEqual({
      result: "ok",
    });
    expect(classifyResponse([line("INFO", "Block placed")])).toEqual({ result: "ok" });
  });

  it("retries while the chunks are not loaded yet", () => {
    expect(classifyResponse([line("ERROR", "Cannot place blocks outside of the world")])).toEqual({
      result: "retry",
      message: "Cannot place blocks outside of the world",
    });
  });

  it("fails on errors that retrying cannot fix", () => {
    for (const text of [
      "Too many blocks in the specified area (100000 > 32768)",
      "Unknown command: {. Please check that the command exists and that you have permission to use it.",
      'Syntax error: Unexpected "stoen": at "100 2 >>stoen<<"',
      "Ticking area contains more than 100 chunks, ticking area is too large and cannot be created.",
    ]) {
      expect(classifyResponse([line("ERROR", text)])).toEqual({ result: "error", message: text });
    }
  });

  it("ignores unrelated server chatter, and fails when nothing answered", () => {
    expect(classifyResponse([line("INFO", "Running AutoCompaction..."), line("INFO", "9 blocks filled")])).toEqual({ result: "ok" });
    expect(classifyResponse([line("INFO", "Running AutoCompaction...")])).toEqual({ result: "error", message: "the server printed no reply" });
  });
});
