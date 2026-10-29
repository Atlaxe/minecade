import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboundEvent } from "@minecade/minigame-core/protocol";
import { HttpLinkHub } from "../src/links/http-link.ts";
import { LobbyChannel } from "../src/lobby.ts";
import { FakeDocker } from "./fakes.ts";

const netLine = (event: OutboundEvent) => `[2026-10-29 00:47:10:100 WARN] [Scripting] [NET] ${JSON.stringify(event)}`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LobbyChannel", () => {
  it("HTTP: opens the lobby link at once and forwards its events", () => {
    const hub = new HttpLinkHub();
    const onEvent = vi.fn();
    const onConnect = vi.fn();
    const channel = new LobbyChannel({ transport: "http", hub, docker: new FakeDocker(), onEvent, onConnect });
    channel.start();
    const link = hub.get("lobby")!;
    expect(onConnect).toHaveBeenCalledOnce();
    link.receive({ t: "status_request" });
    expect(onEvent).toHaveBeenCalledWith({ t: "status_request" });
    const send = vi.spyOn(link, "send");
    channel.send({ t: "status", state: "idle", players: [] });
    expect(send).toHaveBeenCalledWith({ t: "status", state: "idle", players: [] });
    channel.stop();
    expect(hub.get("lobby")).toBeUndefined();
  });

  it("log: attaches once the lobby runs, and again after it restarts", async () => {
    const docker = new FakeDocker();
    const onEvent = vi.fn();
    const onConnect = vi.fn();
    const channel = new LobbyChannel({ transport: "log", hub: new HttpLinkHub(), docker, onEvent, onConnect, scanIntervalMs: 1000 });
    channel.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onConnect).not.toHaveBeenCalled();
    channel.send({ t: "status", state: "idle", players: [] }); // no lobby yet: dropped quietly

    docker.lobby = { id: "lobby-1", name: "minecade-lobby", labels: {}, running: true };
    await vi.advanceTimersByTimeAsync(1000);
    expect(onConnect).toHaveBeenCalledOnce();
    const first = docker.attached.get("lobby-1")!;
    first.console.emit(netLine({ t: "status_request" }));
    expect(onEvent).toHaveBeenCalledWith({ t: "status_request" });
    channel.send({ t: "status", state: "idle", players: [] });
    expect(first.console.sent).toEqual(['scriptevent minecade:net {"t":"status","state":"idle","players":[]}']);

    first.exit(0); // the lobby restarts as a new container
    docker.lobby = { id: "lobby-2", name: "minecade-lobby", labels: {}, running: true };
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.console.closed).toBe(true);
    expect(onConnect).toHaveBeenCalledTimes(2);
    expect(docker.attached.has("lobby-2")).toBe(true);
    channel.stop();
  });
});
