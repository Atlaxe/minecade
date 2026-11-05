// The map store: versions of a map's working folder (kept once each, files shared by content),
// publishing, renames, deletes, restores, backups, the published folder the build reads, and the
// import out of a git checkout.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importCheckout } from "../import.ts";
import { KEEP_SAVES, MapStore } from "../store.ts";

let dir: string;
let store: MapStore;
let clock: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minecade-maps-test-"));
  clock = Date.UTC(2026, 10, 5, 12, 0, 0);
  store = MapStore.open(join(dir, "store"), { now: () => (clock += 1000) });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Writes a map's working folder: map.json and a world with one log. */
function writeMap(target: string, map: string, name: string, log = "log 1"): string {
  const folder = store.folder(target, map);
  mkdirSync(join(folder, "world", "db"), { recursive: true });
  writeFileSync(join(folder, "map.json"), `{ "name": "${name}" }\n`);
  writeFileSync(join(folder, "world", "level.dat"), "level");
  writeFileSync(join(folder, "world", "db", "000001.log"), log);
  return folder;
}

describe("a map's versions", () => {
  it("are kept when the folder changed, and share the files that didn't", () => {
    const folder = writeMap("sumo", "pit", "Pit");
    expect(store.saveVersion("sumo", "pit", "save", "Ana")).toEqual({ version: 1, created: true });
    expect(store.saveVersion("sumo", "pit", "save")).toEqual({ version: 1, created: false });
    writeFileSync(join(folder, "world", "db", "000002.log"), "log 2");
    expect(store.saveVersion("sumo", "pit", "save")).toEqual({ version: 2, created: true });
    const versions = store.versions("sumo", "pit");
    expect(versions.map((version) => [version.n, version.files, version.by])).toEqual([
      [2, 4, undefined],
      [1, 3, "Ana"],
    ]);
  });

  it("leave out a world save's half-written copy", () => {
    const folder = writeMap("sumo", "pit", "Pit");
    mkdirSync(join(folder, "world.new"));
    writeFileSync(join(folder, "world.new", "level.dat"), "half");
    store.saveVersion("sumo", "pit", "save");
    expect(store.versions("sumo", "pit")[0].files).toBe(3);
  });

  it("need a map.json", () => {
    mkdirSync(store.folder("sumo", "empty"), { recursive: true });
    expect(() => store.saveVersion("sumo", "empty", "save")).toThrow(/no map.json/);
  });

  it("keep every publish and the newest saves", () => {
    const folder = writeMap("sumo", "pit", "Pit");
    store.publish("sumo", "pit");
    for (let i = 0; i < KEEP_SAVES + 5; i++) {
      writeFileSync(join(folder, "world", "db", "000001.log"), `log ${i}`);
      store.saveVersion("sumo", "pit", "save");
    }
    const versions = store.versions("sumo", "pit");
    expect(versions).toHaveLength(KEEP_SAVES + 1);
    expect(versions.at(-1)).toMatchObject({ n: 1, kind: "publish", published: true });
    store.exportPublished();
    expect(readFileSync(join(store.dir, "published", "sumo", "pit", "world", "db", "000001.log"), "utf8")).toBe("log 1");
  });
});

describe("publishing", () => {
  it("points the map at its folder as it is, once", () => {
    const folder = writeMap("sumo", "pit", "Pit");
    expect(store.isUnpublished("sumo", "pit")).toBe(true);
    expect(store.publish("sumo", "pit", "Ana")).toEqual({ outcome: "published", version: 1 });
    expect(store.isUnpublished("sumo", "pit")).toBe(false);
    expect(store.publish("sumo", "pit")).toEqual({ outcome: "unchanged", version: 1 });
    writeFileSync(join(folder, "map.json"), '{ "name": "Pit 2" }\n');
    expect(store.isUnpublished("sumo", "pit")).toBe(true);
    expect(store.publish("sumo", "pit")).toEqual({ outcome: "published", version: 2 });
    expect(store.published()).toEqual([{ target: "sumo", map: "pit", version: 2 }]);
  });

  it("publishes the game's picture with it, and only a changed one counts", () => {
    writeMap("sumo", "pit", "Pit");
    store.publish("sumo", "pit");
    writeFileSync(store.icon("sumo"), "picture 1");
    expect(store.publish("sumo", "pit").outcome).toBe("published");
    expect(store.publish("sumo", "pit").outcome).toBe("unchanged");
    store.exportPublished();
    expect(readFileSync(join(store.dir, "published", "sumo", "icon.png"), "utf8")).toBe("picture 1");
  });

  it("backs up the database each time, keeping the newest", () => {
    writeMap("sumo", "pit", "Pit");
    store.publish("sumo", "pit");
    writeMap("sumo", "pit", "Pit 2");
    store.publish("sumo", "pit");
    const backups = readdirSync(join(store.dir, "backups"));
    expect(backups).toHaveLength(2);
    expect(backups.every((name) => /^maps-20261105-1200\d\d\.db$/.test(name))).toBe(true);
  });

  it("writes the published folder whole, without drafts nobody published", () => {
    writeMap("sumo", "pit", "Pit");
    writeMap("sumo", "draft", "Draft");
    writeMap("lobby", "spaceship", "Spaceship");
    store.publish("sumo", "pit");
    store.publish("lobby", "spaceship");
    store.saveVersion("sumo", "draft", "save");
    mkdirSync(join(store.dir, "published", "stale"), { recursive: true });
    expect(store.exportPublished()).toEqual({ maps: 2, icons: 0 });
    const published = join(store.dir, "published");
    expect(readdirSync(published).sort()).toEqual(["lobby", "sumo"]);
    expect(readdirSync(join(published, "sumo"))).toEqual(["pit"]);
    expect(readFileSync(join(published, "sumo", "pit", "map.json"), "utf8")).toBe('{ "name": "Pit" }\n');
  });
});

describe("a map given another id", () => {
  it("keeps its history and stays published under its old id until its next Publish", () => {
    const folder = writeMap("sumo", "pit", "Pit");
    store.publish("sumo", "pit");
    renameSync(folder, store.folder("sumo", "crater"));
    store.rename("sumo", "pit", "crater");
    expect(store.published()).toEqual([{ target: "sumo", map: "pit", version: 1 }]);
    expect(store.isUnpublished("sumo", "crater")).toBe(true);
    expect(store.versions("sumo", "crater")).toHaveLength(1);
    store.publish("sumo", "crater");
    expect(store.published()).toEqual([{ target: "sumo", map: "crater", version: 1 }]);
  });

  it("takes the published id from the map it was renamed from when a new map publishes it", () => {
    const folder = writeMap("sumo", "pit", "Pit");
    store.publish("sumo", "pit");
    renameSync(folder, store.folder("sumo", "crater"));
    store.rename("sumo", "pit", "crater");
    writeMap("sumo", "pit", "New pit");
    store.publish("sumo", "pit");
    expect(store.published()).toEqual([{ target: "sumo", map: "pit", version: 1 }]);
    store.exportPublished();
    expect(readFileSync(join(store.dir, "published", "sumo", "pit", "map.json"), "utf8")).toContain("New pit");
  });
});

describe("deleting a map", () => {
  it("takes its folder and its publish, and keeps its versions for a map of that id made later", () => {
    writeMap("sumo", "pit", "Pit");
    store.publish("sumo", "pit");
    expect(store.remove("sumo", "pit")).toEqual({ published: true });
    expect(existsSync(store.folder("sumo", "pit"))).toBe(false);
    expect(store.published()).toEqual([]);
    expect(store.versions("sumo", "pit")).toEqual([]);
    writeMap("sumo", "pit", "Pit again");
    expect(store.saveVersion("sumo", "pit", "save")).toEqual({ version: 1, created: true });
  });

  it("of a draft nobody saved only takes its folder", () => {
    writeMap("sumo", "fresh", "Fresh");
    expect(store.remove("sumo", "fresh")).toEqual({ published: false });
  });
});

describe("restoring a version", () => {
  it("puts it back in the working folder, keeping what was there", () => {
    const folder = writeMap("sumo", "pit", "Pit", "first");
    store.saveVersion("sumo", "pit", "save");
    writeFileSync(join(folder, "world", "db", "000001.log"), "second");
    writeFileSync(join(folder, "extra.txt"), "gone after the restore");
    store.restore("sumo", "pit", 1);
    expect(readFileSync(join(folder, "world", "db", "000001.log"), "utf8")).toBe("first");
    expect(existsSync(join(folder, "extra.txt"))).toBe(false);
    expect(store.versions("sumo", "pit").map((version) => version.n)).toEqual([2, 1]);
    expect(() => store.restore("sumo", "pit", 9)).toThrow(/no version 9/);
  });
});

describe("importing a git checkout", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

  it("publishes what HEAD has and keeps the working copy, drafts and changed pictures too", async () => {
    const checkout = join(dir, "checkout");
    mkdirSync(join(checkout, "lobby", "maps", "spaceship", "world"), { recursive: true });
    mkdirSync(join(checkout, "games", "sumo", "maps", "pit", "world"), { recursive: true });
    writeFileSync(join(checkout, "lobby", "maps", "spaceship", "map.json"), '{ "name": "Spaceship" }\r\n');
    writeFileSync(join(checkout, "lobby", "maps", "spaceship", "world", "level.dat"), "lobby");
    writeFileSync(join(checkout, "games", "sumo", "maps", "pit", "map.json"), '{ "name": "Pit" }\n');
    writeFileSync(join(checkout, "games", "sumo", "maps", "pit", "world", "level.dat"), "pit");
    writeFileSync(join(checkout, "games", "sumo", "icon.png"), "picture 1");
    git(dir, "init", "--quiet", "-b", "main", checkout);
    git(checkout, "-c", "core.autocrlf=false", "add", "--all");
    git(checkout, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "maps");
    // Not committed: a draft, a changed world and a new picture.
    mkdirSync(join(checkout, "games", "sumo", "maps", "draft"), { recursive: true });
    writeFileSync(join(checkout, "games", "sumo", "maps", "draft", "map.json"), '{ "name": "Draft", "draft": true }\n');
    writeFileSync(join(checkout, "games", "sumo", "maps", "pit", "world", "level.dat"), "pit, changed");
    writeFileSync(join(checkout, "games", "sumo", "icon.png"), "picture 2");

    const result = await importCheckout(store, checkout);
    expect(result.maps).toEqual(["lobby/spaceship", "sumo/draft", "sumo/pit"]);
    expect(result.published).toEqual(["lobby/spaceship", "sumo/pit"]);
    expect(store.isUnpublished("lobby", "spaceship")).toBe(false);
    expect(store.isUnpublished("sumo", "pit")).toBe(true);
    expect(store.isUnpublished("sumo", "draft")).toBe(true);
    expect(readFileSync(join(store.folder("sumo", "pit"), "world", "level.dat"), "utf8")).toBe("pit, changed");
    expect(readFileSync(store.icon("sumo"), "utf8")).toBe("picture 2");
    store.exportPublished();
    const published = join(store.dir, "published");
    expect(readFileSync(join(published, "sumo", "pit", "world", "level.dat"), "utf8")).toBe("pit");
    expect(readFileSync(join(published, "sumo", "icon.png"), "utf8")).toBe("picture 1");
    expect(readFileSync(join(published, "lobby", "spaceship", "map.json"), "utf8")).toBe('{ "name": "Spaceship" }\r\n');

    const again = await importCheckout(store, checkout);
    expect(again.maps).toEqual([]);
    expect(again.skipped).toEqual(["lobby/spaceship", "sumo/draft", "sumo/pit"]);
  });
});
