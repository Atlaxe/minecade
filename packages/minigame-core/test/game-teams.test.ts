import { describe, expect, it } from "vitest";
import type { TeamDef, TeamsConfig } from "../src/config.ts";
import { activeTeams, assignTeams, DEFAULT_TEAMS, shuffle } from "../src/game/teams.ts";

/** A small LCG so "random" fills are repeatable. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function players(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `P${i + 1}`);
}

function members(assignment: Map<string, string>, team: string): string[] {
  return [...assignment].filter(([, id]) => id === team).map(([player]) => player);
}

/** Team sizes, largest first. */
function sizes(assignment: Map<string, string>): number[] {
  const counts = new Map<string, number>();
  for (const team of assignment.values()) counts.set(team, (counts.get(team) ?? 0) + 1);
  return [...counts.values()].sort((a, b) => b - a);
}

const roles: TeamDef[] = [
  { id: "seekers", name: "Seekers", color: "§c", size: 1 },
  { id: "hiders", name: "Hiders", color: "§a", size: "rest" },
];

describe("activeTeams", () => {
  it("uses an exact count, capped at the defined teams", () => {
    expect(activeTeams(5, { count: 2 }).map((team) => team.id)).toEqual(["red", "blue"]);
    expect(activeTeams(1, { count: 3 })).toHaveLength(3);
    expect(activeTeams(12, { count: 6 })).toHaveLength(4);
  });

  it("opens as many teams as a range allows, by minPerTeam", () => {
    const cfg: TeamsConfig = { count: [2, 4], minPerTeam: 2 };
    expect(activeTeams(5, cfg)).toHaveLength(2);
    expect(activeTeams(7, cfg)).toHaveLength(3);
    expect(activeTeams(2, cfg)).toHaveLength(2);
    expect(activeTeams(20, cfg)).toHaveLength(4);
  });

  it("falls back to the default teams and uses custom defs when given", () => {
    expect(activeTeams(8, { count: 4 })).toEqual(DEFAULT_TEAMS);
    const defs: TeamDef[] = [
      { id: "cats", name: "Cats", color: "§6" },
      { id: "dogs", name: "Dogs", color: "§b" },
      { id: "owls", name: "Owls", color: "§7" },
    ];
    expect(activeTeams(6, { count: 2, defs }).map((team) => team.id)).toEqual(["cats", "dogs"]);
  });

  it("uses every def in a role setup, whatever the count", () => {
    expect(activeTeams(10, { count: 1, defs: roles })).toEqual(roles);
  });
});

describe("assignTeams", () => {
  it("splits 5 players into an exact 2 teams of 3 and 2", () => {
    const assignment = assignTeams(players(5), new Map(), { count: 2 }, seeded(1));
    expect(sizes(assignment)).toEqual([3, 2]);
    expect(new Set(assignment.values())).toEqual(new Set(["red", "blue"]));
  });

  it("opens teams from a range by player count", () => {
    const cfg: TeamsConfig = { count: [2, 4], minPerTeam: 2 };
    expect(sizes(assignTeams(players(5), new Map(), cfg, seeded(2)))).toEqual([3, 2]);
    expect(sizes(assignTeams(players(7), new Map(), cfg, seeded(3)))).toEqual([3, 2, 2]);
  });

  it("assigns every player exactly once to an active team", () => {
    const cfgs: TeamsConfig[] = [{ count: 2 }, { count: 3 }, { count: [2, 4], minPerTeam: 2 }, { count: 1, defs: roles }];
    for (const cfg of cfgs) {
      for (let n = 1; n <= 9; n++) {
        const list = players(n);
        const assignment = assignTeams(list, new Map([["P1", "blue"]]), cfg, seeded(n));
        expect([...assignment.keys()].sort()).toEqual([...list].sort());
        const ids = activeTeams(n, cfg).map((team) => team.id);
        for (const team of assignment.values()) expect(ids).toContain(team);
      }
    }
  });

  it("uses the default teams when cfg.defs is missing", () => {
    const assignment = assignTeams(players(8), new Map(), { count: 4 }, seeded(4));
    expect(new Set(assignment.values())).toEqual(new Set(["red", "blue", "green", "yellow"]));
    expect(sizes(assignment)).toEqual([2, 2, 2, 2]);
  });

  it("honors picks in player order up to the cap, and balances the rest", () => {
    const six = players(6);
    const allRed = new Map(six.map((player) => [player, "red"]));
    const two = assignTeams(six, allRed, { count: 2 }, seeded(5));
    expect(members(two, "red")).toEqual(["P1", "P2", "P3"]);
    expect(members(two, "blue").sort()).toEqual(["P4", "P5", "P6"]);

    const seven = players(7);
    const three = assignTeams(seven, new Map(seven.map((player) => [player, "red"])), { count: 3 }, seeded(6));
    expect(members(three, "red")).toEqual(["P1", "P2", "P3"]);
    expect(members(three, "blue")).toHaveLength(2);
    expect(members(three, "green")).toHaveLength(2);
  });

  it("keeps picks for open teams and ignores picks for teams not in play", () => {
    const picks = new Map([
      ["P1", "blue"],
      ["P2", "blue"],
      ["P3", "green"],
      ["P4", "purple"],
    ]);
    const assignment = assignTeams(players(4), picks, { count: 2 }, seeded(7));
    expect(members(assignment, "blue")).toEqual(["P1", "P2"]);
    expect(members(assignment, "red").sort()).toEqual(["P3", "P4"]);
  });

  it("is repeatable with a seeded random, and the seed matters", () => {
    const list = players(9);
    const cfg: TeamsConfig = { count: 3 };
    const first = assignTeams(list, new Map(), cfg, seeded(42));
    const again = assignTeams(list, new Map(), cfg, seeded(42));
    expect(Object.fromEntries(again)).toEqual(Object.fromEntries(first));
    const variants = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      variants.add(JSON.stringify(Object.fromEntries(assignTeams(list, new Map(), cfg, seeded(seed)))));
    }
    expect(variants.size).toBeGreaterThan(1);
  });

  it("deals shuffled players to the smallest team, breaking ties at random", () => {
    const list = players(4);
    // random 0: the shuffle gives P2 P3 P4 P1 and ties go to the first team.
    expect(Object.fromEntries(assignTeams(list, new Map(), { count: 2 }, () => 0))).toEqual({
      P1: "blue",
      P2: "red",
      P3: "blue",
      P4: "red",
    });
    // random just under 1: the shuffle keeps the order and ties go to the last team.
    expect(Object.fromEntries(assignTeams(list, new Map(), { count: 2 }, () => 0.999))).toEqual({
      P1: "blue",
      P2: "red",
      P3: "blue",
      P4: "red",
    });
    expect(assignTeams(["Solo"], new Map(), { count: 2 }, () => 0.999).get("Solo")).toBe("blue");
    expect(assignTeams(["Solo"], new Map(), { count: 2 }, () => 0).get("Solo")).toBe("red");
  });

  describe("role setups", () => {
    const cfg: TeamsConfig = { count: 2, defs: roles };

    it("fills the fixed-size role first and gives the rest to the unsized team", () => {
      for (let seed = 1; seed <= 10; seed++) {
        const assignment = assignTeams(players(5), new Map(), cfg, seeded(seed));
        expect(members(assignment, "seekers")).toHaveLength(1);
        expect(members(assignment, "hiders")).toHaveLength(4);
      }
    });

    it("honors a seeker pick, first come first served", () => {
      const one = assignTeams(players(5), new Map([["P3", "seekers"]]), cfg, seeded(8));
      expect(members(one, "seekers")).toEqual(["P3"]);
      const two = assignTeams(
        players(5),
        new Map([
          ["P4", "seekers"],
          ["P2", "seekers"],
        ]),
        cfg,
        seeded(9),
      );
      expect(members(two, "seekers")).toEqual(["P2"]);
      expect(two.get("P4")).toBe("hiders");
    });

    it("honors a hider pick and still finds a seeker among the rest", () => {
      const assignment = assignTeams(players(5), new Map([["P1", "hiders"]]), cfg, seeded(10));
      expect(assignment.get("P1")).toBe("hiders");
      expect(members(assignment, "seekers")).toHaveLength(1);
    });

    it("keeps room for the fixed-size role when everyone picks the unsized team", () => {
      const list = players(5);
      const assignment = assignTeams(list, new Map(list.map((player) => [player, "hiders"])), cfg, seeded(11));
      expect(members(assignment, "seekers")).toHaveLength(1);
      expect(members(assignment, "hiders")).toHaveLength(4);
    });
  });
});

describe("shuffle", () => {
  it("returns a permutation and leaves the input alone", () => {
    const items = ["a", "b", "c", "d", "e"];
    const shuffled = shuffle(items, seeded(3));
    expect(items).toEqual(["a", "b", "c", "d", "e"]);
    expect([...shuffled].sort()).toEqual(items);
  });

  it("follows the random source (Fisher-Yates)", () => {
    expect(shuffle(["a", "b", "c", "d"], () => 0)).toEqual(["b", "c", "d", "a"]);
    expect(shuffle(["a", "b", "c", "d"], () => 0.999)).toEqual(["a", "b", "c", "d"]);
    expect(shuffle([], () => 0)).toEqual([]);
  });
});
