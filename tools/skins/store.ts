// The skins the watcher saves (watcher/watcher.ts), one folder per player under skins/:
//   <xuid>/meta.json       who and what (SkinMeta)
//   <xuid>/skin.rgba       the skin's pixels, 4 bytes each, rows top to bottom
//   <xuid>/model.geo.json  a character creator skin's own model (absent for classic skins)
//   <xuid>/face.rgba       a character creator skin's face: its "animated_face" model's texture
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkinShape } from "./geometry.ts";
import type { Image } from "./png.ts";

export interface SkinMeta extends SkinShape {
  xuid: string;
  /** The gamertag the player last had. */
  name: string;
  skinId?: string;
  /** A character creator skin's face texture (face.rgba): its size, and how many frames it stacks (the face, then its blink). */
  face?: { width: number; height: number; frames?: number };
  /** Changes when the skin does (the watcher skips saving an unchanged one). */
  hash: string;
  updatedAt: string;
}

export interface StoredSkin {
  meta: SkinMeta;
  image: Image;
  /** The parsed model.geo.json, when there is one. */
  geometry?: unknown;
  /** face.rgba, when there is one. */
  face?: Image;
}

/** Every saved skin in `dir`, by xuid; folders that are incomplete or unreadable are skipped. */
export async function readSkins(dir: string): Promise<StoredSkin[]> {
  if (!existsSync(dir)) return [];
  const skins: StoredSkin[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = join(dir, entry.name);
    try {
      const meta = JSON.parse(await readFile(join(folder, "meta.json"), "utf8")) as SkinMeta;
      const data = new Uint8Array(await readFile(join(folder, "skin.rgba")));
      if (!meta.xuid || data.length !== meta.width * meta.height * 4) continue;
      const geometryPath = join(folder, "model.geo.json");
      const geometry = existsSync(geometryPath) ? JSON.parse(await readFile(geometryPath, "utf8")) : undefined;
      const facePath = join(folder, "face.rgba");
      const faceData = meta.face && existsSync(facePath) ? new Uint8Array(await readFile(facePath)) : undefined;
      const face = meta.face && faceData?.length === meta.face.width * meta.face.height * 4 ? { width: meta.face.width, height: meta.face.height, data: faceData } : undefined;
      skins.push({ meta, image: { width: meta.width, height: meta.height, data }, ...(geometry ? { geometry } : {}), ...(face ? { face } : {}) });
    } catch {
      continue;
    }
  }
  return skins;
}
