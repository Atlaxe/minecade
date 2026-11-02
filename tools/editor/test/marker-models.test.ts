import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_MODEL_EVENT, addMarkerHitboxes, addMarkerModels, listMarkerModels, markerStyles, modelEvent, modelHitbox } from "../marker-models.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const GEO = { format_version: "1.12.0", "minecraft:geometry": [{ description: { identifier: "geometry.anything", texture_width: 16, texture_height: 16 }, bones: [] }] };

describe("a game's own marker models", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "minecade-markers-"));
    const add = async (dir: string[], name: string, png = true) => {
      await mkdir(join(root, ...dir, "markers"), { recursive: true });
      await writeFile(join(root, ...dir, "markers", `${name}.geo.json`), JSON.stringify(GEO));
      if (png) await writeFile(join(root, ...dir, "markers", `${name}.png`), "png");
    };
    await add(["lobby"], "terminal");
    await add(["games", "zeta"], "crate");
    await add(["games", "alpha"], "flag");
    await add(["games", "alpha"], "bomb");
    await add(["games", "alpha"], "no_texture", false);
    await add(["games", "alpha"], "Bad-Name");
  });

  afterAll(() => rm(root, { recursive: true, force: true }));

  it("numbers every model after the built-in styles: the lobby's, then each game's, by name", async () => {
    const models = await listMarkerModels(root);
    expect(models.map((model) => [model.target, model.model, model.style])).toEqual([
      ["lobby", "terminal", 3],
      ["alpha", "bomb", 4],
      ["alpha", "flag", 5],
      ["zeta", "crate", 6],
    ]);
    expect(markerStyles(models, "alpha")).toEqual({ bomb: 4, flag: 5 });
    expect(markerStyles(models, "sumo")).toEqual({});
  });

  it("adds them to a built copy of the editor's resource pack", async () => {
    const pack = join(root, "pack");
    await cp(join(repo, "editor", "resource_pack"), pack, { recursive: true });
    await addMarkerModels(pack, await listMarkerModels(root));
    const entity = JSON.parse(await readFile(join(pack, "entity", "editor_marker.entity.json"), "utf8"))["minecraft:client_entity"].description;
    expect(entity.geometry.model_4).toBe("geometry.minecade.marker.alpha_bomb");
    expect(entity.textures.model_4).toBe("textures/entity/markers/alpha_bomb");
    const controllers = JSON.parse(await readFile(join(pack, "render_controllers", "editor_marker.render_controllers.json"), "utf8")).render_controllers;
    // Style n is shape n; its texture comes after the six kinds' colors (n + 3). The tint pass draws the same.
    for (const name of ["controller.render.minecade.editor_marker", "controller.render.minecade.editor_marker_tint"]) {
      expect(controllers[name].arrays.geometries["Array.shapes"].indexOf("Geometry.model_4")).toBe(4);
      expect(controllers[name].arrays.textures["Array.kinds"].indexOf("Texture.model_4")).toBe(4 + 3);
    }
    // The aim cursor: style n is shape n + 1 (after the box outline), its texture n - 1 (after the outline's and the ghost's).
    const cursor = controllers["controller.render.minecade.editor_cursor"];
    expect(cursor.arrays.geometries["Array.shapes"].indexOf("Geometry.model_4")).toBe(4 + 1);
    expect(cursor.arrays.textures["Array.looks"].indexOf("Texture.model_4")).toBe(4 - 1);
    const cursorEntity = JSON.parse(await readFile(join(pack, "entity", "editor_cursor.entity.json"), "utf8"))["minecraft:client_entity"].description;
    expect(cursorEntity.geometry.model_4).toBe("geometry.minecade.marker.alpha_bomb");
    expect(cursorEntity.textures.model_4).toBe("textures/entity/markers/alpha_bomb");
    const geo = JSON.parse(await readFile(join(pack, "models", "entity", "markers", "alpha_bomb.geo.json"), "utf8"));
    expect(geo["minecraft:geometry"][0].description.identifier).toBe("geometry.minecade.marker.alpha_bomb");
    expect(await readFile(join(pack, "textures", "entity", "markers", "zeta_crate.png"), "utf8")).toBe("png");
  });

  it("gives each one a hitbox in a built copy of the editor's behavior pack, and events to switch to it and back", async () => {
    const pack = join(root, "bp");
    await cp(join(repo, "editor", "behavior_pack", "entities"), join(pack, "entities"), { recursive: true });
    await addMarkerHitboxes(pack, await listMarkerModels(root));
    const entity = JSON.parse(await readFile(join(pack, "entities", "editor_marker.json"), "utf8"))["minecraft:entity"];
    // These models have no cubes: the smallest hitbox.
    expect(entity.component_groups["minecade:model_4"]).toEqual({ "minecraft:custom_hit_test": { hitboxes: [{ width: 0.25, height: 0.25, pivot: [0, 0, 0] }] } });
    expect(entity.events[modelEvent(4)]).toEqual({ remove: { component_groups: ["minecade:model_3", "minecade:model_5", "minecade:model_6"] }, add: { component_groups: ["minecade:model_4"] } });
    expect(entity.events[NO_MODEL_EVENT]).toEqual({ remove: { component_groups: ["minecade:model_3", "minecade:model_4", "minecade:model_5", "minecade:model_6"] } });
    expect(entity.events["minecade:settings"]).toEqual({});
  });

  it("sizes a hitbox from the model's cubes: bottom to top, and square around the marker as far as they reach", async () => {
    const hole = JSON.parse(await readFile(join(repo, "games", "bridges", "markers", "hole.geo.json"), "utf8"));
    expect(modelHitbox(hole)).toEqual({ width: 3, height: 3, pivot: [0, 1.5, 0] });
    const offCenter = { "minecraft:geometry": [{ bones: [{ cubes: [{ origin: [2, -8, -4], size: [6, 16, 2] }] }] }] };
    expect(modelHitbox(offCenter)).toEqual({ width: 1, height: 1, pivot: [0, 0, 0] });
  });
});
