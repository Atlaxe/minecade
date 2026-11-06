// The Panel's map viewer routes (panel.ts serves them). They only read the map store.
//   GET /viewer                                 the viewer page (tools/control-panel/viewer/)
//   GET /viewer/app.js, /viewer/worker.js       its scripts, bundled with esbuild on first use and
//                                               again when one of their files changes
//   GET /api/viewer/maps                        the editor's catalog (catalog.ts): every map by target
//                                               with its checklist state, and the client's worlds
//   GET /api/viewer/view?target=<id>&map=<id>   the map's view file (view-format.ts), gzipped
//   GET /api/viewer/colors                      the blocks' Average colors (looks.ts), gzipped JSON
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type { Catalog } from "@minecade/minigame-core/config";
import { buildCatalog } from "../editor/catalog.ts";
import { storeDir, workingDir } from "../maps/paths.ts";
import { MapStore } from "../maps/store.ts";
import { colorTable } from "./looks.ts";
import { cachedView, ViewError } from "./view-file.ts";

const ID = /^[A-Za-z0-9_-]+$/;
/** The page's code, and the shared code it bundles. */
const PAGE_DIR = fileURLToPath(new URL("../control-panel/viewer/", import.meta.url));
const PAGE_SOURCES = [PAGE_DIR, fileURLToPath(new URL("./view-format.ts", import.meta.url))];

export async function viewerMaps(root: string): Promise<Catalog> {
  const store = MapStore.open(storeDir(root));
  try {
    return await buildCatalog(root, store);
  } finally {
    store.close();
  }
}

export type ViewAnswer = { status: 200; gzipped: Buffer; stamp: string } | { status: 400 | 404 | 422; error: string };

/** A map's view file from the cache in work\viewer\maps\, made first when its world changed. */
export function viewerView(root: string, target: string, map: string): ViewAnswer {
  if (!ID.test(target) || !ID.test(map)) return { status: 400, error: "expected ?target=<id>&map=<id>" };
  const world = join(workingDir(target, storeDir(root)), map, "world");
  try {
    const { gzipped, stamp } = cachedView(world, join(root, "work", "viewer", "maps", target, map));
    return { status: 200, gzipped, stamp };
  } catch (error) {
    if (!(error instanceof ViewError)) throw error;
    return { status: error.message.startsWith("there's no world") ? 404 : 422, error: error.message };
  }
}

let colors: { key: string; gzipped: Buffer } | undefined;

/** The color table as gzipped JSON, kept until it or the overrides change. */
export function viewerColors(root: string): Buffer {
  const table = colorTable(root);
  const overrides = join(root, "work", "viewer", "looks", "overrides.json");
  const key = `${table.stamp} ${existsSync(overrides) ? statSync(overrides).mtimeMs : 0}`;
  if (colors?.key !== key) colors = { key, gzipped: gzipSync(JSON.stringify(table)) };
  return colors.gzipped;
}

let bundle: { newest: number; files: Promise<Map<string, Uint8Array>> } | undefined;

/** The page's scripts by name (app.js, worker.js), bundled again when a source file is newer than the last bundle. */
export async function viewerScripts(): Promise<Map<string, Uint8Array>> {
  const newest = Math.max(...PAGE_SOURCES.map(newestTime));
  if (!bundle || newest > bundle.newest) {
    const files = (async () => {
      const { build } = await import("esbuild");
      const result = await build({
        entryPoints: { app: join(PAGE_DIR, "app.ts"), worker: join(PAGE_DIR, "worker.ts") },
        bundle: true,
        format: "esm",
        target: "es2022",
        minify: true,
        write: false,
        outdir: "out",
        logLevel: "silent",
      });
      return new Map(result.outputFiles.map((file) => [file.path.split(/[\\/]/).pop()!, file.contents]));
    })();
    bundle = { newest, files };
    // A failed bundle is tried again next time.
    files.catch(() => {
      if (bundle?.files === files) bundle = undefined;
    });
  }
  return bundle.files;
}

/** The newest modification time of a file, or of any file under a folder (tests aside). */
function newestTime(path: string): number {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return Math.max(0, ...readdirSync(path).filter((name) => name !== "test").map((name) => newestTime(join(path, name))));
}

/** The viewer page. */
export const VIEWER_PAGE = join(PAGE_DIR, "viewer.html");
