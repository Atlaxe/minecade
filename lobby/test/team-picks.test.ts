import { describe, expect, it } from "vitest";
import { assignTeams } from "@minecade/minigame-core";
import { TeamPicks } from "../behavior_pack/scripts/team-picks.ts";

const players = ["Steve", "Alex", "Bob", "Cara"];

describe("TeamPicks", () => {
  it("uses the game's teams and caps each at ceil(players / teams)", () => {
    const picks = new TeamPicks(players.slice(0, 3), { count: 2 });
    expect(picks.teams.map((team) => team.id)).toEqual(["red", "blue"]);
    expect(picks.cap).toBe(2);
    expect(picks.pick("Steve", "red")).toBe(true);
    expect(picks.pick("Alex", "red")).toBe(true);
    expect(picks.pick("Bob", "red")).toBe(false); // full
    expect(picks.pick("Bob", "green")).toBe(false); // not in this match
    expect(picks.pick("Nobody", "blue")).toBe(false); // not playing
    expect(picks.view()).toEqual({
      teams: [
        { id: "red", name: "Red", color: "§c", members: ["Steve", "Alex"], cap: 2, full: true },
        { id: "blue", name: "Blue", color: "§9", members: [], cap: 2, full: false },
      ],
      unpicked: ["Bob"],
    });
  });

  it("switches teams, goes back to random, and frees spots when players leave", () => {
    const picks = new TeamPicks(players, { count: 2 });
    picks.pick("Steve", "red");
    picks.pick("Alex", "red");
    expect(picks.pick("Steve", "blue")).toBe(true);
    expect(picks.teamOf("Steve")).toBe("blue");
    expect(picks.pick("Steve", undefined)).toBe(true);
    expect(picks.teamOf("Steve")).toBeUndefined();
    picks.pick("Bob", "red");
    expect(picks.view().teams[0].full).toBe(true);
    picks.remove("Bob");
    expect(picks.cap).toBe(2); // 3 players: still ceil(3 / 2)
    picks.remove("Cara");
    expect(picks.cap).toBe(1);
    expect(picks.picks()).toEqual({ Alex: "red" });
  });

  it("is done when everyone still here has picked", () => {
    const picks = new TeamPicks(players.slice(0, 2), { count: 2 });
    picks.pick("Steve", "red");
    expect(picks.allPicked(["Steve", "Alex"])).toBe(false);
    expect(picks.allPicked(["Steve"])).toBe(true); // Alex isn't in the lobby
    picks.pick("Alex", "blue");
    expect(picks.allPicked(["Steve", "Alex"])).toBe(true);
  });

  it("only allows picks the game server's assignTeams honors", () => {
    const picks = new TeamPicks(players, { count: 2 });
    for (const [name, team] of [["Steve", "red"], ["Alex", "red"], ["Bob", "red"], ["Cara", "blue"]] as const) picks.pick(name, team);
    const chosen = picks.picks();
    const assigned = assignTeams(players, new Map(Object.entries(chosen)), { count: 2 }, () => 0.5);
    for (const [name, team] of Object.entries(chosen)) expect(assigned.get(name)).toBe(team);
  });
});
