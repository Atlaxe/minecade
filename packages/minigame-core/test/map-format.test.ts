import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatMapConfig } from "../src/map-format.ts";

const root = new URL("../../../", import.meta.url);

/** Every map.json in the repo: games/<id>/maps/<map>/ and lobby/maps/<map>/. */
function mapFiles(): string[] {
  const dirs = ["lobby/maps", ...readdirSync(new URL("games/", root)).map((game) => `games/${game}/maps`)];
  return dirs.flatMap((dir) =>
    existsSync(new URL(dir, root)) ? readdirSync(new URL(dir, root)).map((map) => `${dir}/${map}/map.json`).filter((file) => existsSync(new URL(file, root))) : [],
  );
}

describe("formatMapConfig", () => {
  it.each(mapFiles())("writes %s exactly as it is", (file) => {
    const text = readFileSync(new URL(file, root), "utf8").replace(/\r\n/g, "\n");
    expect(formatMapConfig(JSON.parse(text))).toBe(text);
  });

  it("writes the map editor's entries in the same style", () => {
    const config = {
      name: "Castle",
      draft: true,
      spawns: [[0, 70, 0]],
      bounds: { min: [-48, 40, -40], max: [48, 96, 40] },
      teamSpawns: { red: [[-20, 65, 0, -90, 0], [-20, 65, 4, -90, 0]], blue: [[20, 65, 0, 90, 0]] },
      regions: {
        kill: [
          { min: [-5, 40, -5], max: [5, 60, 5] },
          { min: [10, 40, 10], max: [15, 60, 15] },
        ],
        "buyZone.red": [{ min: [-30, 64, -5], max: [-25, 70, 5] }],
      },
      cameras: { overview: { at: [0, 90, -60, 0, 25], kind: "map" } },
      source: { world: "Arenas", box: { min: [1200, 40, -620], max: [1296, 96, -540] }, offset: [-1248, 0, 580] },
    };
    expect(formatMapConfig(config)).toBe(
      [
        "{",
        '  "name": "Castle",',
        '  "draft": true,',
        '  "spawns": [[0, 70, 0]],',
        '  "bounds": { "min": [-48, 40, -40], "max": [48, 96, 40] },',
        '  "teamSpawns": {',
        '    "red": [',
        "      [-20, 65, 0, -90, 0], [-20, 65, 4, -90, 0]",
        "    ],",
        '    "blue": [[20, 65, 0, 90, 0]]',
        "  },",
        '  "regions": {',
        '    "kill": [',
        '      { "min": [-5, 40, -5], "max": [5, 60, 5] },',
        '      { "min": [10, 40, 10], "max": [15, 60, 15] }',
        "    ],",
        '    "buyZone.red": [{ "min": [-30, 64, -5], "max": [-25, 70, 5] }]',
        "  },",
        '  "cameras": { "overview": { "at": [0, 90, -60, 0, 25], "kind": "map" } },',
        '  "source": {',
        '    "world": "Arenas",',
        '    "box": { "min": [1200, 40, -620], "max": [1296, 96, -540] },',
        '    "offset": [-1248, 0, 580]',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("splits long lists of positions into even rows that fit, and keeps unknown keys in place", () => {
    const spawns = Array.from({ length: 5 }, (_, i) => [i * 100, 65, -i * 100, 180, -45]);
    const text = formatMapConfig({ name: "Wide", eliminationY: 50, spawns });
    expect(text).toBe(
      [
        "{",
        '  "name": "Wide",',
        '  "eliminationY": 50,',
        '  "spawns": [',
        "    [0, 65, 0, 180, -45], [100, 65, -100, 180, -45], [200, 65, -200, 180, -45],",
        "    [300, 65, -300, 180, -45], [400, 65, -400, 180, -45]",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
    expect(Math.max(...text.split("\n").map((line) => line.length))).toBeLessThanOrEqual(100);
    expect(formatMapConfig(JSON.parse(text))).toBe(text);
  });

  it("writes empty lists and objects inline", () => {
    expect(formatMapConfig({ name: "Empty", spawns: [], points: {} })).toBe('{\n  "name": "Empty",\n  "spawns": [],\n  "points": {}\n}\n');
  });
});
