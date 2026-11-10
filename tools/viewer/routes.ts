// The Panel's map viewer routes (panel.ts serves them). They only read the map store; the viewer's
// changes are POST /api/viewer/edit, /undo, /redo, /save and /publish (map-changes.ts), and Port to
// another game is GET and POST /api/viewer/port (port-map.ts).
//   GET /viewer                                 the viewer page (tools/control-panel/viewer/)
//   GET /viewer/select                          Select from above's page (select.ts has its routes)
//   GET /viewer/app.js, worker.js, select.js,   the pages' scripts, bundled with esbuild on first use and
//       port.js, delete.js                      again when one of their files changes (port.js and
//                                               delete.js are Port to another game's and Delete map's
//                                               dialogs, which the Maps page loads too)
//   GET /api/viewer/maps                        the editor's catalog (catalog.ts): every map by target
//                                               with its checklist state, and the client's worlds
//   GET /api/viewer/view?target=<id>&map=<id>   the map's view file (view-format.ts), gzipped
//   GET /api/viewer/colors                      the blocks' Average colors and texture layer
//                                               numbers (looks.ts), gzipped JSON
//   GET /api/viewer/textures                    the texture layers for Vanilla textures (16x16
//                                               RGBA each, looks.ts), gzipped; for this page only
//   GET /api/viewer/shapes?target=<id>&map=<id> the shapes of the custom blocks the map uses
//                                               (custom-shapes.ts), by look
//   GET /api/viewer/thumb?target=<id>&map=<id>  the map's thumbnail (preview.png), or a minigame
//       [&kind=map|game]                        thumbnail map's game picture (icon.png), if it has
//                                               one; kind asks for one of the two
//   GET /api/viewer/map?target=<id>&map=<id>    the map's markup data (map-data.ts): map.json, its
//                                               game's rules, marker shapes and models
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type { Catalog } from "@minecade/minigame-core/config";
import { buildCatalog } from "../editor/catalog.ts";
import { storeDir, workingDir } from "../maps/paths.ts";
import { MapStore } from "../maps/store.ts";
import type { CustomShape } from "../control-panel/viewer/shapes.ts";
import { viewShapes } from "./custom-shapes.ts";
import { colorTable, textureLayers } from "./looks.ts";
import { gamePicturePath, isGameThumbnail } from "./pictures.ts";
import { cachedView, ViewError } from "./view-file.ts";

const ID = /^[A-Za-z0-9_-]+$/;
/** The page's code, and the shared code it bundles: the view format, minigame-core's map code, and game Edit's lists and boxes. */
const PAGE_DIR = fileURLToPath(new URL("../control-panel/viewer/", import.meta.url));
const PAGE_SOURCES = [
  PAGE_DIR,
  fileURLToPath(new URL("./view-format.ts", import.meta.url)),
  fileURLToPath(new URL("./overview-format.ts", import.meta.url)),
  fileURLToPath(new URL("./edit-check.ts", import.meta.url)),
  fileURLToPath(new URL("../../packages/minigame-core/src/", import.meta.url)),
  fileURLToPath(new URL("../../editor/behavior_pack/scripts/lists.ts", import.meta.url)),
  fileURLToPath(new URL("../../editor/behavior_pack/scripts/regions.ts", import.meta.url)),
];

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

/** The shapes of the custom blocks a map uses, by look (shapes.ts lookKey). */
export function viewerShapes(root: string, target: string, map: string): { status: 200; shapes: Record<string, CustomShape> } | { status: 400 | 404 | 422; error: string } {
  const answer = viewerView(root, target, map);
  if (answer.status !== 200) return answer;
  return { status: 200, shapes: viewShapes(answer.gzipped, join(root, "packs", "blocks")) };
}

/**
 * A map's thumbnail (its preview.png, taken in game Edit), or for a minigame thumbnail map its game's
 * picture; `kind` asks for one of the two. Undefined when there's none.
 */
export function viewerThumbPath(root: string, target: string, map: string, kind?: string): string | undefined {
  if (!ID.test(target) || !ID.test(map)) return undefined;
  const folder = join(workingDir(target, storeDir(root)), map);
  const game = kind === "game" || (kind !== "map" && isGameThumbnail(join(folder, "map.json")));
  const path = game ? gamePicturePath(root, target) : join(folder, "preview.png");
  return target !== "lobby" && existsSync(path) ? path : undefined;
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

let textures: { stamp: string; gzipped: Buffer } | undefined;

/** The texture layers as gzipped bytes, kept until the table changes. */
export function viewerTextures(root: string): Buffer {
  const { stamp } = colorTable(root);
  if (textures?.stamp !== stamp) textures = { stamp, gzipped: gzipSync(textureLayers(root)) };
  return textures.gzipped;
}

let bundle: { newest: number; files: Promise<Map<string, Uint8Array>> } | undefined;

/** The page's scripts by name (app.js, worker.js, select.js), bundled again when a source file is newer than the last bundle. */
export async function viewerScripts(): Promise<Map<string, Uint8Array>> {
  const newest = Math.max(...PAGE_SOURCES.map(newestTime));
  if (!bundle || newest > bundle.newest) {
    const files = (async () => {
      const { build } = await import("esbuild");
      const result = await build({
        entryPoints: { app: join(PAGE_DIR, "app.ts"), worker: join(PAGE_DIR, "worker.ts"), select: join(PAGE_DIR, "select.ts"), port: join(PAGE_DIR, "port.ts"), delete: join(PAGE_DIR, "delete.ts") },
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
/** Select from above's page (select.ts, pass V.10). */
export const SELECT_PAGE = join(PAGE_DIR, "select.html");
