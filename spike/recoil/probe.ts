// Recoil check (the pack script spike/recoil/run.ts bundles, with packages/guns' real Guns): each
// gun's own cooldown started both ways a script can (an item's cooldown component, the player's
// startItemCooldown); then a SimulatedPlayer fires every gun, Paintball's and the arsenal's, and the
// probe reads what each shot left on the server: the gun's own cooldown (its fire rate, which the
// held model's kick runs off on the client) and the player's facing (the view kick). Then it checks
// the teleport the view kick is made of on a walking and a jumping player, and setRotation.
//   scriptevent rc:run        runs it and prints "RC|" lines, then "RC|{"id":"done"}"
import { EntityComponentTypes, GameMode, ItemComponentTypes, ItemStack, system, world, type Player, type Vector3 } from "@minecraft/server";
// @ts-expect-error The gametest module's types aren't installed; the spike only calls these.
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";
import { ARSENAL_GUN_DEFS, GUNS, arsenalItem, gunCooldown, gunItem, type GunDef } from "../../packages/guns/src/defs.ts";
import { Guns } from "../../packages/guns/src/guns.ts";
import { Scope } from "./shim.ts";

/** What the probe uses of a SimulatedPlayer, beyond a Player. */
type Simulated = Player & {
  attack(): boolean;
  moveRelative(leftRight: number, backwardForward: number, speed?: number): void;
  stopMoving(): void;
  jump(): boolean;
};

const Y = 100;
const START = { x: 0.5, y: Y, z: 0.5 };
const r = (n: number) => Math.round(n * 1000) / 1000;
const vec = (v: Vector3) => [r(v.x), r(v.y), r(v.z)];
const out = (value: unknown) => console.log(`RC|${JSON.stringify(value)}`);
const error = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught));
const wait = (ticks: number) => system.waitTicks(ticks);

const ALL_GUNS: { def: GunDef; item: string }[] = [
  ...Object.values(GUNS).map((def) => ({ def: def as GunDef, item: gunItem(def.id as keyof typeof GUNS, "red") })),
  ...Object.values(ARSENAL_GUN_DEFS).map((def) => ({ def: def as GunDef, item: arsenalItem(def.id as keyof typeof ARSENAL_GUN_DEFS) })),
];

system.afterEvents.scriptEventReceive.subscribe(({ id }) => {
  if (id === "rc:run") system.run(() => void run().catch((caught) => out({ id: "error", error: error(caught) })));
});

async function run(): Promise<void> {
  const dimension = world.getDimension("overworld");
  const shooter = spawnSimulatedPlayer({ dimension, ...START }, "Shooter", GameMode.Adventure) as Simulated;
  await wait(10);
  out({ id: "spawned", at: vec(shooter.location) });
  await cooldowns(shooter);
  await firing(shooter);
  await teleports(shooter);
  out({ id: "done" });
}

/**
 * Each gun's own cooldown started both ways: through its item's cooldown component (what Guns did
 * first) and the player's own startItemCooldown (what it does now), with the cooldown the player
 * has after each, at once and a tick later.
 */
async function cooldowns(shooter: Player): Promise<void> {
  for (const { def, item } of ALL_GUNS) {
    const category = gunCooldown(def.id);
    let component: string | number;
    try {
      new ItemStack(item).getComponent(ItemComponentTypes.Cooldown)?.startCooldown(shooter);
      component = shooter.getItemCooldown(category);
    } catch (caught) {
      component = error(caught);
    }
    await wait(def.everyTicks + 2);
    try {
      shooter.startItemCooldown(category, def.everyTicks);
      const now = shooter.getItemCooldown(category);
      await wait(1);
      out({ id: "cooldown", gun: def.id, component, expected: def.everyTicks, now, nextTick: shooter.getItemCooldown(category) });
      await wait(def.everyTicks);
    } catch (caught) {
      out({ id: "cooldown", gun: def.id, component, error: error(caught) });
    }
  }
}

/**
 * Every gun in the shooter's hand, fired by a left click (SimulatedPlayer.attack, which swings) and,
 * failing that, by Guns' own pull: its cooldowns, the facing before and after, and the shots.
 */
async function firing(shooter: Simulated): Promise<void> {
  const scope = new Scope();
  let shots = 0;
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
    warn(...args);
  };
  const swings: string[] = [];
  scope.subscribe(world.afterEvents.playerSwingStart, ({ swingSource }) => void swings.push(String(swingSource)));
  const guns = new Guns(scope, {
    guns: ALL_GUNS.map(({ def }) => def),
    throwables: [],
    canFire: () => true,
    onFire: () => void shots++,
    random: () => 1,
  });
  const inventory = shooter.getComponent(EntityComponentTypes.Inventory)?.container;
  for (const { def, item } of ALL_GUNS) {
    // Guns keeps one fire rate per player: the last gun's wait isn't this one's.
    guns.forget(shooter.name);
    shooter.teleport(START, { rotation: { x: 0, y: 0 } });
    inventory?.setItem(0, new ItemStack(item));
    shooter.selectedSlotIndex = 0;
    await wait(10);
    const before = shooter.getRotation();
    shots = 0;
    swings.length = 0;
    warnings.length = 0;
    const attacked = shooter.attack();
    await wait(1);
    let how = "attack";
    if (shots === 0) {
      how = "pull";
      (guns as unknown as { pull(player: Player, typeId: string): void }).pull(shooter, item);
    }
    const after = shooter.getRotation();
    const own = shooter.getItemCooldown(gunCooldown(def.id));
    await wait(1);
    out({
      id: "fire",
      gun: def.id,
      how,
      attacked,
      swings: [...swings],
      shots,
      before: [r(before.x), r(before.y)],
      after: [r(after.x), r(after.y)],
      expectedKick: [-(def.recoil?.pitch ?? 0), def.recoil?.yaw ?? 0],
      laterTick: [r(shooter.getRotation().x), r(shooter.getRotation().y)],
      ownCooldown: own,
      warnings: [...warnings],
    });
  }
  scope.dispose();
  console.warn = warn;
}

/**
 * The view kick is a teleport to where the player stands with a new facing, keeping their speed:
 * a walking player and a jumping one, each with keepVelocity on and off; then setRotation.
 */
async function teleports(shooter: Simulated): Promise<void> {
  for (const keepVelocity of [true, false]) {
    shooter.teleport(START, { rotation: { x: 0, y: 0 } });
    await wait(5);
    shooter.moveRelative(0, 1, 1);
    const samples: unknown[] = [];
    let threw: string | undefined;
    for (let t = 0; t < 16; t++) {
      if (t === 8) {
        try {
          shooter.teleport(shooter.location, { rotation: { x: -5, y: 2 }, keepVelocity });
        } catch (caught) {
          threw = error(caught);
        }
      }
      await wait(1);
      samples.push([t, vec(shooter.location), vec(shooter.getVelocity()), [r(shooter.getRotation().x), r(shooter.getRotation().y)]]);
    }
    shooter.stopMoving();
    out({ id: "walk", keepVelocity, threw, samples });
  }
  for (const keepVelocity of [true, false]) {
    shooter.teleport(START, { rotation: { x: 0, y: 0 } });
    await wait(10);
    const jumped = shooter.jump();
    const samples: unknown[] = [];
    let threw: string | undefined;
    for (let t = 0; t < 14; t++) {
      if (t === 2) {
        try {
          shooter.teleport(shooter.location, { rotation: { x: -5, y: 2 }, keepVelocity });
        } catch (caught) {
          threw = error(caught);
        }
      }
      await wait(1);
      samples.push([t, r(shooter.location.y - Y), r(shooter.getVelocity().y)]);
    }
    out({ id: "jump", keepVelocity, jumped, threw, samples });
  }
  shooter.teleport(START, { rotation: { x: 0, y: 0 } });
  await wait(2);
  try {
    shooter.setRotation({ x: -10, y: 30 });
    const now = shooter.getRotation();
    await wait(2);
    out({ id: "setRotation", now: [r(now.x), r(now.y)], later: [r(shooter.getRotation().x), r(shooter.getRotation().y)] });
  } catch (caught) {
    out({ id: "setRotation", error: error(caught) });
  }
}
