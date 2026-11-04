import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DYES, GRENADE, GUNS, GUN_PICKUP, PAINTBALL, THROWN_GRENADE, gunItems } from "../../../packages/minigame-core/src/gun-defs.ts";
import { gunsPackFiles } from "../../assets/guns.ts";

type Json = Record<string, any>;
const files = gunsPackFiles();
const json = (path: string): Json => JSON.parse(files[path] as string) as Json;

describe("the guns pack's files", () => {
  it("match what tools/assets/guns.ts writes (rerun it after changing a model or gun-defs.ts)", () => {
    for (const [path, content] of Object.entries(files)) {
      const file = fileURLToPath(new URL(`../../../packs/guns/${path}`, import.meta.url));
      expect(existsSync(file), path).toBe(true);
      const disk = readFileSync(file);
      if (typeof content === "string") expect(disk.toString("utf8").replace(/\r\n/g, "\n"), path).toBe(content);
      else expect(disk.equals(content), path).toBe(true);
    }
  });

  it("gives every item an icon, a held model and the animations it names", () => {
    const icons = json("resource_pack/textures/item_texture.json").texture_data;
    const geometries = new Set(json("resource_pack/models/entity/guns.geo.json")["minecraft:geometry"].map((geometry: Json) => geometry.description.identifier));
    const animations = new Set([
      ...Object.keys(json("resource_pack/animations/guns.animation.json").animations),
      ...Object.keys(json("resource_pack/animation_controllers/guns.animation_controllers.json").animation_controllers),
    ]);
    for (const id of gunItems()) {
      const file = id.replace("minecade:", "");
      const item = json(`behavior_pack/items/${file}.json`)["minecraft:item"];
      expect(item.description.identifier).toBe(id);
      expect(icons[item.components["minecraft:icon"].textures.default], id).toBeDefined();
      const attachable = json(`resource_pack/attachables/${file}.json`)["minecraft:attachable"].description;
      expect(attachable.identifier).toBe(id);
      expect(geometries.has(attachable.geometry.default), id).toBe(true);
      for (const animation of Object.values(attachable.animations)) expect(animations.has(animation as string), `${id}: ${animation}`).toBe(true);
      expect(files[`resource_pack/${attachable.textures.default}.png`], id).toBeDefined();
    }
  });

  it("times a tap gun's item cooldown to its fire rate, and lets a held gun be held", () => {
    for (const gun of Object.values(GUNS)) {
      const components = json(`behavior_pack/items/${gun.item.replace("minecade:", "")}.json`)["minecraft:item"].components;
      if (gun.fire === "tap") expect(components["minecraft:cooldown"].duration).toBe(gun.everyTicks / 20);
      else expect(components["minecraft:use_modifiers"].use_duration).toBeGreaterThan(60);
    }
    expect(json("behavior_pack/items/paint_grenade.json")["minecraft:item"].components["minecraft:max_stack_size"]).toBeGreaterThan(1);
  });

  it("draws a ball in every dye, picked by its color property", () => {
    const ball = json("resource_pack/entity/paintball.entity.json")["minecraft:client_entity"].description;
    expect(ball.identifier).toBe(PAINTBALL);
    expect(Object.keys(ball.textures)).toEqual([...DYES]);
    for (const path of Object.values(ball.textures)) expect(files[`resource_pack/${path}.png`], path as string).toBeDefined();
    const range = json("behavior_pack/entities/paintball.json")["minecraft:entity"].description.properties["minecade:color"].range;
    expect(range).toEqual([0, DYES.length - 1]);
  });

  it("has a client entity for every entity, with geometries the model file holds", () => {
    const geometries = new Set(json("resource_pack/models/entity/guns.geo.json")["minecraft:geometry"].map((geometry: Json) => geometry.description.identifier));
    for (const [id, path] of [
      [PAINTBALL, "paintball"],
      [THROWN_GRENADE, "paint_grenade"],
      [GUN_PICKUP, "gun_pickup"],
    ]) {
      expect(json(`behavior_pack/entities/${path}.json`)["minecraft:entity"].description.identifier).toBe(id);
      const client = json(`resource_pack/entity/${path}.entity.json`)["minecraft:client_entity"].description;
      expect(client.identifier).toBe(id);
      for (const geometry of Object.values(client.geometry)) {
        if (geometry !== "geometry.item_sprite") expect(geometries.has(geometry as string), `${id}: ${geometry}`).toBe(true);
      }
    }
    expect(GRENADE.entity).toBe(THROWN_GRENADE);
  });
});
