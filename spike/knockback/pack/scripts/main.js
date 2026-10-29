// Knockback check pack: two SimulatedPlayers on a flat floor, one hits the other, and the
// victim's position and velocity are printed every tick. Driven from spike/knockback/run.ts:
//   scriptevent kb:setup           spawns the players
//   scriptevent kb:case <json>     runs one case and prints "KB|" lines
// Case fields: id, mode (vanilla | zero | cancel), kb ([horizontal, vertical] applied in
// afterEvents.entityHitEntity), weapon (none | wooden_sword | iron_sword), hits (tick offsets),
// sprint (none | flag | run), method (entity | swing), ticks.
import { GameMode, ItemStack, system, world } from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";

const Y = 100;
const ATTACKER_START = { x: 0.5, y: Y, z: 0.5 };
const RUN_START = { x: 0.5, y: Y, z: -4.5 };
const VICTIM_START = { x: 0.5, y: Y, z: 2.0 };

let attacker;
let victim;
/** The case being recorded: { mode, kb, events, t0 }. */
let current;

const r = (n) => Math.round(n * 10000) / 10000;
const vec = (v) => [r(v.x), r(v.y), r(v.z)];
const out = (obj) => console.log(`KB|${JSON.stringify(obj)}`);
const tick = () => system.currentTick - current.t0;
const health = (e) => e.getComponent("minecraft:health")?.currentValue;
const flatDistance = (a, b) => Math.hypot(a.location.x - b.location.x, a.location.z - b.location.z);

world.beforeEvents.entityHurt.subscribe((e) => {
  if (!current || e.hurtEntity.id !== victim?.id) return;
  current.events.push({
    ev: "beforeHurt",
    t: tick(),
    dmg: r(e.damage),
    cause: e.damageSource.cause,
    by: e.damageSource.damagingEntity?.name,
    hp: health(e.hurtEntity),
  });
  if (current.mode === "zero") e.damage = 0;
  else if (current.mode === "cancel") e.cancel = true;
});

world.afterEvents.entityHurt.subscribe((e) => {
  if (!current || e.hurtEntity.id !== victim?.id) return;
  current.events.push({
    ev: "afterHurt",
    t: tick(),
    dmg: r(e.damage),
    cause: e.damageSource.cause,
    hp: health(e.hurtEntity),
    vel: vec(e.hurtEntity.getVelocity()),
  });
});

world.afterEvents.entityHitEntity.subscribe((e) => {
  if (!current || e.damagingEntity.id !== attacker?.id) return;
  const entry = { ev: "hit", t: tick(), target: e.hitEntity.name ?? e.hitEntity.typeId, vel: vec(victim.getVelocity()) };
  if (current.kb && e.hitEntity.id === victim.id) {
    const [h, v] = current.kb;
    const dx = victim.location.x - attacker.location.x;
    const dz = victim.location.z - attacker.location.z;
    const len = Math.hypot(dx, dz) || 1;
    try {
      victim.applyKnockback({ x: (dx / len) * h, z: (dz / len) * h }, v);
      entry.velAfterKb = vec(victim.getVelocity());
    } catch (err) {
      entry.kbError = String(err);
    }
  }
  current.events.push(entry);
});

system.afterEvents.scriptEventReceive.subscribe((e) => {
  if (e.id === "kb:setup") setup();
  else if (e.id === "kb:case") {
    let spec;
    try {
      spec = JSON.parse(e.message);
    } catch (err) {
      out({ id: "?", part: "end", error: `bad case JSON: ${err}` });
      return;
    }
    runCase(spec).catch((err) => {
      current = undefined;
      out({ id: spec.id, part: "end", error: String(err), stack: err?.stack });
    });
  }
});

function setup() {
  const dimension = world.getDimension("overworld");
  try {
    attacker = spawnSimulatedPlayer({ dimension, ...ATTACKER_START }, "Attacker", GameMode.Adventure);
    victim = spawnSimulatedPlayer({ dimension, ...VICTIM_START }, "Victim", GameMode.Adventure);
    out({ id: "setup", part: "end", ok: true, modes: [attacker.getGameMode(), victim.getGameMode()] });
  } catch (err) {
    out({ id: "setup", part: "end", ok: false, error: String(err), stack: err?.stack });
  }
}

async function runCase(spec) {
  const { id, mode = "vanilla", kb = null, weapon = "none", hits = [0], sprint = "none", method = "entity", ticks = 30 } = spec;

  // Reset: both players still, facing each other, victim at full health, no hurt cooldown left.
  attacker.stopMoving();
  attacker.isSprinting = false;
  victim.stopMoving();
  attacker.teleport(sprint === "run" ? RUN_START : ATTACKER_START, { rotation: { x: 0, y: 0 } });
  victim.teleport(VICTIM_START, { rotation: { x: 0, y: 180 } });
  victim.getComponent("minecraft:health").resetToMaxValue();
  attacker.getComponent("minecraft:inventory").container.setItem(0, weapon === "none" ? undefined : new ItemStack(`minecraft:${weapon}`));
  attacker.selectedSlotIndex = 0;
  await system.waitTicks(30);
  attacker.lookAtEntity(victim);
  victim.lookAtEntity(attacker);
  await system.waitTicks(2);

  if (sprint === "run") {
    attacker.isSprinting = true;
    attacker.moveRelative(0, 1, 1);
    for (let i = 0; i < 60 && flatDistance(attacker, victim) > 1.8; i++) await system.waitTicks(1);
  } else if (sprint === "flag") {
    attacker.isSprinting = true;
  }

  const start = victim.location;
  const hpBefore = health(victim);
  current = { mode, kb, events: [], t0: system.currentTick };
  const attacks = [];
  const samples = [];
  let next = 0;
  for (let t = 0; t <= ticks; t++) {
    while (next < hits.length && hits[next] === t) {
      const info = { t, sprinting: attacker.isSprinting, gap: r(flatDistance(attacker, victim)), attackerVel: vec(attacker.getVelocity()) };
      info.ok = method === "swing" ? attacker.attack() : attacker.attackEntity(victim);
      info.velAfter = vec(victim.getVelocity());
      info.hp = health(victim);
      attacks.push(info);
      next++;
      if (sprint === "run" && next === 1) attacker.stopMoving();
    }
    const p = victim.location;
    const v = victim.getVelocity();
    samples.push([t, r(Math.hypot(p.x - start.x, p.z - start.z)), r(p.y - start.y), r(v.x), r(v.y), r(v.z), victim.isOnGround ? 1 : 0]);
    await system.waitTicks(1);
  }
  const events = current.events;
  current = undefined;

  out({ id, part: "meta", spec, hpBefore, hpAfter: health(victim), start: vec(start), attacks });
  for (let i = 0; i < events.length; i += 6) out({ id, part: "events", events: events.slice(i, i + 6) });
  for (let i = 0; i < samples.length; i += 10) out({ id, part: "samples", samples: samples.slice(i, i + 10) });
  out({ id, part: "end" });
}
