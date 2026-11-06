import { describe, expect, it } from "vitest";
import { IDLE_MS, RESEND_MS, RETRY_MS, WANTED_MS, warmStep, type WarmFacts } from "../warm.ts";

const NOW = 10_000_000;
const base: WarmFacts = { now: NOW, wantedAt: NOW - 1000, paused: false, docker: true, busy: false, network: false, editor: "off", fromPanel: true, people: 0, extracting: false, usedAt: NOW - 1000 };

describe("the map editor's warm-up", () => {
  it("boots the editor while a Maps page or a viewer is open, never stopping the network for it", () => {
    expect(warmStep(base)).toEqual({ action: "boot" });
    expect(warmStep({ ...base, wantedAt: NOW - WANTED_MS })).toEqual({ action: "none" });
    expect(warmStep({ ...base, wantedAt: undefined })).toEqual({ action: "none" });
    expect(warmStep({ ...base, network: true })).toMatchObject({ action: "none", why: expect.stringMatching(/network is running/) });
    expect(warmStep({ ...base, docker: false })).toMatchObject({ action: "none" });
    expect(warmStep({ ...base, busy: true })).toMatchObject({ action: "none" });
    expect(warmStep({ ...base, paused: true })).toMatchObject({ action: "none", why: expect.stringMatching(/shut down/) });
    expect(warmStep({ ...base, failedAt: NOW - 1000 })).toMatchObject({ action: "none", why: expect.stringMatching(/couldn't boot/) });
    expect(warmStep({ ...base, failedAt: NOW - RETRY_MS })).toEqual({ action: "boot" });
    // Booting or starting: it waits.
    expect(warmStep({ ...base, editor: "booting" })).toEqual({ action: "none" });
    expect(warmStep({ ...base, editor: "starting", map: "sumo/arena" })).toEqual({ action: "none" });
  });

  it("opens the wanted map in Edit once the editor is ready, asking again now and then", () => {
    const ready: WarmFacts = { ...base, editor: "ready", map: "sumo/arena" };
    expect(warmStep(ready)).toEqual({ action: "warm", map: "sumo/arena" });
    expect(warmStep({ ...ready, editMap: "sumo/arena" })).toEqual({ action: "none" });
    expect(warmStep({ ...ready, sentMap: "sumo/arena", sentAt: NOW - 1000 })).toEqual({ action: "none" });
    expect(warmStep({ ...ready, sentMap: "sumo/arena", sentAt: NOW - RESEND_MS })).toEqual({ action: "warm", map: "sumo/arena" });
    expect(warmStep({ ...ready, sentMap: "sumo/other", sentAt: NOW - 1000 })).toEqual({ action: "warm", map: "sumo/arena" });
    // No page wants it any more: nothing new opens.
    expect(warmStep({ ...ready, wantedAt: NOW - WANTED_MS })).toEqual({ action: "none" });
  });

  it("shuts an editor the Panel booted down once nobody has used it for a while", () => {
    const idle: WarmFacts = { ...base, editor: "ready", wantedAt: NOW - IDLE_MS, usedAt: NOW - IDLE_MS };
    expect(warmStep(idle)).toEqual({ action: "stop" });
    expect(warmStep({ ...idle, usedAt: NOW - IDLE_MS + 1000 })).toEqual({ action: "none" });
    expect(warmStep({ ...idle, people: 1 })).toEqual({ action: "none" });
    expect(warmStep({ ...idle, extracting: true })).toEqual({ action: "none" });
    // One booted from a terminal is left alone.
    expect(warmStep({ ...idle, fromPanel: false })).toEqual({ action: "none" });
  });
});
