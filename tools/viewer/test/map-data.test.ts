import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stampOf, viewerMap, watchMap, type MapChange } from "../map-data.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
let store: string;
const before = process.env.MAP_STORE;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "minecade-viewer-store-"));
  process.env.MAP_STORE = store;
});
afterEach(() => {
  if (before === undefined) delete process.env.MAP_STORE;
  else process.env.MAP_STORE = before;
  rmSync(store, { recursive: true, force: true });
});

function writeMap(target: string, map: string, text: string): string {
  const dir = join(store, "working", target, map);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "map.json"), text);
  return join(dir, "map.json");
}

describe("viewerMap", () => {
  it("sends the map, its game's rules and the marker shapes and models", async () => {
    const text = JSON.stringify({ name: "Test", spawns: [], points: { "hole.red": [[0, 64, 0]] } });
    writeMap("bridges", "test", text);
    const answer = await viewerMap(root, "bridges", "test");
    expect(answer.status).toBe(200);
    if (answer.status !== 200) return;
    expect(answer.map.config.name).toBe("Test");
    expect(answer.map.stamp).toBe(stampOf(text));
    expect(answer.map.targetName).toBe("Bridges");
    expect(answer.map.rules.teams?.map((team) => team.id)).toEqual(["red", "blue"]);
    expect(Object.keys(answer.map.models)).toEqual(["hole"]);
    expect(answer.map.models.hole.texture).toMatch(/^data:image\/png;base64,/);
    expect(answer.map.shapes.player["minecraft:geometry"]).toHaveLength(1);
    expect(answer.map.shapes.post["minecraft:geometry"]).toHaveLength(1);
  });

  it("refuses bad ids, missing maps and broken JSON", async () => {
    expect(await viewerMap(root, "..", "test")).toMatchObject({ status: 400 });
    expect(await viewerMap(root, "bridges", "nowhere")).toMatchObject({ status: 404 });
    writeMap("bridges", "broken", "{ not json");
    expect(await viewerMap(root, "bridges", "broken")).toMatchObject({ status: 422 });
  });
});

describe("watchMap", () => {
  it("tells each listener when map.json changes, until it stops", async () => {
    const path = writeMap("sumo", "arena", JSON.stringify({ name: "A", spawns: [] }));
    const changes: MapChange[] = [];
    const stop = watchMap(root, "sumo", "arena", (change) => changes.push(change));
    await new Promise((resolve) => setTimeout(resolve, 600));
    writeFileSync(path, JSON.stringify({ name: "B", spawns: [] }));
    for (let i = 0; i < 40 && changes.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(changes.map((change) => change.config?.name)).toEqual(["B"]);
    stop();
    writeFileSync(path, JSON.stringify({ name: "C", spawns: [] }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(changes).toHaveLength(1);
  });
});
