import { describe, expect, it } from "vitest";
import { boxUv, geoHeight, parseGeo } from "../geo.ts";

const file = (bones: unknown[], width = 64, height = 32) => ({ "minecraft:geometry": [{ description: { identifier: "geometry.test", texture_width: width, texture_height: height }, bones }] });

describe("parseGeo", () => {
  it("lays out a box-UV cube's six faces from its corner on the texture", () => {
    const geo = parseGeo(file([{ name: "body", pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }] }]));
    expect(geo.bones).toHaveLength(1);
    const faces = geo.bones[0].cubes[0].faces;
    expect(faces.map((face) => face.name)).toEqual(["up", "down", "north", "south", "east", "west"]);
    const up = faces.find((face) => face.name === "up")!;
    // Up: from (u + depth, v), width by depth: (20, 16) to (28, 20), on a 64 x 32 texture.
    expect(up.uvs[0]).toEqual([20 / 64, 16 / 32]);
    expect(up.uvs[2]).toEqual([28 / 64, 20 / 32]);
    expect(up.corners.every((corner) => corner[1] === 24)).toBe(true);
    const north = faces.find((face) => face.name === "north")!;
    expect(north.corners.every((corner) => corner[2] === -2)).toBe(true);
    expect(north.uvs[0]).toEqual([20 / 64, 20 / 32]);
  });

  it("takes per-face UV only for the faces it names", () => {
    const geo = parseGeo(file([{ name: "pit", pivot: [0, 0, 0], cubes: [{ origin: [-24, 0, -24], size: [48, 0, 48], uv: { up: { uv: [0, 0], uv_size: [48, 48] } } }] }], 96, 48));
    const faces = geo.bones[0].cubes[0].faces;
    expect(faces.map((face) => face.name)).toEqual(["up"]);
    expect(faces[0].uvs).toEqual([
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
    ]);
  });

  it("grows a cube by its inflate, keeps parents and rotations, and mirrors u", () => {
    const geo = parseGeo(
      file([
        { name: "root", pivot: [0, 0, 0] },
        { name: "arm", parent: "root", pivot: [1, 2, 3], rotation: [10, 0, 0], cubes: [{ origin: [0, 0, 0], size: [2, 2, 2], inflate: 0.5, mirror: true, rotation: [0, 45, 0], pivot: [1, 1, 1], uv: [0, 0] }] },
      ]),
    );
    const arm = geo.bones[1];
    expect(arm).toMatchObject({ name: "arm", parent: "root", pivot: [1, 2, 3], rotation: [10, 0, 0] });
    expect(arm.cubes[0]).toMatchObject({ rotation: [0, 45, 0], pivot: [1, 1, 1] });
    const up = arm.cubes[0].faces.find((face) => face.name === "up")!;
    expect(up.corners[0]).toEqual([-0.5, 2.5, -0.5]);
    // Mirrored: the left corners take the right edge's u.
    expect(up.uvs[0][0]).toBeGreaterThan(up.uvs[1][0]);
  });

  it("refuses what isn't a geometry file", () => {
    expect(() => parseGeo({})).toThrow(/not a geometry file/);
  });

  it("measures how tall a model is", () => {
    const geo = parseGeo(file([{ name: "post", pivot: [0, 0, 0], cubes: [{ origin: [-1, 0, -1], size: [2, 12, 2], uv: [0, 0] }, { origin: [-3, 12, -3], size: [6, 4, 6], uv: [0, 0] }] }]));
    expect(geoHeight(geo)).toEqual({ low: 0, high: 16 });
  });
});

describe("boxUv", () => {
  it("puts the sides in a row under the top and bottom", () => {
    expect(boxUv([0, 0], [8, 12, 4])).toEqual({
      up: [4, 0, 8, 4],
      down: [12, 0, 8, 4],
      east: [0, 4, 4, 12],
      north: [4, 4, 8, 12],
      west: [12, 4, 4, 12],
      south: [16, 4, 8, 12],
    });
  });
});
