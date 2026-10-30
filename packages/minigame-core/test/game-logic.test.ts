import { describe, expect, it } from "vitest";
import type { Box, MapConfig } from "../src/map-config.ts";
import { KillCredit } from "../src/game/credit.ts";
import { inside, MapView } from "../src/game/map-view.ts";
import { aborted, draw, endReason, lastStanding } from "../src/game/results.ts";
import { Roster } from "../src/game/roster.ts";
import { Score } from "../src/game/score.ts";

describe("KillCredit", () => {
  it("credits the last hitter within the window, edge included", () => {
    const credit = new KillCredit(60);
    credit.hit("Steve", "Alex", 100);
    expect(credit.creditFor("Steve", 100)).toBe("Alex");
    expect(credit.creditFor("Steve", 160)).toBe("Alex");
    expect(credit.creditFor("Steve", 161)).toBeUndefined();
  });

  it("credits the most recent hitter", () => {
    const credit = new KillCredit(60);
    credit.hit("Steve", "Alex", 100);
    credit.hit("Steve", "Kai", 140);
    expect(credit.creditFor("Steve", 190)).toBe("Kai");
  });

  it("ignores self-hits without forgetting the earlier hitter", () => {
    const credit = new KillCredit(60);
    credit.hit("Steve", "steve", 10);
    expect(credit.creditFor("Steve", 10)).toBeUndefined();
    credit.hit("Steve", "Alex", 20);
    credit.hit("Steve", "STEVE", 30);
    expect(credit.creditFor("Steve", 30)).toBe("Alex");
  });

  it("matches victims case-insensitively and keeps the attacker's spelling", () => {
    const credit = new KillCredit(60);
    credit.hit("Steve", "Alex", 0);
    expect(credit.creditFor("STEVE", 5)).toBe("Alex");
    expect(credit.creditFor("Nobody", 5)).toBeUndefined();
  });

  it("forgets a victim on clear", () => {
    const credit = new KillCredit(60);
    credit.hit("Steve", "Alex", 0);
    credit.hit("Kai", "Alex", 0);
    credit.clear("steve");
    expect(credit.creditFor("Steve", 1)).toBeUndefined();
    expect(credit.creditFor("Kai", 1)).toBe("Alex");
  });
});

describe("results", () => {
  it("names the last side standing once a real contest is down to one", () => {
    expect(lastStanding(["red"], 2)).toEqual({ winner: "red", everyoneOut: false });
    expect(lastStanding(["Alex"], 8)).toEqual({ winner: "Alex", everyoneOut: false });
    expect(lastStanding(["Alex", "Kai"], 8)).toEqual({ everyoneOut: false });
  });

  it("reports everyone out when no side is left", () => {
    expect(lastStanding([], 4)).toEqual({ everyoneOut: true });
    expect(lastStanding([], 1)).toEqual({ everyoneOut: true });
  });

  it("never gives a solo contest a winner", () => {
    const solo = lastStanding(["Alex"], 1);
    expect(solo.winner).toBeUndefined();
    expect(solo.everyoneOut).toBe(false);
  });

  it("builds draws and aborts, and maps results to end reasons", () => {
    expect(draw("time")).toEqual({ kind: "draw", reason: "time" });
    expect(aborted("empty")).toEqual({ kind: "aborted", reason: "empty" });
    expect(endReason(draw("time"))).toBe("finished");
    expect(endReason({ kind: "win", players: ["Alex"], reason: "last standing" })).toBe("finished");
    expect(endReason({ kind: "coop", won: false, reason: "wiped" })).toBe("finished");
    expect(endReason(aborted("not_enough_players"))).toBe("not_enough_players");
    expect(endReason(aborted("error"))).toBe("error");
  });
});

describe("Score", () => {
  it("adds, sets and reads values", () => {
    const score = new Score();
    expect(score.get("Alex")).toBe(0);
    expect(score.add("Alex")).toBe(1);
    expect(score.add("Alex", 4)).toBe(5);
    expect(score.add("Alex", -2)).toBe(3);
    score.set("Kai", 10);
    expect(score.get("Kai")).toBe(10);
    score.set("Kai", 2);
    expect(score.get("Kai")).toBe(2);
  });

  it("lists entries highest first", () => {
    const score = new Score();
    score.set("a", 2);
    score.set("b", 7);
    score.set("c", 4);
    expect(score.entries()).toEqual([
      ["b", 7],
      ["c", 4],
      ["a", 2],
    ]);
  });

  it("finds the leader and flags a tie", () => {
    const score = new Score();
    expect(score.leader()).toBeUndefined();
    score.set("a", 3);
    expect(score.leader()).toEqual({ id: "a", value: 3, tied: false });
    score.set("b", 5);
    expect(score.leader()).toEqual({ id: "b", value: 5, tied: false });
    score.set("c", 5);
    expect(score.leader()).toMatchObject({ value: 5, tied: true });
    expect(["b", "c"]).toContain(score.leader()!.id);
  });

  it("reports the highest id that reached a target", () => {
    const score = new Score();
    score.set("a", 5);
    score.set("b", 7);
    expect(score.reached(5)).toBe("b");
    expect(score.reached(7)).toBe("b");
    expect(score.reached(8)).toBeUndefined();
    expect(new Score().reached(0)).toBeUndefined();
  });

  it("counts changes from add and set, not reads", () => {
    const score = new Score();
    expect(score.changes).toBe(0);
    score.add("a");
    score.set("b", 3);
    score.add("a", 2);
    expect(score.changes).toBe(3);
    score.get("a");
    score.entries();
    score.leader();
    score.reached(1);
    expect(score.changes).toBe(3);
  });
});

describe("Roster", () => {
  it("adds once per name, case-insensitively", () => {
    const roster = new Roster();
    const first = roster.add("Steve", 3, "red");
    expect(first).toEqual({ name: "Steve", lives: 3, team: "red", state: "alive" });
    const again = roster.add("STEVE", 1, "blue");
    expect(again).toBe(first);
    expect(again).toMatchObject({ name: "Steve", lives: 3, team: "red" });
    expect(roster.all()).toHaveLength(1);
    expect(roster.get("steve")).toBe(first);
    expect(roster.get("Alex")).toBeUndefined();
  });

  it("filters by state and by team", () => {
    const roster = new Roster();
    roster.add("A", 1, "red");
    roster.add("B", 1, "red").state = "respawning";
    roster.add("C", 1, "blue").state = "out";
    roster.add("D", 1, "blue").state = "left";
    expect(roster.inState("alive").map((p) => p.name)).toEqual(["A"]);
    expect(roster.inState("alive", "respawning").map((p) => p.name)).toEqual(["A", "B"]);
    expect(roster.inState("out", "left").map((p) => p.name)).toEqual(["C", "D"]);
    expect(roster.teamMembers("red").map((p) => p.name)).toEqual(["A", "B"]);
    expect(roster.teamMembers("blue").map((p) => p.name)).toEqual(["C", "D"]);
    expect(roster.teamMembers("green")).toEqual([]);
  });

  it("counts alive and respawning players as standing, and leaves out the rest", () => {
    const roster = new Roster();
    roster.add("Alex", 1);
    roster.add("Kai", 1).state = "respawning";
    roster.add("Sam", 1).state = "out";
    roster.add("Lee", 1).state = "left";
    expect(roster.standingSides()).toEqual(["Alex", "Kai"]);
  });

  it("collapses team members into one side per team", () => {
    const roster = new Roster();
    roster.add("A", 1, "red");
    roster.add("B", 1, "red").state = "respawning";
    roster.add("C", 1, "blue").state = "out";
    roster.add("D", 1, "blue").state = "left";
    roster.add("E", 1, "green");
    roster.add("F", 1, "green");
    expect(roster.standingSides()).toEqual(["red", "green"]);
    roster.get("E")!.state = "out";
    roster.get("F")!.state = "out";
    expect(roster.standingSides()).toEqual(["red"]);
    roster.get("A")!.state = "out";
    roster.get("B")!.state = "left";
    expect(roster.standingSides()).toEqual([]);
  });
});

describe("MapView", () => {
  const base: MapConfig = { name: "Arena", spawns: [[1, 64, 2], [3, 64, 4]] };

  it("falls back to 5 above the first spawn for spectators", () => {
    expect(new MapView(base).spectatorSpawn).toEqual([1, 69, 2]);
    expect(new MapView({ ...base, spectatorSpawn: [0, 80, 0] }).spectatorSpawn).toEqual([0, 80, 0]);
    expect(new MapView({ name: "Empty", spawns: [] }).spectatorSpawn).toEqual([0, 75, 0]);
  });

  it("returns a copy of the spectator spawn", () => {
    const config: MapConfig = { ...base, spectatorSpawn: [0, 80, 0] };
    const spot = new MapView(config).spectatorSpawn;
    spot[1] = 1;
    expect(config.spectatorSpawn).toEqual([0, 80, 0]);
  });

  it("centers on the middle of the bounds, else the first spawn", () => {
    expect(new MapView({ ...base, bounds: { min: [-10, 50, -10], max: [10, 90, 20] } }).center()).toEqual([0, 70, 5]);
    expect(new MapView(base).center()).toEqual([1, 64, 2]);
    expect(new MapView({ name: "Empty", spawns: [] }).center()).toEqual([0, 64, 0]);
  });

  it("is out below killY", () => {
    const view = new MapView({ ...base, killY: 40 });
    expect(view.killY).toBe(40);
    expect(view.outOfBounds({ x: 0, y: 39.9, z: 0 })).toBe(true);
    expect(view.outOfBounds({ x: 0, y: 40, z: 0 })).toBe(false);
    expect(view.outOfBounds({ x: 1000, y: 200, z: -1000 })).toBe(false);
  });

  it("treats bounds as inclusive blocks", () => {
    const view = new MapView({ ...base, bounds: { min: [-10, 50, -10], max: [12, 90, 12] } });
    expect(view.outOfBounds({ x: 12.9, y: 60, z: 0 })).toBe(false);
    expect(view.outOfBounds({ x: 13.0, y: 60, z: 0 })).toBe(true);
    expect(view.outOfBounds({ x: 0, y: 60, z: 12.99 })).toBe(false);
    expect(view.outOfBounds({ x: 0, y: 60, z: 13 })).toBe(true);
    expect(view.outOfBounds({ x: -10, y: 60, z: 0 })).toBe(false);
    expect(view.outOfBounds({ x: -10.01, y: 60, z: 0 })).toBe(true);
    expect(view.outOfBounds({ x: 0, y: 50, z: 0 })).toBe(false);
    expect(view.outOfBounds({ x: 0, y: 49.5, z: 0 })).toBe(true);
    expect(view.outOfBounds({ x: 0, y: 90.9, z: 0 })).toBe(false);
    expect(view.outOfBounds({ x: 0, y: 91, z: 0 })).toBe(true);
  });

  it("checks killY and bounds together, and nothing without either", () => {
    const view = new MapView({ ...base, killY: 60, bounds: { min: [-10, 50, -10], max: [10, 90, 10] } });
    expect(view.outOfBounds({ x: 0, y: 55, z: 0 })).toBe(true);
    expect(view.outOfBounds({ x: 0, y: 65, z: 0 })).toBe(false);
    expect(view.outOfBounds({ x: 20, y: 65, z: 0 })).toBe(true);
    expect(new MapView(base).outOfBounds({ x: 1e6, y: -1e6, z: 0 })).toBe(false);
  });

  it("reads named entries, with empty defaults", () => {
    const floor: Box = { min: [0, 60, 0], max: [5, 60, 5] };
    const view = new MapView({
      ...base,
      teamSpawns: { red: [[5, 64, 0]] },
      points: { flag: [[0, 70, 0], [1, 70, 1]] },
      regions: { floor: [floor] },
    });
    expect(view.spawns).toEqual(base.spawns);
    expect(view.bounds).toBeUndefined();
    expect(view.teamSpawns("red")).toEqual([[5, 64, 0]]);
    expect(view.teamSpawns("blue")).toEqual([]);
    expect(view.points("flag")).toEqual([[0, 70, 0], [1, 70, 1]]);
    expect(view.points("bomb")).toEqual([]);
    expect(view.regions("floor")).toEqual([floor]);
    expect(view.regions("plot")).toEqual([]);
    const bare = new MapView(base);
    expect(bare.teamSpawns("red")).toEqual([]);
    expect(bare.points("flag")).toEqual([]);
    expect(bare.regions("floor")).toEqual([]);
    expect(bare.killY).toBeUndefined();
  });

  it("keeps saved facings, and centers on a spawn's block", () => {
    const view = new MapView({ name: "Facing", spawns: [[1, 64, 2, 90, 10]], spectatorSpawn: [0, 80, 0, -45, 30] });
    expect(view.spawns[0]).toEqual([1, 64, 2, 90, 10]);
    expect(view.spectatorSpawn).toEqual([0, 80, 0, -45, 30]);
    expect(view.center()).toEqual([1, 64, 2]);
    expect(new MapView({ name: "Fallback", spawns: [[1, 64, 2, 90, 10]] }).spectatorSpawn).toEqual([1, 69, 2]);
  });

  it("puts players out inside a kill region, but not spectators", () => {
    const pit: Box = { min: [0, 50, 0], max: [4, 55, 4] };
    const view = new MapView({ ...base, bounds: { min: [-10, 40, -10], max: [10, 90, 10] }, regions: { kill: [pit] } });
    expect(view.killRegions).toEqual([pit]);
    expect(view.outOfBounds({ x: 2, y: 52, z: 2 })).toBe(true);
    expect(view.outOfBounds({ x: 2, y: 52, z: 2 }, { killRegions: false })).toBe(false);
    expect(view.outOfBounds({ x: 2, y: 56, z: 2 })).toBe(false);
    expect(new MapView(base).killRegions).toEqual([]);
  });

  it("reads one team's points and regions", () => {
    const zone: Box = { min: [0, 60, 0], max: [3, 62, 3] };
    const view = new MapView({ ...base, points: { flag: [[0, 65, 0]], "flag.red": [[-5, 65, 0]] }, regions: { "buyZone.blue": [zone] } });
    expect(view.points("flag")).toEqual([[0, 65, 0]]);
    expect(view.points("flag", "red")).toEqual([[-5, 65, 0]]);
    expect(view.points("flag", "blue")).toEqual([]);
    expect(view.regions("buyZone", "blue")).toEqual([zone]);
  });
});

describe("inside", () => {
  it("covers whole blocks from min up to the far edge of max", () => {
    const box: Box = { min: [0, 0, 0], max: [0, 0, 0] };
    expect(inside({ x: 0, y: 0, z: 0 }, box)).toBe(true);
    expect(inside({ x: 0.99, y: 0.5, z: 0.01 }, box)).toBe(true);
    expect(inside({ x: 1, y: 0, z: 0 }, box)).toBe(false);
    expect(inside({ x: 0, y: -0.01, z: 0 }, box)).toBe(false);
    expect(inside({ x: 0, y: 0, z: 1 }, box)).toBe(false);
  });
});
