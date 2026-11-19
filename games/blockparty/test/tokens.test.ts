// Transfers' tokens (tokens.ts): what each one shows, its flight from one head to another (as whole
// numbers: no Block Party entity has a float property, since they never reach the client), the
// count over the heads, the token's client entity naming a picture for every slot, and the build
// copying each item's and die's icon to its slot.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DICE } from "../behavior_pack/scripts/dice.ts";
import { ITEM_IDS } from "../behavior_pack/scripts/items.ts";
import {
  FLIGHT_RANGES,
  LOOK_COIN,
  LOOK_STAR,
  MODEL_MIDDLE,
  SHAPE_COIN,
  SHAPE_ICON,
  SHAPE_STAR,
  TOKEN_SLOTS,
  counted,
  flightOf,
  flightProperties,
  isSeat,
  labelSteps,
  lookOf,
  shownCount,
  slotLetters,
  slotOf,
  slotPicture,
  soundOf,
} from "../behavior_pack/scripts/tokens.ts";
import { addTokenSlots } from "../../../tools/blockparty/item-icons.ts";
import { blankImage, encodePng } from "../../../tools/skins/png.ts";
import token from "../resource_pack/entity/token.entity.json";
import controllers from "../resource_pack/render_controllers/blockparty.render_controllers.json";
import tokenBehavior from "../behavior_pack/entities/token.json";
import animations from "../resource_pack/animations/blockparty.animation.json";
import tokenGeometry from "../resource_pack/models/entity/token.geo.json";

describe("Block Party's transfer tokens", () => {
  it("show a coin, a Star, or an item's or die's icon from its slot, items first, then the dice", () => {
    expect(lookOf("coin")).toEqual({ shape: SHAPE_COIN, look: LOOK_COIN });
    expect(lookOf("star")).toEqual({ shape: SHAPE_STAR, look: LOOK_STAR });
    expect(lookOf({ kind: "item", id: ITEM_IDS[0] })).toEqual({ shape: SHAPE_ICON, look: 0 });
    expect(slotOf({ kind: "item", id: ITEM_IDS[ITEM_IDS.length - 1] })).toBe(ITEM_IDS.length - 1);
    const dice = Object.keys(DICE);
    expect(slotOf({ kind: "die", id: dice[0] })).toBe(ITEM_IDS.length);
    expect(slotOf({ kind: "die", id: "no_such_die" })).toBeUndefined();
    expect(lookOf({ kind: "die", id: "no_such_die" })).toBeUndefined();
    expect(slotLetters()).toHaveLength(ITEM_IDS.length + dice.length);
    // Every item and die has a slot.
    expect(slotLetters().length).toBeLessThanOrEqual(TOKEN_SLOTS);
    expect(soundOf("coin")).toBe("coins");
    expect(soundOf({ kind: "die", id: dice[0] })).toBe("item");
  });

  it("fly from the middle of the way, facing the taker, with the way's reach, rise and arc", () => {
    const flight = flightOf([0, 70, 0], [0, 66, 6]);
    expect(flight.at).toEqual([0, 70 - MODEL_MIDDLE, 3]);
    // Facing south (+z) is yaw 0; east (+x) is -90 (Minecraft's yaw).
    expect(flight.yaw).toBeCloseTo(0);
    expect(flightOf([0, 0, 0], [5, 0, 0]).yaw).toBeCloseTo(-90);
    expect(flight.reach).toBe(6);
    expect(flight.rise).toBe(-4);
    expect(flight.arc).toBeGreaterThan(0.7);
    // Straight down from the sky: no reach, any facing.
    expect(flightOf([1, 72, 1], [1, 69.4, 1])).toMatchObject({ reach: 0, rise: -2.6, yaw: 0 });
  });

  it("hand the token its flight in hundredths of a block and its heading in degrees, cut to the entity's ranges", () => {
    expect(flightProperties(flightOf([0, 70, 0], [0, 66, 6]))).toEqual({ reach: 600, rise: -400, arc: 142, heading: 0 });
    expect(flightProperties(flightOf([0, 0, 0], [5, 0, 0])).heading).toBe(-90);
    expect(flightProperties({ at: [0, 0, 0], yaw: 179.6, reach: 90, rise: -80, arc: 12 })).toEqual({ reach: 6400, rise: -6400, arc: 800, heading: 180 });
    // The entity holds the same ranges, as whole numbers.
    const properties = tokenBehavior["minecraft:entity"].description.properties as Record<string, { type: string; range: number[] }>;
    for (const [name, range] of Object.entries(FLIGHT_RANGES)) expect(properties[`blockparty:${name}`]).toMatchObject({ type: "int", range });
    // The pack's flight reads them back in model units (16 a block: 0.16 a hundredth), from the giver
    // (half its reach back) to the taker (half on), along a bone turned to its heading under one that
    // undoes the entity's own turn.
    const bones = animations.animations["animation.blockparty.token.fly"].bones;
    const [, up, along] = bones.root.position;
    expect(up).toMatch(/^0\.16 \* \(q\.property\('blockparty:rise'\) .* \+ q\.property\('blockparty:arc'\) /);
    expect(along).toBe("0.16 * q.property('blockparty:reach') * (math.clamp(q.life_time / 0.7, 0, 1) - 0.5)");
    expect(bones.upright.rotation).toEqual([0, "-q.body_y_rotation", 0]);
    expect(bones.heading.rotation).toEqual([0, "q.property('blockparty:heading')", 0]);
    // The icon's model has the same bones, root under heading under upright.
    const geometry = tokenGeometry["minecraft:geometry"].find((one) => one.description.identifier === "geometry.blockparty.token")!;
    expect(geometry.bones.map((bone) => [bone.name, (bone as { parent?: string }).parent])).toEqual([
      ["upright", undefined],
      ["heading", "upright"],
      ["root", "heading"],
    ]);
  });

  it("are never float properties on any of the game's entities (the client never gets them)", () => {
    const folder = new URL("../behavior_pack/entities/", import.meta.url);
    for (const file of readdirSync(folder)) {
      const entity = JSON.parse(readFileSync(new URL(file, folder), "utf8"))["minecraft:entity"];
      const properties = (entity.description.properties ?? {}) as Record<string, { type: string }>;
      for (const [name, property] of Object.entries(properties)) expect(property.type, `${file}: ${name}`).not.toBe("float");
    }
  });

  it("go up to 10 coins, 5 Stars or 3 items at a time, the count rising to the whole", () => {
    expect(shownCount("coin", 25)).toBe(10);
    expect(shownCount("coin", 3)).toBe(3);
    expect(shownCount("star", 7)).toBe(5);
    expect(shownCount({ kind: "item", id: ITEM_IDS[0] }, 1)).toBe(1);
    expect(labelSteps(3, 3)).toEqual([1, 2, 3]);
    expect(labelSteps(25, 10)).toEqual([3, 5, 8, 10, 13, 15, 18, 20, 23, 25]);
    expect(counted(1)).toBe(false);
    expect(counted(2)).toBe(true);
  });

  it("know a seat from an NPC or the bank", () => {
    expect(isSeat({ name: "Alex", key: "alex", body: {} as never })).toBe(true);
    expect(isSeat({ typeId: "blockparty:chris" } as never)).toBe(false);
    expect(isSeat(undefined)).toBe(false);
  });

  it("have a client entity with a picture for every slot, the coin's and the Star's, in the render controller's order", () => {
    const description = token["minecraft:client_entity"].description;
    const textures = description.textures as Record<string, string>;
    for (let slot = 0; slot < TOKEN_SLOTS; slot++) expect(textures[`slot_${slot}`]).toBe(slotPicture(slot));
    const controller = (controllers.render_controllers as Record<string, { arrays: { textures: Record<string, string[]>; geometries: Record<string, string[]> } }>)["controller.render.blockparty.token"];
    const looks = controller.arrays.textures["Array.looks"];
    expect(looks).toHaveLength(TOKEN_SLOTS + 2);
    expect(looks[LOOK_COIN]).toBe("Texture.coin");
    expect(looks[LOOK_STAR]).toBe("Texture.star");
    const shapes = controller.arrays.geometries["Array.shapes"];
    expect([shapes[SHAPE_ICON], shapes[SHAPE_COIN], shapes[SHAPE_STAR]]).toEqual(["Geometry.icon", "Geometry.coin", "Geometry.star"]);
    // The entity's properties hold every look and shape.
    const properties = tokenBehavior["minecraft:entity"].description.properties as Record<string, { range: number[] }>;
    expect(properties["blockparty:look"].range).toEqual([0, LOOK_STAR]);
    expect(properties["blockparty:shape"].range).toEqual([0, SHAPE_STAR]);
  });

  it("get each item's and die's icon copied to its slot by the build, and a clear picture for the rest", async () => {
    const out = await mkdtemp(join(tmpdir(), "token-slots-"));
    const icon = join(out, "textures/blockparty/icons/ST.png");
    await mkdir(dirname(icon), { recursive: true });
    const picture = encodePng(blankImage(64, 64));
    await writeFile(icon, picture);
    const filled = await addTokenSlots(out, ["ST", "NO"]);
    expect(filled).toBe(1);
    expect(await readFile(join(out, `${slotPicture(0)}.png`))).toEqual(picture);
    for (let slot = 1; slot < TOKEN_SLOTS; slot++) expect(existsSync(join(out, `${slotPicture(slot)}.png`))).toBe(true);
  });
});
