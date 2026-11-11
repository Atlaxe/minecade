// Pictures in the Panel's map viewer (the user's ask, 2026-11-09): a map's thumbnail and, for a
// minigame thumbnail map (map.json's gameThumbnail, a switch in Map settings), its game's picture,
// picked from the pictures kept so far (the map editor's shots, tools/editor/shots.ts) or the
// newest screenshot, as game Edit's Edit Map Thumbnail and Edit Minigame Thumbnail do. A game's
// picture needs no Publish: the lobby shows the saved one from the network's next start (the map
// store's export takes it), as a thumbnail map is a draft that's never published itself.
//   GET  /api/viewer/pictures?target=<id>&map=<id>    the kept pictures, and which ones the map
//                                                      and its game use
//   GET  /api/viewer/shot?id=<id>                      a kept picture (a 320x180 PNG)
//   POST /api/viewer/picture {target, map, kind, shot} a kept picture (its id), or "newest" for the
//                                                      newest screenshot, as the map's thumbnail
//                                                      ("map") or its game's picture ("game")
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadTarget } from "../editor/targets.ts";
import { keepNewestScreenshot, readShots, shotFile, shotOf, shotUses, useShot, type ShotKind } from "../editor/shots.ts";
import { storeDir, workingDir } from "../maps/paths.ts";
import { mapJsonPath } from "./map-data.ts";

/** Who keeps a screenshot taken from the Panel (shots.json's `by`). */
export const PANEL_BY = "the Panel";

const SHOT = /^[a-z0-9_]+$/;

export interface PictureList {
  /** The kept pictures, newest first, each with the map whose thumbnail and the game whose picture it was last. */
  shots: { id: string; map?: string; game?: string }[];
  /** The kept picture the map's thumbnail and its game's picture are, or "own" for one that isn't kept; none without a picture. */
  current: { map?: string; game?: string };
}

export interface PictureOptions {
  now?: number;
  /** Where to look for the newest screenshot: Minecraft's screenshot folders, unless a test says. */
  screenshots?: string[];
  /** Where the kept pictures are (its work\editor\): the checkout's, unless a test says. */
  kept?: string;
}

export type PicturesAnswer = { status: 200; pictures: PictureList } | { status: 400 | 404 | 422; error: string };
export type PictureAnswer = { status: 200; message: string } | { status: 400 | 404 | 422 | 500; error: string };

/** A game's picture in the map store: icon.png beside its maps. */
export function gamePicturePath(root: string, target: string): string {
  return join(workingDir(target, storeDir(root)), "icon.png");
}

/** Whether a map.json is a minigame thumbnail map's (false when it can't be read). */
export function isGameThumbnail(path: string): boolean {
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { gameThumbnail?: unknown }).gameThumbnail === true;
  } catch {
    return false;
  }
}

/** What the viewer's picture dialogs offer for a map. `kept` is where the kept pictures are (its work\editor\): the checkout's, unless a test says. */
export async function viewerPictures(root: string, target: string, map: string, kept = root): Promise<PicturesAnswer> {
  const path = mapJsonPath(root, target, map);
  if (!path) return { status: 400, error: "expected ?target=<id>&map=<id>" };
  if (!existsSync(path)) return { status: 404, error: `there's no map ${target}/${map} in the map store` };
  if (target === "lobby") return { status: 422, error: "the lobby shows no picture of its own map" };
  const shots = await readShots(kept);
  const current: PictureList["current"] = {};
  const preview = join(path, "..", "preview.png");
  if (existsSync(preview)) current.map = (await shotOf(kept, preview, shots)) ?? "own";
  const icon = gamePicturePath(root, target);
  if (existsSync(icon)) current.game = (await shotOf(kept, icon, shots)) ?? "own";
  return { status: 200, pictures: { shots: shots.map((shot) => ({ id: shot.id, ...shotUses(shot) })), current } };
}

/** A kept picture's file, or undefined when there's no such picture. */
export function shotPath(root: string, id: string): string | undefined {
  if (!SHOT.test(id)) return undefined;
  const file = shotFile(root, id);
  return existsSync(file) ? file : undefined;
}

/**
 * Uses a kept picture, or the newest screenshot on this PC (taken in the last few minutes, kept
 * with the others), as the map's thumbnail (its preview.png) or its game's picture (icon.png).
 */
export async function usePicture(root: string, body: Record<string, unknown>, options: PictureOptions = {}): Promise<PictureAnswer> {
  const { now = Date.now(), screenshots, kept = root } = options;
  const target = typeof body.target === "string" ? body.target : "";
  const map = typeof body.map === "string" ? body.map : "";
  const kind = body.kind;
  const shot = typeof body.shot === "string" ? body.shot : "";
  const path = mapJsonPath(root, target, map);
  if (!path || (kind !== "map" && kind !== "game") || !(shot === "newest" || SHOT.test(shot))) return { status: 400, error: 'expected {target, map, kind: "map" or "game", shot: a picture\'s id or "newest"}' };
  if (!existsSync(path)) return { status: 404, error: `there's no map ${target}/${map} in the map store` };
  if (target === "lobby") return { status: 422, error: "The lobby shows no picture of its own map: pictures are for a game's maps." };
  let targetName: string;
  try {
    targetName = (await loadTarget(root, target)).name;
  } catch (error) {
    return { status: 404, error: error instanceof Error ? error.message : String(error) };
  }
  let mapName = map;
  try {
    mapName = ((JSON.parse(readFileSync(path, "utf8")) as { name?: string }).name || map).trim();
  } catch {
    // Named by its id, then.
  }
  let id = shot;
  let from = "";
  if (shot === "newest") {
    const newest = await keepNewestScreenshot(kept, PANEL_BY, screenshots, now);
    if (typeof newest === "string") return { status: 422, error: `No picture saved: ${newest}.` };
    id = newest.id;
    const ago = Math.max(1, Math.round((now - newest.takenAt) / 1000));
    from = ` from your screenshot of ${ago} s ago (${basename(newest.from)})`;
  }
  const out = kind === "map" ? join(path, "..", "preview.png") : gamePicturePath(root, target);
  const use = { target, targetName, map, mapName, kind: kind as ShotKind, at: now };
  let failed: string | undefined;
  try {
    failed = await useShot(kept, id, out, use);
  } catch (error) {
    return { status: 500, error: `No picture saved: ${error instanceof Error ? error.message : String(error)}.` };
  }
  if (failed) return { status: 404, error: `No picture saved: ${failed}.` };
  return kind === "map"
    ? { status: 200, message: `Saved the thumbnail for ${mapName}${from}. Publish puts it in the lobby.` }
    : { status: 200, message: `Saved the minigame thumbnail for ${targetName}${from}. The lobby shows it from the network's next start.` };
}
