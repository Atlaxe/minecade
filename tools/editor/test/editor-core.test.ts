import { describe, expect, it } from "vitest";
import type { MapConfig } from "@minecade/minigame-core/config";
import type { RecentEntry } from "@minecade/minigame-core/config";
import {
  History,
  SLOTS,
  addRecent,
  editorPlayers,
  nameList,
  newMapConfig,
  parseArgs,
  parseRecent,
  planOpen,
  portHolders,
  withLineEndings,
} from "../editor-core.ts";

describe("parseArgs", () => {
  it("boots, and opens a map or a world when given one", () => {
    expect(parseArgs([])).toEqual({ command: "boot", verbose: false });
    expect(parseArgs(["--verbose"])).toEqual({ command: "boot", verbose: true });
    expect(parseArgs(["sumo", "arena_1"])).toEqual({ command: "boot", open: { to: "edit", target: "sumo", map: "arena_1" }, verbose: false });
    expect(parseArgs(["sumo", "castle_keep", "--new", "--verbose"])).toEqual({
      command: "boot",
      open: { to: "edit", target: "sumo", map: "castle_keep", fresh: { name: "Castle Keep" } },
      verbose: true,
    });
    expect(parseArgs(["select", "Datapacking", "(imported)"])).toEqual({ command: "boot", open: { to: "select", world: "Datapacking (imported)" }, verbose: false });
    expect(parseArgs(["select"])).toMatchObject({ command: "help", error: expect.stringContaining("select needs a world") });
  });

  it("reads status, save, stop and help", () => {
    expect(parseArgs(["stop"])).toEqual({ command: "stop" });
    expect(parseArgs(["save"])).toEqual({ command: "save" });
    expect(parseArgs(["publish"])).toEqual({ command: "publish" });
    expect(parseArgs(["preview"])).toEqual({ command: "preview" });
    expect(parseArgs(["preview", "end"])).toEqual({ command: "endPreview" });
    expect(parseArgs(["status"])).toEqual({ command: "status" });
    expect(parseArgs(["--help"])).toEqual({ command: "help" });
  });

  it("refuses odd input", () => {
    expect(parseArgs(["sumo"])).toMatchObject({ command: "help", error: "expected a target and a map" });
    expect(parseArgs(["sumo", "Arena 1"])).toMatchObject({ command: "help" });
    expect(parseArgs(["sumo", "../x"])).toMatchObject({ command: "help" });
    expect(parseArgs(["sumo", "a", "--force"])).toMatchObject({ command: "help", error: "unknown option --force" });
  });
});

describe("the three servers", () => {
  it("take the network's ports, each with the identity players trust there", () => {
    expect(Object.values(SLOTS).map((slot) => [slot.port, slot.identity])).toEqual([
      [19132, "lobby"],
      [19133, "game"],
      [19134, "editor"],
    ]);
  });

  it("move players to what's open already, and restart for anything else", () => {
    const arena = { key: "edit:sumo/arena_1", state: "ready" as const, players: ["a", "b"] };
    expect(planOpen("edit", "edit:sumo/arena_1", arena)).toEqual({ slot: "edit", restart: false, evict: [] });
    expect(planOpen("edit", "edit:sumo/arena_1", { ...arena, state: "starting" })).toEqual({ slot: "edit", restart: false, evict: [] });
    expect(planOpen("edit", "edit:sumo/castle", arena)).toEqual({ slot: "edit", restart: true, evict: ["a", "b"] });
    // Stopping or failed: it starts again, and nobody is left on it to move.
    expect(planOpen("edit", "edit:sumo/arena_1", { ...arena, state: "stopping", players: [] })).toEqual({ slot: "edit", restart: true, evict: [] });
    expect(planOpen("select", "select:abc=", undefined)).toEqual({ slot: "select", restart: true, evict: [] });
  });

  it("names whatever holds their ports", () => {
    const listed = [
      { Names: ["/minecade-lobby"], State: "running", Ports: [{ PublicPort: 19132 }, { PublicPort: 19132 }, { PublicPort: 8080 }] },
      { Names: ["/minecade-game-abc"], State: "running", Ports: [{ PublicPort: 19133 }] },
      { Names: ["/old"], State: "exited", Ports: [{ PublicPort: 19134 }] },
      { Names: ["/orchestrator"], State: "running", Ports: [{}] },
      { Names: ["/no-network"], State: "running", Ports: null },
    ];
    expect(portHolders(listed, [19132, 19133, 19134])).toEqual(["minecade-lobby (19132)", "minecade-game-abc (19133)"]);
  });
});

describe("recent maps and worlds", () => {
  const arena: RecentEntry = { request: { to: "edit", target: "sumo", map: "arena_1" }, label: "Sumo: Arena (arena_1)" };
  const world: RecentEntry = { request: { to: "select", world: "abc=" }, label: "Datapacking (imported)" };

  it("puts the newest first, once, and keeps a few", () => {
    expect(addRecent([arena], world)).toEqual([world, arena]);
    expect(addRecent([world, arena], { ...arena, label: "renamed" })).toEqual([{ ...arena, label: "renamed" }, world]);
    let list: RecentEntry[] = [];
    for (let i = 0; i < 9; i++) list = addRecent(list, { request: { to: "edit", target: "sumo", map: `m${i}` }, label: `m${i}` });
    expect(list.map((entry) => entry.label)).toEqual(["m8", "m7", "m6", "m5", "m4"]);
  });

  it("reads the file, skipping what doesn't fit", () => {
    expect(parseRecent(JSON.stringify([arena, { label: "x" }, world, { request: { to: "home" }, label: "home" }]))).toEqual([arena, world]);
    expect(parseRecent("not json")).toEqual([]);
  });
});

describe("who can join", () => {
  it("lets in LAN players, each a map editor, and nobody else", () => {
    expect(editorPlayers({ LAN_PLAYERS: "get a waffle, Friend,friend ", EDITOR_ALLOW_LIST: "Builder", MAP_EDITORS: "Builder" })).toEqual(["get a waffle", "Friend"]);
    expect(nameList(" , ,")).toEqual([]);
  });
});

describe("History", () => {
  const map = (n: number): MapConfig => ({ name: `v${n}`, spawns: [] });

  it("undoes and redoes whole maps, and a new change clears redo", () => {
    const history = new History();
    history.record(map(0), "first");
    history.record(map(1), "second");
    expect(history.undoLabel).toBe("second");
    expect(history.undo(map(2))).toEqual({ config: map(1), label: "second" });
    expect(history.redoLabel).toBe("second");
    expect(history.redo(map(1))).toEqual({ config: map(2), label: "second" });
    expect(history.undo(map(2))?.config).toEqual(map(1));
    history.record(map(1), "third");
    expect(history.redoLabel).toBeUndefined();
    expect(history.undo(map(3))?.label).toBe("third");
    expect(history.undo(map(1))?.label).toBe("first");
    expect(history.undo(map(0))).toBeUndefined();
  });

  it("keeps a limited number of steps", () => {
    const history = new History(2);
    for (let n = 0; n < 5; n++) history.record(map(n), `step ${n}`);
    expect(history.undo(map(5))?.label).toBe("step 4");
    expect(history.undo(map(4))?.label).toBe("step 3");
    expect(history.undo(map(3))).toBeUndefined();
  });
});

describe("map files", () => {
  it("keeps a file's CRLF line endings", () => {
    expect(withLineEndings('{\n  "a": 1\n}\n', '{\r\n}\r\n')).toBe('{\r\n  "a": 1\r\n}\r\n');
    expect(withLineEndings('{\n}\n', "{\n}\n")).toBe("{\n}\n");
    expect(withLineEndings('{\n}\n', undefined)).toBe("{\n}\n");
  });

  it("names a new map after its id", () => {
    expect(newMapConfig("castle_keep")).toEqual({ name: "Castle Keep", draft: true, spawns: [[0, 65, 0]] });
    expect(newMapConfig("castle_keep", " The Keep ").name).toBe("The Keep");
  });
});
