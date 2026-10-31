import { describe, expect, it } from "vitest";
import type { MapConfig } from "@minecade/minigame-core/config";
import { History, editorAllowList, mapEditors, nameList, newMapConfig, parseArgs, withLineEndings } from "../editor-core.ts";

describe("parseArgs", () => {
  it("reads edit, status and stop", () => {
    expect(parseArgs(["sumo", "arena_1"])).toEqual({ command: "edit", target: "sumo", map: "arena_1", fresh: false, verbose: false });
    expect(parseArgs(["sumo", "test", "--new", "--verbose"])).toMatchObject({ command: "edit", fresh: true, verbose: true });
    expect(parseArgs(["stop"])).toEqual({ command: "stop" });
    expect(parseArgs(["save"])).toEqual({ command: "save" });
    expect(parseArgs(["select", "Datapacking", "(imported)"])).toEqual({ command: "select", world: "Datapacking (imported)", verbose: false });
    expect(parseArgs(["select"])).toMatchObject({ command: "help", error: expect.stringContaining("select needs a world") });
    expect(parseArgs([])).toEqual({ command: "help" });
  });

  it("refuses odd input", () => {
    expect(parseArgs(["sumo"])).toMatchObject({ command: "help", error: "expected a target and a map" });
    expect(parseArgs(["sumo", "Arena 1"])).toMatchObject({ command: "help" });
    expect(parseArgs(["sumo", "../x"])).toMatchObject({ command: "help" });
    expect(parseArgs(["sumo", "a", "--force"])).toMatchObject({ command: "help", error: "unknown option --force" });
  });
});

describe("access lists", () => {
  const env = { LAN_PLAYERS: "get a waffle, Friend", EDITOR_ALLOW_LIST: "friend,Builder ", MAP_EDITORS: "" };

  it("lets in LAN players and the editor allow list", () => {
    expect(editorAllowList(env)).toEqual(["get a waffle", "Friend", "Builder"]);
  });

  it("makes LAN players the map editors unless MAP_EDITORS names them", () => {
    expect(mapEditors(env)).toEqual(["get a waffle", "Friend"]);
    expect(mapEditors({ ...env, MAP_EDITORS: "Builder" })).toEqual(["Builder"]);
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
  });
});
