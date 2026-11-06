// A map's markup for the viewer page: its map.json, the rules its game checks it by (with each
// team's color), the shapes game Edit draws markers with (its resource pack's geometry) and the
// game's own marker models (markers/<model>.geo.json and .png), so the page draws every list the
// way game Edit does. And a watch on map.json, so an open viewer sees a change made in game Edit or
// by hand: the Panel's event stream for the viewer's window carries it (panel.ts openEvents); and
// one on the map's world, so the viewer draws the blocks again once game Edit saves them.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unwatchFile, watchFile } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EditorRules, MapConfig } from "@minecade/minigame-core/config";
import { listMarkerModels } from "../editor/marker-models.ts";
import { loadTarget } from "../editor/targets.ts";
import { storeDir, workingDir } from "../maps/paths.ts";
import { worldStamp } from "./view-file.ts";

const ID = /^[A-Za-z0-9_-]+$/;
/** Game Edit's marker shapes, in its resource pack. */
const SHAPES_FILE = join("editor", "resource_pack", "models", "entity", "editor_marker.geo.json");
const SHAPE_IDS = { player: "geometry.minecade.editor_mannequin", post: "geometry.minecade.editor_post" } as const;

/** A Bedrock geometry file's JSON, with one geometry in its list. */
export type GeometryFile = { "minecraft:geometry": unknown[] };

export interface ViewerMap {
  config: MapConfig;
  /** map.json's text as a short hash: the page tells its own change coming back from another one. */
  stamp: string;
  /** "Lobby", or the game's name. */
  targetName: string;
  rules: EditorRules;
  /** Game Edit's own marker shapes: a mannequin for spawns, a post for points. */
  shapes: { player: GeometryFile; post: GeometryFile };
  /** The game's own marker models by name: the geometry, and the texture as a data URL. */
  models: Record<string, { geometry: GeometryFile; texture: string }>;
}

export type MapAnswer = { status: 200; map: ViewerMap } | { status: 400 | 404 | 422; error: string };

/** The path of a map's map.json in the store's working folder, or undefined for ids that could leave it. */
export function mapJsonPath(root: string, target: string, map: string): string | undefined {
  if (!ID.test(target) || !ID.test(map)) return undefined;
  return join(workingDir(target, storeDir(root)), map, "map.json");
}

export async function viewerMap(root: string, target: string, map: string): Promise<MapAnswer> {
  const path = mapJsonPath(root, target, map);
  if (!path) return { status: 400, error: "expected ?target=<id>&map=<id>" };
  if (!existsSync(path)) return { status: 404, error: `there's no map ${target}/${map} in the map store` };
  const text = await readFile(path, "utf8");
  let config: MapConfig;
  try {
    config = JSON.parse(text) as MapConfig;
  } catch {
    return { status: 422, error: "its map.json isn't valid JSON" };
  }
  let loaded: Awaited<ReturnType<typeof loadTarget>>;
  try {
    loaded = await loadTarget(root, target);
  } catch (error) {
    return { status: 404, error: error instanceof Error ? error.message : String(error) };
  }
  const models: ViewerMap["models"] = {};
  for (const model of (await listMarkerModels(root)).filter((candidate) => candidate.target === target)) {
    const geometry = JSON.parse(await readFile(model.geometry, "utf8")) as GeometryFile;
    const texture = `data:image/png;base64,${(await readFile(model.texture)).toString("base64")}`;
    models[model.model] = { geometry, texture };
  }
  return { status: 200, map: { config, stamp: stampOf(text), targetName: loaded.name, rules: loaded.rules, shapes: await markerShapes(root), models } };
}

/** Only the map as it is now, and its stamp (the page reads it again after a change made elsewhere). */
export async function viewerMapConfig(root: string, target: string, map: string): Promise<{ status: 200; config: MapConfig; stamp: string } | { status: 400 | 404 | 422; error: string }> {
  const path = mapJsonPath(root, target, map);
  if (!path) return { status: 400, error: "expected ?target=<id>&map=<id>" };
  if (!existsSync(path)) return { status: 404, error: `there's no map ${target}/${map} in the map store` };
  const text = await readFile(path, "utf8");
  try {
    return { status: 200, config: JSON.parse(text) as MapConfig, stamp: stampOf(text) };
  } catch {
    return { status: 422, error: "its map.json isn't valid JSON" };
  }
}

/** Game Edit's mannequin and post, each as a geometry file of its own. */
async function markerShapes(root: string): Promise<ViewerMap["shapes"]> {
  const file = JSON.parse(await readFile(join(root, SHAPES_FILE), "utf8")) as GeometryFile;
  const pick = (identifier: string): GeometryFile => {
    const geometry = file["minecraft:geometry"].find((entry) => (entry as { description?: { identifier?: string } }).description?.identifier === identifier);
    if (!geometry) throw new Error(`${SHAPES_FILE} has no ${identifier}`);
    return { "minecraft:geometry": [geometry] };
  };
  return { player: pick(SHAPE_IDS.player), post: pick(SHAPE_IDS.post) };
}

export function stampOf(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

/** A change to a watched map.json: the new map, or undefined while the file isn't valid JSON. */
export interface MapChange {
  stamp: string;
  config?: MapConfig;
}

const watches = new Map<string, { listeners: Set<(change: MapChange) => void>; stamp: string }>();

/**
 * Calls `listener` whenever the map's map.json changes (checked every half second, as game Edit
 * checks it). Returns the function that stops it; the file is unwatched once nobody listens.
 */
export function watchMap(root: string, target: string, map: string, listener: (change: MapChange) => void): () => void {
  const path = mapJsonPath(root, target, map);
  if (!path) return () => {};
  let watch = watches.get(path);
  if (!watch) {
    const created = { listeners: new Set<(change: MapChange) => void>(), stamp: stampOfFile(path) };
    watch = created;
    watches.set(path, created);
    watchFile(path, { interval: 500 }, () => {
      const stamp = stampOfFile(path);
      if (stamp === created.stamp) return;
      created.stamp = stamp;
      let config: MapConfig | undefined;
      try {
        config = JSON.parse(readFileSync(path, "utf8")) as MapConfig;
      } catch {
        config = undefined;
      }
      for (const each of created.listeners) each({ stamp, ...(config ? { config } : {}) });
    });
  }
  const listeners = watch.listeners;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && watches.get(path)?.listeners === listeners) {
      unwatchFile(path);
      watches.delete(path);
    }
  };
}

/** How often a watched world's files are looked at. */
const WORLD_POLL_MS = 2000;
const worldWatches = new Map<string, { listeners: Set<(stamp: string) => void>; stamp: string; seen: string; timer: NodeJS.Timeout }>();

/**
 * Calls `listener` with the world's new stamp (view-file.ts worldStamp, the view file's) whenever
 * the map's world changes: game Edit saving it swaps the world folder whole, so a stamp counts once
 * it's the same twice in a row with the world there. Returns the function that stops it.
 */
export function watchWorld(root: string, target: string, map: string, listener: (stamp: string) => void): () => void {
  const json = mapJsonPath(root, target, map);
  if (!json) return () => {};
  const world = join(json, "..", "world");
  let watch = worldWatches.get(world);
  if (!watch) {
    let stamp = "";
    try {
      stamp = worldStamp(world);
    } catch {
      // Read again on the next look.
    }
    const created = {
      listeners: new Set<(stamp: string) => void>(),
      stamp,
      seen: stamp,
      timer: setInterval(() => {
        if (!existsSync(join(world, "db"))) return;
        let now: string;
        try {
          now = worldStamp(world);
        } catch {
          // A file went while it was read: the world is being swapped.
          return;
        }
        const steady = now === created.seen;
        created.seen = now;
        if (!steady || now === created.stamp) return;
        created.stamp = now;
        for (const each of created.listeners) each(now);
      }, WORLD_POLL_MS),
    };
    created.timer.unref();
    watch = created;
    worldWatches.set(world, created);
  }
  const listeners = watch.listeners;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    const current = worldWatches.get(world);
    if (listeners.size === 0 && current?.listeners === listeners) {
      clearInterval(current.timer);
      worldWatches.delete(world);
    }
  };
}

function stampOfFile(path: string): string {
  try {
    return stampOf(readFileSync(path, "utf8"));
  } catch {
    return "";
  }
}
