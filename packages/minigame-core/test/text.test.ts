import { describe, expect, it } from "vitest";
import { COLOR, KILL_VERBS, NO_KILLER_LINES, deathMessage, nameOf, ordinal, say, stripColors } from "../src/text.ts";

describe("say", () => {
  it("colors a line and ends it with a reset", () => {
    expect(say.minor("Wrapping up")).toBe("§7Wrapping up§r");
    expect(say.error("Couldn't start")).toBe("§cCouldn't start§r");
    expect(say.success("Go!")).toBe("§aGo!§r");
  });

  it("returns to its own color after a colored name inside it", () => {
    expect(say.info(`${nameOf("Alex")} is starting Sumo.`)).toBe("§b§fAlex§r§b is starting Sumo.§r");
    expect(say.important(`${nameOf("Red", "§c")} wins round 2!`)).toBe("§9§cRed§r§9 wins round 2!§r");
  });

  it("strips formatting for logs and tests", () => {
    expect(stripColors(say.info(`${nameOf("Alex")} joined`))).toBe("Alex joined");
  });
});

describe("deathMessage", () => {
  const first = () => 0;
  const last = () => 0.999;

  it("reads '<victim> was <verb> by <killer>': gray victim, yellow verb, red killer", () => {
    expect(deathMessage({ victim: "Alex", killer: "Kai", cause: "entityAttack" }, {}, first)).toBe(
      `§7Alex§r ${COLOR.highlight}was ${KILL_VERBS[0]} by §cKai§r`,
    );
    expect(stripColors(deathMessage({ victim: "Alex", killer: "Kai", cause: "void" }, {}, last))).toBe(`Alex was ${KILL_VERBS.at(-1)} by Kai`);
  });

  it("uses team colors when there are teams", () => {
    expect(deathMessage({ victim: "Alex", victimColor: "§9", killer: "Kai", killerColor: "§a", cause: "entityAttack" }, {}, first)).toBe(
      `§9Alex§r §ewas ${KILL_VERBS[0]} by §aKai§r`,
    );
  });

  it("adds a game's verbs to the pool, or uses only them with replace", () => {
    const paintball = { verbs: ["painted", "splattered"] };
    expect(stripColors(deathMessage({ victim: "A", killer: "B", cause: "projectile" }, paintball, last))).toBe("A was splattered by B");
    const verbs = new Set(
      Array.from({ length: 40 }, (_, i) => stripColors(deathMessage({ victim: "A", killer: "B", cause: "x" }, { ...paintball, replace: true }, () => i / 40))),
    );
    expect(verbs).toEqual(new Set(["A was painted by B", "A was splattered by B"]));
  });

  it("picks a line by cause when nobody gets the credit, or the game's own lines", () => {
    expect(stripColors(deathMessage({ victim: "A", cause: "void" }, {}, first))).toBe(`A ${NO_KILLER_LINES.void[0]}`);
    expect(stripColors(deathMessage({ victim: "A", cause: "fall" }, {}, first))).toBe(`A ${NO_KILLER_LINES.fall[0]}`);
    expect(stripColors(deathMessage({ victim: "A", cause: "lava" }, {}, first))).toBe(`A ${NO_KILLER_LINES.generic[0]}`);
    expect(stripColors(deathMessage({ victim: "A", cause: "void" }, { noKiller: ["fell off the plot"] }, first))).toBe("A fell off the plot");
  });
});

describe("ordinal", () => {
  it("writes places the English way", () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "10th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "101st",
      "111th",
      "112th",
    ]);
  });
});
