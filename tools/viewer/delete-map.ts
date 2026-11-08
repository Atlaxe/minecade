// Delete (the user's ask, 2026-11-07): the Panel's Maps page and map viewer delete a map, as game
// Edit's Delete map does. With the map editor running, the editor deletes it (control.ts POST
// /delete), so Edit closes first when it has the map open or is warming it up for the Panel; with
// no editor, the Panel does the same itself. Either way the map's folder goes from the map store, a
// published map stops being published (its versions stay in maps.db), and it leaves every world's
// list in Select (the Panel's Select from above too) and Recent. The live lobby (LOBBY_MAP) is
// refused: another lobby map has to be picked first.
//   POST /api/viewer/delete {target, map}
import { existsSync, readFileSync } from "node:fs";
import { forgetRecent } from "../editor/catalog.ts";
import { loadTarget } from "../editor/targets.ts";
import { storeDir } from "../maps/paths.ts";
import { MapStore } from "../maps/store.ts";
import { mapJsonPath } from "./map-data.ts";

/** What deleting needs from around it, so tests can stand in for the editor and the Panel. */
export interface DeleteLinks {
  /** The running editor's delete: whether the map was published, or why not; undefined when no editor answers. */
  editor(target: string, map: string): Promise<{ published: boolean } | { error: string } | undefined>;
  /** Takes the map off the Panel's own Select from above lists. */
  forgetSelections(target: string, map: string): Promise<void>;
  /** The live lobby map (LOBBY_MAP, "spaceship" when unset). */
  lobbyMap(): string;
}

export type DeleteAnswer = { status: 200; message: string; published: boolean } | { status: 400 | 404 | 409 | 500; error: string };

/** The default LOBBY_MAP (docker-compose.yml's). */
export const DEFAULT_LOBBY_MAP = "spaceship";

/** Deletes a map from the map store, through the running editor when there is one. */
export async function deleteMap(root: string, body: Record<string, unknown>, links: DeleteLinks): Promise<DeleteAnswer> {
  const target = typeof body.target === "string" ? body.target : "";
  const map = typeof body.map === "string" ? body.map : "";
  const path = mapJsonPath(root, target, map);
  if (!path) return { status: 400, error: "expected {target, map}" };
  if (!existsSync(path)) return { status: 404, error: `there's no map ${target}/${map} in the map store` };
  let targetName = target;
  let mapName = map;
  try {
    targetName = (await loadTarget(root, target)).name;
    mapName = ((JSON.parse(readFileSync(path, "utf8")) as { name?: string }).name || map).trim();
  } catch {
    // Named by its ids, then.
  }
  if (target === "lobby" && map === links.lobbyMap()) {
    return { status: 409, error: `${mapName} is the live lobby (LOBBY_MAP): pick another lobby map on the Servers page first.` };
  }
  let published: boolean;
  const through = await links.editor(target, map);
  if (through && "error" in through) return { status: 409, error: `The map editor didn't delete it: ${through.error}.` };
  if (through) {
    published = through.published;
  } else {
    try {
      const store = MapStore.open(storeDir(root));
      try {
        published = store.remove(target, map).published;
        if (published) store.exportPublished();
      } finally {
        store.close();
      }
      await forgetRecent(root, (entry) => entry.request.to !== "select" && entry.request.target === target && entry.request.map === map);
    } catch (error) {
      return { status: 500, error: `It didn't delete: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  await links.forgetSelections(target, map).catch(() => undefined);
  const after = !published ? "" : target === "lobby" ? " It leaves the Panel's lobby map picker." : " It leaves the lobby at the network's next start.";
  return { status: 200, published, message: `Deleted ${mapName} (${targetName}).${after}` };
}
