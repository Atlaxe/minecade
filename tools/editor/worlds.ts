// The worlds Select mode can open: the ones in this PC's Minecraft worlds folders, by the name the
// game shows (levelname.txt), any world folder, or a .mcworld file (unzipped into
// work/select/worlds/ with Windows' own tar, which reads zip files).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { worldSlug } from "./select-core.ts";

export interface World {
  /** The name the game shows. */
  name: string;
  /** The world's folder (with level.dat). */
  path: string;
}

/** The worlds folders of every profile in the Bedrock client (and its shared one). */
export async function worldFolders(appData = process.env.APPDATA ?? ""): Promise<string[]> {
  const users = join(appData, "Minecraft Bedrock", "Users");
  if (!appData || !existsSync(users)) return [];
  const folders: string[] = [];
  for (const user of await readdir(users)) {
    const folder = join(users, user, "games", "com.mojang", "minecraftWorlds");
    if (existsSync(folder)) folders.push(folder);
  }
  return folders;
}

/** Every world in the client's worlds folders, by name. */
export async function clientWorlds(appData?: string): Promise<World[]> {
  const worlds: World[] = [];
  for (const folder of await worldFolders(appData)) {
    for (const entry of await readdir(folder)) {
      const path = join(folder, entry);
      if (!existsSync(join(path, "level.dat"))) continue;
      worlds.push({ name: (await nameOf(path)) ?? entry, path });
    }
  }
  return worlds.sort((a, b) => a.name.localeCompare(b.name));
}

/** The world a name in the list matches (any case), or why there's none or more than one. */
export function pickWorld(worlds: World[], name: string): World | string {
  const wanted = name.trim().toLowerCase();
  const matches = worlds.filter((world) => world.name.toLowerCase() === wanted);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return `more than one world is called "${name}": give its folder instead (${matches.map((world) => world.path).join(", ")})`;
  return `there is no world called "${name}" in this PC's worlds folder: give its folder or a .mcworld file instead`;
}

/**
 * The world `input` means: a world folder, a .mcworld file (unzipped into `unzipTo`), or the name
 * of one of the client's worlds.
 */
export async function resolveWorld(input: string, unzipTo: string, appData?: string): Promise<World> {
  const path = resolve(input.trim().replace(/^"|"$/g, ""));
  if (existsSync(path) && (await stat(path)).isDirectory()) {
    if (!existsSync(join(path, "level.dat"))) throw new Error(`${path} is not a Bedrock world (there's no level.dat in it)`);
    return { name: (await nameOf(path)) ?? basename(path), path };
  }
  if (existsSync(path) && /\.mcworld$/i.test(path)) {
    const dest = join(unzipTo, worldSlug(basename(path, ".mcworld")));
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    const result = spawnSync("tar", ["-xf", path, "-C", dest], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`could not unzip ${path}: ${result.stderr || result.error?.message || "tar failed"}`);
    if (!existsSync(join(dest, "level.dat"))) throw new Error(`${path} has no level.dat: is it a Bedrock world?`);
    return { name: (await nameOf(dest)) ?? basename(path, ".mcworld"), path: dest };
  }
  const picked = pickWorld(await clientWorlds(appData), input);
  if (typeof picked === "string") throw new Error(picked);
  return picked;
}

async function nameOf(world: string): Promise<string | undefined> {
  try {
    return (await readFile(join(world, "levelname.txt"), "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}
