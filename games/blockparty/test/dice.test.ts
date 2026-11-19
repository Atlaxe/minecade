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
  FACE_PICTURES,
  NUMBER_PARTICLE_FILE,
  PACK,
  PLAN_FILE,
  SIDES,
  buildFaces,
  burstEffect,
  burstFile,
  faceCubes,
  facePixels,
  facesGeometry,
  inkPixels,
  modelFiles,
  modelPlan,
  numberAtlas,
  numberParticle,
  rectangles,
} from "../../../tools/blockparty/dice-model.ts";
import { GLYPH_FILE, TEN_FONT, fontOf, glyphTable, loadTenFont, storedFont, type TenFont } from "../../../tools/blockparty/ten-font.ts";
import { blankImage, encodePng } from "../../../tools/skins/png.ts";
import { back, testSpaces } from "../behavior_pack/scripts/board.ts";
import { ATLAS, CELL, CELLS, COLUMNS, MAX_NUMBER, NUMBER_ATLAS, NUMBER_PARTICLE, cellAt, cellOf, cellText, halfSize, popScale } from "../behavior_pack/scripts/numbers.ts";
import { decodeAnyPng } from "../../../tools/viewer/png.ts";
import {
  DEFAULT_GAIN,
  DEFAULT_INK,
  DEFAULT_LOSS,
  DEFAULT_NUMBER,
  DICE,
  DICE_PROBLEMS,
  MAX_AGAIN,
  STANDARD,
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

  it("reads a die's \"number\" look as its faces' ink and shadow, as the user writes the dice", () => {
    const faces = [1, 2, 3, 4, 5, 6].map((move) => ({ move }));
    const standard = { name: "S", letters: "S", block: "minecraft:stone", faces };
    const read = readDice({ dice: { standard, slow: { name: "Slow", letters: "SL", block: "minecraft:stone", number: { ink: "#02B8DB", shadow: true }, faces } } });
    expect(read.problems).toEqual([]);
    const slow = read.dice.find((die) => die.id === "slow")!;
    expect([slow.ink, slow.shadow]).toEqual(["#02b8db", true]);
    expect(slow.faces[0]).toMatchObject({ ink: "#02b8db", shadow: shadowOf("#02b8db") });
    // "ink" and "shadow" win over it; a "number" that isn't an object is named.
    const both = readDice({ dice: { standard: { ...standard, ink: "#111111", number: { ink: "#222222", shadow: false } } } });
    expect(both.dice[0].ink).toBe("#111111");
    expect(both.dice[0].shadow).toBeUndefined();
    expect(readDice({ dice: { standard: { ...standard, number: "red" } } }).problems).toContainEqual(expect.stringMatching(/^standard: "number" is an object/));
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

  it("lays every number over a head out in cells: the moves left 0 to 99, then +1 to +99, then -1 to -99", () => {
    expect(cellOf("count", 0)).toBe(0);
    expect(cellOf("count", 7)).toBe(7);
    expect(cellOf("count", 140)).toBe(MAX_NUMBER);
    expect(cellOf("gain", 3)).toBe(103);
    expect(cellOf("gain", 0)).toBe(101);
    expect(cellOf("loss", 12)).toBe(212);
    expect(cellText(7)).toEqual({ kind: "count", text: "7" });
    expect(cellText(103)).toEqual({ kind: "gain", text: "+3" });
    expect(cellText(299)).toEqual({ kind: "loss", text: "-99" });
    expect(cellText(100)).toBeUndefined();
    expect(cellText(CELLS)).toBeUndefined();
    expect(cellAt(17)).toEqual([CELL.width, CELL.height]);
    // A transfer's count is half the moves left's size; a billboard's size is its half-size.
    expect(halfSize("gain")[1] * 2).toBeCloseTo(halfSize("count")[1]);
    expect(halfSize("count")[1] * 2).toBeCloseTo((CELL.height * 1.25) / 16);
    // It grows in, swells as it changes, and settles.
    expect(popScale(0, 1)).toBe(0);
    expect(popScale(1, 0.1)).toBeCloseTo(1.35);
    expect(popScale(1, 1)).toBe(1);
  });

  it("draws every number in its look with its shadow, centered in its cell, and shows a cell with one particle facing the camera", () => {
    // Digits 2 x 2, a + and a - one row: "+5" is 2 + 1 + 2 = 5 across and 2 high, 6 x 3 with its shadow.
    const font = fontOf((char) => {
      if (/^[0-9]$/.test(char)) return { columns: 2, filled: [[0, 0], [1, 0], [0, 1], [1, 1]] };
      if (char === "+" || char === "-") return { columns: 2, filled: [[0, 0], [1, 0]] };
      return undefined;
    });
    const looks = { number: { ink: "#ffffff", shadow: "#3f3f3f" }, gain: { ink: "#ffaa00", shadow: "#3f2a00" }, loss: { ink: "#ff5555" } };
    const atlas = numberAtlas(looks, font);
    expect([atlas.width, atlas.height]).toEqual([ATLAS.width, ATLAS.height]);
    const pixel = (x: number, y: number) => [...atlas.data.subarray((y * atlas.width + x) * 4, (y * atlas.width + x) * 4 + 4)];
    const colorsIn = (cell: number) => {
      const [left, top] = cellAt(cell);
      const seen = new Set<string>();
      for (let y = top; y < top + CELL.height; y++) for (let x = left; x < left + CELL.width; x++) if (pixel(x, y)[3] > 0) seen.add(pixel(x, y).slice(0, 3).join(","));
      return seen;
    };
    expect(colorsIn(cellOf("count", 5))).toEqual(new Set(["255,255,255", "63,63,63"]));
    expect(colorsIn(cellOf("gain", 5))).toEqual(new Set(["255,170,0", "63,42,0"]));
    // A look with no shadow has none.
    expect(colorsIn(cellOf("loss", 5))).toEqual(new Set(["255,85,85"]));
    // An unused cell is see-through.
    expect(colorsIn(100).size).toBe(0);
    // "5" with its shadow, 3 x 3, centered in its cell.
    const [left, top] = cellAt(cellOf("count", 5));
    const [x, y] = [left + Math.floor((CELL.width - 3) / 2), top + Math.floor((CELL.height - 3) / 2)];
    expect(pixel(x, y)).toEqual([255, 255, 255, 255]);
    expect(pixel(x - 1, y)[3]).toBe(0);
    // A clear margin round every cell, so drawing one never picks up its neighbors: "+99" is the widest.
    expect(CELL.width - (6 + 1 + 7 + 1 + 7 + 1)).toBeGreaterThanOrEqual(4);
    expect(CELL.height - (10 + 1)).toBeGreaterThanOrEqual(4);
    // The particle shows the cell its variables name, the size they say, and moves as they say.
    const particle = numberParticle() as { particle_effect: { description: { identifier: string; basic_render_parameters: { texture: string } }; components: Record<string, any> } };
    expect(particle.particle_effect.description.identifier).toBe(NUMBER_PARTICLE);
    expect(particle.particle_effect.description.basic_render_parameters.texture).toBe(NUMBER_ATLAS);
    const billboard = particle.particle_effect.components["minecraft:particle_appearance_billboard"];
    expect(billboard.facing_camera_mode).toBe("rotate_xyz");
    expect(billboard.size).toEqual(["v.half_w", "v.half_h"]);
    expect(billboard.uv).toMatchObject({ texture_width: ATLAS.width, texture_height: ATLAS.height, uv_size: [CELL.width, CELL.height] });
    expect(billboard.uv.uv).toEqual([`math.mod(v.cell, ${COLUMNS}) * ${CELL.width}`, `math.floor(v.cell / ${COLUMNS}) * ${CELL.height}`]);
    // Unlit: no lighting component, so it's as bright as its picture.
    expect(particle.particle_effect.components["minecraft:particle_appearance_lighting"]).toBeUndefined();
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
    // The numbers over heads (their atlas and particle), and each die's burst.
    expect(existsSync(join(PACK, `${NUMBER_ATLAS}.png`))).toBe(true);
    expect(read(`../resource_pack/${NUMBER_PARTICLE_FILE}`)).toEqual(numberParticle());
    expect(controllers["controller.render.blockparty.count"]).toBeUndefined();
    if (existsSync(TEN_FONT)) {
      const made = numberAtlas(plan, loadTenFont());
      const atlas = decodeAnyPng(readFileSync(join(PACK, `${NUMBER_ATLAS}.png`)));
      expect(Buffer.from(atlas.data).equals(Buffer.from(made.data))).toBe(true);
    }
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

  it("is a die the game can spawn, with room in its property for every die", () => {
    const entity = read("../behavior_pack/entities/die.json")["minecraft:entity"];
    expect(entity.description.identifier).toBe("blockparty:die");
    expect(entity.description.properties["blockparty:die"].range[1]).toBeGreaterThanOrEqual(modelDice().length);
    expect(entity.description.properties["blockparty:burst"]).toMatchObject({ type: "bool", client_sync: true });
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
