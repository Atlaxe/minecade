// Moves the maps out of a git checkout into the store: what the checkout's HEAD commit has (the maps
// the network builds from) comes in published, and its working copy (drafts, and changes not yet
// committed) as the working folders. Game pictures (games/<game>/icon.png) come the same way. A map
// or picture the store has a working copy of already is left alone, unless `replace`.
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import type { MapStore } from "./store.ts";

export interface ImportResult {
  maps: string[];
  published: string[];
  icons: string[];
  skipped: string[];
}

export async function importCheckout(store: MapStore, checkout: string, options: { replace?: boolean; note?: (text: string) => void } = {}): Promise<ImportResult> {
  const note = options.note ?? (() => {});
  const result: ImportResult = { maps: [], published: [], icons: [], skipped: [] };
  const head = mkdtempSync(join(tmpdir(), "minecade-maps-import-"));
  try {
    const archive = join(head, "head.tar");
    await git(checkout, ["archive", "--format=tar", "-o", archive, "HEAD", "--", "lobby", "games"]);
    tar.x({ file: archive, cwd: head, sync: true });
    for (const target of targets(checkout, head)) {
      const headMaps = join(head, targetPath(target), "maps");
      const diskMaps = join(checkout, targetPath(target), "maps");
      for (const map of [...new Set([...mapIds(headMaps), ...mapIds(diskMaps)])].sort()) {
        const label = `${target}/${map}`;
        const folder = store.folder(target, map);
        if (existsSync(folder) && !options.replace) {
          result.skipped.push(label);
          continue;
        }
        // A folder git has no changes in is HEAD's as checked out (line endings and all); git archive
        // writes text with LF whatever the checkout has, so its copy only stands in for a changed one.
        const rel = `${targetPath(target).replaceAll("\\", "/")}/maps/${map}`;
        const clean = (await gitOut(checkout, ["status", "--porcelain", "--untracked-files=all", "--", rel])) === "";
        const committed = clean && existsSync(join(diskMaps, map, "map.json")) ? join(diskMaps, map) : join(headMaps, map);
        if (existsSync(join(committed, "map.json"))) {
          if (committed === join(headMaps, map)) matchLineEndings(join(committed, "map.json"), join(diskMaps, map, "map.json"));
          const draft = (JSON.parse(readFileSync(join(committed, "map.json"), "utf8")) as { draft?: boolean }).draft === true;
          const { version } = store.saveVersion(target, map, draft ? "import" : "publish", "import", committed);
          if (!draft) {
            store.setPublished(target, map, version);
            result.published.push(label);
          }
        }
        const working = existsSync(join(diskMaps, map, "map.json")) ? join(diskMaps, map) : committed;
        rmSync(folder, { recursive: true, force: true });
        cpSync(working, folder, { recursive: true, filter: (source) => !source.endsWith("world.new") });
        store.saveVersion(target, map, "import", "import");
        result.maps.push(label);
        note(`${label}${result.published.includes(label) ? ", published" : ""}`);
      }
      if (target === "lobby") continue;
      const icon = store.icon(target);
      if (existsSync(icon) && !options.replace) continue;
      const committedIcon = join(head, targetPath(target), "icon.png");
      const diskIcon = join(checkout, targetPath(target), "icon.png");
      if (existsSync(committedIcon)) store.setPublishedIcon(target, readFileSync(committedIcon));
      const workingIcon = existsSync(diskIcon) ? diskIcon : committedIcon;
      if (existsSync(workingIcon)) {
        mkdirSync(join(store.dir, "working", target), { recursive: true });
        cpSync(workingIcon, icon);
        result.icons.push(target);
      }
    }
  } finally {
    rmSync(head, { recursive: true, force: true });
  }
  return result;
}

/** The lobby, then every game folder in the checkout or its HEAD. */
function targets(checkout: string, head: string): string[] {
  const games = new Set<string>();
  for (const root of [checkout, head]) {
    const dir = join(root, "games");
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) games.add(entry.name);
  }
  return ["lobby", ...[...games].sort()];
}

function targetPath(target: string): string {
  return target === "lobby" ? "lobby" : join("games", target);
}

function mapIds(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "map.json")))
    .map((entry) => entry.name);
}

/** Gives `path` CRLF line endings when the checkout's copy at `like` has them. */
function matchLineEndings(path: string, like: string): void {
  if (!existsSync(like) || !readFileSync(like, "utf8").includes("\r\n")) return;
  writeFileSync(path, readFileSync(path, "utf8").replace(/\r?\n/g, "\r\n"));
}

async function git(cwd: string, args: string[]): Promise<void> {
  await gitOut(cwd, args);
}

function gitOut(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args[0]}: ${stderr.trim() || error.message}`));
      else resolve(stdout.trim());
    });
  });
}
