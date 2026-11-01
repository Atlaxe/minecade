// The pictures the map editor's Snapshot saved, kept to use again: each screenshot used is stored
// cropped to 16:9 at 320x180 in work/editor/shots/<id>.png, and work/editor/shots.json lists them,
// newest first, with which maps and games used each one. Edit's thumbnail menus offer them (the
// editor's pack carries them as textures/minecade/shots/<id>, template.ts), so a map can take a
// picture another one used.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pictureFrom, recentScreenshot } from "./screenshot.ts";

export type ShotKind = "map" | "game";

export interface ShotUse {
  target: string;
  targetName: string;
  /** The map whose preview it is, or whose game's picture ("game"). */
  map: string;
  mapName: string;
  kind: ShotKind;
  at: number;
}

export interface Shot {
  id: string;
  /** The screenshot it came from, and when that was taken (its file's time). */
  from: string;
  takenAt: number;
  by: string;
  uses: ShotUse[];
}

export function shotsDir(root: string): string {
  return join(root, "work", "editor", "shots");
}

export function shotFile(root: string, id: string): string {
  return join(shotsDir(root), `${id}.png`);
}

function indexPath(root: string): string {
  return join(root, "work", "editor", "shots.json");
}

/** The shots, newest first; none when there's no list yet (or it doesn't read). */
export async function readShots(root: string): Promise<Shot[]> {
  const path = indexPath(root);
  if (!existsSync(path)) return [];
  try {
    const list = JSON.parse(await readFile(path, "utf8")) as unknown;
    return Array.isArray(list) ? list.filter(isShot).filter((shot) => existsSync(shotFile(root, shot.id))) : [];
  } catch {
    return [];
  }
}

async function writeShots(root: string, shots: Shot[]): Promise<void> {
  await mkdir(shotsDir(root), { recursive: true });
  await writeFile(indexPath(root), `${JSON.stringify(shots, null, 2)}\n`);
}

/**
 * Keeps the newest screenshot (taken in the last few minutes) as a shot: cropped and scaled, under
 * a new id. The same screenshot again gives its earlier shot. Returns the shot, or why there's none.
 */
export async function keepNewestScreenshot(root: string, by: string, folders?: string[], now = Date.now()): Promise<Shot | string> {
  const newest = await recentScreenshot(folders, now);
  if (typeof newest === "string") return newest;
  const shots = await readShots(root);
  const known = shots.find((shot) => shot.from === newest.path && shot.takenAt === Math.round(newest.time));
  if (known) return known;
  let picture: Buffer;
  try {
    picture = await pictureFrom(newest.path);
  } catch (error) {
    return `couldn't use ${newest.path}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const taken = new Set(shots.map((shot) => shot.id));
  let id = `s${Math.round(newest.time).toString(36)}`;
  for (let n = 2; taken.has(id); n++) id = `s${Math.round(newest.time).toString(36)}_${n}`;
  const shot: Shot = { id, from: newest.path, takenAt: Math.round(newest.time), by, uses: [] };
  await mkdir(shotsDir(root), { recursive: true });
  await writeFile(shotFile(root, id), picture);
  await writeShots(root, [shot, ...shots]);
  return shot;
}

/** Copies a shot to `out` (a map's preview.png or a game's icon.png) and notes the use. Returns why not, if it can't. */
export async function useShot(root: string, id: string, out: string, use: ShotUse): Promise<string | undefined> {
  const shots = await readShots(root);
  const shot = shots.find((candidate) => candidate.id === id);
  if (!shot) return "that picture is gone";
  await copyFile(shotFile(root, id), out);
  shot.uses = [use, ...shot.uses.filter((old) => !(old.target === use.target && old.map === use.map && old.kind === use.kind))];
  await writeShots(root, shots);
  return undefined;
}

/** Which shot a picture file is (the same bytes), if any. */
export async function shotOf(root: string, file: string, shots: Shot[]): Promise<string | undefined> {
  if (!existsSync(file)) return undefined;
  const want = hashOf(await readFile(file));
  for (const shot of shots) {
    if (hashOf(await readFile(shotFile(root, shot.id))) === want) return shot.id;
  }
  return undefined;
}

/** Where a shot was used last, in a few words: "Sumo: Sewer", "Sumo's picture", or "not used yet". */
export function shotLabel(shot: Shot): string {
  const last = shot.uses[0];
  if (!last) return "not used yet";
  return last.kind === "game" ? `${last.targetName}'s picture` : `${last.targetName}: ${last.mapName}`;
}

function hashOf(data: Buffer): string {
  return createHash("sha1").update(data).digest("hex");
}

function isShot(value: unknown): value is Shot {
  if (typeof value !== "object" || value === null) return false;
  const shot = value as Partial<Shot>;
  return typeof shot.id === "string" && /^[a-z0-9_]+$/.test(shot.id) && typeof shot.from === "string" && typeof shot.takenAt === "number" && Array.isArray(shot.uses);
}
