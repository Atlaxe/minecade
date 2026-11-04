import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DYES,
  GRENADE,
  GUN_KINDS,
  GUN_PICKUP,
  PAINTBALL,
  PRIMED_GRENADE,
  THROWN_GRENADE,
  gunItem,
  gunItems,
  parseGunItem,
  shotMarker,
  teamGunItem,
} from "../../../packages/guns/src/defs.ts";
import { gunsPackFiles } from "../../assets/guns.ts";

type Json = Record<string, any>;
const files = gunsPackFiles();
const json = (path: string): Json => JSON.parse(files[path] as string) as Json;

describe("the guns pack's files", () => {
  it("match what tools/assets/guns.ts writes (rerun it after changing a model or defs.ts)", () => {
    for (const [path, content] of Object.entries(files)) {
      const file = fileURLToPath(new URL(`../../../packs/guns/${path}`, import.meta.url));
      expect(existsSync(file), path).toBe(true);
      const disk = readFileSync(file);
      if (typeof content === "string") expect(disk.toString("utf8").replace(/\r\n/g, "\n"), path).toBe(content);
      else expect(disk.equals(content), path).toBe(true);
    }
  });

  it("gives every item in every paint an icon, a held model, its own texture and the animations it names", () => {
    const icons = json("resource_pack/textures/item_texture.json").texture_data;
    const geometries = new Set(json("resource_pack/models/entity/guns.geo.json")["minecraft:geometry"].map((geometry: Json) => geometry.description.identifier));
    const animations = new Set(Object.keys(json("resource_pack/animations/guns.animation.json").animations));
    expect(gunItems()).toHaveLength(4 * DYES.length);
    const textures = new Set<string>();
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
      textures.add(attachable.textures.default);
    }
    // Each color is its own texture: the paint parts differ.
    expect(textures.size).toBe(gunItems().length);
  });

  it("aims a gun with right click held and keeps its left click swing short; a grenade stacks", () => {
    for (const kind of GUN_KINDS) {
      const components = json(`behavior_pack/items/${gunItem(kind, "red").replace("minecade:", "")}.json`)["minecraft:item"].components;
      expect(components["minecraft:use_modifiers"].use_duration).toBeGreaterThan(60);
      expect(components["minecraft:swing_duration"].value).toBeLessThan(0.3);
      // No cooldown of its own: that would also stop it being aimed.
      expect(components["minecraft:cooldown"]).toBeUndefined();
    }
    const grenade = json(`behavior_pack/items/${gunItem("grenade", "red").replace("minecade:", "")}.json`)["minecraft:item"].components;
    expect(grenade["minecraft:max_stack_size"]).toBeGreaterThan(1);
    expect(grenade["minecraft:use_modifiers"]).toBeUndefined();
  });

  it("times each gun's recoil off its shot marker's cooldown category, which the held model reads", () => {
    for (const kind of GUN_KINDS) {
      const marker = shotMarker(kind);
      const item = json(`behavior_pack/items/${marker.item.replace("minecade:", "")}.json`)["minecraft:item"];
      expect(item.description.identifier).toBe(marker.item);
      expect(item.components["minecraft:cooldown"].category).toBe(marker.category);
      const scripts = json(`resource_pack/attachables/${gunItem(kind).replace("minecade:", "")}.json`)["minecraft:attachable"].description.scripts;
      expect(scripts.pre_animation.join("\n")).toContain(`q.cooldown_time_remaining('${marker.category}')`);
      expect(scripts.animate).toContain("recoil");
    }
  });

  it("names items so kits can ask for the team's paint, and reads them back", () => {
    expect(gunItem("rifle", "red")).toBe("minecade:red_paintball_rifle");
    expect(teamGunItem("grenade")).toBe("minecade:{color}_paint_grenade");
    expect(parseGunItem("minecade:light_blue_paintball_shotgun")).toEqual({ kind: "shotgun", dye: "light_blue" });
    expect(parseGunItem("minecade:light_blue_paint_grenade")).toEqual({ kind: "grenade", dye: "light_blue" });
    expect(parseGunItem("minecade:teal_paintball_pistol")).toBeUndefined();
    expect(parseGunItem("minecraft:red_wool")).toBeUndefined();
  });

  it("draws a ball and a grenade in every dye, picked by the color property", () => {
    const ball = json("resource_pack/entity/paintball.entity.json")["minecraft:client_entity"].description;
    expect(ball.identifier).toBe(PAINTBALL);
    expect(Object.keys(ball.textures)).toEqual([...DYES]);
    for (const path of Object.values(ball.textures)) expect(files[`resource_pack/${path}.png`], path as string).toBeDefined();
    for (const entity of ["paintball", "paint_grenade", "paint_grenade_primed"]) {
      const range = json(`behavior_pack/entities/${entity}.json`)["minecraft:entity"].description.properties["minecade:color"].range;
      expect(range, entity).toEqual([0, DYES.length - 1]);
    }
    for (const entity of ["paint_grenade", "paint_grenade_primed"]) {
      const client = json(`resource_pack/entity/${entity}.entity.json`)["minecraft:client_entity"].description;
      expect(Object.keys(client.textures), entity).toEqual([...DYES]);
    }
  });

  it("has a client entity for every entity, with geometries the model file holds", () => {
    const geometries = new Set(json("resource_pack/models/entity/guns.geo.json")["minecraft:geometry"].map((geometry: Json) => geometry.description.identifier));
    for (const [id, path] of [
      [PAINTBALL, "paintball"],
      [THROWN_GRENADE, "paint_grenade"],
      [PRIMED_GRENADE, "paint_grenade_primed"],
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
    expect(GRENADE.primed).toBe(PRIMED_GRENADE);
  });

  it("eases a gun's first-person hold between the hip and aiming; a grenade has only the hip", () => {
    const holds = json("resource_pack/animations/guns.animation.json").animations;
    for (const kind of GUN_KINDS) {
      const { position } = holds[`animation.minecade.gun_${kind}.hold_first_person`].bones.gun;
      for (const value of position) expect(String(value), kind).toMatch(/^math\.lerp\(-?[\d.]+, -?[\d.]+, v\.aim\)$/);
    }
    expect(holds["animation.minecade.gun_grenade.hold_first_person"].bones.gun.position.every((value: unknown) => typeof value === "number")).toBe(true);
  });
});
