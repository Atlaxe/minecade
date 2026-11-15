// Block Party's pieces check, headless: what the server side of the in-game tests does, with
// SimulatedPlayers on a stone floor. Every Block Party entity spawns (its file loads); a player whose
// walking is locked is pushed (applyKnockback) and teleported each tick, and turned by a teleport
// in the middle of a push (does it stall it?); the jump button from a simulated jump; the
// camera calls on a player; and, when the players pack is loaded, a player riding a player and a
// player on another's lead. (The mount and the stand-in were dropped after the user's look.)
// Prints BP|{json} lines; spike/blockparty/pieces.ts reads them. A real client can move differently
// (it runs its own player's physics), so this says what the server accepts, not how it looks.
import { ButtonState, CatmullRomSpline, EasingType, GameMode, InputButton, InputPermissionCategory, system, world } from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";

const out = (id, data) => console.log(`BP|${JSON.stringify({ id, ...data })}`);
const wait = (ticks) => new Promise((resolve) => system.runTimeout(resolve, ticks));
const dim = () => world.getDimension("overworld");
const round = (v) => Math.round(v * 1000) / 1000;
const where = (e) => ({ x: round(e.location.x), y: round(e.location.y), z: round(e.location.z) });
const tryIt = (fn) => {
  try {
    const value = fn();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
};
const ridingOn = (entity) => entity.getComponent("minecraft:riding")?.entityRidingOn?.typeId ?? null;

const ENTITIES = ["chris", "warden", "villager", "witch", "enderman", "wandering_trader", "referee", "allay", "iron_golem", "zombie"];

async function run() {
  const d = dim();
  await world.tickingAreaManager.createTickingArea("bp_floor", { dimension: d, from: { x: -40, y: 60, z: -40 }, to: { x: 40, y: 70, z: 40 } });
  d.runCommand("fill -40 63 -40 40 63 40 stone");
  await wait(2);

  // Every entity spawns.
  const spawned = {};
  ENTITIES.forEach((id, i) => {
    const result = tryIt(() => {
      const entity = d.spawnEntity(`blockparty:${id}`, { x: -30 + i * 3, y: 64, z: -30 });
      entity.nameTag = id;
      return entity.typeId;
    });
    spawned[id] = result.ok ? "ok" : result.error;
  });
  out("entities", { spawned });
  await wait(10);
  const villager = d.getEntities({ type: "blockparty:villager" })[0];
  out("properties", {
    villager: villager && tryIt(() => {
      villager.setProperty("blockparty:profession", 5);
      villager.setProperty("blockparty:biome", 3);
      return { profession: villager.getProperty("blockparty:profession"), biome: villager.getProperty("blockparty:biome") };
    }),
    chris: tryIt(() => {
      const chris = d.getEntities({ type: "blockparty:chris" })[0];
      chris.setProperty("blockparty:variant", 2);
      return chris.getProperty("blockparty:variant");
    }),
    warden: tryIt(() => d.getEntities({ type: "blockparty:warden" })[0].playAnimation("animation.warden.roar", { controller: "blockparty.npc", stopExpression: "q.any_animation_finished" })),
    allayFloats: (() => {
      const allay = d.getEntities({ type: "blockparty:allay" })[0];
      return allay ? where(allay) : null;
    })(),
    npcFallsTo: (() => {
      const zombie = d.getEntities({ type: "blockparty:zombie" })[0];
      return zombie ? where(zombie) : null;
    })(),
  });

  const a = spawnSimulatedPlayer({ dimension: d, x: 0.5, y: 64, z: 0.5 }, "Alpha", GameMode.Adventure);
  const b = spawnSimulatedPlayer({ dimension: d, x: 0.5, y: 64, z: 10.5 }, "Bravo", GameMode.Adventure);
  await wait(20);

  // The jump button.
  let buttons = 0;
  const onButton = world.afterEvents.playerButtonInput.subscribe(() => buttons++, { buttons: [InputButton.Jump], state: ButtonState.Pressed });
  b.jump();
  await wait(10);
  out("jump_button", { simulatedJumpFired: buttons });
  world.afterEvents.playerButtonInput.unsubscribe(onButton);

  // The camera calls on a player.
  const cam = b.camera;
  const spline = new CatmullRomSpline();
  spline.controlPoints = [{ x: 0, y: 70, z: 0 }, { x: 10, y: 72, z: 0 }, { x: 10, y: 74, z: 10 }, { x: 0, y: 72, z: 10 }];
  out("camera", {
    free: tryIt(() => cam.setCamera("minecraft:free", { location: { x: 0, y: 70, z: -5 }, facingLocation: { x: 0, y: 64, z: 0 }, easeOptions: { easeTime: 1, easeType: EasingType.InOutSine } })),
    facingEntity: tryIt(() => cam.setCamera("minecraft:free", { location: { x: 0, y: 70, z: -5 }, facingEntity: a })),
    spline: tryIt(() => cam.playAnimation(spline, { totalTimeSeconds: 4, animation: { progressKeyFrames: [{ alpha: 0, timeSeconds: 0 }, { alpha: 1, timeSeconds: 4 }], rotationKeyFrames: [{ rotation: { x: 20, y: 0, z: 0 }, timeSeconds: 0 }, { rotation: { x: 20, y: 270, z: 0 }, timeSeconds: 4 }] } })),
    fade: tryIt(() => cam.fade({ fadeTime: { fadeInTime: 0.5, holdTime: 0.5, fadeOutTime: 0.5 }, fadeColor: { red: 0, green: 0, blue: 0 } })),
    attachToPlayer: tryIt(() => cam.attachToEntity({ entity: a, locator: "Head" })),
    clear: tryIt(() => cam.clear()),
  });

  // A locked player pushed each tick toward +x, then teleported each tick.
  b.teleport({ x: 0.5, y: 64, z: 10.5 });
  await wait(5);
  b.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, false);
  const pushStart = where(b);
  const pushTrace = [];
  for (let t = 1; t <= 20; t++) {
    b.applyKnockback({ x: 0.4 / 0.4, z: 0 }, 0);
    await wait(1);
    if (t % 5 === 0) pushTrace.push({ t, at: where(b), onGround: b.isOnGround });
  }
  out("push_locked", { start: pushStart, trace: pushTrace, note: "0.4 a tick asked (8 blocks a second)" });
  const tpTrace = [];
  for (let t = 1; t <= 20; t++) {
    b.teleport({ x: b.location.x - 0.4, y: 64, z: 10.5 }, { rotation: { x: 0, y: 90 } });
    await wait(1);
    if (t % 10 === 0) tpTrace.push({ t, at: where(b), rotation: b.getRotation() });
  }
  out("teleport_locked", { trace: tpTrace });
  // Turning a pushed player: a teleport to where they are, with a new facing, at tick 6 of 12
  // pushes. Each tick's step says whether the turn stalled the push. (keepVelocity throws for a
  // player: "not supported for player teleportation".)
  b.teleport({ x: 0.5, y: 64, z: 10.5 });
  await wait(5);
  const turnSteps = [];
  let last = b.location;
  for (let t = 1; t <= 12; t++) {
    b.applyKnockback({ x: 1, z: 0 }, 0);
    if (t === 6) b.teleport(b.location, { rotation: { x: 0, y: -90 } });
    await wait(1);
    turnSteps.push(round(b.location.x - last.x));
    last = b.location;
  }
  out("turn_while_pushed", { stepsPerTick: turnSteps, facing: b.getRotation().y });
  b.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, true);

  // The players pack: a player riding a player, and a player on another's lead.
  const carrier = a.getComponent("minecraft:rideable");
  out("players_pack", { carrierFamilies: carrier?.getFamilyTypes() ?? null, seats: carrier?.getSeats().map((s) => s.position) ?? null, leashable: !!b.getComponent("minecraft:leashable") });
  if (carrier?.getFamilyTypes().includes("player")) {
    a.teleport({ x: 0.5, y: 64, z: 0.5 });
    b.teleport({ x: 1.5, y: 64, z: 0.5 });
    await wait(5);
    const added = carrier.addRider(b);
    await wait(2);
    const trace = [];
    for (let t = 1; t <= 10; t++) {
      a.teleport({ x: 0.5 + 0.3 * t, y: 64, z: 0.5 });
      await wait(1);
      if (t % 5 === 0) trace.push({ t, carrier: where(a), rider: where(b), on: ridingOn(b) });
    }
    out("player_rides_player", { added, riderOn: ridingOn(b), trace });
    carrier.ejectRiders();
    await wait(5);
  }
  const leashable = b.getComponent("minecraft:leashable");
  if (leashable) {
    a.teleport({ x: 0.5, y: 64, z: 0.5 });
    b.teleport({ x: 2.5, y: 64, z: 0.5 });
    await wait(5);
    const tied = tryIt(() => leashable.leashTo(a));
    await wait(2);
    const trace = [];
    for (let t = 1; t <= 30; t++) {
      a.teleport({ x: 0.5 - 0.3 * t, y: 64, z: 0.5 });
      await wait(1);
      if (t % 5 === 0) trace.push({ t, holder: where(a), follower: where(b), gap: round(Math.hypot(a.location.x - b.location.x, a.location.z - b.location.z)), leashed: leashable.isLeashed });
    }
    out("player_on_lead", { tied, holder: leashable.leashHolder?.typeId ?? null, trace });
  }
}

system.afterEvents.scriptEventReceive.subscribe(({ id }) => {
  if (id !== "bp:run") return;
  run()
    .catch((error) => out("error", { message: String(error), stack: error?.stack }))
    .finally(() => out("done", {}));
});
