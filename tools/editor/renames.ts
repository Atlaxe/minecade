// Map folders given another map id in Edit while git still tracks their old folder (a published
// map): the next Publish commits the old folder's removal with the new one, so the lobby never
// lists both. Kept in work/editor/renames.json as { "<new path>": ["<old path>", ...] }, paths
// relative to the checkout with forward slashes.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Renames = Record<string, string[]>;

function renamesPath(root: string): string {
  return join(root, "work", "editor", "renames.json");
}

async function readRenames(root: string): Promise<Renames> {
  const path = renamesPath(root);
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Renames) : {};
  } catch {
    return {};
  }
}

async function writeRenames(root: string, renames: Renames): Promise<void> {
  await mkdir(join(root, "work", "editor"), { recursive: true });
  await writeFile(renamesPath(root), `${JSON.stringify(renames, null, 2)}\n`);
}

/** Notes that the folder at `from` is now at `to` (whatever `from` was renamed from comes along). */
export async function noteRename(root: string, from: string, to: string): Promise<void> {
  const renames = await readRenames(root);
  const old = [...(renames[from] ?? []), from].filter((path) => path !== to);
  delete renames[from];
  renames[to] = [...new Set([...(renames[to] ?? []), ...old])];
  await writeRenames(root, renames);
}

/** The old folders whose removal goes with the next Publish of the folder at `path`. */
export async function renamedFrom(root: string, path: string): Promise<string[]> {
  return (await readRenames(root))[path] ?? [];
}

/** Once published: nothing more goes with `path`. */
export async function forgetRenames(root: string, path: string): Promise<void> {
  const renames = await readRenames(root);
  if (!(path in renames)) return;
  delete renames[path];
  await writeRenames(root, renames);
}
