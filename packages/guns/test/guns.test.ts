import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scope } from "@minecade/minigame-core";
import { AIM_MARKER, AIM_RECOIL, ARSENAL_GUN_DEFS, GRENADE, GUNS, HEAVY_CARRY_SPEED, PAINTBALL, PRIMED_GRENADE, THROWN_GRENADE, arsenalItem, dyeIndex, gunCooldown, gunItem, type GunDef } from "../src/defs.ts";
import { Guns, ammoText, coneDirections, heading, type AmmoState, type GunsOptions, type Shot } from "../src/guns.ts";
import { Direction, EntitySwingSource, EquipmentSlot, ItemLockMode, ItemStack, system, world, type FakeBlock, type FakeMob, type FakePlayer } from "../../minigame-core/test/fake-mc-server.ts";

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
/** A right click at the sky, as a plain use (no start or release). */
const use = (player: FakePlayer) => world.afterEvents.itemUse.emit({ source: player, itemStack: player.inventory.slots[0]! });
/** Right click goes down at the sky on a gun, which Bedrock uses like a bow: a use and its start. */
const pressRight = (player: FakePlayer) => {
  const itemStack = player.inventory.slots[player.selectedSlotIndex]!;
  world.afterEvents.itemUse.emit({ source: player, itemStack });
  world.afterEvents.itemStartUse.emit({ source: player, itemStack, useDuration: 72000 });
};
/** Right click comes up: the use's release and stop. */
const releaseRight = (player: FakePlayer) => {
  const itemStack = player.inventory.slots[player.selectedSlotIndex];
  world.afterEvents.itemReleaseUse.emit({ source: player, itemStack, useDuration: 71900 });
  world.afterEvents.itemStopUse.emit({ source: player, itemStack, useDuration: 71900 });
};
/** Right click at a block: its first event, or a repeat while the button stays down. */
const atBlock = (player: FakePlayer, isFirstEvent: boolean) =>
  world.afterEvents.playerInteractWithBlock.emit({ player, itemStack: player.inventory.slots[player.selectedSlotIndex], isFirstEvent });
/** What the player has in their off hand: the aim marker while they aim. */
const offHand = (player: FakePlayer) => player.equipment.get(EquipmentSlot.Offhand);
/** A Paintball Pistol that aims (none of Paintball's do now), to test aiming with balls whose spread shows. */
const AIMING_PISTOL: GunDef = { ...GUNS.pistol, aimFov: 60, aimSpreadDegrees: 0.5 };
const angleOf = (velocity: { x: number; y: number; z: number }) => (Math.acos(velocity.z / Math.hypot(velocity.x, velocity.y, velocity.z)) * 180) / Math.PI;

describe("heading", () => {
  it("gives a flight's yaw and pitch as a player's rotation has them", () => {
    const at = (x: number, y: number, z: number) => Object.values(heading({ x, y, z }));
    expect(at(0, 0, 1)).toEqual([0, 0]);
    expect(at(-1, 0, 0)).toEqual([90, 0]);
    expect(at(1, 0, 0)).toEqual([-90, 0]);
    expect(Math.abs(at(0, 0, -1)[0])).toBe(180);
    expect(at(0, -1, 0)[1]).toBe(90);
    expect(at(0, Math.SQRT1_2, Math.SQRT1_2)).toEqual([0, -45]);
  });
});

describe("Guns", () => {
  it("fires a tap gun once per click, at its fire rate, in the gun's paint, shading its slot and kicking its held model", () => {
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
    // The gun's own cooldown shades its slot for its fire rate, and the held model kicks over it.
    expect(player.itemCooldowns).toEqual([{ category: gunCooldown("pistol"), ticks: GUNS.pistol.everyTicks }]);
    system.advanceTicks(GUNS.pistol.everyTicks);
    click(player);
    expect(balls()).toHaveLength(2);
    // Right click fires it too, once a press however long it's held.
    system.advanceTicks(GUNS.pistol.everyTicks);
    pressRight(player);
    expect(balls()).toHaveLength(3);
    system.advanceTicks(GUNS.pistol.everyTicks * 4);
    expect(balls()).toHaveLength(3);
    releaseRight(player);
    // A release can bring a use of its own: not a press.
    use(player);
    expect(balls()).toHaveLength(3);
    system.advanceTicks(GUNS.pistol.everyTicks);
    pressRight(player);
    expect(balls()).toHaveLength(4);
    releaseRight(player);
    // At a block: each press fires, the repeats of a held button don't.
    system.advanceTicks(GUNS.pistol.everyTicks);
    atBlock(player, true);
    expect(balls()).toHaveLength(5);
    for (let i = 0; i < 4; i++) {
      system.advanceTicks(GUNS.pistol.everyTicks);
      atBlock(player, false);
    }
    expect(balls()).toHaveLength(5);
    system.advanceTicks(GUNS.pistol.everyTicks);
    atBlock(player, true);
    expect(balls()).toHaveLength(6);
    // A right click on a door, trapdoor, gate, button or lever uses it, and fires nothing.
    for (const typeId of ["minecraft:oak_door", "minecraft:spruce_trapdoor", "minecraft:oak_fence_gate", "minecraft:stone_button", "minecraft:lever", "minecade:paint_blue_door"]) {
      system.advanceTicks(GUNS.pistol.everyTicks);
      world.afterEvents.playerInteractWithBlock.emit({ player, itemStack: player.inventory.slots[0], block: { typeId } as FakeBlock, isFirstEvent: true });
    }
    expect(balls()).toHaveLength(6);
  });

  it("shakes the shooter's camera by the gun's recoil each shot, leaving the aim alone, and less while aiming", () => {
    const { balls } = setup({ guns: [AIMING_PISTOL] });
    const player = holding("Ann", gunItem("pistol", "red"));
    player.rotation = { x: 10, y: 45 };
    const { shake } = GUNS.pistol.recoil;
    pressRight(player);
    releaseRight(player);
    expect(balls()).toHaveLength(1);
    // Until the pistol can fire again (6 ticks).
    expect(player.commands).toEqual([`camerashake add @s ${shake} 0.3 rotational`]);
    expect(player.rotation).toEqual({ x: 10, y: 45 });
    expect(player.teleports).toHaveLength(0);
    // Raised (a left click), the shake is smaller.
    system.advanceTicks(GUNS.pistol.everyTicks);
    click(player);
    pressRight(player);
    expect(balls()).toHaveLength(2);
    expect(player.commands[1]).toBe(`camerashake add @s ${Math.round(shake * AIM_RECOIL * 1000) / 1000} 0.3 rotational`);
  });

  it("shakes as long as the gun takes to fire again, from 0.1 to 0.3 seconds", () => {
    setup({ guns: Object.values(ARSENAL_GUN_DEFS) });
    for (const [gun, seconds] of [
      ["smg", 0.1],
      ["handgun", 0.25],
      ["sniper_rifle", 0.3],
    ] as const) {
      const player = holding(`Shooter_${gun}`, arsenalItem(gun));
      pressRight(player);
      expect(player.commands, gun).toEqual([`camerashake add @s ${ARSENAL_GUN_DEFS[gun].recoil.shake} ${seconds} rotational`]);
    }
  });

  it("shakes for every shot of a held gun, in the air too", () => {
    const { balls } = setup();
    const player = holding("Ann", gunItem("rifle", "red"));
    player.isOnGround = false;
    pressRight(player);
    system.advanceTicks(GUNS.rifle.everyTicks * 3);
    releaseRight(player);
    expect(balls().length).toBeGreaterThanOrEqual(3);
    expect(player.commands).toHaveLength(balls().length);
    expect(player.rotation).toEqual({ x: 0, y: 0 });
  });

  it("fires on a left click (an attack or mining swing), not on a right click's own swings or a drop", () => {
    const { balls } = setup();
    const player = holding("Ann", gunItem("pistol"));
    for (const source of [EntitySwingSource.UseItem, EntitySwingSource.Build, EntitySwingSource.Interact, EntitySwingSource.DropItem, EntitySwingSource.ThrowItem]) {
      click(player, source);
    }
    expect(balls()).toHaveLength(0);
    click(player, EntitySwingSource.Mine);
    expect(balls()).toHaveLength(1);
  });

  it("keeps a held gun firing at its rate while right click stays down, and stops when it comes up", () => {
    const { balls } = setup();
    const player = holding("Ann", gunItem("rifle", "blue"));
    pressRight(player);
    expect(balls()).toHaveLength(1);
    // In use, it fires on with no more events, however long the button stays down.
    system.advanceTicks(GUNS.rifle.everyTicks * 10);
    expect(balls()).toHaveLength(11);
    releaseRight(player);
    system.advanceTicks(GUNS.rifle.everyTicks * 3);
    expect(balls()).toHaveLength(11);
    // A left click fires one shot.
    click(player);
    expect(balls()).toHaveLength(12);
    system.advanceTicks(GUNS.rifle.everyTicks * 3);
    expect(balls()).toHaveLength(12);
    // Putting the gun away lets go at once.
    pressRight(player);
    player.selectedSlotIndex = 1;
    system.advanceTicks(GUNS.rifle.everyTicks * 2);
    expect(balls()).toHaveLength(13);
  });

  it("keeps a held gun firing at a block while the interaction repeats, and stops its triggerTicks after the last", () => {
    const { balls } = setup();
    const player = holding("Ann", gunItem("rifle", "blue"));
    atBlock(player, true);
    expect(balls()).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      system.advanceTicks(5);
      atBlock(player, false);
    }
    // Fired at its rate all along: the first at once, then every everyTicks over the 20 ticks.
    expect(balls()).toHaveLength(1 + Math.floor(20 / GUNS.rifle.everyTicks));
    system.advanceTicks(GUNS.rifle.triggerTicks + GUNS.rifle.everyTicks);
    const fired = balls().length;
    expect(fired).toBeLessThanOrEqual(1 + Math.ceil((20 + GUNS.rifle.triggerTicks) / GUNS.rifle.everyTicks));
    system.advanceTicks(GUNS.rifle.everyTicks * 3);
    expect(balls()).toHaveLength(fired);
    // A repeat after the window ran out picks up again.
    atBlock(player, false);
    expect(balls()).toHaveLength(fired + 1);
  });

  it("raises a gun that aims with a left click and lowers it with the next: the camera zooms, shots stray less, and the aim marker sits in the off hand", () => {
    // random 1: every ball strays the gun's whole spread.
    const { guns, balls } = setup({ guns: [AIMING_PISTOL], random: () => 1 });
    const player = holding("Ann", gunItem("pistol", "red"));
    pressRight(player);
    releaseRight(player);
    expect(angleOf(balls()[0].projectile.shot!)).toBeCloseTo(AIMING_PISTOL.hipSpreadDegrees, 3);
    click(player);
    expect(guns.isAiming("Ann")).toBe(true);
    expect(balls()).toHaveLength(1);
    expect(player.camera.fovs).toEqual([AIMING_PISTOL.aimFov]);
    // The held model reads the off hand: the marker, locked where it is.
    expect(offHand(player)?.typeId).toBe(AIM_MARKER.item);
    expect(offHand(player)?.lockMode).toBe(ItemLockMode.slot);
    // A held left click can repeat its swing: still one click.
    system.advanceTicks(4);
    click(player);
    expect(guns.isAiming("Ann")).toBe(true);
    system.advanceTicks(AIMING_PISTOL.everyTicks);
    pressRight(player);
    releaseRight(player);
    expect(angleOf(balls()[1].projectile.shot!)).toBeCloseTo(AIMING_PISTOL.aimSpreadDegrees!, 3);
    system.advanceTicks(10);
    click(player);
    expect(guns.isAiming("Ann")).toBe(false);
    expect(player.camera.fovs).toEqual([AIMING_PISTOL.aimFov, undefined]);
    expect(offHand(player)).toBeUndefined();
    // Switching away lowers it.
    system.advanceTicks(10);
    click(player);
    expect(guns.isAiming("Ann")).toBe(true);
    player.selectedSlotIndex = 1;
    system.advanceTicks(1);
    expect(guns.isAiming("Ann")).toBe(false);
    expect(player.camera.fovs).toHaveLength(4);
    expect(offHand(player)).toBeUndefined();
  });

  it("says who looks through a scope (the raised Sniper Rifle), and tells the game whenever a gun goes up or down", () => {
    const aims: [string, boolean][] = [];
    const { guns } = setup({ guns: Object.values(ARSENAL_GUN_DEFS), onAim: (player, aiming) => aims.push([player.name, aiming]) });
    const ann = holding("Ann", arsenalItem("sniper_rifle"));
    ann.inventory.slots[1] = new ItemStack(arsenalItem("rpg"));
    expect(guns.isScoped("Ann")).toBe(false);
    click(ann);
    expect(guns.isScoped("Ann")).toBe(true);
    expect(aims).toEqual([["Ann", true]]);
    system.advanceTicks(10);
    click(ann);
    expect(guns.isScoped("Ann")).toBe(false);
    expect(aims).toEqual([
      ["Ann", true],
      ["Ann", false],
    ]);
    // The RPG aims without a scope; switching away lowers it, and says so.
    ann.selectedSlotIndex = 1;
    system.advanceTicks(10);
    click(ann);
    expect(guns.isAiming("Ann")).toBe(true);
    expect(guns.isScoped("Ann")).toBe(false);
    ann.selectedSlotIndex = 2;
    system.advanceTicks(1);
    expect(aims.at(-1)).toEqual(["Ann", false]);
    expect((Object.values(ARSENAL_GUN_DEFS) as GunDef[]).filter((gun) => gun.scope).map((gun) => gun.id)).toEqual(["sniper_rifle"]);
  });

  it("slows a player while a heavy gun is in hand, and gives them their own speed back when it isn't", () => {
    const { scope } = setup({ guns: Object.values(ARSENAL_GUN_DEFS) });
    const ann = holding("Ann", arsenalItem("sniper_rifle"));
    ann.inventory.slots[1] = new ItemStack(arsenalItem("handgun"));
    ann.inventory.slots[2] = new ItemStack(arsenalItem("rpg"));
    const bob = holding("Bob", arsenalItem("smg"));
    system.advanceTicks(4);
    expect(ann.movement.currentValue).toBeCloseTo(0.1 * HEAVY_CARRY_SPEED, 6);
    expect(bob.movement.currentValue).toBe(0.1);
    ann.selectedSlotIndex = 1;
    system.advanceTicks(4);
    expect(ann.movement.currentValue).toBe(0.1);
    ann.selectedSlotIndex = 2;
    system.advanceTicks(4);
    expect(ann.movement.currentValue).toBeCloseTo(0.1 * HEAVY_CARRY_SPEED, 6);
    // The game's end gives it back too.
    scope.dispose();
    expect(ann.movement.currentValue).toBe(0.1);
    expect((Object.values(ARSENAL_GUN_DEFS) as GunDef[]).filter((gun) => gun.carrySpeed !== undefined).map((gun) => gun.id)).toEqual(["sniper_rifle", "rail_gun", "rpg"]);
  });

  it("gives a player who goes out their own speed back at once", () => {
    const { guns } = setup({ guns: Object.values(ARSENAL_GUN_DEFS) });
    const ann = holding("Ann", arsenalItem("rail_gun"));
    system.advanceTicks(4);
    expect(ann.movement.currentValue).toBeCloseTo(0.1 * HEAVY_CARRY_SPEED, 6);
    guns.forget("Ann");
    expect(ann.movement.currentValue).toBe(0.1);
  });

  it("leaves something of the player's own in the off hand where it is when they aim", () => {
    const { guns } = setup({ guns: [AIMING_PISTOL] });
    const player = holding("Ann", gunItem("pistol", "red"));
    const shield = new ItemStack("minecraft:shield");
    player.equipment.set(EquipmentSlot.Offhand, shield);
    click(player);
    expect(guns.isAiming("Ann")).toBe(true);
    expect(offHand(player)).toBe(shield);
    system.advanceTicks(10);
    click(player);
    expect(offHand(player)).toBe(shield);
  });

  it("doesn't aim a gun without an aimFov: a left click fires it (Paintball's and most of the arsenal's)", () => {
    const { guns, balls } = setup({ random: () => 1 });
    const player = holding("Ann", gunItem("pistol", "red"));
    expect(GUNS.pistol).not.toHaveProperty("aimFov");
    click(player);
    expect(guns.isAiming("Ann")).toBe(false);
    expect(player.camera.fovs).toEqual([]);
    expect(offHand(player)).toBeUndefined();
    expect(angleOf(balls()[0].projectile.shot!)).toBeCloseTo(GUNS.pistol.hipSpreadDegrees, 3);
    // Only the Sniper Rifle, Rail Gun and RPG aim, each zooming within what Bedrock allows (a custom
    // field of view from 30 to 110: camera.setFov throws outside it, seen on BDS).
    const aiming = Object.values(ARSENAL_GUN_DEFS as Record<string, GunDef>).filter((gun) => gun.aimFov !== undefined);
    expect(aiming.map((gun) => gun.id)).toEqual(["sniper_rifle", "rail_gun", "rpg"]);
    for (const gun of aiming) {
      expect(gun.aimFov, gun.id).toBeGreaterThanOrEqual(30);
      expect(gun.aimFov, gun.id).toBeLessThanOrEqual(110);
    }
  });

  it("tells the game when a held gun's right click lets go: the shots, how long, and how the button came", () => {
    const reports: unknown[] = [];
    const { balls } = setup({ onTrigger: (_player, report) => reports.push(report) });
    const player = holding("Ann", gunItem("rifle", "blue"));
    pressRight(player);
    system.advanceTicks(20);
    expect(reports).toEqual([]);
    releaseRight(player);
    expect(reports).toEqual([{ gun: "rifle", shots: balls().length, ticks: 20, held: "use", gaps: [] }]);
    // At a block, held: the interaction's repeats.
    system.advanceTicks(10);
    atBlock(player, true);
    system.advanceTicks(3);
    atBlock(player, false);
    system.advanceTicks(5);
    atBlock(player, false);
    system.advanceTicks(GUNS.rifle.triggerTicks + 1);
    expect(reports[1]).toEqual({ gun: "rifle", shots: expect.any(Number), ticks: 8 + GUNS.rifle.triggerTicks + 1, held: "repeats", gaps: [3, 5] });
    // A plain use with no release.
    use(player);
    system.advanceTicks(GUNS.rifle.triggerTicks + 1);
    expect(reports[2]).toMatchObject({ held: "press", gaps: [] });
    // A tap gun says nothing.
    const other = holding("Bo", gunItem("pistol"));
    pressRight(other);
    releaseRight(other);
    expect(reports).toHaveLength(3);
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
    use(player);
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
