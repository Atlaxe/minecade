// The Panel's map viewer routes (panel.ts serves them): the maps there are to open, and a map's
// view file. Both only read the map store.
//   GET /api/viewer/maps                        the editor's catalog (catalog.ts): every map by target
//                                               with its checklist state, and the client's worlds
//   GET /api/viewer/view?target=<id>&map=<id>   the map's view file (view-format.ts), gzipped
import { join } from "node:path";
import type { Catalog } from "@minecade/minigame-core/config";
import { buildCatalog } from "../editor/catalog.ts";
import { storeDir, workingDir } from "../maps/paths.ts";
import { MapStore } from "../maps/store.ts";
import { cachedView, ViewError } from "./view-file.ts";

const ID = /^[A-Za-z0-9_-]+$/;

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
