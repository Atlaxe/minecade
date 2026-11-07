import { beforeEach, describe, expect, it } from "vitest";
import { Combat, type CombatHost } from "../src/game/combat.ts";
import { KillCredit } from "../src/game/credit.ts";
import type { StatsRecorder } from "../src/game/stats.ts";
import { system, world, type FakePlayer } from "./fake-mc-server.ts";

beforeEach(() => {
  system.reset();
  world.reset();
});

/** A Combat over players who are all fighting, Ann and Bo on one team, recording downs and damage. */
function setup() {
  const downs: { name: string; cause: string }[] = [];
  const damage: { name: string; amount: number; attacker?: string }[] = [];
  const host: CombatHost = {
    playing: true,
    nameOf: (entity) => (entity as unknown as FakePlayer).name,
    canFight: () => true,
    isProtected: () => false,
    areAllies: (a, b) => a !== b && [a, b].every((name) => ["Ann", "Bo"].includes(name)),
    onDamage: () => undefined,
    down: (name, cause) => downs.push({ name, cause }),
  };
  const stats = { damage: (name: string, amount: number, attacker?: string) => damage.push({ name, amount, attacker }) } as unknown as StatsRecorder;
  const credit = new KillCredit(100);
  const combat = new Combat(host, {}, stats, credit);
  return { combat, downs, damage, credit };
}

describe("Combat.hit", () => {
  it("takes health straight off with direct: no hurt event (so no armor or hurt cooldown), the damage counted and credited", () => {
    const { combat, damage, credit } = setup();
    const cy = world.join("Cy");
    world.join("Ann");
    const hurts: unknown[] = [];
    world.afterEvents.entityHurt.subscribe((event) => hurts.push(event));
    expect(combat.hit(cy as never, "Ann", 3, "gun", { direct: true })).toBe("hurt");
    expect(combat.hit(cy as never, "Ann", 3, "gun", { direct: true })).toBe("hurt");
    expect(cy.health.currentValue).toBe(14);
    expect(hurts).toEqual([]);
    expect(damage).toEqual([
      { name: "Cy", amount: 3, attacker: "Ann" },
      { name: "Cy", amount: 3, attacker: "Ann" },
    ]);
    expect(credit.creditFor("Cy", system.currentTick)).toBe("Ann");
  });

  it("downs whoever it would take to nothing, and says when a hit didn't count", () => {
    const { combat, downs } = setup();
    const cy = world.join("Cy");
    const bo = world.join("Bo");
    expect(combat.hit(cy as never, "Ann", 25, "gun", { direct: true })).toBe("down");
    expect(downs).toEqual([{ name: "Cy", cause: "gun" }]);
    // Already going down.
    expect(combat.hit(cy as never, "Ann", 1, "gun", { direct: true })).toBeUndefined();
    // A teammate's.
    expect(combat.hit(bo as never, "Ann", 5, "gun", { direct: true })).toBeUndefined();
    expect(bo.health.currentValue).toBe(20);
    // One's own blast: no attacker.
    expect(combat.hit(bo as never, undefined, 5, "explosion", { direct: true })).toBe("hurt");
    expect(bo.health.currentValue).toBe(15);
  });
});
