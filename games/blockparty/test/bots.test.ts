// The bots' skins (bot-skins.ts) and how well they play (bot-skill.ts).
import { describe, expect, it } from "vitest";
import config from "../game.config.ts";
import { BOT_LEVELS, BOT_OPTION, BOT_SKILLS, MEDIUM, aim, botLevelOf, odds, pace, slip, wait } from "../behavior_pack/scripts/bot-skill.ts";
import { BOT_SKINS, SKINS_PACK, botSkinTexture, pickSkin, wearableSkins } from "../behavior_pack/scripts/bot-skins.ts";
import { BOT_RUN, BOT_WALK } from "../behavior_pack/scripts/bots.ts";
import bot from "../behavior_pack/entities/bot.json";
import client from "../resource_pack/entity/bot.entity.json";
import controllers from "../resource_pack/render_controllers/blockparty.render_controllers.json";

/** A random that gives `values` in turn, then 0. */
function sequence(...values: number[]): () => number {
  let next = 0;
  return () => values[next++] ?? 0;
}

describe("bot skins", () => {
  const description = client["minecraft:client_entity"].description;
  const controller = (controllers.render_controllers as Record<string, { arrays?: { textures?: Record<string, string[]>; geometries?: Record<string, string[]> }; geometry?: string; textures?: string[] }>)[description.render_controllers[0]];

  it("lists Minecraft's default skins and Legacy Console's default pack, each once", () => {
    const ids = BOT_SKINS.map((skin) => skin.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 9)).toEqual(["steve", "alex", "ari", "efe", "kai", "makena", "noor", "sunny", "zuri"]);
    expect(ids).toHaveLength(25);
    // Only Steve and Alex are Minecraft's own resource pack's; the rest come from the private pack.
    expect(BOT_SKINS.filter((skin) => !skin.pack).map((skin) => skin.id)).toEqual(["steve", "alex"]);
    expect(BOT_SKINS.every((skin) => !skin.pack || skin.pack === SKINS_PACK)).toBe(true);
  });

  it("has the bot's client entity list every texture, and its render controller pick texture and model in the same order", () => {
    expect(Object.entries(description.textures)).toEqual(BOT_SKINS.map((skin) => [skin.id, botSkinTexture(skin)]));
    expect(description.geometry).toEqual({ default: "geometry.humanoid.custom", slim: "geometry.humanoid.customSlim" });
    expect(controller.arrays?.textures?.["Array.skins"]).toEqual(BOT_SKINS.map((skin) => `Texture.${skin.id}`));
    expect(controller.arrays?.geometries?.["Array.models"]).toEqual(BOT_SKINS.map((skin) => (skin.slim ? "Geometry.slim" : "Geometry.default")));
    expect(controller.textures).toEqual(["Array.skins[v.skin]"]);
    expect(controller.geometry).toBe("Array.models[v.skin]");
    expect(description.scripts.pre_animation).toContain("v.skin = q.property('blockparty:skin');");
  });

  it("gives the bot a skin property that reaches every skin", () => {
    const property = bot["minecraft:entity"].description.properties["blockparty:skin"];
    expect(property.type).toBe("int");
    expect(property.client_sync).toBe(true);
    expect(property.range[0]).toBe(0);
    expect(property.range[1]).toBeGreaterThanOrEqual(BOT_SKINS.length - 1);
  });

  it("wears only Steve and Alex without the private skins pack", () => {
    expect(wearableSkins([]).map((index) => BOT_SKINS[index].id)).toEqual(["steve", "alex"]);
    expect(wearableSkins(["icons", SKINS_PACK])).toHaveLength(BOT_SKINS.length);
  });

  it("picks a skin no other bot wears while there is one", () => {
    const wearable = wearableSkins([SKINS_PACK]);
    expect(pickSkin(wearable, [], sequence(0))).toBe(0);
    // Steve is taken, so the first free one is Alex.
    expect(pickSkin(wearable, [0], sequence(0))).toBe(1);
    const taken: number[] = [];
    for (let i = 0; i < 4; i++) taken.push(pickSkin([0, 1, 2, 3], taken, sequence(0.99)));
    expect(new Set(taken).size).toBe(4);
    // All taken: any of them again; nothing wearable: Steve.
    expect([0, 1]).toContain(pickSkin([0, 1], [0, 1], sequence(0.5)));
    expect(pickSkin([], [], sequence(0.5))).toBe(0);
  });
});

describe("bot levels", () => {
  it("is one lobby option of Easy, Medium, Hard and No bots, Easy first", () => {
    const option = config.options?.find((one) => one.id === "bots");
    expect(option?.values.map((value) => value.label)).toEqual(["Easy", "Medium", "Hard", "No bots"]);
    expect(BOT_OPTION.map((value) => value.value)).toEqual([...BOT_LEVELS, "none"]);
  });

  it("reads the option's value, old counts and blanks as the default", () => {
    expect(botLevelOf("hard")).toBe("hard");
    expect(botLevelOf("medium")).toBe("medium");
    expect(botLevelOf("none")).toBeUndefined();
    expect(botLevelOf("3")).toBe("easy");
    expect(botLevelOf(undefined)).toBe("easy");
  });

  it("plays Medium as the minigames' own numbers", () => {
    expect(MEDIUM).toBe(BOT_SKILLS.medium);
    expect(pace(MEDIUM, BOT_WALK)).toBe(BOT_WALK);
    expect(wait(MEDIUM, 30)).toBe(30);
    expect(aim(MEDIUM, 1.4)).toBe(1.4);
    expect(odds(MEDIUM, 0.6)).toBe(0.6);
    expect(slip(MEDIUM, 0.12)).toBeCloseTo(0.12);
  });

  it("is slower, wider and more often wrong on Easy, and the other way on Hard", () => {
    const { easy, hard } = BOT_SKILLS;
    expect(pace(easy, BOT_WALK)).toBeLessThan(BOT_WALK);
    expect(pace(hard, BOT_WALK)).toBeGreaterThan(BOT_WALK);
    expect(wait(easy, 20)).toBeGreaterThan(20);
    expect(wait(hard, 20)).toBeLessThan(20);
    expect(aim(easy, 1)).toBeGreaterThan(1);
    expect(aim(hard, 1)).toBeLessThan(1);
    expect(odds(easy, 0.6)).toBeCloseTo(0.355, 2);
    expect(odds(hard, 0.6)).toBeCloseTo(0.846, 2);
    expect(slip(easy, 0.12)).toBeGreaterThan(0.2);
    expect(slip(hard, 0.12)).toBeLessThan(0.05);
    // Never and always stay so.
    for (const skill of [easy, hard]) {
      expect(odds(skill, 0)).toBe(0);
      expect(odds(skill, 1)).toBe(1);
    }
  });

  it("never runs a Hard bot past a sprint, unless it already was", () => {
    expect(pace(BOT_SKILLS.hard, BOT_RUN)).toBe(BOT_RUN);
    expect(pace(BOT_SKILLS.hard, BOT_RUN * 0.95)).toBe(BOT_RUN);
    expect(pace(BOT_SKILLS.hard, 0.4)).toBe(0.4);
    expect(wait(BOT_SKILLS.hard, 1)).toBe(1);
  });
});
