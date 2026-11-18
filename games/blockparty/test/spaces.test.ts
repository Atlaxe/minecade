// Block Party's space markers: the model cut on the block grid, the pedestal's floor, the user's
// spaces.json, the files tools/blockparty/space-pack.ts writes (they must agree with the model and
// spaces.json), and what the game lights (space-markers.ts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTROLLERS_FILE,
  ENTITY_FILE,
  FLOOR_FILE,
  FLOOR_TEXTURE,
  FLOOR_TEXTURE_ID,
  INFO_FILE,
  MODEL_FILE,
  PACK,
  TERRAIN_FILE,
  TYPE_IDS,
  bonesOf,
  clientEntity,
  cutCube,
  cutModel,
  floorBlock,
  floorCells,
  gridCuts,
  markerGeometry,
  measure,
  modelInfo,
  modelProblems,
  readSpaces,
  renderControllers,
  spacesProblems,
  type Cube,
  type GeometryFile,
  type SpacesFile,
} from "../../../tools/blockparty/space-model.ts";
import { STAND, floorOf, testSpaces, type Space, type Vec3 } from "../behavior_pack/scripts/board.ts";
import { FLOOR_CELLS, PEDESTAL, floorBlocks, litSpaces, standsOn, typeIndex } from "../behavior_pack/scripts/space-markers.ts";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const RUN = "else run: npx tsx tools/blockparty/space-pack.ts";

/** A model of the given cubes, perimeter and pedestal. */
function modelOf(perimeter: Cube[], pedestal: Cube[], extra: GeometryFile["minecraft:geometry"][number]["bones"] = []): GeometryFile {
  return {
    format_version: "1.12.0",
    "minecraft:geometry": [
      {
        description: { identifier: "geometry.blockparty.space", texture_width: 16, texture_height: 16 },
        bones: [
          { name: "perimeter", pivot: [0, 0, 0], cubes: perimeter },
          { name: "pedestal", pivot: [0, 2, 0], cubes: pedestal },
          ...extra,
        ],
      },
    ],
  };
}

describe("cutting the model on the block grid", () => {
  it("cuts x and z where blocks meet (the middle on a block's middle), and y at each block's bottom", () => {
    expect(gridCuts(-20, 20, 0)).toEqual([-8, 8]);
    expect(gridCuts(-8, 8, 2)).toEqual([]);
    expect(gridCuts(-24, 24, 0)).toEqual([-8, 8]);
    expect(gridCuts(0, 40, 1)).toEqual([16, 32]);
    expect(gridCuts(2, 8, 1)).toEqual([]);
  });

  it("cuts a 40-wide pedestal into 12, 16 and 12, keeping only its outside faces", () => {
    const pieces = cutCube({ origin: [-20, 2, -20], size: [40, 6, 40] });
    expect(pieces).toHaveLength(9);
    expect(pieces.map((piece) => piece.size[0]).sort()).toEqual([12, 12, 12, 12, 12, 12, 16, 16, 16]);
    const middle = pieces.find((piece) => piece.origin[0] === -8 && piece.origin[2] === -8)!;
    // The middle piece shows only its top: every side is on a cut, and its bottom is off the ground.
    expect(Object.keys(middle.uv!)).toEqual(["up", "down"]);
    // Every piece has a top and a bottom (a new cube off the ground keeps its bottom).
    for (const piece of pieces) expect(Object.keys(piece.uv!)).toEqual(expect.arrayContaining(["up", "down"]));
  });

  it("maps each face onto the part of the texture the block it's in shows there", () => {
    const pieces = cutCube({ origin: [-20, 2, -20], size: [40, 6, 40] });
    // Blockbench's x is the file's turned over: file x 8..20 is Blockbench's -20..-8, the west (low x) side.
    const corner = pieces.find((piece) => piece.origin[0] === 8 && piece.origin[2] === -20)!;
    const uv = corner.uv as Record<string, { uv: number[]; uv_size: number[] }>;
    expect(Object.keys(uv).sort()).toEqual(["down", "north", "up", "west"]);
    // Its top: 4 pixels into its block both ways, 12 x 12.
    expect(uv.up).toEqual({ uv: [4, 4], uv_size: [12, 12] });
    // Its sides: 2 to 8 pixels up a block shows the texture's rows 8 to 14 (a slab's side is its bottom half).
    expect(uv.north).toEqual({ uv: [0, 8], uv_size: [12, 6] });
    expect(uv.west).toEqual({ uv: [4, 8], uv_size: [12, 6] });
  });

  it("leaves a new cube's bottom on the ground off, and keeps the faces a cube has", () => {
    const [plate] = cutCube({ origin: [-8, 0, -8], size: [16, 2, 16] });
    expect(Object.keys(plate.uv!)).not.toContain("down");
    const [kept] = cutCube({ origin: [-8, 0, -8], size: [16, 2, 16], uv: { up: { uv: [0, 0], uv_size: [16, 16] } } });
    expect(Object.keys(kept.uv!)).toEqual(["up"]);
  });

  it("keeps a turned cube's turn and pivot on every piece", () => {
    const pieces = cutCube({ origin: [-12, 0, -4], size: [24, 4, 8], rotation: [0, 45, 0], pivot: [0, 0, 0] });
    expect(pieces).toHaveLength(3);
    for (const piece of pieces) {
      expect(piece.rotation).toEqual([0, 45, 0]);
      expect(piece.pivot).toEqual([0, 0, 0]);
    }
  });

  it("changes nothing once cut (the tool can run again)", () => {
    const model = modelOf([{ origin: [-24, 0, -24], size: [48, 2, 48] }], [{ origin: [-20, 2, -20], size: [40, 6, 40] }]);
    const once = cutModel(model);
    expect(cutModel(once)).toEqual(once);
  });
});

describe("the model's sizes and problems", () => {
  const model = modelOf([{ origin: [-24, 0, -24], size: [48, 2, 48] }], [{ origin: [-20, 2, -20], size: [40, 6, 40] }]);

  it("measures the footprint and the pedestal from the middle", () => {
    expect(measure(markerGeometry(model)!)).toEqual({ reach: [24, 24], height: 8, pedestal: { reach: [20, 20], top: 8 } });
  });

  it("says when the marker is wider than 3 blocks, has no pedestal, or has cubes in neither part", () => {
    expect(modelProblems(model).problems).toEqual([]);
    expect(modelProblems(modelOf([{ origin: [-26, 0, -24], size: [52, 2, 48] }], [{ origin: [-20, 2, -20], size: [40, 6, 40] }])).problems.join(" ")).toMatch(/within 24/);
    expect(modelProblems(modelOf([{ origin: [-24, 0, -24], size: [48, 2, 48] }], [])).problems.join(" ")).toMatch(/no pedestal/);
    expect(modelProblems(modelOf([], [{ origin: [-20, 2, -20], size: [40, 6, 40] }], [{ name: "trim", cubes: [{ origin: [0, 0, 0], size: [1, 1, 1] }] }])).problems.join(" ")).toMatch(/neither part/);
  });

  it("counts a bone inside a part as that part", () => {
    const nested = modelOf([], [{ origin: [-8, 2, -8], size: [16, 6, 16] }], [{ name: "rim", parent: "pedestal", cubes: [{ origin: [-20, 2, -20], size: [40, 10, 40] }] }]);
    expect(modelProblems(nested).problems).toEqual([]);
    expect(measure(markerGeometry(nested)!).pedestal).toEqual({ reach: [20, 20], top: 12 });
    expect(bonesOf(markerGeometry(nested)!).pedestal).toEqual(["pedestal", "rim"]);
  });

  it("warns when a piece can't step up onto the pedestal, or four don't fit on it", () => {
    expect(modelProblems(modelOf([], [{ origin: [-20, 0, -20], size: [40, 12, 40] }])).warnings.join(" ")).toMatch(/steps up/);
    expect(modelProblems(modelOf([], [{ origin: [-10, 0, -10], size: [20, 8, 20] }])).warnings.join(" ")).toMatch(/hang over/);
  });
});

describe("the pedestal's floor", () => {
  it("covers the 3 x 3 blocks a 2.5-block pedestal reaches, each block's part with x mirrored as Bedrock's boxes are", () => {
    const cells = floorCells({ reach: [24, 24], height: 8, pedestal: { reach: [20, 20], top: 8 } });
    expect(cells).toHaveLength(9);
    expect(cells.find((cell) => cell.dx === 0 && cell.dz === 0)).toMatchObject({ cell: 4, origin: [-8, 0, -8], size: [16, 8, 16] });
    // The block east of the space's own: the pedestal takes its western 12 pixels, which a mirrored box keeps on its +x side.
    expect(cells.find((cell) => cell.dx === 1 && cell.dz === 0)).toMatchObject({ cell: 5, origin: [-4, 0, -8], size: [12, 8, 16] });
    // The north-west block: its south-east 12 x 12.
    expect(cells.find((cell) => cell.dx === -1 && cell.dz === -1)).toMatchObject({ cell: 0, origin: [-8, 0, -4], size: [12, 8, 12] });
  });

  it("takes only the space's own block for a pedestal within it", () => {
    const cells = floorCells({ reach: [8, 8], height: 6, pedestal: { reach: [6, 6], top: 6 } });
    expect(cells).toEqual([{ dx: 0, dz: 0, cell: 4, origin: [-6, 0, -6], size: [12, 6, 12] }]);
  });
});

describe("spaces.json", () => {
  const file = readSpaces();

  it("has both textures for every space type, and a highlight in range", () => {
    expect(spacesProblems(file)).toEqual([]);
    expect(Object.keys(file.types).sort()).toEqual([...TYPE_IDS].sort());
  });

  it("says what's wrong", () => {
    const broken: SpacesFile = { highlight: { color: "white", strength: 0.9, pulse: 0.3, seconds: 0 }, types: { ...file.types, purple: { pedestal: "concrete", perimeter: "textures/blocks/stone" } } };
    delete broken.types.blue;
    const problems = spacesProblems(broken).join(" ");
    expect(problems).toMatch(/no "blue"/);
    expect(problems).toMatch(/"purple" isn't a space type/);
    expect(problems).toMatch(/purple's pedestal should be a texture's path/);
    expect(problems).toMatch(/"color"/);
  });

  it("says when the highlight goes past full or under none", () => {
    const over: SpacesFile = { ...file, highlight: { color: "#FFFFFF", strength: 0.9, pulse: 0.3, seconds: 1 } };
    expect(spacesProblems(over).join(" ")).toMatch(/strength plus pulse at 1 or less/);
  });
});

describe("the files space-pack.ts writes", () => {
  const file = readSpaces();
  const model = readJson(MODEL_FILE) as GeometryFile;
  const geometry = markerGeometry(model)!;
  const size = measure(geometry);
  const cells = floorCells(size);

  it(`has a model with no problems, already cut (${RUN})`, () => {
    expect(modelProblems(model).problems).toEqual([]);
    expect(cutModel(model)).toEqual(model);
  });

  it(`has the client entity and render controllers for spaces.json and the model's bones (${RUN})`, () => {
    expect(readJson(ENTITY_FILE)).toEqual(clientEntity(file));
    const controllers = readJson(CONTROLLERS_FILE).render_controllers;
    for (const [id, controller] of Object.entries(renderControllers(file, bonesOf(geometry)))) expect(controllers[id]).toEqual(controller);
  });

  it(`has the floor block, its clear texture and what the game reads (${RUN})`, () => {
    expect(readJson(FLOOR_FILE)).toEqual(floorBlock(cells));
    expect(readJson(INFO_FILE)).toEqual(modelInfo(size, cells));
    expect(existsSync(join(PACK, `${FLOOR_TEXTURE}.png`))).toBe(true);
    expect(readJson(TERRAIN_FILE).texture_data[FLOOR_TEXTURE_ID]).toEqual({ textures: FLOOR_TEXTURE });
  });

  it("gives the marker's entity a type for every space type and a lit switch, synced to the client", () => {
    const entity = readJson(join(PACK, "..", "behavior_pack", "entities", "space.json"))["minecraft:entity"];
    expect(entity.description.properties["blockparty:type"]).toMatchObject({ type: "int", client_sync: true });
    expect(entity.description.properties["blockparty:type"].range[1]).toBeGreaterThanOrEqual(TYPE_IDS.length - 1);
    expect(entity.description.properties["blockparty:lit"]).toMatchObject({ type: "bool", client_sync: true });
  });
});

describe("the markers in game", () => {
  const spaces = testSpaces([0, 64, 0], 6);

  it("stands a piece on the pedestal's top, its floor blocks around the space's own block", () => {
    expect(STAND).toBe(0.5);
    expect(PEDESTAL).toEqual([1.25, 1.25]);
    expect(FLOOR_CELLS).toHaveLength(9);
    const blocks = floorBlocks(spaces[0]);
    const [x, , z] = spaces[0].at;
    expect(blocks.find((block) => block.cell === 4)?.at).toEqual([Math.floor(x), 64, Math.floor(z)]);
    expect(blocks.find((block) => block.cell === 5)?.at).toEqual([Math.floor(x) + 1, 64, Math.floor(z)]);
    expect(floorOf(spaces[0])).toBe(64);
  });

  it("lights a space while a piece's middle is over its pedestal, on it or crossing it", () => {
    const space = spaces[1];
    const [x, y, z] = space.at;
    expect(standsOn(space, [x + 0.7, y, z - 0.7])).toBe(true);
    // Walking across the perimeter onto it, still at the floor.
    expect(standsOn(space, [x + 1.2, floorOf(space), z])).toBe(true);
    expect(standsOn(space, [x + 1.4, y, z])).toBe(false);
    expect(standsOn(space, [x, y + 3, z])).toBe(false);
  });

  it("lights the spaces pieces stand on and the one the stage's shot is on", () => {
    const pieces: Vec3[] = [spaces[2].at, [spaces[5].at[0] + 0.7, spaces[5].at[1], spaces[5].at[2] + 0.7], [1000, 64, 1000]];
    expect([...litSpaces(spaces, pieces, [9])].sort((a, b) => a - b)).toEqual([2, 5, 9]);
    expect(litSpaces(spaces, [], []).size).toBe(0);
  });

  it("picks each type's textures by its place in spaces.json's types, Blue for one it doesn't know", () => {
    expect(typeIndex("start")).toBe(0);
    expect(typeIndex("happening")).toBe(TYPE_IDS.indexOf("happening"));
    expect(typeIndex("nonsense")).toBe(TYPE_IDS.indexOf("blue"));
  });

  it("has a floor for any space shape the board kit makes", () => {
    const odd: Space = { index: 0, type: "blue", at: [10.5, 70.5, -3.5], floor: 70, next: [] };
    expect(floorBlocks(odd).every((block) => block.at[1] === 70)).toBe(true);
  });
});
