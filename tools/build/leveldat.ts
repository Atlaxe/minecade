// Read/write Bedrock level.dat files.
// Format: int32 LE storage version, int32 LE payload length, then little-endian uncompressed NBT.
import { readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import nbt from "prismarine-nbt";

type Tag = NonNullable<nbt.Compound["value"][string]>;

export interface LevelDat {
  storageVersion: number;
  root: nbt.NBT;
}

export async function readLevelDat(path: string): Promise<LevelDat> {
  return decodeLevelDat(await readFile(path));
}

export async function writeLevelDat(path: string, dat: LevelDat): Promise<void> {
  await writeFile(path, encodeLevelDat(dat));
}

function decodeLevelDat(buf: Buffer): LevelDat {
  const storageVersion = buf.readInt32LE(0);
  const length = buf.readInt32LE(4);
  const root = nbt.parseUncompressed(buf.subarray(8, 8 + length), "little");
  return { storageVersion, root };
}

export function encodeLevelDat(dat: LevelDat): Buffer {
  const body = nbt.writeUncompressed(dat.root, "little");
  const header = Buffer.alloc(8);
  header.writeInt32LE(dat.storageVersion, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function fields(dat: LevelDat): Record<string, Tag | undefined> {
  return dat.root.value;
}

export function setTag(dat: LevelDat, key: string, tag: Tag): void {
  fields(dat)[key] = tag;
}

export function getTag(dat: LevelDat, key: string): Tag | undefined {
  return fields(dat)[key];
}

/** Turns on the "Beta APIs" experiment, required by @minecraft/server-admin and server-net. */
export function enableBetaApis(dat: LevelDat): void {
  const existing = getTag(dat, "experiments");
  const experiments: Record<string, Tag | undefined> =
    existing?.type === "compound" ? existing.value : {};
  experiments.gametest = nbt.byte(1) as Tag;
  experiments.experiments_ever_used = nbt.byte(1) as Tag;
  experiments.saved_with_toggled_experiments = nbt.byte(1) as Tag;
  setTag(dat, "experiments", nbt.comp(experiments) as Tag);
}

export function isBetaApisEnabled(dat: LevelDat): boolean {
  const experiments = getTag(dat, "experiments");
  if (experiments?.type !== "compound") return false;
  const gametest = experiments.value.gametest;
  return gametest?.type === "byte" && gametest.value === 1;
}

export async function patchLevelDat(path: string, patch: (dat: LevelDat) => void): Promise<void> {
  const dat = await readLevelDat(path);
  patch(dat);
  await writeLevelDat(path, dat);
}

/** patchLevelDat, done at once (the map store's export is synchronous). */
export function patchLevelDatSync(path: string, patch: (dat: LevelDat) => void): void {
  const dat = decodeLevelDat(readFileSync(path));
  patch(dat);
  writeFileSync(path, encodeLevelDat(dat));
}
