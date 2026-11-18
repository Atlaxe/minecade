// The dice file (games/blockparty/dice.json, dice.ts): it reads without problems, a mistake in it is
// named, a roll throws its faces (a Triple's three, Roll again's extra), the die model's files agree
// with it (tools/blockparty/dice-model.ts: the body, the faces raised off it in the Minecraft Ten
// font or a picture), and a step back on the board goes against the links.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BLANK_FACES, FACE_PICTURES, PLAN_FILE, SIDES, buildFaces, faceCubes, facesGeometry, modelFiles, modelPlan, rectangles } from "../../../tools/blockparty/dice-model.ts";
import { TEN_FONT, loadTenFont, type TenFont } from "../../../tools/blockparty/ten-font.ts";
import { blankImage, encodePng } from "../../../tools/skins/png.ts";
import { back, testSpaces } from "../behavior_pack/scripts/board.ts";
import { DEFAULT_INK, DICE, DICE_PROBLEMS, MAX_AGAIN, STANDARD, dieOf, modelDice, modelIndex, readDice, rollDie, throwsText, thrown, type DieDef } from "../behavior_pack/scripts/dice.ts";

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
        odd: { name: "Odd", letters: "O", block: "minecraft:stone", faces: [{ move: -1 }, { move: 1, event: "fly" }, { move: 1, show: "ABC" }, { move: 1, ink: "red" }, { move: 1 }, { move: 1, say: "Not An Id" }] },
        pale: { name: "Pale", letters: "P", block: "minecraft:stone", ink: "#fff", faces: [1, 2, 3, 4, 5, 6].map((move) => ({ move })) },
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
        expect.stringMatching(/^odd: face 4: "ink"/),
        expect.stringMatching(/^odd: face 6: "say"/),
        expect.stringMatching(/^pale: "ink"/),
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

  it("gives each face its die's ink unless it has its own", () => {
    const { dice } = readDice({ dice: { standard: { name: "S", letters: "S", block: "minecraft:stone", ink: "#FFFFFF", faces: [{ move: 1, ink: "#D83A3A" }, ...[2, 3, 4, 5, 6].map((move) => ({ move }))] } } });
    expect(dice[0].ink).toBe("#ffffff");
    expect(dice[0].faces.map((face) => face.ink)).toEqual(["#d83a3a", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff"]);
    expect(readDice({ dice: { standard: { name: "S", letters: "S", block: "minecraft:stone", faces: [1, 2, 3, 4, 5, 6].map((move) => ({ move })) } } }).dice[0].ink).toBe(DEFAULT_INK);
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
  const scratch = mkdtempSync(join(tmpdir(), "dice-model-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  /** A pack in the scratch folder holding these pictures (path in the pack without .png: width and height), red with the first pixel see-through. */
  const pack = (name: string, pictures: Record<string, [number, number]>) => {
    const root = join(scratch, name);
    for (const [path, [width, height]] of Object.entries(pictures)) {
      const image = blankImage(width, height);
      for (let i = 1; i < width * height; i++) image.data.set([200, 40, 40, 255], i * 4);
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, `${path}.png`), encodePng(image));
    }
    return root;
  };
  type Cube = { origin: number[]; size: number[]; uv: Record<string, { uv: number[]; uv_size: number[] }> };
  const cubesOf = (geometry: object) => (geometry as { bones: { cubes?: Cube[] }[] }).bones[0].cubes ?? [];

  it("lists every die with a texture after its blank default, in the file's order", () => {
    const dice = [DICE.standard, { ...DICE.golden, texture: "textures/blockparty/dice/golden" }, { ...DICE.risk, texture: "textures/blocks/concrete_red" }];
    const root = pack("order", { "textures/blockparty/dice/golden": [24, 16] });
    const { plan, problems } = modelPlan(modelDice(dice), root);
    expect(problems).toEqual([]);
    expect(plan.dice.map((die) => [die.id, die.layout])).toEqual([
      ["standard", "plain"],
      ["golden", "six"],
      ["risk", "plain"],
    ]);
    const files = modelFiles(plan);
    expect(files.dice).toEqual(["Texture.default", "Texture.die_standard", "Texture.die_golden", "Texture.die_risk"]);
    expect(files.bodies).toEqual(["Geometry.plain", "Geometry.plain", "Geometry.default", "Geometry.plain"]);
    expect(files.faces).toEqual(["Geometry.faces", "Geometry.faces_standard", "Geometry.faces_golden", "Geometry.faces_risk"]);
    expect(files.geometry.faces_golden).toBe(facesGeometry("golden"));
    expect(modelIndex(dice[2], modelDice(dice))).toBe(3);
    expect(modelIndex({ ...DICE.slow, texture: undefined }, [{ ...DICE.slow, texture: undefined }])).toBeUndefined();
  });

  it("takes a body of 8 x 8 (or 16 x 16...) worn on every face, or 24 x 16 for six, and names any other size or a missing picture", () => {
    const root = pack("sizes", { "textures/blockparty/dice/a": [8, 8], "textures/blockparty/dice/b": [48, 32], "textures/blockparty/dice/c": [16, 8] });
    const die = (id: string): DieDef => ({ ...STANDARD, id, texture: `textures/blockparty/dice/${id}` });
    const { plan, problems } = modelPlan([die("a"), die("b"), die("c"), die("d")], root);
    expect(plan.dice.map((entry) => entry.layout)).toEqual(["plain", "six", "plain", "plain"]);
    expect(problems).toEqual([expect.stringMatching(/^c: "texture": .*16 x 8/), expect.stringMatching(/^d: "texture": there's no picture/)]);
  });

  it("shows a face's picture when the pack has one for its show text, else its text, or nothing", () => {
    const root = pack("pictures", { [`${FACE_PICTURES}/S+`]: [4, 3] });
    const faces = STANDARD.faces.map((face, i) => (i === 0 ? { ...face, show: "S+" } : i === 1 ? { ...face, show: "" } : face));
    const { plan } = modelPlan([{ ...STANDARD, texture: "textures/blocks/stone", faces }], root);
    expect(plan.dice[0].faces[0]).toEqual({ picture: "S+", hash: expect.stringMatching(/^[0-9a-f]{12}$/) });
    expect(plan.dice[0].faces[1]).toEqual({});
    expect(plan.dice[0].faces[2]).toEqual({ text: "3", ink: DEFAULT_INK });
    // The see-through pixel stays empty, so the 4 x 3 picture is 2 cubes; its red is the palette's first pixel.
    const font: TenFont = { glyph: () => undefined, text: () => ({ width: 0, height: 0, filled: [] }) };
    const built = buildFaces({ maker: 1, dice: [{ id: "x", texture: "textures/blocks/stone", layout: "plain", faces: [plan.dice[0].faces[0], {}, {}, {}, {}, {}] }] }, font, root);
    expect(cubesOf(built.geometries[0])).toEqual([]);
    expect(cubesOf(built.geometries[1])).toHaveLength(2);
    expect([...built.palette.data.subarray(0, 4)]).toEqual([200, 40, 40, 255]);
  });

  it("raises a face's pixels off its side, the right way round from outside, in as few cubes as it can", () => {
    // An L: a column of 3 and a foot to its right.
    const ink = "#123456";
    const pixels = { width: 2, height: 3, colors: [ink, undefined, ink, undefined, ink, ink] };
    expect(rectangles(pixels)).toEqual([
      [0, 0, 1, 3, ink],
      [1, 2, 1, 1, ink],
    ]);
    const uvOf = (): [number, number] => [3, 0];
    // Face 5 is south (+z): seen from outside, its right is east, +x as Blockbench draws it and -x in the file.
    const [column, foot] = faceCubes(pixels, 4, 0.5, uvOf) as Cube[];
    expect(column).toMatchObject({ origin: [0, 7.25, 4], size: [0.5, 1.5, 0.5] });
    expect(foot).toMatchObject({ origin: [-0.5, 7.25, 4], size: [0.5, 0.5, 0.5] });
    expect(Object.keys(column.uv).sort()).toEqual(["down", "east", "south", "up", "west"]);
    expect(column.uv.south).toEqual({ uv: [3.25, 0.25], uv_size: [0.5, 0.5] });
    // Face 1 is up, its top toward north (-z), so the foot (the bottom row) is toward south.
    const [, upFoot] = faceCubes(pixels, 0, 0.5, uvOf) as Cube[];
    expect(upFoot).toMatchObject({ origin: [-0.5, 12, 0.25], size: [0.5, 0.5, 0.5] });
    expect(SIDES.map((side) => side.name)).toEqual(["up", "north", "east", "west", "south", "down"]);
  });

  it.skipIf(!existsSync(TEN_FONT))("reads Minecraft Ten's digits from the game: 7 x 10, the 1 5 wide, two side by side a pixel apart", () => {
    const font = loadTenFont();
    expect(font.text("8")).toMatchObject({ width: 7, height: 10 });
    expect(font.text("1")).toMatchObject({ width: 5, height: 10 });
    expect(font.text("12")).toMatchObject({ width: 13, height: 10 });
    const zero = font.text("0");
    const row = (r: number) => zero.filled.slice(r * zero.width, (r + 1) * zero.width).map((on) => (on ? "#" : ".")).join("");
    expect([row(0), row(4), row(9)]).toEqual(["#######", "###.###", "#######"]);
  });

  it("has the dice file's model (else run: npx tsx tools/blockparty/dice-pack.ts)", () => {
    const { plan, problems } = modelPlan();
    expect(problems).toEqual([]);
    const { about: _about, ...made } = JSON.parse(readFileSync(PLAN_FILE, "utf8"));
    expect(made).toEqual(plan);
    const files = modelFiles(plan);
    const description = read("../resource_pack/entity/die.entity.json")["minecraft:client_entity"].description;
    expect(description.textures).toEqual(files.textures);
    expect(description.geometry).toEqual(files.geometry);
    const controllers = read("../resource_pack/render_controllers/blockparty.render_controllers.json").render_controllers;
    expect(controllers["controller.render.blockparty.die"].arrays).toEqual({ textures: { "Array.dice": files.dice }, geometries: { "Array.bodies": files.bodies } });
    expect(controllers["controller.render.blockparty.die_faces"].arrays).toEqual({ geometries: { "Array.faces": files.faces } });
    const geometries = read("../resource_pack/models/entity/die_faces.geo.json")["minecraft:geometry"].map((geometry: { description: { identifier: string } }) => geometry.description.identifier);
    expect(geometries).toEqual([BLANK_FACES, ...plan.dice.map((die) => facesGeometry(die.id))]);
  });

  it("is a die the game can spawn, with room in its property for every die", () => {
    const entity = read("../behavior_pack/entities/die.json")["minecraft:entity"];
    expect(entity.description.identifier).toBe("blockparty:die");
    expect(entity.description.properties["blockparty:die"].range[1]).toBeGreaterThanOrEqual(modelDice().length);
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
