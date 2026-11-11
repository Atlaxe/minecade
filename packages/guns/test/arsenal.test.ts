import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scope } from "@minecade/minigame-core";
import {
  ARSENAL_GUN_DEFS,
  ARSENAL_MODELS,
  ARSENAL_PICKUP,
  ARSENAL_THROWABLE_DEFS,
  BLASTS,
  CROSSBOW_ARROWS,
  FIRE,
  FLASH,
  MODEL_PROPERTY,
  PARTICLES,
  PRIMED_ARSENAL,
  ROCKET,
  SMOKE,
  STIM,
  THROWN_ARSENAL,
  arsenalItem,
  blastDamage,
  damageAt,
  flashStrength,
  gunCooldown,
  parseArsenalItem,
  weaponId,
  type ArsenalModel,
} from "../src/defs.ts";
import { Arsenal, LETHAL, type ArsenalHost } from "../src/arsenal.ts";
import { Direction, EntitySwingSource, ItemStack, system, world, type FakeMob, type FakePlayer } from "../../minigame-core/test/fake-mc-server.ts";

beforeEach(() => {
  system.reset();
  world.reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Hurt {
  victim: string;
  attacker: string | undefined;
  amount: number | "lethal";
  cause: string;
}

/** An Arsenal whose host counts every player as fighting (but those in `down`) and records each hurt. */
function setup() {
  const scope = new Scope();
  const hurts: Hurt[] = [];
  const down = new Set<string>();
  const host: ArsenalHost = {
    canFire: (player) => !down.has(player.name),
    targets: () => world.getAllPlayers().filter((player) => !down.has(player.name)) as never,
    nameOf: (entity) => (entity.typeId === "minecraft:player" ? (entity as unknown as FakePlayer).name : undefined),
    hurt: (victim, attacker, amount, cause) => {
      hurts.push({ victim: (victim as unknown as FakePlayer).name, attacker, amount, cause });
      return amount === "lethal" ? "down" : "hurt";
    },
  };
  // No stray: every shot goes exactly where the player looks.
  const arsenal = new Arsenal(scope, host, { random: () => 0 });
  const spawned = (typeId: string) => world.overworld.spawned.filter((mob) => mob.typeId === typeId);
  const particles = (id: string) => world.overworld.particles.filter((particle) => particle.id === id);
  return { scope, arsenal, hurts, down, spawned, particles };
}

/** A player at `at` (feet), looking south (+z) unless told otherwise, holding `item` in the first slot. */
function player(name: string, at: { x: number; y: number; z: number }, item?: string, count = 1): FakePlayer {
  const joined = world.join(name);
  joined.location = { ...at };
  if (item) joined.inventory.slots[0] = new ItemStack(item, count);
  return joined;
}

const gun = (model: ArsenalModel) => arsenalItem(model);
const click = (shooter: FakePlayer) =>
  world.afterEvents.playerSwingStart.emit({ player: shooter, heldItemStack: shooter.inventory.slots[shooter.selectedSlotIndex], swingSource: EntitySwingSource.Attack });
const use = (shooter: FakePlayer) => world.afterEvents.itemUse.emit({ source: shooter, itemStack: shooter.inventory.slots[shooter.selectedSlotIndex]! });
const stone = (x: number, y: number, z: number) => world.overworld.blocks.set(`${x},${y},${z}`, "minecraft:stone");
const look = (shooter: FakePlayer, x: number, y: number, z: number) => {
  const length = Math.hypot(x, y, z);
  shooter.viewDirection = { x: x / length, y: y / length, z: z / length };
};

describe("bullets", () => {
  it("hit the first player in line at once with their gun's damage, more in the head, drawing a streak", () => {
    const { hurts, particles } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("handgun"));
    player("Bo", { x: 0.5, y: 65, z: 10.5 });
    player("Cy", { x: 0.5, y: 65, z: 20.5 });
    // Level from the eyes: Bo's head. The Pistol fires on right click.
    use(ann);
    expect(hurts).toEqual([{ victim: "Bo", attacker: "Ann", amount: ARSENAL_GUN_DEFS.handgun.damage.head, cause: "gun" }]);
    const [streak] = particles(PARTICLES.streak);
    expect(streak.variables!.values.get("variable.dist")).toBeGreaterThan(8);
    expect(streak.variables!.values.get("variable.speed")).toBe(ARSENAL_GUN_DEFS.handgun.speed * 20);
    // A little lower: the body.
    system.advanceTicks(ARSENAL_GUN_DEFS.handgun.everyTicks);
    look(ann, 0, -0.1, 1);
    use(ann);
    expect(hurts[1]).toMatchObject({ victim: "Bo", amount: ARSENAL_GUN_DEFS.handgun.damage.body });
    expect(world.overworld.sounds.filter((sound) => sound.id === ARSENAL_GUN_DEFS.handgun.sound.id)).toHaveLength(2);
  });

  it("stop at a block in the way, marking it, and fall off past their range's start", () => {
    const { hurts, particles } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("assault_rifle"));
    player("Bo", { x: 0.5, y: 65, z: 10.5 });
    stone(0, 66, 5);
    click(ann);
    expect(hurts).toEqual([]);
    expect(particles(PARTICLES.impact)).toHaveLength(1);
    expect(particles(PARTICLES.impact)[0].location.z).toBeCloseTo(5, 1);
    expect(damageAt(ARSENAL_GUN_DEFS.assault_rifle.damage, 10, false)).toBe(4);
    expect(damageAt(ARSENAL_GUN_DEFS.assault_rifle.damage, 50, false)).toBe(4);
    expect(damageAt(ARSENAL_GUN_DEFS.assault_rifle.damage, 90, false)).toBeCloseTo(4 * 0.8);
    expect(damageAt(ARSENAL_GUN_DEFS.assault_rifle.damage, 70, true)).toBeCloseTo(6 * (1 - 0.5 * 0.2));
  });

  it("go through a block that isn't solid, and never hit the shooter", () => {
    const { hurts } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("handgun"));
    look(ann, 0, -1, 0);
    use(ann);
    expect(hurts).toEqual([]);
  });

  it("a shotgun's pellets each count, up to its cap on one player", () => {
    const { hurts } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("pump_shotgun"));
    player("Bo", { x: 0.5, y: 65, z: 3.5 });
    look(ann, 0, -0.25, 1);
    click(ann);
    expect(hurts).toHaveLength(ARSENAL_GUN_DEFS.pump_shotgun.maxHitsPerShot);
    expect(hurts.every((hurt) => hurt.amount === ARSENAL_GUN_DEFS.pump_shotgun.damage.body)).toBe(true);
  });

  it("a beam goes through every player in line", () => {
    const { hurts, particles } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("rail_gun"));
    player("Bo", { x: 0.5, y: 65, z: 10.5 });
    player("Cy", { x: 0.5, y: 65, z: 20.5 });
    stone(0, 66, 30);
    // Right click fires it: a left click would raise it (it aims).
    use(ann);
    expect(hurts.map((hurt) => [hurt.victim, hurt.amount])).toEqual([
      ["Bo", 20],
      ["Cy", 20],
    ]);
    expect(particles(PARTICLES.beam)[0].variables!.values.get("variable.dist")).toBeGreaterThan(28);
  });

  it("a burst gun fires its shots a few ticks apart from one click, shading its slot once and using a round each", () => {
    const { arsenal, hurts } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("burst_rifle"));
    player("Bo", { x: 0.5, y: 65, z: 10.5 });
    const { shots, gapTicks } = ARSENAL_GUN_DEFS.burst_rifle.burst;
    click(ann);
    expect(hurts).toHaveLength(1);
    system.advanceTicks(gapTicks);
    expect(hurts).toHaveLength(2);
    system.advanceTicks(gapTicks * 3);
    expect(hurts).toHaveLength(shots);
    // One shading of the slot, and one kick of the held model, for the whole burst.
    expect(ann.itemCooldowns).toEqual([{ category: gunCooldown("burst_rifle"), ticks: ARSENAL_GUN_DEFS.burst_rifle.everyTicks }]);
    expect(arsenal.guns.ammoOf(ann as never)).toMatchObject({ loaded: ARSENAL_GUN_DEFS.burst_rifle.ammo.magazine - shots });
    expect(arsenal.ammoLine(ann as never)).toBe(`§f${ARSENAL_GUN_DEFS.burst_rifle.ammo.magazine - shots}§7/${ARSENAL_GUN_DEFS.burst_rifle.ammo.magazine}`);
  });

  it("stops a burst when the player switches away", () => {
    const { hurts } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("burst_rifle"));
    player("Bo", { x: 0.5, y: 65, z: 10.5 });
    click(ann);
    ann.selectedSlotIndex = 1;
    system.advanceTicks(10);
    expect(hurts).toHaveLength(1);
  });

  it("fire nothing for a player the game says can't", () => {
    const { hurts, down } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("handgun"));
    player("Bo", { x: 0.5, y: 65, z: 10.5 });
    down.add("Ann");
    use(ann);
    expect(hurts).toEqual([]);
  });
});

describe("the RPG", () => {
  it("fires a rocket that trails smoke; a direct hit takes its damage, then its blast hurts everyone near, its shooter a share", () => {
    const { arsenal, hurts, spawned, particles } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("rpg"));
    const bo = player("Bo", { x: 0.5, y: 65, z: 10.5 });
    player("Cy", { x: 2.5, y: 65, z: 10.5 });
    use(ann);
    const [rocket] = spawned(ROCKET);
    // No properties: the client points its model by its flight (a snowball's has none on the client).
    expect(rocket.properties.size).toBe(0);
    expect(rocket.projectile.shot!.z).toBeCloseTo(ARSENAL_GUN_DEFS.rpg.speed, 1);
    system.advanceTicks(2);
    // Its smoke comes from its client entity, behind the rocket the client draws, not from here.
    expect(particles(PARTICLES.trail)).toHaveLength(0);
    world.projectileHitsEntity(rocket, bo, { x: 0.5, y: 66, z: 10.2 }, ann);
    expect(rocket.isValid).toBe(false);
    expect(hurts[0]).toEqual({ victim: "Bo", attacker: "Ann", amount: 20, cause: "explosion" });
    expect(hurts.find((hurt) => hurt.victim === "Cy")).toMatchObject({ attacker: "Ann", cause: "explosion" });
    // Ann is ten blocks off: out of the blast.
    expect(hurts.find((hurt) => hurt.victim === "Ann")).toBeUndefined();
    expect(particles(PARTICLES.explosion)[0].variables!.values.get("variable.radius")).toBe(BLASTS.rpg.radius);
    // Only one round, so it reloads.
    expect(arsenal.guns.ammoOf(ann as never)).toMatchObject({ loaded: 0, reloading: true });
  });

  it("hurts its own shooter with half its blast", () => {
    const { hurts, spawned } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("rpg"));
    use(ann);
    const [rocket] = spawned(ROCKET);
    rocket.location = { x: 0.5, y: 66, z: 2.5 };
    stone(0, 66, 3);
    world.projectileHitsBlock(rocket, { x: 0, y: 66, z: 3 }, Direction.North, ann);
    const own = hurts.find((hurt) => hurt.victim === "Ann")!;
    expect(own.attacker).toBeUndefined();
    const far = Math.hypot(0, 66 - 65.9, 2.3 - 0.5);
    expect(own.amount as number).toBeCloseTo(blastDamage(BLASTS.rpg, far, false) * BLASTS.rpg.selfFactor, 5);
  });
});

describe("thrown", () => {
  it("a frag grenade flies and lands showing its model, sits for its fuse, then blasts everyone near: less far off, a quarter through cover, its thrower too", () => {
    const { hurts, spawned, particles } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("frag_grenade"), 2);
    const bo = player("Bo", { x: 0.5, y: 65, z: 7.5 });
    player("Cy", { x: 4.5, y: 65, z: 4 });
    stone(2, 65, 4);
    stone(2, 66, 4);
    use(ann);
    expect(ann.inventory.slots[0]!.amount).toBe(1);
    const [thrown] = spawned(THROWN_ARSENAL);
    expect(thrown.properties.get(MODEL_PROPERTY)).toBe(ARSENAL_MODELS.indexOf("frag_grenade"));
    const at = { x: 0.5, y: 65, z: 4 };
    thrown.location = { ...at };
    world.projectileHitsBlock(thrown, { x: 0, y: 64, z: 4 }, Direction.Up, ann);
    const [primed] = spawned(PRIMED_ARSENAL);
    expect(primed.properties.get(MODEL_PROPERTY)).toBe(ARSENAL_MODELS.indexOf("frag_grenade"));
    system.advanceTicks(ARSENAL_THROWABLE_DEFS.frag_grenade.fuseTicks - 1);
    expect(hurts).toEqual([]);
    primed.location = { ...at };
    system.advanceTicks(1);
    expect(particles(PARTICLES.explosion)).toHaveLength(1);
    const middleOf = (feet: { x: number; y: number; z: number }) => Math.hypot(feet.x - at.x, feet.y + 0.9 - at.y, feet.z - at.z);
    const by = (name: string) => hurts.find((hurt) => hurt.victim === name)!;
    expect(by("Bo")).toEqual({ victim: "Bo", attacker: "Ann", amount: blastDamage(BLASTS.frag_grenade, middleOf(bo.location), false), cause: "explosion" });
    expect(by("Cy").amount as number).toBeCloseTo(blastDamage(BLASTS.frag_grenade, middleOf({ x: 4.5, y: 65, z: 4 }), true), 5);
    expect(by("Ann")).toEqual({ victim: "Ann", attacker: undefined, amount: blastDamage(BLASTS.frag_grenade, middleOf(ann.location), false) * BLASTS.frag_grenade.selfFactor, cause: "explosion" });
    // Thrown out from the middle: Bo is south of it, so south.
    expect(bo.knockbacks[0].z).toBeGreaterThan(0);
  });

  it("a Molotov breaks where it hits and sets the floor around alight, hurting whoever stands in the flames, for a while", () => {
    const { hurts, spawned, particles } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("molotov"));
    const bo = player("Bo", { x: 1.5, y: 65, z: 6.5 });
    // A stone floor around where it breaks, a step up to the east, and a wall to the west.
    for (let x = -5; x <= 5; x++) for (let z = 0; z <= 10; z++) stone(x, 64, z);
    for (let z = 0; z <= 10; z++) stone(3, 65, z);
    for (let z = 0; z <= 10; z++) for (let y = 65; y <= 67; y++) stone(-2, y, z);
    world.overworld.blocks.set("0,65,7", "minecraft:oak_fence");
    use(ann);
    const [thrown] = spawned(THROWN_ARSENAL);
    thrown.location = { x: 0.5, y: 65, z: 5.5 };
    world.projectileHitsBlock(thrown, { x: 0, y: 64, z: 5 }, Direction.Up, ann);
    expect(spawned(PRIMED_ARSENAL)).toEqual([]);
    const [fire] = particles(PARTICLES.fire);
    expect(fire.location.y).toBeCloseTo(65, 5);
    expect(fire.variables!.values.get("variable.seconds")).toBe(FIRE.seconds);
    system.advanceTicks(FIRE.everyTicks * 3);
    const burns = hurts.filter((hurt) => hurt.cause === "fire");
    expect(burns.length).toBeGreaterThanOrEqual(3);
    expect(burns[0]).toEqual({ victim: "Bo", attacker: "Ann", amount: FIRE.damage, cause: "fire" });
    // Fire blocks on the floor in its circle: up on the step and the fence too, never in place of a
    // block, never past the wall or behind the fence.
    const alight = () => [...world.overworld.blocks].filter(([, typeId]) => typeId === "minecraft:fire").map(([key]) => key);
    expect(alight()).toEqual(expect.arrayContaining(["0,65,5", "1,65,6", "-1,65,5", "3,66,5", "0,66,7"]));
    expect(alight()).not.toContain("0,65,7");
    expect(alight()).not.toContain("0,65,8");
    expect(alight().filter((key) => Number(key.split(",")[0]) < -1)).toEqual([]);
    expect(alight().every((key) => Math.hypot(Number(key.split(",")[0]), Number(key.split(",")[2]) - 5) <= FIRE.radius)).toBe(true);
    expect(world.overworld.blocks.get("0,65,7")).toBe("minecraft:oak_fence");
    // Out of the flames, Minecraft's own burning goes out.
    bo.onFire = true;
    bo.location = { x: 0.5, y: 65, z: 9.5 };
    system.advanceTicks(2);
    expect(bo.onFire).toBe(false);
    const stepped = hurts.length;
    system.advanceTicks(FIRE.everyTicks * 2);
    expect(hurts).toHaveLength(stepped);
    system.advanceTicks(FIRE.seconds * 20);
    const later = hurts.length;
    system.advanceTicks(FIRE.everyTicks * 3);
    expect(hurts).toHaveLength(later);
    expect(alight()).toEqual([]);
  });

  it("puts a Molotov's flames out when its scope ends, and only its own", () => {
    const { scope, spawned } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("molotov"));
    for (let x = -4; x <= 4; x++) for (let z = 1; z <= 9; z++) stone(x, 64, z);
    world.overworld.blocks.set("4,65,5", "minecraft:fire");
    use(ann);
    const [thrown] = spawned(THROWN_ARSENAL);
    thrown.location = { x: 0.5, y: 65, z: 5.5 };
    world.projectileHitsBlock(thrown, { x: 0, y: 64, z: 5 }, Direction.Up, ann);
    expect(world.overworld.blocks.get("0,65,5")).toBe("minecraft:fire");
    scope.dispose();
    expect(world.overworld.blocks.get("0,65,5")).toBeUndefined();
    expect(world.overworld.blocks.get("4,65,5")).toBe("minecraft:fire");
  });

  it("a flashbang whites out players who can see it: more close up and looking at it, less looking away, none behind a wall", () => {
    const { spawned } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("flashbang"));
    const bo = player("Bo", { x: 0.5, y: 65, z: 10.5 });
    look(bo, 0, 0, -1);
    const cy = player("Cy", { x: 3.5, y: 65, z: 5.5 });
    look(cy, 1, 0, 0);
    const dee = player("Dee", { x: 0.5, y: 65, z: 12.5 });
    look(dee, 0, 0, -1);
    for (let y = 64; y < 70; y++) for (let x = -3; x < 4; x++) stone(x, y, 11);
    use(ann);
    const [thrown] = spawned(THROWN_ARSENAL);
    thrown.location = { x: 0.5, y: 65.2, z: 5.5 };
    world.projectileHitsBlock(thrown, { x: 0, y: 64, z: 5 }, Direction.Up, ann);
    spawned(PRIMED_ARSENAL)[0].location = { x: 0.5, y: 65.2, z: 5.5 };
    system.advanceTicks(ARSENAL_THROWABLE_DEFS.flashbang.fuseTicks);
    const held = (who: FakePlayer) => who.camera.fades[0]?.fadeTime?.holdTime ?? 0;
    expect(bo.camera.fades[0].fadeColor).toEqual({ red: 1, green: 1, blue: 1 });
    expect(held(bo)).toBeGreaterThan(held(cy));
    expect(held(cy)).toBeGreaterThan(0);
    expect(dee.camera.fades).toEqual([]);
    // Ann threw it the way she looks: she's flashed too.
    expect(held(ann)).toBeGreaterThan(0);
    expect(held(bo)).toBeLessThanOrEqual(FLASH.seconds);
  });

  it("a smoke grenade leaves a cloud that blinds whoever stands in it while it lasts", () => {
    // The arsenal's own ticks start on an odd one: the cloud keeps its own time, not the clock's.
    system.advanceTicks(1);
    const { spawned, particles } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("smoke_grenade"));
    const bo = player("Bo", { x: 1.5, y: 65, z: 6.5 });
    stone(0, 64, 5);
    use(ann);
    const [thrown] = spawned(THROWN_ARSENAL);
    world.projectileHitsBlock(thrown, { x: 0, y: 64, z: 5 }, Direction.Up, ann);
    spawned(PRIMED_ARSENAL)[0].location = { x: 0.5, y: 65.2, z: 5.5 };
    system.advanceTicks(ARSENAL_THROWABLE_DEFS.smoke_grenade.fuseTicks + 10);
    expect(particles(PARTICLES.smoke)[0].variables!.values.get("variable.radius")).toBe(SMOKE.radius);
    expect(bo.effects.has("blindness")).toBe(true);
    expect(ann.effects.has("blindness")).toBe(false);
    // Gone with the cloud.
    system.advanceTicks(SMOKE.seconds * 20);
    bo.effects.clear();
    system.advanceTicks(20);
    expect(bo.effects.has("blindness")).toBe(false);
  });

  it("a throwing knife kills whoever it hits, comes to rest at their feet, and goes to whoever walks over it", () => {
    const { hurts, down, spawned } = setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("throwing_knife"));
    const bo = player("Bo", { x: 0.5, y: 65, z: 6.5 });
    stone(0, 64, 6);
    click(ann);
    expect(ann.inventory.slots[0]).toBeUndefined();
    const [knife] = spawned(THROWN_ARSENAL);
    expect(knife.properties.get(MODEL_PROPERTY)).toBe(ARSENAL_MODELS.indexOf("throwing_knife"));
    world.projectileHitsEntity(knife, bo, { x: 0.5, y: 66, z: 6.3 }, ann);
    expect(hurts).toEqual([{ victim: "Bo", attacker: "Ann", amount: "lethal", cause: "knife" }]);
    down.add("Bo");
    const [lying] = spawned(ARSENAL_PICKUP);
    expect(lying.properties.get(MODEL_PROPERTY)).toBe(ARSENAL_MODELS.indexOf("throwing_knife"));
    expect(lying.location).toMatchObject({ x: 0.5, z: 6.5 });
    expect(lying.location.y).toBeCloseTo(65, 5);
    system.advanceTicks(4);
    expect(lying.isValid).toBe(true);
    ann.location = { x: 0.8, y: 65, z: 6 };
    system.advanceTicks(2);
    expect(lying.isValid).toBe(false);
    expect(ann.inventory.slots[0]?.typeId).toBe(gun("throwing_knife"));
  });
});

describe("the stimpack", () => {
  it("gives health back and a moment of speed, used up, no faster than once a second", () => {
    setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, gun("stimpack"), 2);
    ann.health.currentValue = 6;
    use(ann);
    expect(ann.health.currentValue).toBe(6 + STIM.health);
    expect(ann.effects.get("speed")).toEqual({ amplifier: 0, duration: STIM.speedSeconds * 20 });
    expect(ann.inventory.slots[0]!.amount).toBe(1);
    click(ann);
    expect(ann.inventory.slots[0]!.amount).toBe(1);
    system.advanceTicks(STIM.everyTicks);
    click(ann);
    expect(ann.health.currentValue).toBe(20);
    expect(ann.inventory.slots[0]).toBeUndefined();
  });
});

describe("vanilla weapons", () => {
  it("make a crossbow's arrow and a netherite sword's hit one-hit kills, cancel fire's own damage, and leave everything else to the game", () => {
    const { arsenal } = setup();
    player("Ann", { x: 0.5, y: 65, z: 0.5 }, "minecraft:netherite_sword");
    player("Bo", { x: 0.5, y: 65, z: 0.5 }, "minecraft:iron_sword");
    expect(arsenal.vanillaDamage({ victim: "Cy", attacker: "Ann", cause: "projectile", damage: 9, projectile: "minecraft:arrow" })).toBe(LETHAL);
    expect(arsenal.vanillaDamage({ victim: "Cy", attacker: "Ann", cause: "entityAttack", damage: 8 })).toBe(LETHAL);
    expect(arsenal.vanillaDamage({ victim: "Cy", attacker: "Bo", cause: "entityAttack", damage: 6 })).toBeUndefined();
    expect(arsenal.vanillaDamage({ victim: "Cy", cause: "fall", damage: 3 })).toBeUndefined();
    // Fire's own damage: a Molotov's flames hurt by its own rule instead.
    expect(arsenal.vanillaDamage({ victim: "Cy", cause: "fire", damage: 1 })).toBe("cancel");
    expect(arsenal.vanillaDamage({ victim: "Cy", cause: "fireTick", damage: 1 })).toBe("cancel");
  });

  it("keep crossbow carriers in arrows above the hotbar, and take landed arrows away", () => {
    setup();
    const ann = player("Ann", { x: 0.5, y: 65, z: 0.5 }, "minecraft:crossbow");
    const bo = player("Bo", { x: 0.5, y: 65, z: 0.5 }, "minecraft:iron_sword");
    system.advanceTicks(20);
    const arrows = ann.inventory.slots.filter((stack) => stack?.typeId === "minecraft:arrow");
    expect(arrows.map((stack) => stack!.amount)).toEqual([CROSSBOW_ARROWS]);
    expect(ann.inventory.slots.findIndex((stack) => stack?.typeId === "minecraft:arrow")).toBeGreaterThanOrEqual(9);
    expect(bo.inventory.items().some((stack) => stack.typeId === "minecraft:arrow")).toBe(false);
    const arrow = world.projectileLands(ann);
    expect(arrow.isValid).toBe(false);
  });
});

describe("the arsenal's names and numbers", () => {
  it("reads items back to the weapons Guns knows", () => {
    expect(parseArsenalItem("minecade:rail_gun")).toBe("rail_gun");
    expect(parseArsenalItem("minecade:railgun")).toBeUndefined();
    expect(weaponId("minecade:molotov")).toBe("molotov");
    expect(weaponId("minecade:red_paintball_pistol")).toBe("pistol");
    expect(weaponId("minecraft:crossbow")).toBeUndefined();
  });

  it("works out a flash's strength by distance, facing and sight", () => {
    expect(flashStrength(0, 1, true)).toBe(1);
    expect(flashStrength(FLASH.range / 2, 1, true)).toBeCloseTo(0.5);
    expect(flashStrength(0, -1, true)).toBeCloseTo(1 / 3);
    expect(flashStrength(0, 0.25, true)).toBeCloseTo(2 / 3);
    expect(flashStrength(5, 1, false)).toBe(0);
    expect(flashStrength(FLASH.range, 1, true)).toBe(0);
  });

  it("lets a blast fall off to nothing at its edge, a quarter through cover", () => {
    expect(blastDamage(BLASTS.frag_grenade, 0, false)).toBe(BLASTS.frag_grenade.damage);
    expect(blastDamage(BLASTS.frag_grenade, BLASTS.frag_grenade.radius / 2, true)).toBeCloseTo(BLASTS.frag_grenade.damage / 8);
    expect(blastDamage(BLASTS.frag_grenade, BLASTS.frag_grenade.radius, false)).toBe(0);
  });
});
