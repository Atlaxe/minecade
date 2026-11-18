// The dice file (games/blockparty/dice.json, dice.ts): it reads without problems, a mistake in it is
// named, a roll throws its faces (a Triple's three, Roll again's extra), the die model's files agree
// with it, and a step back on the board goes against the links.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { back, testSpaces } from "../behavior_pack/scripts/board.ts";
import { DICE, DICE_PROBLEMS, MAX_AGAIN, STANDARD, dieOf, modelFiles, modelIndex, readDice, rollDie, throwsText, thrown, type DieDef } from "../behavior_pack/scripts/dice.ts";

/** A random() that gives each of `values` in turn (each a face: 0 is the first of six). */
const faces = (...values: number[]) => {
  let at = 0;
  return () => (values[at++ % values.length] + 0.5) / 6;
};

describe("the dice file", () => {
  it("has no problems, and every die has six faces and its letters", () => {
    expect(DICE_PROBLEMS).toEqual([]);
    expect(Object.keys(DICE)).toContain("standard");
    for (const die of Object.values(DICE)) {
      expect(die.faces).toHaveLength(6);
      expect(die.letters.length).toBeLessThanOrEqual(2);
    }
  });

  it("names each mistake, and leaves a die with one out", () => {
    const read = readDice({
      dice: {
        standard: { name: "Standard Die", letters: "D", block: "minecraft:white_concrete", faces: [1, 2, 3, 4, 5, 6].map((move) => ({ move })) },
        Bad: { name: "Bad", letters: "BAD", block: "minecraft:stone", panel: "pictures", faces: [{ move: 1 }] },
        odd: { name: "Odd", letters: "O", block: "minecraft:stone", faces: [{ move: -1 }, { move: 1, event: "fly" }, { move: 1, show: "ABC" }, { move: 1 }, { move: 1 }, { move: 1, say: "Not An Id" }] },
      },
    });
    expect(read.dice.map((die) => die.id)).toEqual(["standard"]);
    expect(read.problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Bad: an id is/),
        expect.stringMatching(/^Bad: "letters"/),
        expect.stringMatching(/^Bad: "panel"/),
        expect.stringMatching(/^Bad: "faces" must list six/),
        expect.stringMatching(/^odd: face 1: "move"/),
        expect.stringMatching(/^odd: face 2: "event"/),
        expect.stringMatching(/^odd: face 3: "show"/),
        expect.stringMatching(/^odd: face 6: "say"/),
      ]),
    );
    expect(readDice({ dice: {} }).problems).toEqual([expect.stringMatching(/"standard" die/)]);
  });

  it("fills in a face's panel text from its move, and an event's amount", () => {
    const { dice } = readDice({ dice: { standard: { name: "S", letters: "S", block: "minecraft:stone", faces: [{ move: 12 }, { move: 1, event: "everyone_coins" }, { move: 1, event: "everyone_back" }, { move: 1 }, { move: 1 }, { move: 1 }] } } });
    expect(dice[0].faces.map((face) => face.show)).toEqual(["12", "1", "1", "1", "1", "1"]);
    expect(dice[0].faces[1].amount).toBe(5);
    expect(dice[0].faces[2].amount).toBe(3);
    expect(dice[0].panel).toBe("faces");
    expect(dice[0].count).toBe(1);
  });

  it("gives the standard die for one that isn't there", () => {
    expect(dieOf("no_such_die")).toBe(STANDARD);
    expect(dieOf(undefined)).toBe(STANDARD);
  });
});

describe("a roll", () => {
  const die = (over: Partial<DieDef>): DieDef => ({ ...STANDARD, ...over });

  it("throws one face and moves it", () => {
    const rolled = rollDie(STANDARD, faces(3));
    expect(rolled.faces).toEqual([3]);
    expect(rolled.move).toBe(4);
    expect(throwsText(rolled)).toBe("");
  });

  it("throws a Triple's three and adds them up", () => {
    const rolled = rollDie(die({ count: 3 }), faces(2, 4, 1));
    expect(rolled.move).toBe(3 + 5 + 2);
    expect(throwsText(rolled)).toBe("3 + 5 + 2");
  });

  it("throws once more for Roll again, at most MAX_AGAIN more", () => {
    const again = die({ faces: STANDARD.faces.map((face, i) => (i === 5 ? { ...face, event: "again" as const } : face)) });
    const rolled = rollDie(again, faces(5, 0));
    expect(rolled.faces).toEqual([5, 0]);
    expect(rolled.move).toBe(7);
    expect(thrown(rolled).map((face) => face.event)).toEqual(["again", undefined]);
    expect(rollDie(again, faces(5)).faces).toHaveLength(1 + MAX_AGAIN);
  });

  it("is the Cursed Die's: 12 and 10 coins, or 1 and 3 coins lost", () => {
    const cursed = DICE.cursed;
    expect(thrown(rollDie(cursed, faces(0)))[0]).toMatchObject({ move: 12, coins: 10 });
    expect(thrown(rollDie(cursed, faces(4)))[0]).toMatchObject({ move: 1, coins: -3 });
  });
});

describe("the die model", () => {
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

  it("lists every die with a texture after its blank default, in the file's order", () => {
    const dice = [DICE.standard, { ...DICE.golden, texture: "textures/blockparty/dice/golden" }, { ...DICE.risk, texture: "textures/blockparty/dice/risk" }];
    expect(modelFiles(dice)).toEqual({
      textures: { default: "textures/blocks/concrete_white", golden: "textures/blockparty/dice/golden", risk: "textures/blockparty/dice/risk" },
      list: ["Texture.default", "Texture.golden", "Texture.risk"],
    });
    expect(modelIndex(dice[2], dice)).toBe(2);
    expect(modelIndex(dice[0], dice)).toBeUndefined();
  });

  it("has the dice file's textures (else run: npx tsx tools/blockparty/dice-pack.ts)", () => {
    const { textures, list } = modelFiles();
    expect(read("../resource_pack/entity/die.entity.json")["minecraft:client_entity"].description.textures).toEqual(textures);
    expect(read("../resource_pack/render_controllers/blockparty.render_controllers.json").render_controllers["controller.render.blockparty.die"].arrays.textures["Array.dice"]).toEqual(list);
  });

  it("is a die the game can spawn, with room in its property for every texture", () => {
    const entity = read("../behavior_pack/entities/die.json")["minecraft:entity"];
    expect(entity.description.identifier).toBe("blockparty:die");
    expect(entity.description.properties["blockparty:die"].range[1]).toBeGreaterThanOrEqual(modelFiles().list.length - 1);
  });
});

describe("a step back on the board", () => {
  it("goes against the links, and stays at a space nothing leads into", () => {
    const spaces = testSpaces([0, 64, 0], 6);
    expect(back(spaces, 3, 2)).toBe(1);
    expect(back(spaces, 0, 1)).toBe(spaces.length - 1);
    const line = spaces.map((space, i) => ({ ...space, next: i < spaces.length - 1 ? [i + 1] : [] }));
    expect(back(line, 1, 3)).toBe(0);
  });
});
