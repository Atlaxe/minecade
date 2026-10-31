// The camera's pictures (the map editor's Camera tool): finds the newest screenshot on this PC and
// saves it, cropped to 16:9 and scaled to the lobby's size, as a map's preview.png or a game's
// icon.png. Screenshots come from the Xbox Game Bar (Win+Alt+PrtScn, Videos\Captures) or Windows
// (Win+PrtScn, Pictures\Screenshots, which OneDrive may hold instead).
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cropToAspect, decodePng, encodePng, scaleDown } from "./png.ts";

/** The lobby's picture size (docs/ui.md): 16:9. */
export const PICTURE = { width: 320, height: 180 } as const;
/** A screenshot older than this isn't taken for the one just asked for. */
export const NEWEST_WITHIN_MS = 10 * 60_000;

/** Where Windows keeps screenshots, for this user. */
export function screenshotFolders(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.USERPROFILE ?? "";
  const folders = [join(home, "Videos", "Captures"), join(home, "Pictures", "Screenshots")];
  if (env.OneDrive) folders.push(join(env.OneDrive, "Pictures", "Screenshots"));
  return [...new Set(folders.filter((folder) => folder.length > 0))];
}

/** The newest PNG in these folders, with when it was saved, or undefined when there's none. */
export async function newestScreenshot(folders: string[]): Promise<{ path: string; time: number } | undefined> {
  let newest: { path: string; time: number } | undefined;
  for (const folder of folders) {
    if (!existsSync(folder)) continue;
    for (const name of await readdir(folder).catch(() => [])) {
      if (!name.toLowerCase().endsWith(".png")) continue;
      const path = join(folder, name);
      const info = await stat(path).catch(() => undefined);
      if (info?.isFile() && (!newest || info.mtimeMs > newest.time)) newest = { path, time: info.mtimeMs };
    }
  }
  return newest;
}

/** A picture file for the lobby: the screenshot's middle 16:9, scaled to 320x180, as PNG. */
export async function pictureFrom(screenshot: string): Promise<Buffer> {
  const picture = decodePng(await readFile(screenshot));
  return encodePng(scaleDown(cropToAspect(picture, 16, 9), PICTURE.width, PICTURE.height));
}

/**
 * Saves the newest screenshot (taken in the last few minutes) to `out`. Returns the screenshot's
 * path and age, or why there's none to use.
 */
export async function saveNewestScreenshot(out: string, folders = screenshotFolders(), now = Date.now()): Promise<{ from: string; ageMs: number } | string> {
  const newest = await newestScreenshot(folders);
  if (!newest) return "there's no screenshot on this PC yet (Win+Alt+PrtScn saves one to Videos\\Captures)";
  const ageMs = now - newest.time;
  if (ageMs > NEWEST_WITHIN_MS) return `the newest screenshot is ${Math.round(ageMs / 60_000)} minutes old: take one first (Win+Alt+PrtScn)`;
  try {
    await writeFile(out, await pictureFrom(newest.path));
  } catch (error) {
    return `couldn't use ${newest.path}: ${error instanceof Error ? error.message : String(error)}`;
  }
  return { from: newest.path, ageMs };
}
