import { beforeEach, describe, expect, it } from "vitest";
import { Scope } from "@minecade/minigame-core";
import { system } from "../../packages/minigame-core/test/fake-mc-server.ts";
import { TeamPickController, type TeamPickPorts, type TeamPickView } from "../behavior_pack/scripts/team-pick-controller.ts";

function setup(players = ["Steve", "Alex"], online = [...players]) {
  const opened: string[] = [];
  const closed: string[] = [];
  const updates = new Map<string, TeamPickView>();
  const holo: TeamPickView[] = [];
  const done: Record<string, string>[] = [];
  const here = [...online];
  const ports: TeamPickPorts = {
    open: (name, view) => {
      opened.push(name);
      updates.set(name, view);
    },
    update: (name, view) => updates.set(name, view),
    close: (name) => closed.push(name),
    hologram: (view) => holo.push(view),
  };
  const root = new Scope("lobby");
  const scope = root.child("teams");
  const picker = new TeamPickController(ports, scope, { game: "Probe", players, teams: { count: 2 }, online: () => here, done: (picks) => done.push(picks) });
  return { opened, closed, updates, holo, done, here, root, scope, picker };
}

beforeEach(() => system.reset());

describe("TeamPickController", () => {
  it("opens a form for every player here and shows the teams on the hologram", () => {
    const t = setup(["Steve", "Alex", "Gone"], ["Steve", "Alex"]);
    expect(t.opened).toEqual(["Steve", "Alex"]);
    expect(t.holo.at(-1)).toMatchObject({ game: "Probe", status: "Waiting for the server...", unpicked: ["Steve", "Alex", "Gone"] });
  });

  it("updates every form and the hologram when someone picks", () => {
    const t = setup();
    t.picker.pick("Steve", "blue");
    for (const name of ["Steve", "Alex"]) expect(t.updates.get(name)?.teams[1].members).toEqual(["Steve"]);
    expect(t.holo.at(-1)?.teams[1].members).toEqual(["Steve"]);
  });

  it("waits for the server, then for everyone to pick, but at least 5 s", () => {
    const t = setup();
    t.picker.pick("Steve", "red");
    t.picker.pick("Alex", "blue");
    system.advanceTicks(60);
    expect(t.done).toEqual([]); // not ready
    t.picker.ready();
    expect(t.done).toEqual([]); // 3 s so far
    expect(t.holo.at(-1)?.status).toBe("Teams lock in 2 s");
    system.advanceTicks(40);
    expect(t.done).toEqual([{ Steve: "red", Alex: "blue" }]);
    expect(t.closed).toEqual(["Steve", "Alex"]);
  });

  it("locks teams after 20 s once the server is ready, picked or not", () => {
    const t = setup();
    t.picker.pick("Steve", "red");
    t.picker.ready();
    system.advanceTicks(380);
    expect(t.done).toEqual([]);
    expect(t.holo.at(-1)?.status).toBe("Teams lock in 1 s");
    system.advanceTicks(20);
    expect(t.done).toEqual([{ Steve: "red" }]);
    t.picker.pick("Alex", "blue"); // too late
    expect(t.done).toHaveLength(1);
  });

  it("drops a player who leaves, so the others can finish", () => {
    const t = setup();
    t.picker.ready();
    t.picker.pick("Steve", "red");
    t.here.splice(t.here.indexOf("Alex"), 1);
    t.picker.leave("Alex");
    system.advanceTicks(100);
    expect(t.done).toEqual([{ Steve: "red" }]);
  });

  it("brings a form back for players in the match only", () => {
    const t = setup();
    expect(t.picker.reopen("Steve")).toBe(true);
    expect(t.picker.reopen("Stranger")).toBe(false);
    expect(t.opened).toEqual(["Steve", "Alex", "Steve"]);
  });

  it("closes every form when the start fails, and leaves nothing running", () => {
    const t = setup();
    t.scope.dispose();
    expect(t.closed).toEqual(["Steve", "Alex"]);
    system.advanceTicks(600);
    expect(t.done).toEqual([]);
    expect(t.root.live()).toEqual({ scopes: 1, subscriptions: 0, runs: 0 });
  });
});
