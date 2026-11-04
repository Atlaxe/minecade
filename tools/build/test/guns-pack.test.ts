import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AIM_MARKER,
  DYES,
  GRENADE,
  GUNS,
  GUN_KINDS,
  GUN_PICKUP,
  PAINTBALL,
  PRIMED_GRENADE,
  THROWN_GRENADE,
  gunCooldown,
  gunItem,
  gunItems,
  gunModelBlock,
  parseGunItem,
  shotMarker,
  teamGunItem,
} from "../../../packages/guns/src/defs.ts";
import { HOLD_FILE, gunsPackFiles, holdAnimationNames } from "../../assets/guns.ts";

type Json = Record<string, any>;
const files = gunsPackFiles();
const json = (path: string): Json => JSON.parse(files[path] as string) as Json;
const onDisk = (path: string) => fileURLToPath(new URL(`../../../packs/guns/${path}`, import.meta.url));
const file = (identifier: string) => identifier.replace("minecade:", "");

describe("the guns pack's files", () => {
  it("match what tools/assets/guns.ts writes (rerun it after changing a model or defs.ts)", () => {
    for (const [path, content] of Object.entries(files)) {
      expect(existsSync(onDisk(path)), path).toBe(true);
      const disk = readFileSync(onDisk(path));
      if (typeof content === "string") expect(disk.toString("utf8").replace(/\r\n/g, "\n"), path).toBe(content);
      else expect(disk.equals(content), path).toBe(true);
    }
  });

  it("gives every item in every paint a model block for its icon, a held model, its own texture and a kit picture icon", () => {
    const geometries = new Set(json("resource_pack/models/entity/guns.geo.json")["minecraft:geometry"].map((geometry: Json) => geometry.description.identifier));
    const terrain = json("resource_pack/textures/terrain_texture.json").texture_data;
    expect(gunItems()).toHaveLength(4 * DYES.length);
    const textures = new Set<string>();
    for (const id of gunItems()) {
      const { kind, dye } = parseGunItem(id)!;
      const item = json(`behavior_pack/items/${file(id)}.json`)["minecraft:item"];
      expect(item.description.identifier).toBe(id);
      // No icon of its own: the hotbar draws the block it places, which is never placed.
      expect(item.components["minecraft:icon"], id).toBeUndefined();
      const model = gunModelBlock(kind, dye);
      expect(item.components["minecraft:block_placer"]).toEqual({ block: model, use_on: [model] });
      const block = json(`behavior_pack/blocks/${file(model)}.json`)["minecraft:block"];
      expect(block.description.identifier).toBe(model);
      expect(geometries.has(block.components["minecraft:geometry"]), id).toBe(true);
      const texture = terrain[block.components["minecraft:material_instances"]["*"].texture]?.textures;
      expect(files[`resource_pack/${texture}.png`], id).toBeDefined();
      const attachable = json(`resource_pack/attachables/${file(id)}.json`)["minecraft:attachable"].description;
      expect(attachable.identifier).toBe(id);
      expect(geometries.has(attachable.geometry.default), id).toBe(true);
      expect(attachable.textures.default).toBe(texture);
      textures.add(texture);
      expect(files[`icons/${file(id)}.png`], id).toBeDefined();
    }
    // Each color is its own texture: the paint parts differ.
    expect(textures.size).toBe(gunItems().length);
  });

  it("fits each model block's model in a block's 30 pixels", () => {
    for (const geometry of json("resource_pack/models/entity/guns.geo.json")["minecraft:geometry"]) {
      if (!geometry.description.identifier.endsWith("_icon")) continue;
      for (const cube of geometry.bones[0].cubes) {
        for (const axis of [0, 2]) {
          expect(cube.origin[axis]).toBeGreaterThanOrEqual(-15);
          expect(cube.origin[axis] + cube.size[axis]).toBeLessThanOrEqual(15);
        }
        expect(cube.origin[1]).toBeGreaterThanOrEqual(0);
        expect(cube.origin[1] + cube.size[1]).toBeLessThanOrEqual(30);
      }
    }
  });

  it("shades a gun's hotbar slot for its fire rate and keeps its left click swing short; a grenade stacks", () => {
    for (const kind of GUN_KINDS) {
      const components = json(`behavior_pack/items/${file(gunItem(kind, "red"))}.json`)["minecraft:item"].components;
      expect(components["minecraft:cooldown"]).toEqual({ category: gunCooldown(kind), duration: GUNS[kind].everyTicks / 20 });
      expect(components["minecraft:swing_duration"].value).toBeLessThan(0.3);
      // Right click toggles the aim: nothing holds it in use, which would stop the left click.
      expect(components["minecraft:use_modifiers"]).toBeUndefined();
    }
    const grenade = json(`behavior_pack/items/${file(gunItem("grenade", "red"))}.json`)["minecraft:item"].components;
    expect(grenade["minecraft:max_stack_size"]).toBeGreaterThan(1);
  });

  it("times the recoil and the aim off hidden markers' cooldown categories, which the held model reads", () => {
    for (const kind of GUN_KINDS) {
      const marker = shotMarker(kind);
      const item = json(`behavior_pack/items/${file(marker.item)}.json`)["minecraft:item"];
      expect(item.components["minecraft:cooldown"].category).toBe(marker.category);
      const scripts = json(`resource_pack/attachables/${file(gunItem(kind))}.json`)["minecraft:attachable"].description.scripts;
      const script = scripts.pre_animation.join("\n");
      expect(script).toContain(`q.cooldown_time_remaining('${marker.category}')`);
      expect(script).toContain(`q.cooldown_time_remaining('${AIM_MARKER.category}')`);
      expect(scripts.animate).toContain("recoil");
    }
    expect(json(`behavior_pack/items/${file(AIM_MARKER.item)}.json`)["minecraft:item"].components["minecraft:cooldown"].category).toBe(AIM_MARKER.category);
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
});

describe("the hand-edited hold file", () => {
  const holds = JSON.parse(readFileSync(onDisk(HOLD_FILE), "utf8")).animations as Json;

  it("still has every hold animation the attachables name, each moving the bound \"gun\" bone", () => {
    const named = new Set<string>();
    for (const id of gunItems()) {
      const { animations } = json(`resource_pack/attachables/${file(id)}.json`)["minecraft:attachable"].description;
      for (const name of Object.values(animations) as string[]) if (!name.endsWith(".recoil")) named.add(name);
    }
    expect([...named].sort()).toEqual(holdAnimationNames().sort());
    for (const name of named) {
      expect(holds[name], `${HOLD_FILE} has no ${name}`).toBeDefined();
      expect(holds[name].bones?.gun, `${name} moves no "gun" bone`).toBeDefined();
    }
  });

  it("is left alone by the generator", () => {
    expect(files[HOLD_FILE]).toBeUndefined();
  });
});
