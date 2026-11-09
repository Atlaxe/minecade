import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AIM_MARKER,
  AIM_RECOIL,
  ARSENAL_GUNS,
  ARSENAL_GUN_DEFS,
  ARSENAL_MODELS,
  ARSENAL_PICKUP,
  DYES,
  GRENADE,
  GUNS,
  GUN_KINDS,
  GUN_PICKUP,
  MODEL_PROPERTY,
  PAINTBALL,
  PARTICLES,
  PRIMED_ARSENAL,
  PRIMED_GRENADE,
  ROCKET,
  THROWN_ARSENAL,
  THROWN_GRENADE,
  arsenalItem,
  arsenalItems,
  arsenalModelBlock,
  gunCooldown,
  gunItem,
  gunItems,
  gunModelBlock,
  parseGunItem,
  teamGunItem,
  type GunDef,
} from "../../../packages/guns/src/defs.ts";
import { HOLD_FILE, gunsPackFiles, holdAnimationNames, kickHeight, kickRise, withMissingHolds } from "../../assets/guns.ts";

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
      // One bone, bound to the hand, with every box: a pose on a bound bone doesn't move a child's boxes.
      const held = json("resource_pack/models/entity/guns.geo.json")["minecraft:geometry"].find((geo: Json) => geo.description.identifier === attachable.geometry.default);
      expect(held.bones.length, id).toBe(1);
      expect(held.bones[0].binding, id).toBe("q.item_slot_to_bone_name(c.item_slot)");
      expect(held.bones[0].cubes.length, id).toBeGreaterThan(0);
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

  it("shades a gun's hotbar slot for its fire rate, uses it while right click is down and keeps its left click swing short; a grenade stacks", () => {
    for (const kind of GUN_KINDS) {
      const components = json(`behavior_pack/items/${file(gunItem(kind, "red"))}.json`)["minecraft:item"].components;
      expect(components["minecraft:cooldown"]).toEqual({ category: gunCooldown(kind), duration: GUNS[kind].everyTicks / 20 });
      expect(components["minecraft:swing_duration"].value).toBeLessThan(0.3);
      // Used like a bow while right click is down (Bedrock says when it comes up), never finishing, at full speed.
      expect(components["minecraft:use_modifiers"]).toEqual({ use_duration: 3600, movement_modifier: 1 });
    }
    const grenade = json(`behavior_pack/items/${file(gunItem("grenade", "red"))}.json`)["minecraft:item"].components;
    expect(grenade["minecraft:max_stack_size"]).toBeGreaterThan(1);
  });

  it("times the recoil off the gun's own cooldown in the main hand; only the guns that aim read the aim marker in the off hand", () => {
    const aiming = ["sniper_rifle", "rail_gun", "rpg"];
    const markerQuery = `is_item_name_any('slot.weapon.offhand', 0, '${AIM_MARKER.item}')`;
    const offHand = `(q.${markerQuery} || c.owning_entity->q.${markerQuery})`;
    const recoils = json("resource_pack/animations/guns.animation.json").animations;
    const controllers = json("resource_pack/animation_controllers/guns.animation_controllers.json").animation_controllers;
    const all = [...GUN_KINDS.map((kind) => ({ id: kind as string, item: gunItem(kind) })), ...ARSENAL_GUNS.map((gun) => ({ id: gun as string, item: arsenalItem(gun) }))];
    for (const { id, item } of all) {
      const description = json(`resource_pack/attachables/${file(item)}.json`)["minecraft:attachable"].description;
      const recoil = JSON.stringify(recoils[description.animations.recoil]);
      expect(recoil, id).toContain("q.cooldown_time_remaining('slot.weapon.mainhand')");
      expect(description.scripts.animate, id).toContain("recoil");
      // No cooldown is read by category: the client reads only what it has itself.
      expect(recoil, id).not.toMatch(/cooldown_time_remaining\('minecade/);
      if (aiming.includes(id)) {
        // The hold controller eases between the hip and aim poses as the marker comes and goes.
        expect(description.scripts.animate, id).toEqual(["hold", "recoil"]);
        const hold = controllers[description.animations.hold];
        expect(hold.states.hip.transitions, id).toEqual([{ aim: offHand }]);
        expect(hold.states.aim.transitions, id).toEqual([{ hip: `!${offHand}` }]);
        expect(hold.states.hip.animations, id).toEqual([
          { first_person_hip: "c.is_first_person" },
          { first_person_hip_own: "c.is_first_person" },
          { third_person: "!c.is_first_person" },
          { third_person_own: "!c.is_first_person" },
        ]);
        expect(hold.states.aim.animations, id).toEqual([
          { first_person_aim: "c.is_first_person" },
          { first_person_aim_own: "c.is_first_person" },
          { third_person: "!c.is_first_person" },
          { third_person_own: "!c.is_first_person" },
        ]);
        expect(hold.states.hip.blend_transition, id).toBeGreaterThan(0);
        expect(description.animations.first_person_aim, id).toBeDefined();
        expect(recoil, id).toContain(offHand);
      } else {
        const names = description.scripts.animate.flatMap((entry: unknown) => (typeof entry === "string" ? [entry] : Object.keys(entry as object)));
        expect(names, id).toEqual(["first_person_hip", "first_person_hip_own", "third_person", "third_person_own", "recoil"]);
        expect(description.animations.first_person_aim, id).toBeUndefined();
        expect(recoil, id).not.toContain("offhand");
      }
    }
    // The aim marker: allowed in the off hand, with a blank icon and a model with nothing to draw.
    const marker = json(`behavior_pack/items/${file(AIM_MARKER.item)}.json`)["minecraft:item"];
    expect(marker.components["minecraft:allow_off_hand"]).toEqual({ value: true });
    expect(marker.components["minecraft:cooldown"]).toBeUndefined();
    const attachable = json(`resource_pack/attachables/${file(AIM_MARKER.item)}.json`)["minecraft:attachable"].description;
    const blank = json("resource_pack/models/entity/guns.geo.json")["minecraft:geometry"].find((geo: Json) => geo.description.identifier === attachable.geometry.default);
    expect(blank.bones.flatMap((bone: Json) => bone.cubes ?? [])).toEqual([]);
    expect(files[`resource_pack/${attachable.textures.default}.png`]).toBeDefined();
    // No hidden item per gun: the kick reads the gun itself.
    expect(Object.keys(files).filter((path) => path.endsWith("_shot.json"))).toEqual([]);
  });

  it("uses no variables in the held models: their animations look variables up on the player, so a script's would be unknown", () => {
    const animations = { ...json("resource_pack/animations/guns.animation.json").animations, ...JSON.parse(readFileSync(onDisk(HOLD_FILE), "utf8")).animations };
    const controllers = json("resource_pack/animation_controllers/guns.animation_controllers.json").animation_controllers;
    for (const path of Object.keys(files).filter((name) => name.startsWith("resource_pack/attachables/"))) {
      const description = json(path)["minecraft:attachable"].description;
      expect(description.scripts?.initialize, path).toBeUndefined();
      expect(description.scripts?.pre_animation, path).toBeUndefined();
      for (const name of Object.values(description.animations ?? {}) as string[]) {
        const used = name.startsWith("controller.") ? controllers[name] : animations[name];
        expect(used, `${path}: ${name}`).toBeDefined();
        expect(JSON.stringify(used), `${path}: ${name}`).not.toMatch(/\b(v|variable)\./);
      }
    }
  });

  it("kicks every gun's held model by its own recoil, settling just as it can fire again", () => {
    const guns = [...GUN_KINDS.map((kind) => ({ def: GUNS[kind] as GunDef, item: gunItem(kind) })), ...ARSENAL_GUNS.map((gun) => ({ def: ARSENAL_GUN_DEFS[gun] as GunDef, item: arsenalItem(gun) }))];
    const recoils = json("resource_pack/animations/guns.animation.json").animations;
    for (const { def, item } of guns) {
      const recoil = def.recoil!;
      expect(recoil, def.id).toBeDefined();
      expect(recoil.back, def.id).toBeGreaterThan(0);
      expect(recoil.lift, def.id).toBeGreaterThan(0);
      expect(recoil.shake, def.id).toBeGreaterThan(0);
      // Over the gun's own cooldown, its fire rate, which every shot (or burst) starts.
      const seconds = def.everyTicks / 20;
      expect(json(`behavior_pack/items/${file(item)}.json`)["minecraft:item"].components["minecraft:cooldown"], def.id).toEqual({ category: gunCooldown(def.id), duration: seconds });
      // On the held bone, over the hold pose: the muzzle tips up about the grip, and the gun goes back
      // along its barrel, which way that is depending on the view.
      const { position, rotation } = recoils[`animation.minecade.gun_${def.id}.recoil`].bones.gun;
      expect(rotation[0], def.id).toContain(`q.cooldown_time_remaining('slot.weapon.mainhand') / ${seconds}`);
      expect(rotation[0].endsWith(` * ${-recoil.lift}`), def.id).toBe(true);
      expect([rotation[1], rotation[2]], def.id).toEqual([0, 0]);
      for (const channel of position) expect(channel, def.id).toMatch(/ \* \(c\.is_first_person \? .+ : -?[\d.]+\)$/);
      // Less while aiming, for a gun that aims.
      if (def.aimFov !== undefined) expect(rotation[0], def.id).toContain(`? ${AIM_RECOIL} : 1)`);
    }
    // Heavy guns kick harder than fast ones.
    expect(ARSENAL_GUN_DEFS.sniper_rifle.recoil.lift).toBeGreaterThan(ARSENAL_GUN_DEFS.smg.recoil.lift);
    expect(ARSENAL_GUN_DEFS.pump_shotgun.recoil.shake).toBeGreaterThan(ARSENAL_GUN_DEFS.assault_rifle.recoil.shake);
  });

  it("raises a kick fast, then eases it home to nothing by the next shot", () => {
    for (const seconds of [0.1, 0.25, 1, 2]) {
      const rise = kickRise(seconds);
      expect(rise).toBeGreaterThan(0);
      expect(rise).toBeLessThanOrEqual(0.3);
      expect(kickHeight(0, seconds)).toBe(0);
      expect(kickHeight(rise * seconds, seconds)).toBeCloseTo(1, 5);
      expect(kickHeight(seconds, seconds)).toBe(0);
      expect(kickHeight(seconds * 2, seconds)).toBe(0);
      // Falling the whole way back, fastest at first.
      const samples = [0.4, 0.6, 0.8, 0.95].map((t) => kickHeight(t * seconds, seconds));
      for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1]);
      expect(samples[0] - samples[1]).toBeGreaterThan(samples[2] - samples[3]);
    }
    // A slow gun's kick still comes up in about the same short time as a fast one's.
    expect(kickRise(2) * 2).toBeCloseTo(0.04, 2);
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

  it("still has every hold animation the attachables name, moving only the bound \"gun\" bone", () => {
    const named = new Set<string>();
    for (const id of [...gunItems(), ...arsenalItems()]) {
      const { animations } = json(`resource_pack/attachables/${file(id)}.json`)["minecraft:attachable"].description;
      for (const name of Object.values(animations) as string[]) if (!name.endsWith(".recoil") && !name.startsWith("controller.")) named.add(name);
    }
    expect([...named].sort()).toEqual(holdAnimationNames().sort());
    for (const name of named) {
      expect(holds[name], `${HOLD_FILE} has no ${name}`).toBeDefined();
      // A model's own pose may be empty (Blockbench saves one with no keyframes without bones).
      expect(Object.keys(holds[name].bones ?? {}).filter((bone) => bone !== "gun"), `${name} moves a bone other than "gun"`).toEqual([]);
    }
  });

  it("gives every gun the guns' shared poses and every other model the throwables', each with its own on top", () => {
    for (const id of [...gunItems(), ...arsenalItems()]) {
      const { animations } = json(`resource_pack/attachables/${file(id)}.json`)["minecraft:attachable"].description;
      const group = animations.recoil ? "all_guns" : "all_throwables";
      const model = (animations.first_person_hip_own as string).split(".")[2];
      for (const pose of ["first_person_hip", "third_person", ...(animations.first_person_aim ? ["first_person_aim"] : [])]) {
        expect(animations[pose], id).toBe(`animation.minecade.${group}.${pose}`);
        expect(animations[`${pose}_own`], id).toBe(`animation.minecade.${model}.${pose}`);
      }
    }
  });

  it("is left alone by the generator", () => {
    expect(files[HOLD_FILE]).toBeUndefined();
  });
});

describe("adding new models' poses to the hold file", () => {
  const disk = readFileSync(onDisk(HOLD_FILE), "utf8");
  const names = Object.keys(JSON.parse(disk).animations as Json);

  it("adds only the missing ones, after the last, keeping every character already there and its line endings", () => {
    // The file as it was before the arsenal: Paintball's poses only, edited by hand, with CRLF.
    const paintOnly = { format_version: "1.8.0", animations: Object.fromEntries(names.filter((name) => /gun_(pistol|rifle|shotgun|grenade)\./.test(name)).map((name) => [name, { loop: true, bones: { gun: { position: [1.25, 2, 3] } } }])) };
    const before = `${JSON.stringify(paintOnly, null, 2)}\n`.replace(/\n/g, "\r\n");
    const { text, added } = withMissingHolds(before);
    expect(added.sort()).toEqual(holdAnimationNames().filter((name) => !(name in paintOnly.animations)).sort());
    const [kept, tail] = [before.slice(0, before.lastIndexOf("}", before.lastIndexOf("}") - 1)).trimEnd(), "\r\n  }\r\n}\r\n"];
    expect(text.startsWith(kept)).toBe(true);
    expect(text.endsWith(tail)).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    const after = JSON.parse(text).animations as Json;
    for (const [name, pose] of Object.entries(paintOnly.animations)) expect(after[name]).toEqual(pose);
    expect(Object.keys(after).sort()).toEqual(holdAnimationNames().sort());
  });

  it("leaves a file with every pose as it is", () => {
    expect(withMissingHolds(disk)).toEqual({ text: disk, added: [] });
  });
});

describe("the arsenal's files", () => {
  const geometries = new Set(json("resource_pack/models/entity/guns.geo.json")["minecraft:geometry"].map((geometry: Json) => geometry.description.identifier));

  it("gives each item one model block for its icon, a held model, one texture and a kit picture icon", () => {
    const terrain = json("resource_pack/textures/terrain_texture.json").texture_data;
    expect(arsenalItems()).toHaveLength(ARSENAL_MODELS.length);
    for (const model of ARSENAL_MODELS) {
      const id = arsenalItem(model);
      const item = json(`behavior_pack/items/${file(id)}.json`)["minecraft:item"];
      expect(item.description.identifier).toBe(id);
      expect(item.components["minecraft:icon"], id).toBeUndefined();
      const block = arsenalModelBlock(model);
      expect(item.components["minecraft:block_placer"]).toEqual({ block, use_on: [block] });
      const blockFile = json(`behavior_pack/blocks/${file(block)}.json`)["minecraft:block"];
      expect(geometries.has(blockFile.components["minecraft:geometry"]), id).toBe(true);
      const texture = terrain[blockFile.components["minecraft:material_instances"]["*"].texture]?.textures;
      expect(files[`resource_pack/${texture}.png`], id).toBeDefined();
      const attachable = json(`resource_pack/attachables/${file(id)}.json`)["minecraft:attachable"].description;
      expect(attachable.identifier).toBe(id);
      expect(attachable.textures.default).toBe(texture);
      expect(geometries.has(attachable.geometry.default), id).toBe(true);
      expect(files[`icons/${file(id)}.png`], id).toBeDefined();
    }
  });

  it("shades a gun's slot for its fire rate and kicks it over that cooldown; grenades, the knife and the stimpack stack", () => {
    for (const gun of ARSENAL_GUNS) {
      const components = json(`behavior_pack/items/${file(arsenalItem(gun))}.json`)["minecraft:item"].components;
      expect(components["minecraft:cooldown"]).toEqual({ category: gunCooldown(gun), duration: ARSENAL_GUN_DEFS[gun].everyTicks / 20 });
      expect(components["minecraft:use_modifiers"], gun).toEqual({ use_duration: 3600, movement_modifier: 1 });
      expect(components["minecraft:max_stack_size"]).toBe(1);
      const recoil = json("resource_pack/animations/guns.animation.json").animations[`animation.minecade.gun_${gun}.recoil`];
      expect(JSON.stringify(recoil)).toContain("q.cooldown_time_remaining('slot.weapon.mainhand')");
    }
    for (const model of ARSENAL_MODELS.filter((model) => !(ARSENAL_GUNS as readonly string[]).includes(model))) {
      const components = json(`behavior_pack/items/${file(arsenalItem(model))}.json`)["minecraft:item"].components;
      expect(components["minecraft:max_stack_size"], model).toBeGreaterThan(1);
      expect(components["minecraft:cooldown"], model).toBeUndefined();
      expect(components["minecraft:use_modifiers"], model).toBeUndefined();
    }
  });

  it("shows any arsenal model on its thrown, landed and pickup entities by the model property, and draws the rocket", () => {
    for (const [id, path] of [
      [THROWN_ARSENAL, "arsenal_thrown"],
      [PRIMED_ARSENAL, "arsenal_primed"],
      [ARSENAL_PICKUP, "arsenal_pickup"],
    ]) {
      const entity = json(`behavior_pack/entities/${path}.json`)["minecraft:entity"].description;
      expect(entity.identifier).toBe(id);
      expect(entity.properties[MODEL_PROPERTY].range).toEqual([0, ARSENAL_MODELS.length - 1]);
      const client = json(`resource_pack/entity/${path}.entity.json`)["minecraft:client_entity"].description;
      expect(client.identifier).toBe(id);
      expect(Object.keys(client.geometry)).toEqual([...ARSENAL_MODELS]);
      for (const geometry of Object.values(client.geometry)) expect(geometries.has(geometry as string), geometry as string).toBe(true);
      for (const texture of Object.values(client.textures)) expect(files[`resource_pack/${texture}.png`], texture as string).toBeDefined();
    }
    const controllers = json("resource_pack/render_controllers/guns.render_controllers.json").render_controllers;
    expect(controllers["controller.render.minecade.arsenal_model"].arrays.geometries["Array.models"]).toEqual(ARSENAL_MODELS.map((model) => `Geometry.${model}`));
    expect(json("behavior_pack/entities/rocket.json")["minecraft:entity"].description).toEqual({ identifier: ROCKET, runtime_identifier: "minecraft:snowball", is_spawnable: false, is_summonable: true });
    const rocket = json("resource_pack/entity/rocket.entity.json")["minecraft:client_entity"].description;
    expect(geometries.has(rocket.geometry.default)).toBe(true);
    expect(files[`resource_pack/${rocket.textures.default}.png`]).toBeDefined();
  });

  it("has every particle the scripts spawn", () => {
    const particles = Object.entries(files).filter(([path]) => path.startsWith("resource_pack/particles/"));
    const ids = particles.map(([, content]) => JSON.parse(content as string).particle_effect.description.identifier);
    for (const id of Object.values(PARTICLES)) expect(ids, id).toContain(id);
    for (const [path, content] of particles) {
      const texture = JSON.parse(content as string).particle_effect.description.basic_render_parameters.texture;
      expect(files[`resource_pack/${texture}.png`], path).toBeDefined();
    }
  });
});
