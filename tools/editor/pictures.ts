// The pictures the editor's pack carries for Edit's thumbnail menus (template.ts adds them each time
// a server starts): the shots used before (shots.ts) as textures/minecade/shots/<id>, every map's
// preview.png as textures/minecade/maps/<target>/<map>, and every game's icon.png as
// textures/minecade/games/<game>. A picture saved after a server started shows there from its next
// start. pictureInfo says which of them Edit can offer for the map it opens.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MapConfig, PictureInfo } from "@minecade/minigame-core/config";
import { readShots, shotFile, shotOf, shotUses } from "./shots.ts";
import { listTargets } from "./targets.ts";

/** Copies the pictures into a resource pack being built at `pack`. */
export async function addPictures(pack: string, root: string): Promise<void> {
  const textures = join(pack, "textures", "minecade");
  for (const shot of await readShots(root)) {
    await mkdir(join(textures, "shots"), { recursive: true });
    await copyFile(shotFile(root, shot.id), join(textures, "shots", `${shot.id}.png`));
  }
  for (const target of await listTargets(root)) {
    const icon = join(target.dir, "icon.png");
    if (target.id !== "lobby" && existsSync(icon)) {
      await mkdir(join(textures, "games"), { recursive: true });
      await copyFile(icon, join(textures, "games", `${target.id}.png`));
    }
    for (const map of target.maps) {
      const preview = join(target.dir, "maps", map, "preview.png");
      if (!existsSync(preview)) continue;
      await mkdir(join(textures, "maps", target.id), { recursive: true });
      await copyFile(preview, join(textures, "maps", target.id, `${map}.png`));
    }
  }
}

/** What Edit's thumbnail menus offer for `mapId` of `targetId`: the shots, which ones it uses now, and the other maps with a picture. */
export async function pictureInfo(root: string, targetId: string, mapId: string): Promise<PictureInfo> {
  const shots = await readShots(root);
  const targets = await listTargets(root);
  const target = targets.find((candidate) => candidate.id === targetId);
  const current: PictureInfo["current"] = {};
  if (target) {
    const preview = join(target.dir, "maps", mapId, "preview.png");
    if (existsSync(preview)) current.map = (await shotOf(root, preview, shots)) ?? "own";
    const icon = join(target.dir, "icon.png");
    if (target.id !== "lobby" && existsSync(icon)) current.game = (await shotOf(root, icon, shots)) ?? "own";
  }
  const maps: PictureInfo["maps"] = [];
  for (const other of targets) {
    for (const map of other.maps) {
      if (other.id === targetId && map === mapId) continue;
      if (!existsSync(join(other.dir, "maps", map, "preview.png"))) continue;
      maps.push({ target: other.id, targetName: other.name, map, name: (await mapName(join(other.dir, "maps", map, "map.json"))) ?? map });
    }
  }
  return { shots: shots.map((shot) => ({ id: shot.id, ...shotUses(shot) })), current, maps };
}

async function mapName(path: string): Promise<string | undefined> {
  try {
    return ((JSON.parse(await readFile(path, "utf8")) as MapConfig).name || undefined)?.trim();
  } catch {
    return undefined;
  }
}
