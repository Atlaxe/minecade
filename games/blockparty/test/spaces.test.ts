// Block Party's space markers: the model with the block texture stretched over each face, its floor,
// the user's spaces.json, the files tools/blockparty/space-pack.ts writes (they must agree with the
// model and spaces.json), what the game lights, and the lift up onto a marker (space-markers.ts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTROLLERS_FILE,
  CONTROLLER_PREFIX,
  ENTITY_FILE,
  FLOOR_FILE,
  FLOOR_TEXTURE,
  FLOOR_TEXTURE_ID,
  INFO_FILE,
  MODEL_FILE,
  PACK,
  TERRAIN_FILE,
  TYPE_IDS,
  clientEntity,
  fitCube,
  fitModel,
  floorBlock,
  floorCells,
  markerGeometry,
  measure,
  modelInfo,
  modelProblems,
  readSpaces,
  renderControllers,
  spacesProblems,
  withControllers,
  type Cube,
  type GeometryFile,
  type SpacesFile,
} from "../../../tools/blockparty/space-model.ts";
import { STAND, floorOf, testSpaces, type Space, type Vec3 } from "../behavior_pack/scripts/board.ts";
import { hopUp } from "../behavior_pack/scripts/bots.ts";
import { FLOOR_CELLS, MARKER_REACH, floorBlocks, litSpaces, standsOn, stepUp, typeIndex } from "../behavior_pack/scripts/space-markers.ts";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const RUN = "else run: npx tsx tools/blockparty/space-pack.ts";
const WHOLE = { uv: [0, 0], uv_size: [16, 16] };

/** A model of the given cubes. */
function modelOf(cubes: Cube[], extra: GeometryFile["minecraft:geometry"][number]["bones"] = []): GeometryFile {
  return {
    format_version: "1.12.0",
    "minecraft:geometry": [
      {
        description: { identifier: "geometry.blockparty.space", texture_width: 16, texture_height: 16 },
        bones: [{ name: "pedestal", pivot: [0, 0, 0], cubes }, ...extra],
      },
    ],
  };
}

describe("the block texture on the model", () => {
  it("stretches the whole texture once over every face, a big top and a thin side alike", () => {
    const fitted = fitCube({ origin: [-20, 2, -20], size: [40, 6, 40] });
    expect(Object.values(fitted.uv!)).toHaveLength(6);
    for (const face of Object.values(fitted.uv!)) expect(face).toEqual(WHOLE);
    expect(fitted.origin).toEqual([-20, 2, -20]);
    expect(fitted.size).toEqual([40, 6, 40]);
  });

  it("leaves a new cube's bottom on the ground off, and keeps the faces a cube has", () => {
    expect(Object.keys(fitCube({ origin: [-20, 0, -20], size: [40, 6, 40] }).uv!)).toEqual(["north", "east", "south", "west", "up"]);
    const kept = fitCube({ origin: [-8, 0, -8], size: [16, 2, 16], uv: { up: { uv: [3, 3], uv_size: [4, 4] } } });
    expect(kept.uv).toEqual({ up: WHOLE });
  });

  it("keeps a turned cube's turn and pivot", () => {
    const fitted = fitCube({ origin: [-12, 0, -4], size: [24, 4, 8], rotation: [0, 45, 0], pivot: [0, 0, 0] });
    expect(fitted.rotation).toEqual([0, 45, 0]);
    expect(fitted.pivot).toEqual([0, 0, 0]);
  });

  it("changes nothing the second time (the tool can run again)", () => {
    const once = fitModel(modelOf([{ origin: [-20, 0, -20], size: [40, 6, 40] }]));
    expect(fitModel(once)).toEqual(once);
  });
});

describe("the model's sizes and problems", () => {
  const model = modelOf([{ origin: [-20, 0, -20], size: [40, 6, 40] }]);

  it("measures its reach from the middle and its top", () => {
    expect(measure(markerGeometry(model)!)).toEqual({ reach: [20, 20], top: 6 });
  });

  it("says when the marker is wider than 3 blocks or has nothing to stand on", () => {
    expect(modelProblems(model)).toEqual({ problems: [], warnings: [] });
    expect(modelProblems(modelOf([{ origin: [-26, 0, -24], size: [52, 2, 48] }])).problems.join(" ")).toMatch(/within 24/);
    expect(modelProblems(modelOf([])).problems.join(" ")).toMatch(/no cubes/);
  });

  it("counts every bone's cubes", () => {
    const more = modelOf([{ origin: [-8, 0, -8], size: [16, 6, 16] }], [{ name: "rim", parent: "pedestal", cubes: [{ origin: [-20, 0, -20], size: [40, 4, 40] }] }]);
    expect(measure(markerGeometry(more)!)).toEqual({ reach: [20, 20], top: 6 });
  });

  it("warns when the top is more than a step up, or four pieces don't fit on it", () => {
    expect(modelProblems(modelOf([{ origin: [-20, 0, -20], size: [40, 12, 40] }])).warnings.join(" ")).toMatch(/step of at most 8/);
    expect(modelProblems(modelOf([{ origin: [-10, 0, -10], size: [20, 6, 20] }])).warnings.join(" ")).toMatch(/hang over/);
  });
});

describe("the marker's floor", () => {
  it("covers the 3 x 3 blocks a 2.5-block marker reaches, each block's part with x mirrored as Bedrock's boxes are", () => {
    const cells = floorCells({ reach: [20, 20], top: 6 });
    expect(cells).toHaveLength(9);
    expect(cells.find((cell) => cell.dx === 0 && cell.dz === 0)).toMatchObject({ cell: 4, origin: [-8, 0, -8], size: [16, 6, 16] });
    // The block east of the space's own: the marker takes its western 12 pixels, which a mirrored box keeps on its +x side.
    expect(cells.find((cell) => cell.dx === 1 && cell.dz === 0)).toMatchObject({ cell: 5, origin: [-4, 0, -8], size: [12, 6, 16] });
    // The north-west block: its south-east 12 x 12.
    expect(cells.find((cell) => cell.dx === -1 && cell.dz === -1)).toMatchObject({ cell: 0, origin: [-8, 0, -4], size: [12, 6, 12] });
  });

  it("takes only the space's own block for a marker within it", () => {
    expect(floorCells({ reach: [6, 6], top: 6 })).toEqual([{ dx: 0, dz: 0, cell: 4, origin: [-6, 0, -6], size: [12, 6, 12] }]);
  });
});

describe("spaces.json", () => {
  const file = readSpaces();

  it("has a texture for every space type, and a highlight in range", () => {
    expect(spacesProblems(file)).toEqual([]);
    expect(Object.keys(file.types).sort()).toEqual([...TYPE_IDS].sort());
  });

  it("says what's wrong", () => {
    const broken: SpacesFile = { highlight: { color: "white", strength: 0.9, pulse: 0.3, seconds: 0 }, types: { ...file.types, purple: "concrete" } };
    delete broken.types.blue;
    const problems = spacesProblems(broken).join(" ");
    expect(problems).toMatch(/no "blue"/);
    expect(problems).toMatch(/"purple" isn't a space type/);
    expect(problems).toMatch(/purple's texture should be a texture's path/);
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

  it(`has a model with no problems, its texture stretched over every face (${RUN})`, () => {
    expect(modelProblems(model).problems).toEqual([]);
    expect(fitModel(model)).toEqual(model);
  });

  it(`has the client entity and render controllers for spaces.json, and no old ones (${RUN})`, () => {
    expect(readJson(ENTITY_FILE)).toEqual(clientEntity(file));
    const controllers = readJson(CONTROLLERS_FILE);
    expect(controllers).toEqual(withControllers(controllers, renderControllers(file)));
    expect(Object.keys(controllers.render_controllers).filter((id) => id.startsWith(CONTROLLER_PREFIX))).toEqual([CONTROLLER_PREFIX, `${CONTROLLER_PREFIX}_lit`]);
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

  it("stands a piece on the marker's top, its floor blocks around the space's own block", () => {
    expect(STAND).toBe(0.375);
    expect(MARKER_REACH).toEqual([1.25, 1.25]);
    expect(FLOOR_CELLS).toHaveLength(9);
    const blocks = floorBlocks(spaces[0]);
    const [x, , z] = spaces[0].at;
    expect(blocks.find((block) => block.cell === 4)?.at).toEqual([Math.floor(x), 64, Math.floor(z)]);
    expect(blocks.find((block) => block.cell === 5)?.at).toEqual([Math.floor(x) + 1, 64, Math.floor(z)]);
    expect(floorOf(spaces[0])).toBe(64);
  });

  it("lights a space while a piece's middle is over its marker, on it or crossing it", () => {
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

describe("the lift up onto a marker", () => {
  const spaces = testSpaces([0, 64, 0], 6);
  const [x, top, z] = spaces[1].at;
  const floor = floorOf(spaces[1]);

  it("climbs the marker's height once a piece's side is about to meet its edge", () => {
    // Walking east toward space 1, its edge 1.25 from the middle, a piece's side 0.3 from its own.
    expect(stepUp(spaces, [x - 2.5, floor, z], 1, 0, 0.9)).toBe(0);
    expect(stepUp(spaces, [x - 2.4, floor, z], 1, 0, 0.9)).toBeCloseTo(top - floor);
    expect(stepUp(spaces, [x - 1.3, floor + 0.2, z], 1, 0, 0.9)).toBeCloseTo(top - floor - 0.2);
  });

  it("doesn't lift a piece already up, walking off, or far below", () => {
    expect(stepUp(spaces, [x, top, z], 1, 0, 0.9)).toBe(0);
    // Leaving east: what's ahead is off the marker.
    expect(stepUp(spaces, [x + 1.3, floor + 0.3, z], 1, 0, 0.9)).toBe(0);
    expect(stepUp(spaces, [x - 1.5, floor - 3, z], 1, 0, 0.9)).toBe(0);
  });

  it("hops a bot a little over the step, never more than a jump", () => {
    const peak = (speed: number) => {
      let height = 0;
      for (let v = speed; v > 0; v = (v - 0.08) * 0.98) height += v;
      return height;
    };
    expect(peak(hopUp(top - floor))).toBeGreaterThan(top - floor);
    expect(peak(hopUp(top - floor))).toBeLessThan(top - floor + 0.4);
    expect(hopUp(5)).toBe(0.42);
  });
});
