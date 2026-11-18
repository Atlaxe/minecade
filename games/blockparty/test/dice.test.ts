// The dice file (games/blockparty/dice.json, dice.ts): it reads without problems, a mistake in it is
// named, a roll throws its faces (a Triple's three, Roll again's extra), the die model's files agree
// with it (tools/blockparty/dice-model.ts: the body, the faces raised off it in the Minecraft Ten
// font or a picture; the numbers over heads, the moves left and a transfer's count), and a step back
// on the board goes against the links.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BLANK_FACES,
  COUNT_CONTROLLER,
  COUNT_GEOMETRY,
  COUNT_ROOT,
  FACE_PICTURES,
  NUMBER_ALPHA,
  NUMBER_PALETTE,
  PACK,
  PLAN_FILE,
  SIDES,
  TALLY_CONTROLLER,
  TALLY_GEOMETRY,
  UPRIGHT_BONE,
  buildFaces,
  burstEffect,
  burstFile,
  countBone,
  countController,
  faceCubes,
  facePixels,
  facesGeometry,
  inkPixels,
  modelFiles,
  modelPlan,
  rectangles,
  signBone,
  tallyController,
} from "../../../tools/blockparty/dice-model.ts";
import { GLYPH_FILE, TEN_FONT, fontOf, glyphTable, loadTenFont, storedFont, type TenFont } from "../../../tools/blockparty/ten-font.ts";
import { blankImage, encodePng } from "../../../tools/skins/png.ts";
import { back, testSpaces } from "../behavior_pack/scripts/board.ts";
import {
  COUNT_ENTITY,
  COUNT_PROPERTY,
  DEFAULT_GAIN,
  DEFAULT_INK,
  DEFAULT_LOSS,
  DEFAULT_NUMBER,
  DICE,
  DICE_PROBLEMS,
  MAX_AGAIN,
  MAX_COUNT,
  STANDARD,
  TALLY_ENTITY,
  TALLY_PROPERTY,
  TONE_GAIN,
  TONE_LOSS,
  TONE_PROPERTY,
  burstParticle,
  dieOf,
  modelDice,
  modelIndex,
  readDice,
  rollDie,
  shadowOf,
  throwsText,
  thrown,
  type DieDef,
} from "../behavior_pack/scripts/dice.ts";

/** The numbers' looks when the file doesn't say. */
const LOOKS = { number: DEFAULT_NUMBER, gain: DEFAULT_GAIN, loss: DEFAULT_LOSS };

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

  it("gives a face a shadow as Minecraft draws one under text (true), in a color, or none, its own over its die's", () => {
    expect(shadowOf("#ffffff")).toBe("#3f3f3f");
    expect(shadowOf("#d83a3a")).toBe("#360e0e");
    const six = [2, 3, 4, 5, 6].map((move) => ({ move }));
    const { dice, problems } = readDice({
      dice: {
        standard: { name: "S", letters: "S", block: "minecraft:stone", ink: "#ffffff", shadow: true, faces: [{ move: 1, shadow: false }, { move: 2, shadow: "#112233" }, { move: 3, ink: "#d83a3a" }, ...six.slice(2)] },
        plain: { name: "P", letters: "P", block: "minecraft:stone", faces: [{ move: 1, shadow: true }, ...six] },
        odd: { name: "O", letters: "O", block: "minecraft:stone", shadow: "dark", faces: [{ move: 1 }, ...six] },
      },
    });
    expect(problems).toEqual([expect.stringMatching(/^odd: "shadow"/)]);
    expect(dice[0].faces.map((face) => face.shadow)).toEqual([undefined, "#112233", "#360e0e", "#3f3f3f", "#3f3f3f", "#3f3f3f"]);
    expect(dice[1].faces.map((face) => face.shadow)).toEqual([shadowOf(DEFAULT_INK), undefined, undefined, undefined, undefined, undefined]);
  });

  it("reads the number's look, white with Minecraft's shadow when the file doesn't say", () => {
    const standard = { name: "S", letters: "S", block: "minecraft:stone", faces: [1, 2, 3, 4, 5, 6].map((move) => ({ move })) };
    expect(readDice({ dice: { standard } }).number).toEqual(DEFAULT_NUMBER);
    expect(readDice({ number: { ink: "#FFD83D" }, dice: { standard } }).number).toEqual({ ink: "#ffd83d", shadow: "#3f360f" });
    expect(readDice({ number: { ink: "#ffffff", shadow: false }, dice: { standard } }).number).toEqual({ ink: "#ffffff" });
    expect(readDice({ number: { ink: "white" }, dice: { standard } }).problems).toEqual([expect.stringMatching(/^number: "ink"/)]);
  });

  it("reads a transfer's count's looks, Minecraft's gold coming in and its red going out when the file doesn't say", () => {
    const standard = { name: "S", letters: "S", block: "minecraft:stone", faces: [1, 2, 3, 4, 5, 6].map((move) => ({ move })) };
    const plain = readDice({ dice: { standard } });
    expect([plain.gain, plain.loss]).toEqual([DEFAULT_GAIN, DEFAULT_LOSS]);
    expect(DEFAULT_GAIN.shadow).toBe(shadowOf(DEFAULT_GAIN.ink));
    expect(DEFAULT_LOSS.shadow).toBe(shadowOf(DEFAULT_LOSS.ink));
    const set = readDice({ gain: { ink: "#55FF55", shadow: false }, loss: { ink: "#aa0000" }, dice: { standard } });
    expect(set.gain).toEqual({ ink: "#55ff55" });
    expect(set.loss).toEqual({ ink: "#aa0000", shadow: "#2a0000" });
    expect(readDice({ loss: "red", dice: { standard } }).problems).toEqual([expect.stringMatching(/^loss: "loss" is an object/)]);
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
    const dice = [{ ...DICE.standard, texture: "textures/blocks/concrete_white" }, { ...DICE.golden, texture: "textures/blockparty/dice/golden" }, { ...DICE.risk, texture: "textures/blocks/concrete_red" }];
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
    expect(plan.dice[0].faces[2]).toEqual({ text: "3", ink: STANDARD.faces[2].ink, shadow: STANDARD.faces[2].shadow });
    // The see-through pixel stays empty, so the 4 x 3 picture is 2 cubes; its red is the palette's first pixel.
    const font: TenFont = { glyph: () => undefined, text: () => ({ width: 0, height: 0, filled: [] }) };
    const built = buildFaces({ maker: 1, dice: [{ id: "x", texture: "textures/blocks/stone", layout: "plain", faces: [plan.dice[0].faces[0], {}, {}, {}, {}, {}] }], ...LOOKS }, font, root);
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

  it("puts a shadow a pixel right of and below its text, only where the text isn't, and raises it half as far", () => {
    // An L again: a column of 3 and a foot to its right.
    const text = { width: 2, height: 3, filled: [true, false, true, false, true, true] };
    const drawn = inkPixels(text, "#ffffff", "#3f3f3f");
    const grid = (pixels: { width: number; colors: (string | undefined)[] }) =>
      Array.from({ length: pixels.colors.length / pixels.width }, (_, row) => pixels.colors.slice(row * pixels.width, (row + 1) * pixels.width).map((color) => (color === "#ffffff" ? "#" : color ? "s" : ".")).join(""));
    expect(grid(drawn.pixels)).toEqual(["#..", "#..", "##.", "..."]);
    expect(grid(drawn.shadow!)).toEqual(["...", ".s.", "...", ".ss"]);
    expect(inkPixels(text, "#ffffff").shadow).toBeUndefined();
    // On a die: the text's cubes stand half a unit off the face, the shadow's a quarter.
    const font = fontOf((char) => (char === "L" ? { columns: 2, filled: [[0, 0], [1, 0], [0, 1], [0, 2]] } : undefined));
    const face = facePixels({ text: "L", ink: "#ffffff", shadow: "#3f3f3f" }, font)!;
    expect([face.pixels.width, face.pixels.height, face.pixel]).toEqual([3, 4, 0.5]);
    type Cube = { origin: number[]; size: number[] };
    const plan = { maker: 1, dice: [{ id: "x", texture: "textures/blocks/stone", layout: "plain" as const, faces: [{ text: "L", ink: "#ffffff", shadow: "#3f3f3f" }, {}, {}, {}, {}, {}] }], ...LOOKS };
    const cubes = (buildFaces(plan, font).geometries[1] as { bones: { cubes: Cube[] }[] }).bones[0].cubes;
    // Face 1 is up: the heights the cubes reach over the die's top (12).
    expect(new Set(cubes.map((cube) => cube.origin[1] + cube.size[1]))).toEqual(new Set([12.5, 12.25]));
  });

  it("draws the number over a head with every digit, a two-digit number's halves a pixel apart about the middle, and shows only its digits", () => {
    const font = fontOf((char) => (/^[0-9]$/.test(char) ? { columns: 2, filled: [[0, 0], [1, 0], [0, 1], [1, 1]] } : undefined));
    const { count } = buildFaces({ maker: 1, dice: [], ...LOOKS, number: { ink: "#ffffff" } }, font);
    type Cube = { origin: number[]; size: number[] };
    const bones = (count as { description: { identifier: string }; bones: { name: string; parent?: string; cubes?: Cube[] }[] }).bones;
    expect((count as { description: { identifier: string } }).description.identifier).toBe(COUNT_GEOMETRY);
    // The upright bone undoes the entity's turn; the count bone under it turns to the camera.
    expect(bones.slice(0, 2).map((bone) => [bone.name, bone.parent])).toEqual([
      [UPRIGHT_BONE, undefined],
      [COUNT_ROOT, UPRIGHT_BONE],
    ]);
    expect(bones.map((bone) => bone.name)).toEqual([UPRIGHT_BONE, "count", ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => countBone("one", d)), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => countBone("tens", d)), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => countBone("ones", d))]);
    // A 2 x 2 digit: alone, it's centered (file x is turned over, so its edges are -1.25 and 1.25 either way).
    const xs = (name: string) => bones.find((bone) => bone.name === name)!.cubes!.flatMap((cube) => [-cube.origin[0] - cube.size[0], -cube.origin[0]]);
    expect([Math.min(...xs("one_5")), Math.max(...xs("one_5"))]).toEqual([-1.25, 1.25]);
    // Tens end half a pixel left of the middle, ones start half a pixel right of it (as Blockbench sees it, from the south).
    expect(Math.max(...xs("tens_1"))).toBeCloseTo(-0.625);
    expect(Math.min(...xs("ones_2"))).toBeCloseTo(0.625);
    const parts = (countController() as { part_visibility: Record<string, unknown>[] }).part_visibility;
    expect(parts.slice(0, 3)).toEqual([{ "*": false }, { [UPRIGHT_BONE]: true }, { [COUNT_ROOT]: true }]);
    expect(parts).toContainEqual({ tens_1: `q.property('${COUNT_PROPERTY}') >= 10 && math.floor(q.property('${COUNT_PROPERTY}') / 10) == 1` });
  });

  it("draws a transfer's count with its sign first, the whole centered, a geometry for each tone, and nothing at 0", () => {
    // Digits 2 wide (the 1 one wide), a + 3 wide, a - 2 wide, every glyph 2 high.
    const font = fontOf((char) => {
      if (char === "1") return { columns: 1, filled: [[0, 0], [0, 1]] };
      if (/^[0-9]$/.test(char)) return { columns: 2, filled: [[0, 0], [1, 0], [0, 1], [1, 1]] };
      if (char === "+") return { columns: 3, filled: [[0, 0], [1, 0], [2, 0], [1, 1]] };
      if (char === "-") return { columns: 2, filled: [[0, 0], [1, 0]] };
      return undefined;
    });
    const { tallies, numberPalette } = buildFaces({ maker: 1, dice: [], number: { ink: "#ffffff" }, gain: { ink: "#ffaa00" }, loss: { ink: "#ff5555" } }, font);
    type Cube = { origin: number[]; size: number[]; uv: Record<string, { uv: number[] }> };
    type Bone = { name: string; parent?: string; cubes?: Cube[] };
    const [gain, loss] = tallies as { description: { identifier: string }; bones: Bone[] }[];
    expect([gain.description.identifier, loss.description.identifier]).toEqual([TALLY_GEOMETRY.gain, TALLY_GEOMETRY.loss]);
    expect(gain.bones.map((bone) => bone.name)).toEqual([
      UPRIGHT_BONE,
      COUNT_ROOT,
      signBone(1),
      signBone(2),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => countBone("one", d)),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => countBone("tens", d)),
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => countBone("ones", d)),
    ]);
    // Edges as Blockbench sees them from the south, in pixels (1.25 units each).
    const edges = (bones: Bone[], name: string) => {
      const xs = bones.find((bone) => bone.name === name)!.cubes!.flatMap((cube) => [-cube.origin[0] - cube.size[0], -cube.origin[0]]);
      return [Math.min(...xs) / 1.25 + 0, Math.max(...xs) / 1.25 + 0];
    };
    // "+5": the + (3), a pixel, a cell as wide as the widest digit (2): 6 across, from -3 to 3.
    expect(edges(gain.bones, signBone(1))).toEqual([-3, 0]);
    expect(edges(gain.bones, "one_5")).toEqual([1, 3]);
    // "+15": 3 + 1 + 2 + 1 + 2 = 9 across; the 1 sits in the middle of its cell.
    expect(edges(gain.bones, signBone(2))).toEqual([-4.5, -1.5]);
    expect(edges(gain.bones, "tens_1")).toEqual([0, 1]);
    expect(edges(gain.bones, "ones_5")).toEqual([2.5, 4.5]);
    // "-5": the - is 2 wide, so the loss is laid out on its own.
    expect(edges(loss.bones, signBone(1))).toEqual([-2.5, -0.5]);
    // Each tone in its own ink, from the numbers' palette, nearly see-through (drawn unshaded).
    const ink = (bones: Bone[]) => {
      const [u, v] = bones.find((bone) => bone.name === "one_5")!.cubes![0].uv.south.uv;
      return [...numberPalette.data.subarray((Math.floor(v) * numberPalette.width + Math.floor(u)) * 4, (Math.floor(v) * numberPalette.width + Math.floor(u)) * 4 + 4)];
    };
    expect(ink(gain.bones)).toEqual([255, 170, 0, NUMBER_ALPHA]);
    expect(ink(loss.bones)).toEqual([255, 85, 85, NUMBER_ALPHA]);
    const controller = tallyController() as { arrays: { geometries: Record<string, string[]> }; geometry: string; part_visibility: Record<string, unknown>[] };
    const tones = controller.arrays.geometries["Array.tones"];
    expect([tones[TONE_GAIN], tones[TONE_LOSS]]).toEqual(["Geometry.gain", "Geometry.loss"]);
    expect(controller.geometry).toBe(`Array.tones[q.property('${TONE_PROPERTY}')]`);
    const value = `q.property('${TALLY_PROPERTY}')`;
    expect(controller.part_visibility).toContainEqual({ [signBone(1)]: `${value} >= 1 && ${value} < 10` });
    expect(controller.part_visibility).toContainEqual({ [signBone(2)]: `${value} >= 10` });
    expect(controller.part_visibility.some((part) => "one_0" in part)).toBe(false);
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
    // The number over a head, and each die's burst.
    expect(read("../resource_pack/models/entity/count.geo.json")["minecraft:geometry"][0].description.identifier).toBe(COUNT_GEOMETRY);
    expect(controllers[COUNT_CONTROLLER]).toEqual(countController());
    const tallies = read("../resource_pack/models/entity/tally.geo.json")["minecraft:geometry"].map((geometry: { description: { identifier: string } }) => geometry.description.identifier);
    expect(tallies).toEqual([TALLY_GEOMETRY.gain, TALLY_GEOMETRY.loss]);
    expect(controllers[TALLY_CONTROLLER]).toEqual(tallyController());
    expect(existsSync(join(PACK, `${NUMBER_PALETTE}.png`))).toBe(true);
    for (const die of plan.dice) {
      const effect = read(`../resource_pack/${burstFile(die.id)}`);
      expect(effect).toEqual(burstEffect(die));
      expect(effect.particle_effect.description.identifier).toBe(burstParticle(die.id));
    }
  });

  it("keeps the glyphs for every digit and every face's text, for the dice icons' numbers", () => {
    const font = storedFont();
    expect(font).toBeDefined();
    const glyphs = JSON.parse(readFileSync(GLYPH_FILE, "utf8")).glyphs;
    const chars = new Set(["0123456789", ...Object.values(DICE).flatMap((die) => die.faces.map((face) => face.show))].join(""));
    chars.delete(" ");
    for (const char of chars) expect(glyphs[char], `the glyph for "${char}" (run the dice tool)`).toBeDefined();
    if (existsSync(TEN_FONT)) expect(glyphs).toEqual(glyphTable(loadTenFont(), chars));
  });

  it("is a die the game can spawn, with room in its property for every die, and a number the same", () => {
    const entity = read("../behavior_pack/entities/die.json")["minecraft:entity"];
    expect(entity.description.identifier).toBe("blockparty:die");
    expect(entity.description.properties["blockparty:die"].range[1]).toBeGreaterThanOrEqual(modelDice().length);
    expect(entity.description.properties["blockparty:burst"]).toMatchObject({ type: "bool", client_sync: true });
    const count = read("../behavior_pack/entities/count.json")["minecraft:entity"];
    expect(count.description.identifier).toBe(COUNT_ENTITY);
    expect(count.description.properties[COUNT_PROPERTY]).toMatchObject({ type: "int", range: [0, MAX_COUNT], client_sync: true });
    const countClient = read("../resource_pack/entity/count.entity.json")["minecraft:client_entity"].description;
    expect(countClient.render_controllers).toEqual([COUNT_CONTROLLER]);
    // Drawn unshaded from the numbers' palette, its upright bone undoing the entity's turn.
    expect(countClient.materials).toEqual({ default: "entity_emissive" });
    expect(countClient.textures).toEqual({ default: NUMBER_PALETTE });
    const face = read("../resource_pack/animations/blockparty.animation.json").animations["animation.blockparty.count_face"].bones;
    expect(face[UPRIGHT_BONE].rotation).toEqual([0, "-q.body_y_rotation", 0]);
    expect(face[COUNT_ROOT].rotation).toEqual(["q.camera_rotation(0)", "q.camera_rotation(1)", 0]);
  });

  it("is a transfer's count the game can spawn, with room for its number and its two tones", () => {
    const tally = read("../behavior_pack/entities/tally.json")["minecraft:entity"];
    expect(tally.description.identifier).toBe(TALLY_ENTITY);
    expect(tally.description.properties[TALLY_PROPERTY]).toMatchObject({ type: "int", range: [0, MAX_COUNT], client_sync: true });
    expect(tally.description.properties[TONE_PROPERTY]).toMatchObject({ type: "int", range: [Math.min(TONE_GAIN, TONE_LOSS), Math.max(TONE_GAIN, TONE_LOSS)], client_sync: true });
    const client = read("../resource_pack/entity/tally.entity.json")["minecraft:client_entity"].description;
    expect(client.identifier).toBe(TALLY_ENTITY);
    expect(client.render_controllers).toEqual([TALLY_CONTROLLER]);
    expect(client.geometry).toEqual(TALLY_GEOMETRY);
    expect(client.materials).toEqual({ default: "entity_emissive" });
    expect(client.textures).toEqual({ default: NUMBER_PALETTE });
    // It faces the camera and pops as the moves left do, and rises a little as it comes.
    const animations = read("../resource_pack/animations/blockparty.animation.json").animations;
    for (const name of Object.values(client.animations as Record<string, string>)) expect(animations[name], name).toBeDefined();
    expect(client.scripts.animate).toEqual(Object.keys(client.animations));
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
