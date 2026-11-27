import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { skinTexture } from "@minecade/minigame-core/config";
import { BOT_SKINS, SKINS_FOLDER, SKINS_PACK } from "../../../games/blockparty/behavior_pack/scripts/bot-skins.ts";
import { blankImage, encodePng } from "../../skins/png.ts";
import { botPortraits } from "../bot-portraits.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A game folder whose private skins pack holds a plain 64 x 64 skin for each of `ids`. */
function gameWith(ids: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "minecade-bot-skins-"));
  dirs.push(dir);
  const folder = join(dir, "private_packs", SKINS_PACK, "resource_pack", ...SKINS_FOLDER.split("/"));
  mkdirSync(folder, { recursive: true });
  const skin = blankImage(64, 64);
  skin.data.fill(200);
  for (const id of ids) writeFileSync(join(folder, `${id}.png`), encodePng(skin));
  return dir;
}

describe("botPortraits", () => {
  it("draws a portrait of each skin whose texture is here, classic or slim", () => {
    const { files, missing } = botPortraits(gameWith(["ari", "efe"]), undefined);
    expect([...files.keys()]).toEqual([`${skinTexture("ari", "portrait")}.png`, `${skinTexture("efe", "portrait")}.png`]);
    // Steve and Alex come from Minecraft's textures, which this test hasn't got.
    expect(missing).toContain("steve");
    expect(missing).toContain("alex");
    expect(missing).toHaveLength(BOT_SKINS.length - 2);
  });

  it("draws none without the private pack or Minecraft's textures", () => {
    const { files, missing } = botPortraits(gameWith([]), undefined);
    expect(files.size).toBe(0);
    expect(missing).toHaveLength(BOT_SKINS.length);
  });
});
