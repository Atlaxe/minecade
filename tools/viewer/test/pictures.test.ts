// The map viewer's pictures (pictures.ts): a kept picture or the newest screenshot as a map's
// thumbnail or its game's picture, the game's picture published alone, and the thumbnail a
// minigame thumbnail map shows. The kept pictures and the map store are temporary folders here.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodePng } from "../../editor/png.ts";
import { MapStore } from "../../maps/store.ts";
import { publishGamePicture, shotPath, usePicture, viewerPictures } from "../pictures.ts";
import { viewerThumbPath } from "../routes.ts";

/** The checkout: its games' configs name them. */
const root = fileURLToPath(new URL("../../../", import.meta.url));
let store: string;
let kept: string;
let screenshots: string;
const before = process.env.MAP_STORE;
const now = Date.UTC(2026, 10, 9, 12);

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "minecade-viewer-pictures-store-"));
  kept = mkdtempSync(join(tmpdir(), "minecade-viewer-pictures-kept-"));
  screenshots = mkdtempSync(join(tmpdir(), "minecade-viewer-pictures-shots-"));
  process.env.MAP_STORE = store;
  map("pit", { name: "Pit", spawns: [] });
});
afterEach(() => {
  if (before === undefined) delete process.env.MAP_STORE;
  else process.env.MAP_STORE = before;
  for (const dir of [store, kept, screenshots]) rmSync(dir, { recursive: true, force: true });
});

function map(id: string, config: Record<string, unknown>): string {
  const folder = join(store, "working", "sumo", id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "map.json"), `${JSON.stringify(config)}\n`);
  return folder;
}

/** A screenshot taken `ago` ms before now, a flat gray. */
function screenshot(name: string, ago: number, gray = 120): void {
  const file = join(screenshots, name);
  writeFileSync(file, encodePng({ width: 32, height: 18, data: new Uint8Array(32 * 18 * 4).fill(gray) }));
  const at = new Date(now - ago);
  utimesSync(file, at, at);
}

const use = (body: Record<string, unknown>) => usePicture(root, { target: "sumo", map: "pit", ...body }, { now, screenshots: [screenshots], kept });

describe("usePicture", () => {
  it("keeps the newest screenshot and uses it as the map's thumbnail", async () => {
    screenshot("shot.png", 5000);
    const answer = await use({ kind: "map", shot: "newest" });
    expect(answer).toMatchObject({ status: 200 });
    if (answer.status === 200) expect(answer.message).toBe("Saved the thumbnail for Pit from your screenshot of 5 s ago (shot.png). Publish puts it in the lobby.");
    expect(existsSync(join(store, "working", "sumo", "pit", "preview.png"))).toBe(true);
    const list = await viewerPictures(root, "sumo", "pit", kept);
    expect(list.status).toBe(200);
    if (list.status !== 200) return;
    const id = list.pictures.shots[0].id;
    expect(list.pictures).toEqual({ shots: [{ id, map: "Pit" }], current: { map: id }, game: "none" });
    expect(shotPath(kept, id)).toBe(join(kept, "work", "editor", "shots", `${id}.png`));
  });

  it("uses a kept picture as the game's picture, which isn't published until asked", async () => {
    screenshot("shot.png", 5000);
    await use({ kind: "map", shot: "newest" });
    const id = ((await viewerPictures(root, "sumo", "pit", kept)) as { pictures: { shots: { id: string }[] } }).pictures.shots[0].id;
    const answer = await use({ kind: "game", shot: id });
    expect(answer).toEqual({ status: 200, message: "Saved the minigame thumbnail for Sumo. Publish picture puts it in the lobby." });
    expect(readFileSync(join(store, "working", "sumo", "icon.png"))).toEqual(readFileSync(shotPath(kept, id)!));
    expect(await viewerPictures(root, "sumo", "pit", kept)).toEqual({ status: 200, pictures: { shots: [{ id, map: "Pit", game: "Sumo" }], current: { map: id, game: id }, game: "changed" } });
  });

  it("refuses the lobby, a picture that's gone, no screenshot, a map that isn't there and a bad ask", async () => {
    mkdirSync(join(store, "working", "lobby", "hub"), { recursive: true });
    writeFileSync(join(store, "working", "lobby", "hub", "map.json"), '{ "name": "Hub", "spawns": [] }\n');
    expect(await usePicture(root, { target: "lobby", map: "hub", kind: "map", shot: "newest" }, { now, kept })).toMatchObject({ status: 422, error: expect.stringMatching(/lobby shows no picture/) });
    expect(await use({ kind: "map", shot: "s123" })).toEqual({ status: 404, error: "No picture saved: that picture is gone." });
    expect(await use({ kind: "map", shot: "newest" })).toMatchObject({ status: 422, error: expect.stringMatching(/^No picture saved: /) });
    expect(await use({ map: "gone", kind: "map", shot: "newest" })).toMatchObject({ status: 404 });
    expect(await use({ kind: "both", shot: "newest" })).toMatchObject({ status: 400 });
    expect(await use({ kind: "map", shot: "../x" })).toMatchObject({ status: 400 });
    expect(shotPath(kept, "../x")).toBeUndefined();
  });
});

describe("publishGamePicture", () => {
  it("publishes the game's picture alone, once, into the store's published catalog", async () => {
    expect(await publishGamePicture(root, { target: "sumo" })).toEqual({ status: 422, error: "Sumo has no picture yet." });
    writeFileSync(join(store, "working", "sumo", "icon.png"), "picture");
    expect(await publishGamePicture(root, { target: "sumo" })).toEqual({ status: 200, message: "The minigame thumbnail for Sumo is published: the lobby shows it from the network's next start." });
    expect(readFileSync(join(store, "published", "catalog", "sumo", "icon.png"), "utf8")).toBe("picture");
    expect(await publishGamePicture(root, { target: "sumo" })).toEqual({ status: 200, message: "The minigame thumbnail for Sumo is published already." });
    const opened = MapStore.open(store);
    try {
      expect(opened.pictureState("sumo")).toBe("published");
      // Pit itself stays unpublished.
      expect(opened.published()).toEqual([]);
    } finally {
      opened.close();
    }
    expect(await publishGamePicture(root, { target: "lobby" })).toMatchObject({ status: 422 });
    expect(await publishGamePicture(root, { target: "../x" })).toMatchObject({ status: 400 });
  });
});

describe("viewerThumbPath", () => {
  it("is the map's preview, or a minigame thumbnail map's game picture, or the one asked for", () => {
    const pit = join(store, "working", "sumo", "pit");
    const icon = join(store, "working", "sumo", "icon.png");
    expect(viewerThumbPath(root, "sumo", "pit")).toBeUndefined();
    writeFileSync(join(pit, "preview.png"), "preview");
    expect(viewerThumbPath(root, "sumo", "pit")).toBe(join(pit, "preview.png"));
    map("pit", { name: "Pit", spawns: [], gameThumbnail: true });
    expect(viewerThumbPath(root, "sumo", "pit")).toBeUndefined();
    writeFileSync(icon, "picture");
    expect(viewerThumbPath(root, "sumo", "pit")).toBe(icon);
    expect(viewerThumbPath(root, "sumo", "pit", "map")).toBe(join(pit, "preview.png"));
    map("pit", { name: "Pit", spawns: [] });
    expect(viewerThumbPath(root, "sumo", "pit", "game")).toBe(icon);
  });
});
