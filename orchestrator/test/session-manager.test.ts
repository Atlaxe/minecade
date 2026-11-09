import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type OutboundEvent } from "@minecade/minigame-core/protocol";
import { cleanPicks, cleanSettings, PREPARED_MS } from "../src/session-manager.ts";
import { SERVER_STARTED_LINE, setupSessions } from "./fakes.ts";

const ready: OutboundEvent = { t: "server_ready", protocol: PROTOCOL_VERSION, role: "game", transport: "http", sessionId: "s1" };
const startRequest = { requestId: "r1", game: "probe", map: "default", players: ["Steve", "Alex"] };

beforeEach(() => {
  vi.useFakeTimers();
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function startAndReady(t: ReturnType<typeof setupSessions>) {
  const result = await t.sessions.start(startRequest);
  const handle = t.docker.handles[0];
  const link = t.links[0];
  handle.console.emit(SERVER_STARTED_LINE);
  link.emit(ready);
  return { result, handle, link };
}

const types = (t: ReturnType<typeof setupSessions>) => t.lobby.map((message) => message.t);

const statsPart = {
  t: "match_stats" as const,
  sessionId: "s1",
  matchId: "s1.1",
  part: 1,
  parts: 1,
  game: "probe",
  map: "default",
  mode: "solo" as const,
  durationSec: 30,
};

describe("SessionManager: starting", () => {
  it("starts the game container and tells the lobby", async () => {
    const t = setupSessions();
    expect(await t.sessions.start(startRequest)).toEqual({ ok: true, sessionId: "s1" });
    const spec = t.docker.specs[0];
    expect(spec).toMatchObject({ name: "minecade-game-s1", image: "minecade/bds:local", network: "minecade", port: 19133 });
    expect(spec.env).toMatchObject({
      GAME: "probe",
      MAP: "default",
      SERVER_ID: "s1",
      SESSION_ID: "s1",
      SERVER_PORT: "19133",
      LOBBY_PORT: "19132",
      TRANSPORT: "http",
      ORCH_URL: "http://orchestrator:8080",
      LAN_HOST: "192.168.40.98",
      PUBLIC_HOST: "203.0.113.7",
      LAN_PLAYERS: "Steve",
      EXPECTED_PLAYERS: "Steve,Alex",
      GAME_SETTINGS: "{}",
      MAX_PLAYERS: "10",
    });
    expect(spec.env.IDENTITY).toBe("game");
    expect(spec.volumes).toEqual({});
    expect(spec.labels).toMatchObject({ "minecade.role": "game", "minecade.session": "s1", "minecade.managed-by": "orchestrator" });
    expect(types(t)).toEqual(["game_starting", "status"]);
    expect(t.sessions.status()).toMatchObject({ state: "starting", sessionId: "s1", game: "probe", map: "default" });
  });

  it("passes the game screen's settings to the game, dropping anything malformed", async () => {
    const t = setupSessions();
    await t.sessions.start({ ...startRequest, settings: { teams: "random" } });
    expect(JSON.parse(t.docker.specs[0].env.GAME_SETTINGS)).toEqual({ teams: "random" });
    const odd = { teams: "random", "Bad Key": "x", long: "y".repeat(40), num: 3 as unknown as string };
    expect(cleanSettings(odd)).toEqual({ teams: "random" });
    expect(cleanSettings(["teams"])).toEqual({});
    expect(cleanSettings(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, "v"])))).toHaveProperty("k7");
    expect(Object.keys(cleanSettings(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, "v"]))))).toHaveLength(8);
  });

  it("is ready only once both server_ready and 'Server started.' arrive", async () => {
    const t = setupSessions();
    await t.sessions.start(startRequest);
    t.links[0].emit(ready);
    expect(t.sessions.status().state).toBe("starting");
    t.docker.handles[0].console.emit("[2026-10-29 00:47:06:396 INFO] Starting Server");
    expect(t.sessions.status().state).toBe("starting");
    t.docker.handles[0].console.emit(SERVER_STARTED_LINE);
    expect(t.sessions.status().state).toBe("running");
    expect(t.lobby).toContainEqual({
      t: "game_ready",
      requestId: "r1",
      sessionId: "s1",
      game: "probe",
      map: "default",
      port: 19133,
      hosts: { public: "203.0.113.7", lan: "192.168.40.98" },
    });
  });

  it("rejects unknown games and maps, and a second game while one runs", async () => {
    const t = setupSessions();
    expect(await t.sessions.start({ ...startRequest, game: "nope" })).toEqual({ ok: false, reason: 'unknown game "nope"' });
    expect(await t.sessions.start({ ...startRequest, map: "nope" })).toMatchObject({ ok: false });
    await startAndReady(t);
    const busy = await t.sessions.start({ ...startRequest, requestId: "r2" });
    expect(busy).toMatchObject({ ok: false, reason: "busy: Probe is running" });
    expect(t.lobby.at(-1)).toMatchObject({ t: "start_rejected", requestId: "r2", status: { state: "running", sessionId: "s1" } });
    expect(t.docker.specs).toHaveLength(1);
  });

  it("gives every game the published maps' folder, and starts only maps that are in it", async () => {
    const t = setupSessions({}, { publishedMaps: () => ({ probe: { default: 3 } }), mapsSource: "C:\\dev\\minecade\\maps\\published\\worlds" });
    expect(await t.sessions.start({ ...startRequest, map: "random" })).toMatchObject({ ok: true });
    expect(t.docker.specs[0].env.MAP).toBe("default");
    expect(t.docker.specs[0].binds).toEqual({ "C:\\dev\\minecade\\maps\\published\\worlds": "/maps" });

    const other = setupSessions({}, { publishedMaps: () => ({ probe: { default: 3 } }) });
    expect(await other.sessions.start({ ...startRequest, map: "other" })).toEqual({ ok: false, reason: "Probe's Other isn't in the published maps; restart the network" });
    const none = setupSessions({}, { publishedMaps: () => undefined });
    expect(await none.sessions.start(startRequest)).toEqual({ ok: false, reason: "the published maps aren't at /maps; restart the network" });
    expect([...other.docker.specs, ...none.docker.specs]).toEqual([]);
  });

  it("runs a borrowed map from its own game's published worlds", async () => {
    const borrowing = {
      games: [{ id: "gunfight", name: "Gunfight", minPlayers: 1, maxPlayers: 8, maps: [{ id: "strife", name: "Strife", owner: "siege" }] }],
    };
    const t = setupSessions({}, { registry: borrowing, publishedMaps: () => ({ siege: { strife: 2 } }) });
    expect(await t.sessions.start({ ...startRequest, game: "gunfight", map: "random" })).toMatchObject({ ok: true });
    expect(t.docker.specs[0].env).toMatchObject({ GAME: "gunfight", MAP: "strife", MAP_GAME: "siege" });
    // Published only under the borrowing game's own name, it isn't there.
    const wrong = setupSessions({}, { registry: borrowing, publishedMaps: () => ({ gunfight: { strife: 2 } }) });
    expect(await wrong.sessions.start({ ...startRequest, game: "gunfight", map: "strife" })).toEqual({ ok: false, reason: "Gunfight's Strife isn't in the published maps; restart the network" });
  });

  it("mounts the identity key volume so every game keeps one server identity", async () => {
    const t = setupSessions({ keysVolume: "minecade-keys" });
    await t.sessions.start(startRequest);
    expect(t.docker.specs[0].volumes).toEqual({ "minecade-keys": "/keys" });
  });

  it("copies the game's script output into the orchestrator log", async () => {
    const t = setupSessions();
    await t.sessions.start(startRequest);
    const handle = t.docker.handles[0];
    handle.console.emit("[2026-10-29 01:40:00:000 WARN] [Scripting] [probe] sending get a waffle to 192.168.40.98:19132");
    handle.console.emit('[2026-10-29 01:40:00:000 WARN] [Scripting] [NET] {"t":"status_request"}');
    handle.console.emit("[2026-10-29 01:40:00:000 INFO] Player connected: get a waffle, xuid: 1");
    const logged = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
    expect(logged.filter((line) => line.includes("game s1:"))).toEqual([
      "[orchestrator] game s1: [2026-10-29 01:40:00:000 WARN] [Scripting] [probe] sending get a waffle to 192.168.40.98:19132",
    ]);
  });

  it("logs how long each step of the start took, once everyone expected is in", async () => {
    vi.setSystemTime(1_800_000_000_000);
    const t = setupSessions();
    await t.sessions.start(startRequest);
    const handle = t.docker.handles[0];
    handle.console.emit("[minecade] step entrypoint 1800000000400");
    handle.console.emit("[minecade] step world 1800000000900");
    await vi.advanceTimersByTimeAsync(9000);
    handle.console.emit(SERVER_STARTED_LINE);
    t.links[0].emit(ready);
    await vi.advanceTimersByTimeAsync(6000);
    t.links[0].emit({ t: "player_count", sessionId: "s1", players: ["Steve"] });
    await vi.advanceTimersByTimeAsync(2000);
    t.links[0].emit({ t: "player_count", sessionId: "s1", players: ["Steve", "Alex"] });
    t.links[0].emit({ t: "end_game", sessionId: "s1", reason: "finished" });
    await vi.advanceTimersByTimeAsync(0);
    const logged = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
    expect(logged.filter((line) => line.includes("timings"))).toEqual([
      "[orchestrator] session s1: timings: public ip 0.0 s, created 0.0 s, started 0.0 s, entrypoint 0.4 s, world 0.9 s, " +
        "server started 9.0 s, server_ready 9.0 s, ready 9.0 s, Steve in 15.0 s, Alex in 17.0 s, all in 17.0 s",
    ]);
  });

  it("logs the timings when the game ends before everyone expected is in", async () => {
    vi.setSystemTime(1_800_000_000_000);
    const t = setupSessions();
    const { link } = await startAndReady(t);
    link.emit({ t: "player_count", sessionId: "s1", players: ["Steve"] });
    link.emit({ t: "end_game", sessionId: "s1", reason: "aborted" });
    await vi.advanceTimersByTimeAsync(0);
    const logged = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
    expect(logged.filter((line) => line.includes("timings"))).toEqual([
      "[orchestrator] session s1: timings: public ip 0.0 s, created 0.0 s, started 0.0 s, server started 0.0 s, server_ready 0.0 s, ready 0.0 s, Steve in 0.0 s",
    ]);
  });

  it("picks one of the game's maps for 'random'", async () => {
    const t = setupSessions();
    await t.sessions.start({ ...startRequest, map: "random" });
    expect(t.docker.specs[0].env.MAP).toBe("other");
  });

  it("retries while Docker still holds the port, but not for other errors", async () => {
    const t = setupSessions();
    const busy = () => new Error("Bind for 0.0.0.0:19133 failed: port is already allocated");
    t.docker.startErrors.push(busy(), busy());
    const pending = t.sessions.start(startRequest);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toMatchObject({ ok: true });
    expect(t.docker.specs).toHaveLength(3);

    const other = setupSessions();
    other.docker.startErrors.push(new Error("No such image: minecade/bds:local"));
    expect(await other.sessions.start(startRequest)).toMatchObject({ ok: false });
    expect(other.docker.specs).toHaveLength(1);
    expect(other.lobby.at(-2)).toMatchObject({ t: "game_failed", requestId: "r1" });
    expect(other.sessions.status().state).toBe("idle");
  });

  it("fails the start when the game uses a different transport", async () => {
    const t = setupSessions();
    await t.sessions.start(startRequest);
    t.links[0].emit({ ...ready, transport: "log" });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.docker.handles[0].remove).toHaveBeenCalled();
    expect(t.lobby.find((message) => message.t === "game_failed")).toMatchObject({ reason: expect.stringContaining("log transport") });
    expect(t.sessions.status().state).toBe("idle");
  });

  it("fails the start when the server is not ready in time", async () => {
    const t = setupSessions();
    await t.sessions.start(startRequest);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.docker.handles[0].remove).toHaveBeenCalled();
    expect(t.lobby.find((message) => message.t === "game_failed")).toMatchObject({ reason: expect.stringContaining("in time") });
    expect(t.sessions.status().state).toBe("idle");
  });

  it("removes the container if the game was aborted while it was starting", async () => {
    const t = setupSessions();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const realStart = t.docker.startGame.bind(t.docker);
    t.docker.startGame = async (spec) => {
      await gate;
      return realStart(spec);
    };
    const pending = t.sessions.start(startRequest);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sessions.end("aborted")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.lobby.find((message) => message.t === "game_failed")).toBeDefined();
    release();
    expect(await pending).toMatchObject({ ok: false });
    expect(t.docker.handles[0].remove).toHaveBeenCalled();
  });
});

describe("SessionManager: running", () => {
  it("ends cleanly when the game sends end_game, and can start again", async () => {
    const t = setupSessions();
    const { handle, link } = await startAndReady(t);
    link.emit({ t: "end_game", sessionId: "s1", reason: "finished" });
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.remove).toHaveBeenCalled();
    expect(link.closed).toBe(true);
    expect(t.lobby).toContainEqual({ t: "game_ended", sessionId: "s1", reason: "finished" });
    expect(t.sessions.status()).toEqual({ state: "idle", players: [] });
    expect(await t.sessions.start(startRequest)).toMatchObject({ ok: true });
  });

  it("tracks players and logs stats as one [STATS] line", async () => {
    const t = setupSessions();
    const { link } = await startAndReady(t);
    link.emit({ t: "player_count", sessionId: "s1", players: ["Steve", "Alex"] });
    expect(t.sessions.status().players).toEqual(["Steve", "Alex"]);
    expect(t.lobby.at(-1)).toMatchObject({ t: "status", players: ["Steve", "Alex"] });
    const stats: OutboundEvent = {
      t: "match_stats",
      sessionId: "s1",
      matchId: "s1.1",
      part: 1,
      parts: 1,
      game: "probe",
      map: "default",
      mode: "solo",
      durationSec: 12,
      rows: [{ n: "Steve", r: "w", k: 0, d: 0, dd: 0, dt: 0, s: 12, bs: 0 }],
    };
    link.emit(stats);
    expect(console.log).toHaveBeenCalledWith(`[STATS] ${JSON.stringify(stats)}`);
  });

  it("passes stats on with the xuids from the game's console, and ignores another session's", async () => {
    const received: { part: OutboundEvent; xuids: Record<string, string> }[] = [];
    const t = setupSessions({}, { onMatchStats: (part, { xuids }) => received.push({ part, xuids: Object.fromEntries(xuids) }) });
    const { handle, link } = await startAndReady(t);
    handle.console.emit("[2026-10-29 15:31:14:610 INFO] Player connected: get a waffle, xuid: 2535411111111111");
    handle.console.emit("[2026-10-29 15:31:16:706 INFO] Player Spawned: get a waffle xuid: 2535411111111111, pfid: abc");
    handle.console.emit("[2026-10-29 15:31:20:000 INFO] Player connected: Friend, xuid: 2535422222222222");
    const part = { ...statsPart, rows: [{ n: "get a waffle", r: "w" as const, k: 1, d: 0, dd: 20, dt: 0, s: 30, bs: 1 }] };
    link.emit(part);
    link.emit({ ...part, sessionId: "other", matchId: "other.1" });
    expect(received).toEqual([{ part, xuids: { "get a waffle": "2535411111111111", friend: "2535422222222222" } }]);
  });

  it("reports a crash while running, and while starting", async () => {
    const t = setupSessions();
    const { handle } = await startAndReady(t);
    handle.exit(137);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.lobby).toContainEqual({ t: "game_ended", sessionId: "s1", reason: "crashed" });

    const early = setupSessions();
    await early.sessions.start(startRequest);
    early.docker.handles[0].exit(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(early.lobby.find((message) => message.t === "game_failed")).toMatchObject({ reason: expect.stringContaining("exit code 1") });
  });

  it("keeps a crashed game's last console lines in its data folder, and the last few in its log", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "minecade-crash-"));
    try {
      const t = setupSessions({ dataDir });
      const { handle } = await startAndReady(t);
      for (let i = 1; i <= 250; i++) handle.console.emit(`[2026-11-09 10:19:00:000 INFO] line ${i}`);
      handle.console.emit("[2026-11-09 10:19:29:000 ERROR] the last words");
      handle.exit(139);
      await vi.waitFor(() => expect(readdirSync(join(dataDir, "crashes"))).toHaveLength(1));
      const [name] = readdirSync(join(dataDir, "crashes"));
      expect(name).toMatch(/-probe-default\.log$/);
      const lines = readFileSync(join(dataDir, "crashes", name), "utf8").trimEnd().split("\n");
      expect(lines[0]).toBe("session s1: the probe server (map default, players none) stopped with exit code 139");
      // The last 200 lines, oldest first: lines 52 to 250 and the last words.
      expect(lines.slice(1)).toHaveLength(200);
      expect(lines[1]).toBe("[2026-11-09 10:19:00:000 INFO] line 52");
      expect(lines.at(-1)).toBe("[2026-11-09 10:19:29:000 ERROR] the last words");
      const warned = vi.mocked(console.warn).mock.calls.map(([line]) => String(line));
      expect(warned.some((line) => line.includes("game s1: [2026-11-09 10:19:29:000 ERROR] the last words"))).toBe(true);
      expect(warned.some((line) => line.includes("line 220"))).toBe(false);
      expect(t.lobby).toContainEqual({ t: "game_ended", sessionId: "s1", reason: "crashed" });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("ends a game that stays empty past the backstop, but not one with players", async () => {
    const t = setupSessions();
    const { link } = await startAndReady(t);
    link.emit({ t: "player_count", sessionId: "s1", players: ["Steve"] });
    await vi.advanceTimersByTimeAsync(400_000);
    expect(t.sessions.status().state).toBe("running");
    link.emit({ t: "player_count", sessionId: "s1", players: [] });
    await vi.advanceTimersByTimeAsync(179_000);
    expect(t.sessions.status().state).toBe("running");
    await vi.advanceTimersByTimeAsync(11_000);
    expect(t.lobby).toContainEqual({ t: "game_ended", sessionId: "s1", reason: "empty for too long" });
  });

  it("answers the lobby's start_game and status_request", async () => {
    const t = setupSessions();
    t.sessions.onLobbyEvent({ t: "status_request" });
    expect(t.lobby).toEqual([{ t: "status", state: "idle", players: [] }]);
    t.sessions.onLobbyEvent({ t: "start_game", ...startRequest });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.docker.specs).toHaveLength(1);
  });

  it("forwards the lobby's team picks to the game they're for, cleaned", async () => {
    const t = setupSessions();
    t.sessions.onLobbyEvent({ t: "team_picks", sessionId: "s1", picks: { Steve: "red" } }); // no game yet: dropped
    const { link } = await startAndReady(t);
    t.sessions.onLobbyEvent({ t: "team_picks", sessionId: "other", picks: { Steve: "red" } }); // another session: dropped
    t.sessions.onLobbyEvent({ t: "team_picks", sessionId: "s1", picks: { Steve: "red", Alex: "Not An Id", "": "blue" } });
    expect(link.sent).toEqual([{ t: "team_picks", picks: { Steve: "red" } }]);
  });

  it("forwards the players the lobby sent to their game, and counts everyone in by that list", async () => {
    vi.setSystemTime(1_800_000_000_000);
    const t = setupSessions();
    t.sessions.onLobbyEvent({ t: "players_sent", sessionId: "s1", players: ["Steve"] }); // no game yet: dropped
    const { link } = await startAndReady(t);
    t.sessions.onLobbyEvent({ t: "players_sent", sessionId: "other", players: ["Steve"] }); // another session: dropped
    await vi.advanceTimersByTimeAsync(3000);
    t.sessions.onLobbyEvent({ t: "players_sent", sessionId: "s1", players: ["Steve", "Eve", "", 7 as unknown as string] });
    expect(link.sent).toEqual([{ t: "expected_players", players: ["Steve", "Eve"] }]);
    await vi.advanceTimersByTimeAsync(4000);
    link.emit({ t: "player_count", sessionId: "s1", players: ["Steve", "Eve"] }); // Alex, there at the start, wasn't sent
    const logged = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
    expect(logged.filter((line) => line.includes("timings"))).toEqual([
      "[orchestrator] session s1: timings: public ip 0.0 s, created 0.0 s, started 0.0 s, server started 0.0 s, server_ready 0.0 s, ready 0.0 s, " +
        "players sent 3.0 s, Steve in 7.0 s, Eve in 7.0 s, all in 7.0 s",
    ]);
  });
});

describe("SessionManager: booting a game ahead", () => {
  const prepare = async (t: ReturnType<typeof setupSessions>, map = "other") => {
    t.sessions.onLobbyEvent({ t: "prepare_game", game: "probe", map });
    await vi.advanceTimersByTimeAsync(0);
  };

  it("boots without a word to the lobby, then the start for that map adopts it", async () => {
    vi.setSystemTime(1_800_000_000_000);
    const t = setupSessions();
    await prepare(t);
    expect(t.docker.specs).toHaveLength(1);
    expect(t.docker.specs[0].env).toMatchObject({ MAP: "other", AWAIT_START: "1", EXPECTED_PLAYERS: "", GAME_SETTINGS: "{}" });
    expect(t.lobby).toEqual([]);
    expect(t.sessions.status()).toEqual({ state: "idle", players: [] });
    await vi.advanceTimersByTimeAsync(5000);
    t.docker.handles[0].console.emit(SERVER_STARTED_LINE);
    t.links[0].emit(ready);
    expect(t.links[0].sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(await t.sessions.start({ ...startRequest, map: "other", settings: { teams: "random" } })).toEqual({ ok: true, sessionId: "s1" });
    expect(t.docker.specs).toHaveLength(1);
    expect(types(t)).toEqual(["game_starting", "status"]);
    expect(t.links[0].sent).toEqual([{ t: "configure", settings: { teams: "random" }, players: ["Steve", "Alex"] }]);
    expect(t.sessions.status().state).toBe("starting");
    await vi.advanceTimersByTimeAsync(500);
    t.links[0].emit({ t: "configured", sessionId: "s1" });
    expect(t.sessions.status().state).toBe("running");
    expect(t.lobby.find((message) => message.t === "game_ready")).toMatchObject({ requestId: "r1", map: "other" });
    t.links[0].emit({ t: "end_game", sessionId: "s1", reason: "aborted" });
    await vi.advanceTimersByTimeAsync(0);
    const logged = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
    // Counted from the start: the boot that came before it shows as negative times.
    expect(logged.filter((line) => line.includes("timings"))).toEqual([
      "[orchestrator] session s1: timings: booted ahead -6.0 s, public ip -6.0 s, created -6.0 s, started -6.0 s, server started -1.0 s, " +
        "server_ready -1.0 s, configure sent 0.0 s, configured 0.5 s, ready 0.5 s",
    ]);
  });

  it("configures it as soon as its pack is up when the start comes first", async () => {
    const t = setupSessions();
    await prepare(t);
    await t.sessions.start({ ...startRequest, map: "other" });
    expect(t.links[0].sent).toEqual([]);
    t.links[0].emit(ready);
    expect(t.links[0].sent).toEqual([{ t: "configure", settings: {}, players: ["Steve", "Alex"] }]);
    t.links[0].emit({ t: "configured", sessionId: "s1" });
    expect(t.sessions.status().state).toBe("starting"); // BDS hasn't said Server started.
    t.docker.handles[0].console.emit(SERVER_STARTED_LINE);
    expect(t.sessions.status().state).toBe("running");
  });

  it("is replaced for another map, and removed at once for a start on another map", async () => {
    const t = setupSessions();
    await prepare(t, "default");
    await prepare(t, "default"); // the same map again: nothing new
    await prepare(t, "other");
    expect(t.docker.specs.map((spec) => spec.env.MAP)).toEqual(["default", "other"]);
    expect(t.docker.handles[0].discard).toHaveBeenCalled();
    expect(await t.sessions.start({ ...startRequest, map: "default" })).toMatchObject({ ok: true });
    expect(t.docker.handles[1].discard).toHaveBeenCalled();
    expect(t.docker.specs.map((spec) => [spec.env.MAP, spec.env.AWAIT_START])).toEqual([
      ["default", "1"],
      ["other", "1"],
      ["default", ""],
    ]);
    expect(t.docker.handles[0].remove).not.toHaveBeenCalled();
  });

  it("goes when the player leaves the screen, when nobody starts it, or when its server stops", async () => {
    const t = setupSessions();
    await prepare(t);
    t.sessions.onLobbyEvent({ t: "cancel_prepare" });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.docker.handles[0].discard).toHaveBeenCalled();

    await prepare(t);
    await vi.advanceTimersByTimeAsync(PREPARED_MS - 1);
    expect(t.docker.handles[1].discard).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.docker.handles[1].discard).toHaveBeenCalled();

    await prepare(t);
    t.docker.handles[2].exit(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.docker.handles[2].discard).toHaveBeenCalled();
    await prepare(t);
    expect(t.docker.specs).toHaveLength(4);
    expect(t.lobby).toEqual([]);
  });

  it("boots nothing ahead while a game is on, nor a map that isn't published", async () => {
    const t = setupSessions();
    await startAndReady(t);
    await prepare(t);
    expect(t.docker.specs).toHaveLength(1);

    const unpublished = setupSessions({}, { publishedMaps: () => ({ probe: { default: 1 } }) });
    await prepare(unpublished, "other");
    expect(unpublished.docker.specs).toEqual([]);
  });
});

describe("cleanPicks", () => {
  it("keeps up to 32 picks of short names to team ids", () => {
    expect(cleanPicks({ Steve: "red", "get a waffle": "blue", Bad: 3, Worse: "Red Team" })).toEqual({ Steve: "red", "get a waffle": "blue" });
    expect(cleanPicks(["red"])).toEqual({});
    expect(cleanPicks(null)).toEqual({});
    expect(Object.keys(cleanPicks(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`P${i}`, "red"]))))).toHaveLength(32);
  });
});

describe("SessionManager: startup and shutdown", () => {
  it("sends leftover games home, then removes them", async () => {
    const t = setupSessions();
    t.docker.games = [
      { id: "c1", name: "minecade-game-old", labels: { "minecade.session": "old" }, running: true },
      { id: "c2", name: "minecade-game-dead", labels: { "minecade.session": "dead" }, running: false },
    ];
    const pending = t.sessions.cleanupLeftovers();
    await vi.advanceTimersByTimeAsync(0);
    expect(await t.sessions.start(startRequest)).toEqual({ ok: false, reason: "the network is still starting up; try again in a few seconds" });
    expect(t.links.map((link) => link.serverId)).toEqual(["old"]);
    expect(t.links[0].sent).toEqual([{ t: "return_all", reason: "The network restarted." }]);
    expect(t.docker.removeContainer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(t.docker.removeContainer.mock.calls).toEqual([["c1"], ["c2"]]);
    expect(t.links[0].closed).toBe(true);
    expect(await t.sessions.start(startRequest)).toMatchObject({ ok: true });
  });

  it("on shutdown, sends players home and removes the game once it ends", async () => {
    const t = setupSessions();
    const { handle, link } = await startAndReady(t);
    const done = t.sessions.shutdown();
    await vi.advanceTimersByTimeAsync(0);
    expect(link.sent).toContainEqual({ t: "return_all", reason: "The network is shutting down." });
    link.emit({ t: "end_game", sessionId: "s1", reason: "aborted" });
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(handle.remove).toHaveBeenCalled();
  });

  it("on shutdown, removes a game that doesn't end itself within 10 s", async () => {
    const t = setupSessions();
    const { handle } = await startAndReady(t);
    const done = t.sessions.shutdown();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(handle.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(handle.remove).toHaveBeenCalled();
  });
});
