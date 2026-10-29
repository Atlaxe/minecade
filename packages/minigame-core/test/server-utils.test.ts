// TransferService, showForm and readServerVars against the fake script modules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@minecraft/server";
import type { ActionFormData as RealActionFormData } from "@minecraft/server-ui";
import { Scope } from "../src/scope.ts";
import { TransferService } from "../src/transfer.ts";
import { showForm } from "../src/ui.ts";
import { readServerVars } from "../src/vars.ts";
import { failTransfers, resetAdmin, setVariables, transfers } from "./fake-mc-server-admin.ts";
import { system } from "./fake-mc-server.ts";
import { ActionFormData, closedFor, openForms, queueFormResponses, resetForms, shownForms } from "./fake-mc-server-ui.ts";
import { flushPromises } from "./util.ts";

function fakePlayer(name: string, isValid = true) {
  return { name, isValid, sendMessage: vi.fn() } as unknown as Player & { sendMessage: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  system.reset();
  resetAdmin();
  resetForms();
  for (const level of ["info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TransferService", () => {
  const service = new TransferService({ lanHost: "192.168.40.98", publicHost: "203.0.113.7", lanPlayers: ["Get A Waffle"] });

  it("sends LAN players to the LAN address and everyone else to the public one", () => {
    expect(service.transfer(fakePlayer("get a waffle"), 19133)).toBe(true);
    expect(service.transfer(fakePlayer("Friend"), 19133)).toBe(true);
    expect(transfers).toEqual([
      { player: "get a waffle", hostname: "192.168.40.98", port: 19133 },
      { player: "Friend", hostname: "203.0.113.7", port: 19133 },
    ]);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("sending get a waffle to 192.168.40.98:19133 (in LAN_PLAYERS)"));
  });

  it("skips players who already left, and tells the player when a transfer can't start", () => {
    expect(service.transfer(fakePlayer("Gone", false), 19133)).toBe(false);
    failTransfers(new Error("restricted execution"));
    const player = fakePlayer("Friend");
    expect(service.transfer(player, 19133)).toBe(false);
    expect(player.sendMessage).toHaveBeenCalledOnce();
    expect(transfers).toEqual([]);
  });
});

describe("showForm", () => {
  const player = fakePlayer("Steve");
  // The fake stands in for the real form class, whose enum types it can't name.
  const form = () => new ActionFormData().title("Pick").button("A") as unknown as RealActionFormData;

  it("returns the response, and leaves no cleanup behind", async () => {
    const scope = new Scope();
    queueFormResponses({ canceled: false, selection: 0 });
    expect(await showForm(scope, player, form())).toEqual({ canceled: false, selection: 0 });
    scope.dispose();
    expect(closedFor).toEqual([]);
  });

  it("retries while the player is busy, every 10 ticks, then gives up after about 5 s", async () => {
    const scope = new Scope();
    const busy = { canceled: true, cancelationReason: "UserBusy" as const };
    queueFormResponses(busy, busy, { canceled: false, selection: 0 });
    const result = showForm(scope, player, form());
    for (let i = 0; i < 2; i++) {
      await flushPromises();
      system.advanceTicks(10);
    }
    expect(await result).toEqual({ canceled: false, selection: 0 });
    expect(shownForms).toHaveLength(3);

    resetForms();
    queueFormResponses(...Array(20).fill(busy));
    const gaveUp = showForm(scope, player, form());
    for (let i = 0; i < 12; i++) {
      await flushPromises();
      system.advanceTicks(10);
    }
    expect(await gaveUp).toBeUndefined();
    expect(shownForms).toHaveLength(11);
  });

  it("doesn't retry a form the player closed or couldn't see", async () => {
    const scope = new Scope();
    queueFormResponses({ canceled: true, cancelationReason: "UserClosed" }, new Error("PlayerQuit"));
    expect(await showForm(scope, player, form())).toBeUndefined();
    expect(await showForm(scope, player, form())).toBeUndefined();
    expect(shownForms).toHaveLength(2);
  });

  it("closes the form and never settles once its scope is disposed", async () => {
    const scope = new Scope();
    const settled = vi.fn();
    void showForm(scope, player, form()).then(settled);
    await flushPromises();
    scope.dispose();
    expect(closedFor).toEqual(["Steve"]);
    expect(openForms).toHaveLength(0); // closed; its answer arrives after the scope ended
    await flushPromises();
    expect(settled).not.toHaveBeenCalled();
  });
});

describe("readServerVars", () => {
  it("parses the JSON-string lists and numbers the entrypoint writes", () => {
    setVariables({
      serverId: "ab12",
      role: "game",
      sessionId: "ab12",
      transport: "log",
      lanPlayers: '["get a waffle"]',
      expectedPlayers: '["get a waffle","Friend"]',
      mapConfig: '{"name":"Default","spawns":[[0,65,0]]}',
      lobbyPort: 19132,
      serverPort: 19133,
      devMinPlayers: "1",
    });
    expect(readServerVars()).toMatchObject({
      serverId: "ab12",
      role: "game",
      transport: "log",
      lanPlayers: ["get a waffle"],
      expectedPlayers: ["get a waffle", "Friend"],
      mapConfig: { name: "Default", spawns: [[0, 65, 0]] },
      lobbyPort: 19132,
      serverPort: 19133,
      devMinPlayers: 1,
    });
  });

  it("falls back to defaults for missing or broken values", () => {
    setVariables({ role: "lobby", lanPlayers: "[oops", devMinPlayers: "" });
    expect(readServerVars()).toMatchObject({
      role: "lobby",
      sessionId: "",
      transport: "http",
      lanPlayers: [],
      mapConfig: { name: "", spawns: [] },
      lobbyPort: 19132,
      devMinPlayers: undefined,
    });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"lanPlayers" is not valid JSON'));
  });
});
