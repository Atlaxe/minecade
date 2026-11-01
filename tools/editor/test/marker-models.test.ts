import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMarkerModels, listMarkerModels, markerStyles } from "../marker-models.ts";

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
    const marker = JSON.parse(await readFile(join(pack, "render_controllers", "editor_marker.render_controllers.json"), "utf8")).render_controllers["controller.render.minecade.editor_marker"];
    // Style n is shape n; its texture comes after the six kinds' colors (n + 3).
    expect(marker.arrays.geometries["Array.shapes"].indexOf("Geometry.model_4")).toBe(4);
    expect(marker.arrays.textures["Array.kinds"].indexOf("Texture.model_4")).toBe(4 + 3);
    const geo = JSON.parse(await readFile(join(pack, "models", "entity", "markers", "alpha_bomb.geo.json"), "utf8"));
    expect(geo["minecraft:geometry"][0].description.identifier).toBe("geometry.minecade.marker.alpha_bomb");
    expect(await readFile(join(pack, "textures", "entity", "markers", "zeta_crate.png"), "utf8")).toBe("png");
  });
});
