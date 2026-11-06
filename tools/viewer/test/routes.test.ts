import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BlockState } from "../subchunk.ts";
import { viewerView } from "../routes.ts";
import { decodeView } from "../view-format.ts";
import { subChunk, subChunkKey, writeWorld } from "./fixture-world.ts";

const stone: BlockState = { name: "minecraft:stone", states: {} };
let root: string;
let store: string;
const before = process.env.MAP_STORE;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "minecade-viewer-root-"));
  store = mkdtempSync(join(tmpdir(), "minecade-viewer-store-"));
  process.env.MAP_STORE = store;
});
afterEach(() => {
  if (before === undefined) delete process.env.MAP_STORE;
  else process.env.MAP_STORE = before;
  rmSync(root, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
});

/** A map in the store's working folder whose world has stone at these chunks' corners. */
function map(target: string, id: string, chunks: [number, number][]): void {
  writeWorld(join(store, "working", target, id, "world"), {
    tables: { 5: chunks.map(([x, z], i) => ({ key: subChunkKey(x, z, 0), seq: i + 1, value: subChunk([{ at: (bx, by, bz) => (bx + by + bz === 0 ? stone : undefined) }]) })) },
  });
}

describe("viewerView", () => {
  it("sends a map's view, made once into work\\viewer\\maps", () => {
    map("sumo", "arena", [[0, 0]]);
    const answer = viewerView(root, "sumo", "arena");
    expect(answer.status).toBe(200);
    if (answer.status !== 200) return;
    expect(decodeView(new Uint8Array(gunzipSync(answer.gzipped))).looks.map((look) => look.name)).toEqual(["minecraft:air", "minecraft:stone"]);
    expect(existsSync(join(root, "work", "viewer", "maps", "sumo", "arena", `${answer.stamp}.bin.gz`))).toBe(true);
  });

  it("refuses ids that could leave the store", () => {
    expect(viewerView(root, "..", "arena")).toMatchObject({ status: 400 });
    expect(viewerView(root, "sumo", "a/b")).toMatchObject({ status: 400 });
    expect(viewerView(root, "sumo", "")).toMatchObject({ status: 400 });
  });

  it("says there's no world for a map that isn't there", () => {
    expect(viewerView(root, "sumo", "nowhere")).toMatchObject({ status: 404 });
  });

  it("says why a world is too wide to show", () => {
    map("sumo", "huge", [[0, 0], [20, 0]]);
    const answer = viewerView(root, "sumo", "huge");
    expect(answer).toMatchObject({ status: 422 });
    if (answer.status === 422) expect(answer.error).toMatch(/321 by 1 blocks across/);
  });
});
