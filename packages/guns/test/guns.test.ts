import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scope } from "@minecade/minigame-core";
import { GRENADE, GUNS, PAINTBALL, PRIMED_GRENADE, THROWN_GRENADE, dyeIndex, gunItem, shotMarker, type GunDef } from "../src/defs.ts";
import { Guns, ammoText, coneDirections, type AmmoState, type GunsOptions, type Shot } from "../src/guns.ts";
import { Direction, EntitySwingSource, ItemStack, system, world, type FakeMob, type FakePlayer } from "../../minigame-core/test/fake-mc-server.ts";

beforeEach(() => {
  system.reset();
  world.reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A player holding `item` in their first hotbar slot. */
function holding(name: string, item: string, count = 1): FakePlayer {
  const player = world.join(name);
  player.inventory.slots[0] = new ItemStack(item, count);
  return player;
}

function setup(options: Partial<GunsOptions> = {}) {
  const scope = new Scope();
  const hits: { shot: Shot; entity: unknown }[] = [];
  const blocks: { shot: Shot; face: string }[] = [];
  const bursts: { shot: Shot; location: unknown }[] = [];
  const ammo: AmmoState[] = [];
  const guns = new Guns(scope, {
    canFire: () => true,
    onHitEntity: (shot, entity) => hits.push({ shot, entity }),
    onHitBlock: (shot, hit) => blocks.push({ shot, face: hit.face }),
    onBurst: (shot, location) => bursts.push({ shot, location }),
    onAmmo: (_player, state) => ammo.push(state),
    random: () => 0.5,
    ...options,
  });
  const spawned = (typeId: string) => world.overworld.spawned.filter((mob) => mob.typeId === typeId);
  const balls = () => spawned(PAINTBALL);
  return { scope, guns, hits, blocks, bursts, ammo, balls, spawned };
}

/** A left click: the swing Bedrock reports for an attack. */
const click = (player: FakePlayer, swingSource: string = EntitySwingSource.Attack) =>
  world.afterEvents.playerSwingStart.emit({ player, heldItemStack: player.inventory.slots[player.selectedSlotIndex], swingSource });
const startUse = (player: FakePlayer) => world.afterEvents.itemStartUse.emit({ source: player, itemStack: player.inventory.slots[0]!, useDuration: 0 });
const stopUse = (player: FakePlayer) => world.afterEvents.itemStopUse.emit({ source: player, itemStack: player.inventory.slots[0], useDuration: 10 });
const use = (player: FakePlayer) => world.afterEvents.itemUse.emit({ source: player, itemStack: player.inventory.slots[0]! });
const angleOf = (velocity: { x: number; y: number; z: number }) => (Math.acos(velocity.z / Math.hypot(velocity.x, velocity.y, velocity.z)) * 180) / Math.PI;

describe("Guns", () => {
  it("fires a tap gun once per left click, at its fire rate, in the gun's paint, and kicks its held model", () => {
    const { balls } = setup();
    const player = holding("Ann", gunItem("pistol", "red"));
    click(player);
    click(player);
    expect(balls()).toHaveLength(1);
    const [ball] = balls();
    expect(ball.properties.get("minecade:color")).toBe(dyeIndex("red"));
    expect(ball.projectile.owner).toBe(player);
    // Fired the way the player looks (south), at the pistol's speed.
    expect(ball.projectile.shot!.z).toBeCloseTo(GUNS.pistol.speed, 1);
    expect(world.overworld.sounds.map((sound) => sound.id)).toEqual([GUNS.pistol.sound.id]);
    // The recoil runs off the shot marker's cooldown, not the gun's own.
    expect(player.cooldownsStarted).toEqual([shotMarker("pistol").item]);
    expect(player.inventory.slots[0]!.cooldownsStarted).toBe(0);
    system.advanceTicks(GUNS.pistol.everyTicks);
    click(player);
    expect(balls()).toHaveLength(2);
  });

  it("fires only on an attack or mining swing, not on a right click's own swings or a drop", () => {
    const { balls } = setup();
    const player = holding("Ann", gunItem("pistol"));
    for (const source of [EntitySwingSource.UseItem, EntitySwingSource.Build, EntitySwingSource.Interact, EntitySwingSource.DropItem, EntitySwingSource.ThrowItem]) {
      click(player, source);
    }
    use(player);
    expect(balls()).toHaveLength(0);
    click(player, EntitySwingSource.Mine);
    expect(balls()).toHaveLength(1);
  });

  it("keeps a held gun firing while the swings keep coming, and stops a moment after the last", () => {
    const { balls } = setup();
    const player = holding("Ann", gunItem("rifle", "blue"));
    click(player);
    expect(balls()).toHaveLength(1);
    // The button stays down: Bedrock repeats the swing.
    for (let i = 0; i < 3; i++) {
      system.advanceTicks(GUNS.rifle.everyTicks);
      click(player);
    }
    expect(balls()).toHaveLength(4);
    // Let go: it fires out the trigger's last ticks, then stops.
    system.advanceTicks(GUNS.rifle.triggerTicks + GUNS.rifle.everyTicks * 3);
    const fired = balls().length;
    expect(fired).toBeLessThanOrEqual(4 + Math.ceil(GUNS.rifle.triggerTicks / GUNS.rifle.everyTicks));
    system.advanceTicks(GUNS.rifle.everyTicks * 3);
    expect(balls()).toHaveLength(fired);
    // Putting the gun away ends a held trigger at once.
    system.advanceTicks(GUNS.rifle.everyTicks);
    click(player);
    player.selectedSlotIndex = 1;
    system.advanceTicks(GUNS.rifle.everyTicks * 2);
    expect(balls()).toHaveLength(fired + 1);
  });

  it("aims while right click is held: the camera zooms, shots stray less, and letting go or putting the gun away zooms back", () => {
    // random 1: every ball strays the gun's whole spread.
    const { guns, balls } = setup({ random: () => 1 });
    const player = holding("Ann", gunItem("pistol", "red"));
    click(player);
    expect(angleOf(balls()[0].projectile.shot!)).toBeCloseTo(GUNS.pistol.hipSpreadDegrees, 3);
    startUse(player);
    expect(guns.isAiming("Ann")).toBe(true);
    expect(player.camera.fovs).toEqual([GUNS.pistol.aimFov]);
    system.advanceTicks(GUNS.pistol.everyTicks);
    click(player);
    expect(angleOf(balls()[1].projectile.shot!)).toBeCloseTo(GUNS.pistol.aimSpreadDegrees, 3);
    stopUse(player);
    expect(guns.isAiming("Ann")).toBe(false);
    expect(player.camera.fovs).toEqual([GUNS.pistol.aimFov, undefined]);
    startUse(player);
    player.selectedSlotIndex = 1;
    system.advanceTicks(1);
    expect(guns.isAiming("Ann")).toBe(false);
    expect(player.camera.fovs).toHaveLength(4);
  });

  it("fires nothing when the game says no", () => {
    const { balls } = setup({ canFire: () => false });
    click(holding("Ann", gunItem("pistol")));
    expect(balls()).toHaveLength(0);
  });

  it("paints in the game's color when it chooses one", () => {
    const { balls } = setup({ colorOf: () => dyeIndex("green") });
    click(holding("Ann", gunItem("pistol", "red")));
    expect(balls()[0].properties.get("minecade:color")).toBe(dyeIndex("green"));
  });

  it("sprays a shotgun's balls in a cone, and counts at most its cap of them on one target", () => {
    const { balls, hits } = setup();
    const player = holding("Ann", gunItem("shotgun", "red"));
    const victim = world.join("Bo");
    click(player);
    expect(balls()).toHaveLength(GUNS.shotgun.pellets);
    for (const ball of balls()) world.projectileHitsEntity(ball, victim, undefined, player);
    expect(hits).toHaveLength(GUNS.shotgun.maxHitsPerShot);
    expect(hits[0].shot).toMatchObject({ shooter: "Ann", weapon: "shotgun", color: dyeIndex("red") });
    // Each ball is taken out of the air as it lands.
    expect(balls().every((ball) => !ball.isValid)).toBe(true);
  });

  it("reports a ball's block and face, and takes a ball away once it has flown its range", () => {
    const { guns, balls, blocks } = setup();
    const player = holding("Ann", gunItem("pistol"));
    click(player);
    world.projectileHitsBlock(balls()[0], { x: 0, y: 64, z: 5 }, Direction.North, player);
    expect(blocks).toEqual([{ shot: expect.objectContaining({ weapon: "pistol" }), face: Direction.North }]);
    system.advanceTicks(GUNS.pistol.everyTicks);
    click(player);
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

  it("throws a grenade with either click, uses it up, and lands it to swell and burst when its fuse runs out", () => {
    const { bursts, spawned } = setup();
    const player = holding("Ann", gunItem("grenade", "yellow"), 2);
    use(player);
    expect(player.inventory.slots[0]!.amount).toBe(1);
    const [grenade] = spawned(THROWN_GRENADE);
    expect(grenade.projectile.shot!.y).toBeGreaterThan(0);
    grenade.location = { x: 0.5, y: 65, z: 5.5 };
    world.projectileHitsBlock(grenade, { x: 0, y: 64, z: 5 }, Direction.Up, player);
    expect(grenade.isValid).toBe(false);
    const [primed] = spawned(PRIMED_GRENADE);
    expect(primed.properties.get("minecade:color")).toBe(dyeIndex("yellow"));
    // Off the face it hit, so it doesn't start inside the block.
    expect(primed.location.y).toBeCloseTo(65.2, 5);
    expect(world.overworld.sounds.map((sound) => sound.id)).toContain(GRENADE.fuseSound.id);
    system.advanceTicks(GRENADE.fuseTicks - 1);
    expect(bursts).toEqual([]);
    primed.location = { x: 0.5, y: 65, z: 5.5 };
    system.advanceTicks(1);
    expect(bursts).toEqual([{ shot: expect.objectContaining({ weapon: "grenade", shooter: "Ann", color: dyeIndex("yellow") }), location: { x: 0.5, y: 65, z: 5.5 } }]);
    expect(primed.isValid).toBe(false);
    expect(world.overworld.sounds.map((sound) => sound.id)).toContain(GRENADE.burstSound.id);
    // A left click throws the last one.
    system.advanceTicks(GRENADE.everyTicks);
    click(player);
    expect(player.inventory.slots[0]).toBeUndefined();
    expect(spawned(THROWN_GRENADE)).toHaveLength(2);
  });

  it("takes everything away when its scope ends, and zooms an aiming player back", () => {
    const { scope, balls, spawned } = setup();
    const player = holding("Ann", gunItem("pistol"));
    click(player);
    startUse(player);
    const thrower = holding("Bo", gunItem("grenade"));
    use(thrower);
    world.projectileHitsBlock(spawned(THROWN_GRENADE)[0], { x: 0, y: 64, z: 5 }, Direction.Up, thrower);
    scope.dispose();
    expect(balls()[0].isValid).toBe(false);
    expect(spawned(PRIMED_GRENADE)[0].isValid).toBe(false);
    expect(player.camera.fovs.at(-1)).toBeUndefined();
    expect(world.afterEvents.playerSwingStart.listenerCount).toBe(0);
  });
});

describe("ammo", () => {
  const RIFLE: GunDef = { ...GUNS.rifle, fire: "tap", ammo: { magazine: 3, reloadTicks: 10, reserve: 4 } };

  it("empties a magazine, reloads it by itself from the spare rounds, and clicks dry once they're gone", () => {
    const { guns, balls, ammo } = setup({ guns: [RIFLE] });
    const player = holding("Ann", gunItem("rifle"));
    const shoot = () => {
      click(player);
      system.advanceTicks(RIFLE.everyTicks);
    };
    shoot();
    shoot();
    expect(guns.ammoOf(player as never)).toEqual({ gun: "rifle", loaded: 1, magazine: 3, reserve: 4, reloading: false });
    shoot();
    expect(balls()).toHaveLength(3);
    expect(ammo.at(-1)).toMatchObject({ loaded: 0, reloading: true });
    expect(ammoText(ammo.at(-1)!)).toBe("§7Reloading");
    // Nothing fires while it reloads.
    shoot();
    expect(balls()).toHaveLength(3);
    system.advanceTicks(RIFLE.ammo!.reloadTicks);
    expect(ammo.at(-1)).toEqual({ gun: "rifle", loaded: 3, magazine: 3, reserve: 1, reloading: false });
    expect(ammoText(ammo.at(-1)!)).toBe("§f3§7/3  §81");
    for (let i = 0; i < 3; i++) shoot();
    system.advanceTicks(RIFLE.ammo!.reloadTicks);
    expect(guns.ammoOf(player as never)).toMatchObject({ loaded: 1, reserve: 0 });
    shoot();
    shoot();
    expect(balls()).toHaveLength(7);
    expect(world.overworld.sounds.at(-1)!.id).toBe("random.click");
    // A respawn fills it all again.
    guns.refill("Ann");
    expect(guns.ammoOf(player as never)).toMatchObject({ loaded: 3, reserve: 4 });
  });

  it("leaves guns without an AmmoDef endless, and reloads a part-used magazine when asked", () => {
    const { guns } = setup({ guns: [RIFLE, GUNS.pistol] });
    const pistol = holding("Ann", gunItem("pistol"));
    expect(guns.ammoOf(pistol as never)).toBeUndefined();
    const rifle = holding("Bo", gunItem("rifle"));
    click(rifle);
    guns.reload(rifle as never);
    expect(guns.ammoOf(rifle as never)).toMatchObject({ loaded: 2, reloading: true });
    system.advanceTicks(RIFLE.ammo!.reloadTicks);
    expect(guns.ammoOf(rifle as never)).toMatchObject({ loaded: 3, reserve: 3 });
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
