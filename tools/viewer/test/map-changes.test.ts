import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nbt from "prismarine-nbt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeLevelDat } from "../../build/leveldat.ts";
import type { EditorStatus } from "../../editor/editor-core.ts";
import { MapStore } from "../../maps/store.ts";
import { MapChanges, type EditorLink } from "../map-changes.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const LEVEL_DAT = encodeLevelDat({ storageVersion: 10, root: { ...nbt.comp({ LevelName: nbt.string("Test") }), name: "" } as nbt.NBT });
let store: string;
const before = process.env.MAP_STORE;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "minecade-viewer-changes-"));
  process.env.MAP_STORE = store;
});
afterEach(() => {
  if (before === undefined) delete process.env.MAP_STORE;
  else process.env.MAP_STORE = before;
  rmSync(store, { recursive: true, force: true });
});

/** A lobby map in the store's working folder, with a world. */
function lobbyMap(map: string, text: string): string {
  const dir = join(store, "working", "lobby", map);
  mkdirSync(join(dir, "world", "db"), { recursive: true });
  writeFileSync(join(dir, "world", "level.dat"), LEVEL_DAT);
  writeFileSync(join(dir, "world", "db", "000001.log"), "log");
  writeFileSync(join(dir, "map.json"), text);
  return join(dir, "map.json");
}

/** No map editor running. */
const NO_EDITOR: EditorLink = {
  status: async () => undefined,
  change: async () => ({ status: 0, answer: { error: "no map editor is running" } }),
  save: async () => ({ ok: false, error: "no map editor is running" }),
  publish: async () => ({ ok: false, error: "no map editor is running" }),
};

/** A map editor with `open` in Edit, answering changes with `reply`. */
function editor(open: { target: string; map: string } | undefined, reply: (path: string, body: Record<string, unknown>) => { status: number; answer: Record<string, unknown> }): EditorLink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    status: async () => ({ edit: open ? { ...open, state: "ready" } : undefined }) as unknown as EditorStatus,
    change: async (path, body) => {
      calls.push(path);
      return reply(path, body);
    },
    save: async () => (calls.push("save"), { ok: true }),
    publish: async () => (calls.push("publish"), { ok: true }),
  };
}

describe("MapChanges without game Edit", () => {
  it("writes each edit to map.json as game Edit does, with the file's line endings", async () => {
    const path = lobbyMap("hub", '{\r\n  "name": "Hub",\r\n  "spawns": []\r\n}\r\n');
    const changes = new MapChanges(root, NO_EDITOR);
    const answer = await changes.edit("lobby", "hub", { op: "add", target: { list: "spawns" }, at: [1, 64, 2] });
    expect(answer).toMatchObject({ status: 200, via: "panel", config: { spawns: [[1, 64, 2]] }, undo: "add spawns (Map viewer)" });
    const text = readFileSync(path, "utf8");
    expect(text).toContain("\r\n");
    expect(JSON.parse(text).spawns).toEqual([[1, 64, 2]]);
    if (answer.status === 200) expect(answer.stamp).toMatch(/^[0-9a-f]{12}$/);
  });

  it("undoes and redoes, and counts a change made elsewhere as a step", async () => {
    const path = lobbyMap("hub", '{ "name": "Hub", "spawns": [] }\n');
    const changes = new MapChanges(root, NO_EDITOR);
    await changes.edit("lobby", "hub", { op: "add", target: { list: "spawns" }, at: [1, 64, 2] });
    // Someone edits map.json by hand.
    writeFileSync(path, JSON.stringify({ name: "Hub!", spawns: [[1, 64, 2]] }));
    await changes.edit("lobby", "hub", { op: "remove", target: { list: "spawns" }, index: 0 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ name: "Hub!", spawns: [] });
    expect(await changes.step("lobby", "hub", "undo")).toMatchObject({ status: 200, note: "Undid: remove spawns 1 (Map viewer)", config: { name: "Hub!", spawns: [[1, 64, 2]] } });
    expect(await changes.step("lobby", "hub", "undo")).toMatchObject({ status: 200, note: "Undid: a change made elsewhere", config: { name: "Hub" } });
    expect(await changes.step("lobby", "hub", "undo")).toMatchObject({ status: 200, config: { spawns: [] } });
    expect(await changes.step("lobby", "hub", "undo")).toMatchObject({ status: 409, error: "Nothing to undo." });
    expect(await changes.step("lobby", "hub", "redo")).toMatchObject({ status: 200, config: { spawns: [[1, 64, 2]] } });
  });

  it("refuses edits that don't fit, bad ones, and missing maps", async () => {
    lobbyMap("hub", '{ "name": "Hub", "spawns": [] }\n');
    const changes = new MapChanges(root, NO_EDITOR);
    expect(await changes.edit("lobby", "hub", { op: "remove", target: { list: "spawns" }, index: 0 })).toMatchObject({ status: 422, error: /no entry 1/, config: { name: "Hub" } });
    expect(await changes.edit("lobby", "hub", { op: "camera", name: "X" })).toMatchObject({ status: 400 });
    expect(await changes.edit("lobby", "hub", { op: "stars", on: true })).toMatchObject({ status: 200 });
    expect(await changes.edit("lobby", "hub", { op: "queue", mode: "free" })).toMatchObject({ status: 422, error: /queue spawn first/ });
    expect(await changes.edit("lobby", "nowhere", { op: "killY", y: 1 })).toMatchObject({ status: 404 });
    expect(await changes.edit("..", "hub", { op: "killY", y: 1 })).toMatchObject({ status: 400 });
  });

  it("keeps game Edit's rules: a Build Swap plot under 24 blocks each way isn't saved", async () => {
    const dir = join(store, "working", "buildswap", "roman");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "map.json"), '{ "name": "Roman", "spawns": [] }\n');
    const changes = new MapChanges(root, NO_EDITOR);
    expect(await changes.edit("buildswap", "roman", { op: "addRegion", name: "plot", box: { min: [0, 0, 0], max: [10, 30, 30] } })).toMatchObject({ status: 422, error: /at least 24 blocks/ });
    expect(readFileSync(join(dir, "map.json"), "utf8")).toBe('{ "name": "Roman", "spawns": [] }\n');
    expect(await changes.edit("buildswap", "roman", { op: "addRegion", name: "plot", box: { min: [0, 0, 0], max: [23, 23, 23] } })).toMatchObject({ status: 200 });
  });

  it("saves a version, and publishes once the checklist is done, no longer a draft", async () => {
    const path = lobbyMap("hub", JSON.stringify({ name: "Hub", draft: true, spawns: [] }));
    const changes = new MapChanges(root, NO_EDITOR);
    expect(await changes.save("lobby", "hub")).toEqual({ status: 200, message: "Saved as version 1." });
    expect(await changes.save("lobby", "hub")).toEqual({ status: 200, message: "No changes since version 1." });
    expect(await changes.publish("lobby", "hub")).toMatchObject({ status: 409, error: /Not ready to publish/ });
    writeFileSync(path, JSON.stringify({ name: "Hub", draft: true, spawns: [[0, 64, 0]], points: { terminal: [[1, 64, 1]] } }));
    const published = await changes.publish("lobby", "hub");
    expect(published).toMatchObject({ status: 200, message: "Hub is published (version 2). The Panel's lobby map picker has it." });
    expect(JSON.parse(readFileSync(path, "utf8")).draft).toBeUndefined();
    expect(await changes.publish("lobby", "hub")).toMatchObject({ status: 200, message: /no changes since it was last published \(version 2\)/ });
    const maps = MapStore.open(store);
    try {
      expect(maps.published()).toEqual([{ target: "lobby", map: "hub", version: 2 }]);
    } finally {
      maps.close();
    }
  });
});

describe("MapChanges with game Edit", () => {
  it("sends changes to the map Edit has open, and writes nothing itself", async () => {
    const path = lobbyMap("hub", '{ "name": "Hub", "spawns": [] }\n');
    const link = editor({ target: "lobby", map: "hub" }, (route) => ({ status: 200, answer: { config: { name: "Hub", spawns: [[5, 5, 5]] }, undo: "add spawns (Map viewer)", ...(route === "/undo" ? { note: "Undid: x" } : {}) } }));
    const changes = new MapChanges(root, link);
    expect(await changes.edit("lobby", "hub", { op: "add", target: { list: "spawns" }, at: [5, 5, 5] })).toMatchObject({ status: 200, via: "editor", undo: "add spawns (Map viewer)" });
    expect(await changes.step("lobby", "hub", "undo")).toMatchObject({ status: 200, via: "editor", note: "Undid: x" });
    expect(readFileSync(path, "utf8")).toBe('{ "name": "Hub", "spawns": [] }\n');
    expect(await changes.save("lobby", "hub")).toMatchObject({ status: 202 });
    expect(await changes.publish("lobby", "hub")).toMatchObject({ status: 202 });
    expect(link.calls).toEqual(["/edit", "/undo", "save", "publish"]);
  });

  it("changes the map itself when Edit has another one open", async () => {
    const path = lobbyMap("hub", '{ "name": "Hub", "spawns": [] }\n');
    const changes = new MapChanges(root, editor({ target: "lobby", map: "other" }, () => ({ status: 409, answer: { notOpen: true, error: "Edit doesn't have that map open" } })));
    expect(await changes.edit("lobby", "hub", { op: "killY", y: 10 })).toMatchObject({ status: 200, via: "panel" });
    expect(JSON.parse(readFileSync(path, "utf8")).killY).toBe(10);
  });

  it("says why when Edit is busy, refuses the change, or runs older code with the map open", async () => {
    lobbyMap("hub", '{ "name": "Hub", "spawns": [] }\n');
    const busy = new MapChanges(root, editor({ target: "lobby", map: "hub" }, () => ({ status: 409, answer: { error: "game Edit is still opening this map" } })));
    expect(await busy.edit("lobby", "hub", { op: "killY", y: 10 })).toMatchObject({ status: 409, error: /still opening/ });
    const refused = new MapChanges(root, editor({ target: "lobby", map: "hub" }, () => ({ status: 422, answer: { error: "there is no entry 1" } })));
    expect(await refused.edit("lobby", "hub", { op: "remove", target: { list: "spawns" }, index: 0 })).toMatchObject({ status: 422, error: "there is no entry 1", config: { name: "Hub" } });
    const old = new MapChanges(root, editor({ target: "lobby", map: "hub" }, () => ({ status: 404, answer: { error: "not found" } })));
    expect(await old.edit("lobby", "hub", { op: "killY", y: 10 })).toMatchObject({ status: 409, error: /older than the viewer/ });
    const oldOther = new MapChanges(root, editor({ target: "lobby", map: "other" }, () => ({ status: 404, answer: { error: "not found" } })));
    expect(await oldOther.edit("lobby", "hub", { op: "killY", y: 10 })).toMatchObject({ status: 200, via: "panel" });
  });

  it("says why there's nothing to undo in game Edit when the change was made before Edit opened the map", async () => {
    const path = lobbyMap("hub", '{ "name": "Hub", "spawns": [] }\n');
    let open = false;
    const link = editor({ target: "lobby", map: "hub" }, () =>
      !open ? { status: 409, answer: { notOpen: true, error: "Edit doesn't have that map open" } } : { status: 422, answer: { error: "Nothing to undo." } },
    );
    const changes = new MapChanges(root, link);
    // Edit is still opening the map: the Panel writes the change.
    expect(await changes.edit("lobby", "hub", { op: "killY", y: 10 })).toMatchObject({ status: 200, via: "panel" });
    open = true;
    // It's Edit's starting point now: the Panel leaves it, and says so.
    expect(await changes.step("lobby", "hub", "undo")).toMatchObject({ status: 422, error: /before it opened this map/ });
    expect(JSON.parse(readFileSync(path, "utf8")).killY).toBe(10);
  });
});
