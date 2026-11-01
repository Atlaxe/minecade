// The camera's pictures (the map editor's Snapshot): finds the newest screenshot on this PC and
// saves it, cropped to 16:9 and scaled to the lobby's size. Screenshots come from Minecraft's own
// screenshot key (F2, JPEGs in each profile's com.mojang\Screenshots), the Xbox Game Bar
// (Win+Alt+PrtScn, Videos\Captures) or Windows (Win+PrtScn, Pictures\Screenshots, which OneDrive
// may hold instead). shots.ts keeps the saved pictures to use again.
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeJpeg } from "./jpeg.ts";
import { cropToAspect, decodePng, encodePng, scaleDown, type Picture } from "./png.ts";

/** The lobby's picture size (docs/ui.md): 16:9. */
export const PICTURE = { width: 320, height: 180 } as const;
/** A screenshot older than this isn't taken for the one just asked for. */
export const NEWEST_WITHIN_MS = 10 * 60_000;
const PICTURE_FILE = /\.(png|jpe?g)$/i;

/** Where Windows keeps screenshots, for this user. */
export function screenshotFolders(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.USERPROFILE ?? "";
  const folders = [join(home, "Videos", "Captures"), join(home, "Pictures", "Screenshots")];
  if (env.OneDrive) folders.push(join(env.OneDrive, "Pictures", "Screenshots"));
  return [...new Set(folders.filter((folder) => folder.length > 0))];
}

/** Where Minecraft keeps the screenshots its own key takes: a folder per account in each profile. */
export async function minecraftScreenshotFolders(appData = process.env.APPDATA ?? ""): Promise<string[]> {
  const users = join(appData, "Minecraft Bedrock", "Users");
  if (!appData || !existsSync(users)) return [];
  const folders: string[] = [];
  for (const user of await readdir(users).catch(() => [])) {
    const shots = join(users, user, "games", "com.mojang", "Screenshots");
    for (const account of await readdir(shots).catch(() => [])) folders.push(join(shots, account));
  }
  return folders;
}

/** Every folder a screenshot can be in: Minecraft's, then Windows'. */
export async function allScreenshotFolders(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  return [...(await minecraftScreenshotFolders(env.APPDATA ?? "")), ...screenshotFolders(env)];
}

/** The newest PNG or JPEG in these folders, with when it was saved, or undefined when there's none. */
export async function newestScreenshot(folders: string[]): Promise<{ path: string; time: number } | undefined> {
  let newest: { path: string; time: number } | undefined;
  for (const folder of folders) {
    if (!existsSync(folder)) continue;
    for (const name of await readdir(folder).catch(() => [])) {
      if (!PICTURE_FILE.test(name)) continue;
      const path = join(folder, name);
      const info = await stat(path).catch(() => undefined);
      if (info?.isFile() && (!newest || info.mtimeMs > newest.time)) newest = { path, time: info.mtimeMs };
    }
  }
  return newest;
}

/** A screenshot's pixels: a PNG or a JPEG, told apart by their first bytes. */
export function decodeScreenshot(file: Uint8Array): Picture {
  return file[0] === 0xff && file[1] === 0xd8 ? decodeJpeg(file) : decodePng(file);
}

/** A picture file for the lobby: the screenshot's middle 16:9, scaled to 320x180, as PNG. */
export async function pictureFrom(screenshot: string): Promise<Buffer> {
  const picture = decodeScreenshot(await readFile(screenshot));
  return encodePng(scaleDown(cropToAspect(picture, 16, 9), PICTURE.width, PICTURE.height));
}

/**
 * The newest screenshot, taken in the last few minutes: its path and age, or why there's none to
 * use. `folders` defaults to every folder screenshots go to.
 */
export async function recentScreenshot(folders?: string[], now = Date.now()): Promise<{ path: string; time: number; ageMs: number } | string> {
  const newest = await newestScreenshot(folders ?? (await allScreenshotFolders()));
  if (!newest) return "there's no screenshot on this PC yet (F2 in Minecraft takes one)";
  const ageMs = now - newest.time;
  if (ageMs > NEWEST_WITHIN_MS) return `the newest screenshot is ${Math.round(ageMs / 60_000)} minutes old: take one first (F1, then F2)`;
  return { ...newest, ageMs };
}

/**
 * Saves the newest screenshot (taken in the last few minutes) to `out`. Returns the screenshot's
 * path and age, or why there's none to use.
 */
export async function saveNewestScreenshot(out: string, folders?: string[], now = Date.now()): Promise<{ from: string; ageMs: number } | string> {
  const newest = await recentScreenshot(folders, now);
  if (typeof newest === "string") return newest;
  try {
    await writeFile(out, await pictureFrom(newest.path));
  } catch (error) {
    return `couldn't use ${newest.path}: ${error instanceof Error ? error.message : String(error)}`;
  }
  return { from: newest.path, ageMs: newest.ageMs };
}
