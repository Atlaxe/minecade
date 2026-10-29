import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type OutboundEvent } from "@minecade/minigame-core/protocol";
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
      MAX_PLAYERS: "10",
    });
    expect(spec.env.IDENTITY).toBe("game");
    expect(spec.volumes).toEqual({});
    expect(spec.labels).toMatchObject({ "minecade.role": "game", "minecade.session": "s1", "minecade.managed-by": "orchestrator" });
    expect(types(t)).toEqual(["game_starting", "status"]);
    expect(t.sessions.status()).toMatchObject({ state: "starting", sessionId: "s1", game: "probe", map: "default" });
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
      t: "stats",
      sessionId: "s1",
      game: "probe",
      map: "default",
      players: ["Steve"],
      kills: {},
      deaths: {},
      winner: null,
      durationSec: 12,
    };
    link.emit(stats);
    expect(console.log).toHaveBeenCalledWith(`[STATS] ${JSON.stringify(stats)}`);
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
    expect(t.links.map((link) => link.serverId)).toEqual(["old"]);
    expect(t.links[0].sent).toEqual([{ t: "return_all", reason: "The network restarted." }]);
    expect(t.docker.removeContainer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(t.docker.removeContainer.mock.calls).toEqual([["c1"], ["c2"]]);
    expect(t.links[0].closed).toBe(true);
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
