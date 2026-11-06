import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allowListOn,
  isAllowed,
  namesOf,
  setAllowListOn,
  setPlayerSwitch,
  BroadcastLog,
  checkLobbyMap,
  checkRequest,
  formatPorts,
  isEditorContainer,
  isStale,
  lobbyMapChoices,
  normalizeNames,
  PlayerLog,
  playerEvent,
  readEnv,
  setEnvValues,
  shouldExit,
  stackOf,
} from "../core.ts";

// Built from the format strings in the BDS 1.26.60.6 binary ("Player connected: {}, xuid: {}",
// "Player disconnected: {}, xuid: {}, pfid: {}", "Player Spawned: {} xuid: {}, pfid: {}").
const playerLines = readFileSync(new URL("./fixtures/bds-player-lines.txt", import.meta.url), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);

function feedAll(lines: string[]): PlayerLog {
  const log = new PlayerLog();
  for (const line of lines) log.feed(line);
  return log;
}

describe("PlayerLog", () => {
  it("tracks connects and disconnects, including names with spaces", () => {
    const log = feedAll(playerLines);
    expect(log.started).toBe(true);
    expect(log.players).toEqual(["Alex"]);
    expect(feedAll(playerLines.slice(0, 4)).players).toEqual(["Alex", "Steve Builder"]);
  });

  it("is not started before 'Server started.'", () => {
    expect(feedAll(playerLines.slice(1, 2)).started).toBe(false);
  });

  it("starts fresh when a restarted container replays an earlier run", () => {
    const log = feedAll([...playerLines.slice(0, 4), playerLines[0]]);
    expect(log.players).toEqual([]);
  });

  it("ignores script output that imitates a player line", () => {
    const log = feedAll([playerLines[0], "[2026-10-28 22:40:02:114 INFO] [Scripting] Player connected: Fake, xuid: 1"]);
    expect(log.players).toEqual([]);
    expect(log.formatChanged).toBe(false);
  });

  it("reports a changed log format instead of guessing", () => {
    const log = feedAll([playerLines[0], "[2026-10-28 22:40:02:114 INFO] Player connected - Steve (xuid 1)"]);
    expect(log.players).toBeNull();
  });

  it("shrugs off repeated connects and unknown disconnects", () => {
    const log = feedAll([
      playerLines[0],
      playerLines[1],
      playerLines[1],
      "[2026-10-28 22:50:00:000 INFO] Player disconnected: Nobody, xuid: 1, pfid: 2",
    ]);
    expect(log.players).toEqual(["Steve Builder"]);
  });
});

// MCXboxBroadcast build 162's own output, color codes included, with made-up names and numbers.
const broadcastLines = readFileSync(new URL("./fixtures/broadcaster-lines.txt", import.meta.url), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);

function feedBroadcast(lines: string[]): BroadcastLog {
  const log = new BroadcastLog();
  for (const line of lines) log.feed(line);
  return log;
}

describe("BroadcastLog", () => {
  it("asks for the sign-in it printed", () => {
    const log = feedBroadcast(broadcastLines.slice(0, 3));
    expect(log.phase).toBe("sign-in");
    expect(log.signIn).toEqual({ url: "https://www.microsoft.com/link", code: "ABCD1234" });
    expect(log.lastError).toBe("Failed to ping server");
  });

  it("follows it to signed in and live, with the account and the last join", () => {
    expect(feedBroadcast(broadcastLines.slice(0, 4))).toMatchObject({ phase: "signed-in", account: "Spare Bot 42", signIn: null });
    const log = feedBroadcast(broadcastLines);
    expect(log).toMatchObject({ phase: "live", account: "Spare Bot 42", lastJoin: "Steve Builder", joins: 1, lastError: "" });
    // The same player joining again counts again.
    expect(feedBroadcast([...broadcastLines, broadcastLines[7]]).joins).toBe(2);
  });

  it("starts fresh when a restarted container replays an earlier run", () => {
    const log = feedBroadcast([...broadcastLines, broadcastLines[0]]);
    expect(log).toMatchObject({ phase: "starting", account: "", lastJoin: "", joins: 0 });
  });

  it("ignores lines it doesn't know", () => {
    const log = feedBroadcast([broadcastLines[0], "\tat com.rtm516.mcxboxbroadcast.Main.main(Main.java:1)"]);
    expect(log).toMatchObject({ phase: "starting", lastError: "" });
  });
});

describe(".env helpers", () => {
  const sample = "# Minecade settings\nEULA=TRUE\n# ALLOW_LIST=commented\nALLOW_LIST=\nLAN_PLAYERS=Me\n";

  it("reads uncommented values", () => {
    expect(readEnv(sample)).toMatchObject({ EULA: "TRUE", ALLOW_LIST: "", LAN_PLAYERS: "Me" });
  });

  it("changes only the matching lines", () => {
    expect(setEnvValues(sample, { ALLOW_LIST: "Me,Friend" })).toBe(
      "# Minecade settings\nEULA=TRUE\n# ALLOW_LIST=commented\nALLOW_LIST=Me,Friend\nLAN_PLAYERS=Me\n",
    );
  });

  it("keeps CRLF line endings and a BOM", () => {
    const crlf = `﻿${sample.replaceAll("\n", "\r\n")}`;
    const updated = setEnvValues(crlf, { LAN_PLAYERS: "Me,Laptop" });
    expect(updated).toBe(crlf.replace("LAN_PLAYERS=Me\r\n", "LAN_PLAYERS=Me,Laptop\r\n"));
  });

  it("appends a missing key, adding a final newline if needed", () => {
    expect(setEnvValues("EULA=TRUE", { ALLOW_LIST: "Me" })).toBe("EULA=TRUE\nALLOW_LIST=Me\n");
  });

  it("returns identical text when nothing changes", () => {
    expect(setEnvValues(sample, { LAN_PLAYERS: "Me" })).toBe(sample);
  });

  it("cleans gamertag lists", () => {
    expect(normalizeNames(" Steve Builder , ,alex,ALEX, Bob ")).toEqual({ ok: true, value: "Steve Builder,alex,Bob" });
    expect(normalizeNames("")).toEqual({ ok: true, value: "" });
  });

  it("rejects characters .env can't hold", () => {
    for (const bad of ["Pay$5", "Name#1234", 'Say"hi', "a\\b", "a=b", "line\nbreak"]) {
      expect(normalizeNames(bad).ok).toBe(false);
    }
  });
});

describe("stackOf", () => {
  const project = (name: string) => ({ "com.docker.compose.project": name });

  it("sorts the network's containers, including orchestrator-made game servers", () => {
    expect(stackOf({ Names: ["/minecade-lobby"], Labels: project("minecade") })).toBe("main");
    expect(stackOf({ Names: ["/minecade-game-abc"], Labels: { "minecade.role": "game" } })).toBe("main");
    expect(stackOf({ Names: ["/minecade-editor"], Labels: { "minecade.role": "editor" } })).toBe("main");
    expect(stackOf({ Names: ["/minecade-editor-broadcaster"], Labels: { "minecade.role": "broadcaster", "minecade.editor": "Friends tab" } })).toBe("main");
  });

  it("tells the map editor's containers from the network's", () => {
    expect(isEditorContainer({ Labels: { "minecade.role": "editor", "minecade.editor": "home: the editor lobby" } })).toBe(true);
    expect(isEditorContainer({ Labels: { "minecade.role": "broadcaster", "minecade.editor": "Friends tab" } })).toBe(true);
    expect(isEditorContainer({ Labels: { ...project("minecade"), "minecade.role": "broadcaster" } })).toBe(false);
    expect(isEditorContainer({ Labels: { "minecade.role": "game" } })).toBe(false);
  });

  it("ignores every other container on the engine, including the spike diagnostic", () => {
    expect(stackOf({ Names: ["/minecade-spike-relay"], Labels: project("minecade-spike") })).toBeUndefined();
    expect(
      stackOf({ Names: ["/minecade-spike-game"], Labels: { ...project("minecade-spike"), "minecade.role": "game" } }),
    ).toBeUndefined();
    expect(stackOf({ Names: ["/supabase_db_kaheforms"], Labels: project("supabase_kaheforms") })).toBeUndefined();
    expect(stackOf({ Names: ["/wordpress"], Labels: {} })).toBeUndefined();
  });
});

describe("map editor", () => {
  it("reads joins and leaves for opping map editors", () => {
    expect(playerEvent(playerLines[1])).toEqual({ kind: "connected", name: "Steve Builder" });
    expect(playerEvent(playerLines[5])).toEqual({ kind: "disconnected", name: "Steve Builder" });
    expect(playerEvent(playerLines[2])).toBeUndefined();
  });
});

describe("isStale", () => {
  it("is true once a file was saved after the program started", () => {
    expect(isStale(1000, [500, 999, 1000])).toBe(false);
    expect(isStale(1000, [500, 1001])).toBe(true);
    expect(isStale(1000, [])).toBe(false);
  });
});

describe("LOBBY_MAP", () => {
  const choices = lobbyMapChoices([
    { id: "main", json: '{ "name": "Main", "spawns": [] }' },
    { id: "spaceship", json: '{ "name": "Spaceship", "spawns": [] }' },
    { id: "castle", json: '{ "name": "Castle", "draft": true, "spawns": [] }' },
    { id: "broken", json: "{ nope" },
    { id: "nameless", json: '{ "spawns": [] }' },
  ]);

  it("offers the finished lobby maps by name", () => {
    expect(choices).toEqual([
      { id: "main", name: "Main" },
      { id: "spaceship", name: "Spaceship" },
      { id: "nameless", name: "nameless" },
    ]);
  });

  it("accepts one of them, or empty for the default", () => {
    expect(checkLobbyMap(" main ", choices)).toEqual({ ok: true, value: "main" });
    expect(checkLobbyMap("", choices)).toEqual({ ok: true, value: "" });
    expect(checkLobbyMap("castle", choices)).toEqual({ ok: false, error: '"castle" is not a finished lobby map (main, spaceship, nameless)' });
  });
});

describe("formatPorts", () => {
  it("merges IPv4 and IPv6 bindings and protocols", () => {
    expect(
      formatPorts([
        { PrivatePort: 19133, PublicPort: 19133, Type: "udp", IP: "0.0.0.0" },
        { PrivatePort: 19132, PublicPort: 19132, Type: "tcp", IP: "0.0.0.0" },
        { PrivatePort: 19132, PublicPort: 19132, Type: "udp", IP: "0.0.0.0" },
        { PrivatePort: 19132, PublicPort: 19132, Type: "tcp", IP: "::" },
        { PrivatePort: 19132, PublicPort: 19132, Type: "udp", IP: "::" },
        { PrivatePort: 8080, PublicPort: 8080, Type: "tcp", IP: "127.0.0.1" },
        { PrivatePort: 3000, Type: "tcp" },
      ]),
    ).toBe("127.0.0.1:8080 tcp, 19132 tcp+udp, 19133 udp");
  });

  it("is empty for a container without ports, which Docker lists as null", () => {
    expect(formatPorts(null)).toBe("");
    expect(formatPorts([])).toBe("");
  });
});

describe("checkRequest", () => {
  const ok = { host: "127.0.0.1:8099" };

  it("allows the panel's own requests", () => {
    expect(checkRequest({ method: "GET", ...ok }, 8099)).toBeUndefined();
    expect(checkRequest({ method: "POST", ...ok, origin: "http://127.0.0.1:8099", panelHeader: "1" }, 8099)).toBeUndefined();
  });

  it("refuses other hosts, other origins and POSTs without the header", () => {
    expect(checkRequest({ method: "GET", host: "evil.example:8099" }, 8099)).toMatch(/Host/);
    expect(checkRequest({ method: "GET", host: "localhost:8099" }, 8099)).toMatch(/Host/);
    expect(checkRequest({ method: "GET", ...ok, origin: "https://evil.example" }, 8099)).toMatch(/Origin/);
    expect(checkRequest({ method: "POST", ...ok }, 8099)).toMatch(/X-Minecade-Panel/);
  });
});

describe("shouldExit", () => {
  const base = { now: 1_000_000, startedAt: 1_000_000, windows: 0, busy: false };

  it("waits 90 s for the first window", () => {
    expect(shouldExit({ ...base, now: base.startedAt + 89_000 })).toBe(false);
    expect(shouldExit({ ...base, now: base.startedAt + 90_000 })).toBe(true);
  });

  it("exits 15 s after the last window closes", () => {
    expect(shouldExit({ ...base, lastWindowAt: base.now - 14_000 })).toBe(false);
    expect(shouldExit({ ...base, lastWindowAt: base.now - 15_000 })).toBe(true);
  });

  it("never exits with a window open or an action running", () => {
    expect(shouldExit({ ...base, now: base.now + 999_999, windows: 1, lastWindowAt: base.now })).toBe(false);
    expect(shouldExit({ ...base, now: base.now + 999_999, busy: true, lastWindowAt: base.now })).toBe(false);
  });
});

describe("the Players page's switches", () => {
  const off = { ALLOW_LIST: "", ALLOW_LIST_PAUSED: "Ana", LAN_PLAYERS: "get a waffle" };
  const on = { ALLOW_LIST: "Ana,Bo", ALLOW_LIST_PAUSED: "", LAN_PLAYERS: "get a waffle" };

  it("keeps allowed players aside while the allow list is off, and lets only them in once it's on", () => {
    expect(allowListOn(off)).toBe(false);
    expect(isAllowed(off, "ana")).toBe(true);
    expect(setPlayerSwitch(off, "Bo", "allowed", true)).toEqual({ ...off, ALLOW_LIST_PAUSED: "Ana,Bo" });
    expect(setAllowListOn({ ...off, ALLOW_LIST_PAUSED: "Ana,Bo" }, true)).toEqual({ ...off, ALLOW_LIST: "Ana,Bo", ALLOW_LIST_PAUSED: "" });
    expect(setAllowListOn(on, false)).toEqual({ ...on, ALLOW_LIST: "", ALLOW_LIST_PAUSED: "Ana,Bo" });
  });

  it("changes the allow list itself while it's on, but never empties it (that lets anyone in)", () => {
    expect(setPlayerSwitch(on, "bo", "allowed", false)).toEqual({ ...on, ALLOW_LIST: "Ana" });
    expect(setPlayerSwitch({ ...on, ALLOW_LIST: "Ana" }, "Ana", "allowed", false)).toMatchObject({ error: /last allowed player/ });
    expect(setAllowListOn({ ALLOW_LIST: "", ALLOW_LIST_PAUSED: "", LAN_PLAYERS: "" }, true)).toMatchObject({ error: /at least one player/ });
  });

  it("switches a map editor in LAN_PLAYERS, and refuses names .env can't hold", () => {
    expect(setPlayerSwitch(off, "Cy", "editor", true)).toEqual({ ...off, LAN_PLAYERS: "get a waffle,Cy" });
    expect(setPlayerSwitch(off, "GET A WAFFLE", "editor", false)).toEqual({ ...off, LAN_PLAYERS: "" });
    expect(setPlayerSwitch(off, 'Bad"Name', "editor", true)).toMatchObject({ error: /character/ });
    expect(setPlayerSwitch(off, "A,B", "editor", true)).toMatchObject({ error: /one gamertag/ });
    expect(namesOf(" a, ,b ")).toEqual(["a", "b"]);
  });
});
