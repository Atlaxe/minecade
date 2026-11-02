// A game's own marker models (map config `marker: { model }`): markers/<model>.geo.json and
// markers/<model>.png in the game's folder (the lobby's: lobby/markers/). The editor's template
// build adds every one to the editor's resource pack, numbered after the built-in marker styles
// (editor/behavior_pack/scripts/lists.ts MARKER_STYLES), and each target's rules carry its models'
// numbers so the pack can draw them: on the markers, and on the aim cursor while one is placed. A
// model's bones named "tint" take a team's color (the rim of Bridges' hole); the rest keep their
// texture's.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The first number after the built-in styles (a mannequin, a post, a camera head). */
export const FIRST_MODEL_STYLE = 3;
/** The editor_marker entity's minecade:style range ends here (editor/behavior_pack/entities/editor_marker.json). */
export const MAX_STYLE = 63;
/** The kinds' colors come first in the render controller's Array.kinds: a model's texture follows them. */
const KIND_TEXTURES = 6;
/** The cursor's shapes before the models (the box outline, then one per built-in style: style n is shape n + 1). */
const CURSOR_SHAPES = FIRST_MODEL_STYLE + 1;
/** The cursor's looks before the models (the box outline's, the ghost's): style n's texture is n - 1. */
const CURSOR_LOOKS = 2;
/** The marker's render controllers that draw its shape (its tinted bones are drawn by the second). */
const MARKER_CONTROLLERS = ["controller.render.minecade.editor_marker", "controller.render.minecade.editor_marker_tint"];
const NAME = /^[a-z0-9_]+$/;

export interface MarkerModel {
  /** "lobby", or a game id. */
  target: string;
  /** The model's name, as the config's `{ model }` says it. */
  model: string;
  geometry: string;
  texture: string;
  /** Its number for the marker's minecade:style. */
  style: number;
}

/** Every target's marker models, in a fixed order (by target, then name), numbered from FIRST_MODEL_STYLE. */
export async function listMarkerModels(root: string): Promise<MarkerModel[]> {
  const targets = ["lobby", ...(existsSync(join(root, "games")) ? (await readdir(join(root, "games"))).sort() : [])];
  const found: Omit<MarkerModel, "style">[] = [];
  for (const target of targets) {
    const dir = join(root, ...(target === "lobby" ? ["lobby"] : ["games", target]), "markers");
    if (!existsSync(dir)) continue;
    for (const file of (await readdir(dir)).sort()) {
      const model = file.endsWith(".geo.json") ? file.slice(0, -".geo.json".length) : undefined;
      if (model === undefined || !NAME.test(model)) continue;
      const texture = join(dir, `${model}.png`);
      if (!existsSync(texture)) continue;
      found.push({ target, model, geometry: join(dir, file), texture });
    }
  }
  return found.slice(0, MAX_STYLE - FIRST_MODEL_STYLE + 1).map((entry, index) => ({ ...entry, style: FIRST_MODEL_STYLE + index }));
}

/** One target's models by name, for its rules (EditorRules markerModels). */
export function markerStyles(models: MarkerModel[], target: string): Record<string, number> {
  return Object.fromEntries(models.filter((model) => model.target === target).map((model) => [model.model, model.style]));
}

/**
 * Adds the models to a built copy of the editor's resource pack: each geometry (renamed
 * geometry.minecade.marker.<target>.<model>) and texture, the marker's and the cursor's client
 * entity entries, and their render controllers' shape and texture arrays.
 */
export async function addMarkerModels(pack: string, models: MarkerModel[]): Promise<void> {
  if (models.length === 0) return;
  const entityPath = join(pack, "entity", "editor_marker.entity.json");
  const cursorPath = join(pack, "entity", "editor_cursor.entity.json");
  const controllerPath = join(pack, "render_controllers", "editor_marker.render_controllers.json");
  const entity = JSON.parse(await readFile(entityPath, "utf8"));
  const cursorEntity = JSON.parse(await readFile(cursorPath, "utf8"));
  const controllers = JSON.parse(await readFile(controllerPath, "utf8"));
  const descriptions = [entity["minecraft:client_entity"].description, cursorEntity["minecraft:client_entity"].description];
  const markers = MARKER_CONTROLLERS.map((name) => controllers.render_controllers[name]);
  const cursor = controllers.render_controllers["controller.render.minecade.editor_cursor"];
  const lists: { shapes: string[]; looks: string[]; shapeCount: number; lookCount: number }[] = [
    ...markers.map((marker) => ({ shapes: marker?.arrays.geometries["Array.shapes"], looks: marker?.arrays.textures["Array.kinds"], shapeCount: FIRST_MODEL_STYLE, lookCount: KIND_TEXTURES })),
    { shapes: cursor?.arrays.geometries["Array.shapes"], looks: cursor?.arrays.textures["Array.looks"], shapeCount: CURSOR_SHAPES, lookCount: CURSOR_LOOKS },
  ];
  if (lists.some((list) => list.shapes?.length !== list.shapeCount || list.looks?.length !== list.lookCount)) {
    throw new Error("the editor's marker or cursor render controller doesn't match tools/editor/marker-models.ts (their shapes or textures changed)");
  }
  await mkdir(join(pack, "models", "entity", "markers"), { recursive: true });
  await mkdir(join(pack, "textures", "entity", "markers"), { recursive: true });
  for (const model of models) {
    const name = `${model.target.replace(/[^a-z0-9_]/g, "_")}_${model.model}`;
    const identifier = `geometry.minecade.marker.${name}`;
    const geo = JSON.parse(await readFile(model.geometry, "utf8"));
    const first = geo["minecraft:geometry"]?.[0];
    if (!first?.description) throw new Error(`${model.geometry}: not a geometry file (no "minecraft:geometry" list)`);
    first.description.identifier = identifier;
    geo["minecraft:geometry"] = [first];
    await writeFile(join(pack, "models", "entity", "markers", `${name}.geo.json`), JSON.stringify(geo, null, 2));
    await copyFile(model.texture, join(pack, "textures", "entity", "markers", `${name}.png`));
    const key = `model_${model.style}`;
    for (const description of descriptions) {
      description.geometry[key] = identifier;
      description.textures[key] = `textures/entity/markers/${name}`;
    }
    for (const list of lists) {
      list.shapes.push(`Geometry.${key}`);
      list.looks.push(`Texture.${key}`);
    }
  }
  await writeFile(entityPath, JSON.stringify(entity, null, 2));
  await writeFile(cursorPath, JSON.stringify(cursorEntity, null, 2));
  await writeFile(controllerPath, JSON.stringify(controllers, null, 2));
}
