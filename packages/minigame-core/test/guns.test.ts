import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRENADE, GUNS, PAINTBALL, THROWN_GRENADE } from "../src/gun-defs.ts";
import { Guns, coneDirections, type Shot } from "../src/game/guns.ts";
import { mixDyes } from "../src/kit-defs.ts";
import { Scope } from "../src/scope.ts";
import { Direction, ItemStack, system, world, type FakeMob, type FakePlayer } from "./fake-mc-server.ts";

beforeEach(() => {
  system.reset();
  world.reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A player holding `item` in their first hotbar slot. */
function holding(name: string, item: string): FakePlayer {
  const player = world.join(name);
  player.inventory.slots[0] = new ItemStack(item);
  return player;
}

function setup(canFire: (player: FakePlayer) => boolean = () => true) {
  const scope = new Scope();
  const hits: { shot: Shot; entity: unknown }[] = [];
  const blocks: { shot: Shot; face: string }[] = [];
  const bursts: Shot[] = [];
  const guns = new Guns(scope, {
    canFire: (player) => canFire(player as unknown as FakePlayer),
    colorOf: () => 14,
    onHitEntity: (shot, entity) => hits.push({ shot, entity }),
    onHitBlock: (shot, hit) => blocks.push({ shot, face: hit.face }),
    onBurst: (shot) => bursts.push(shot),
    random: () => 0.5,
  });
  const balls = () => world.overworld.spawned.filter((mob) => mob.typeId === PAINTBALL);
  return { scope, guns, hits, blocks, bursts, balls };
}

const use = (player: FakePlayer) => world.afterEvents.itemUse.emit({ source: player, itemStack: player.inventory.slots[0]! });

describe("Guns", () => {
  it("fires a tap gun once per use, at its fire rate, in the shooter's color, and starts its item cooldown", () => {
    const { balls } = setup();
    const player = holding("Ann", GUNS.pistol.item);
    use(player);
    use(player);
    expect(balls()).toHaveLength(1);
    const [ball] = balls();
    expect(ball.properties.get("minecade:color")).toBe(14);
    expect(ball.projectile.owner).toBe(player);
    // Fired the way the player looks (south), at the pistol's speed.
    expect(ball.projectile.shot!.z).toBeCloseTo(GUNS.pistol.speed, 1);
    expect(player.inventory.slots[0]!.cooldownsStarted).toBe(1);
    expect(world.overworld.sounds.map((sound) => sound.id)).toEqual([GUNS.pistol.sound.id]);
    system.advanceTicks(GUNS.pistol.everyTicks);
    use(player);
    expect(balls()).toHaveLength(2);
  });

  it("keeps firing a held gun while use is held, and stops when it's let go or put away", () => {
    const { balls } = setup();
    const player = holding("Ann", GUNS.rifle.item);
    world.afterEvents.itemStartUse.emit({ source: player, itemStack: player.inventory.slots[0]!, useDuration: 0 });
    expect(balls()).toHaveLength(1);
    system.advanceTicks(GUNS.rifle.everyTicks * 3);
    expect(balls()).toHaveLength(4);
    world.afterEvents.itemStopUse.emit({ source: player, itemStack: player.inventory.slots[0]!, useDuration: 12 });
    system.advanceTicks(GUNS.rifle.everyTicks * 3);
    expect(balls()).toHaveLength(4);
    // A tap on its own still fires one; switching slots ends a hold.
    use(player);
    expect(balls()).toHaveLength(5);
    world.afterEvents.itemStartUse.emit({ source: player, itemStack: player.inventory.slots[0]!, useDuration: 0 });
    player.selectedSlotIndex = 1;
    system.advanceTicks(GUNS.rifle.everyTicks * 3);
    expect(balls()).toHaveLength(5);
  });

  it("fires nothing when the game says no", () => {
    const { balls } = setup(() => false);
    use(holding("Ann", GUNS.pistol.item));
    expect(balls()).toHaveLength(0);
  });

  it("sprays a shotgun's balls in a cone, and counts at most its cap of them on one target", () => {
    const { balls, hits } = setup();
    const player = holding("Ann", GUNS.shotgun.item);
    const victim = world.join("Bo");
    use(player);
    expect(balls()).toHaveLength(GUNS.shotgun.pellets);
    for (const ball of balls()) world.projectileHitsEntity(ball, victim, undefined, player);
    expect(hits).toHaveLength(GUNS.shotgun.maxHitsPerShot);
    expect(hits[0].shot).toMatchObject({ shooter: "Ann", weapon: "shotgun", color: 14 });
    // Each ball is taken out of the air as it lands.
    expect(balls().every((ball) => !ball.isValid)).toBe(true);
  });

  it("reports a ball's block and face, and takes a ball away once it has flown its range", () => {
    const { guns, balls, blocks } = setup();
    const player = holding("Ann", GUNS.pistol.item);
    use(player);
    world.projectileHitsBlock(balls()[0], { x: 0, y: 64, z: 5 }, Direction.North, player);
    expect(blocks).toEqual([{ shot: expect.objectContaining({ weapon: "pistol" }), face: Direction.North }]);
    system.advanceTicks(GUNS.pistol.everyTicks);
    use(player);
    expect(guns.inFlight).toBe(1);
    system.advanceTicks(GUNS.pistol.lifeTicks);
    expect(guns.inFlight).toBe(0);
    expect(balls()[1].isValid).toBe(false);
  });

  it("ignores projectiles it didn't fire", () => {
    const { hits } = setup();
    const arrow = world.overworld.spawnEntity("minecraft:arrow", { x: 0, y: 65, z: 0 }) as FakeMob;
    world.projectileHitsEntity(arrow, world.join("Bo"));
    expect(hits).toEqual([]);
  });

  it("throws a grenade, uses it up, and bursts it where it lands", () => {
    const { bursts } = setup();
    const player = holding("Ann", GRENADE.item);
    use(player);
    expect(player.inventory.slots[0]).toBeUndefined();
    const [grenade] = world.overworld.spawned.filter((mob) => mob.typeId === THROWN_GRENADE);
    expect(grenade.projectile.shot!.y).toBeGreaterThan(0);
    world.projectileHitsBlock(grenade, { x: 0, y: 64, z: 5 }, Direction.Up, player);
    expect(bursts).toEqual([expect.objectContaining({ weapon: "grenade", shooter: "Ann" })]);
  });

  it("takes everything still in the air away when its scope ends", () => {
    const { scope, balls } = setup();
    use(holding("Ann", GUNS.pistol.item));
    scope.dispose();
    expect(balls()[0].isValid).toBe(false);
    expect(world.afterEvents.itemUse.listenerCount).toBe(0);
  });
});

describe("coneDirections", () => {
  const angle = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    (Math.acos(Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)))) * 180) / Math.PI;

  it("stays within the spread of the view, in any direction, straight up too", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const view of [{ x: 0, y: 0, z: 1 }, { x: 1, y: -0.5, z: -1 }, { x: 0, y: 1, z: 0 }]) {
      const directions = coneDirections(view, 50, 9, random);
      expect(directions).toHaveLength(50);
      for (const direction of directions) {
        expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 6);
        expect(angle(direction, view)).toBeLessThanOrEqual(9.0001);
      }
      expect(Math.max(...directions.map((direction) => angle(direction, view)))).toBeGreaterThan(5);
    }
  });

  it("is the view itself with no spread", () => {
    const [direction] = coneDirections({ x: 0, y: 0, z: 2 }, 1, 0, Math.random);
    expect(direction).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe("mixDyes", () => {
  const red = { red: 0.85, green: 0.15, blue: 0.15 };
  const yellow = { red: 0.95, green: 0.85, blue: 0.2 };
  const blue = { red: 0.2, green: 0.35, blue: 0.9 };

  it("mixes red and yellow into orange, red and blue into purple", () => {
    const orange = mixDyes([red, yellow]);
    expect(orange.red).toBeGreaterThan(orange.green);
    expect(orange.green).toBeGreaterThan(orange.blue);
    expect(orange.green).toBeGreaterThan(0.4);
    const purple = mixDyes([red, blue]);
    expect(purple.red).toBeGreaterThan(purple.green * 1.5);
    expect(purple.blue).toBeGreaterThan(purple.green * 1.5);
  });

  it("keeps a mix as bright as its colors", () => {
    const mix = mixDyes([red, blue]);
    expect(Math.max(mix.red, mix.green, mix.blue)).toBeCloseTo((0.85 + 0.9) / 2, 6);
    expect(mixDyes([red])).toEqual(red);
  });
});
