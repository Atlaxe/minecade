// Knockback check pack: SimulatedPlayers on a flat floor, one hits another, and the victim's
// position and velocity are printed every tick. Driven from spike/knockback/run.ts:
//   scriptevent kb:setup           spawns the players (Attacker, Victim, Attacker2, Bystander)
//   scriptevent kb:case <json>     runs one case and prints "KB|" lines
// Case fields: id, mode (vanilla | zero | cancel), kb ([horizontal, vertical] applied with
// applyKnockback in afterEvents.entityHitEntity), kbSprint (the same, used instead of kb when
// the attacker is sprinting), weapon (none | wooden_sword | iron_sword), hits (tick offsets),
// and per hit: by (a | b), targets (victim | bystander), weapons; sprint (none | flag | run),
// method (entity | swing), attackerAt ([x, z]), attackerYaw, ticks.
import { GameMode, ItemStack, system, world } from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";

const Y = 100;
const ATTACKER_START = { x: 0.5, y: Y, z: 0.5 };
const RUN_START = { x: 0.5, y: Y, z: -4.5 };
const VICTIM_START = { x: 0.5, y: Y, z: 2.0 };
const ATTACKER2_START = { x: -3.5, y: Y, z: 2.0 };
const BYSTANDER_START = { x: 6.5, y: Y, z: 0.5 };

let attacker;
let attacker2;
let victim;
let bystander;
/** The case being recorded: { mode, kb, kbSprint, events, t0 }. */
let current;

const r = (n) => Math.round(n * 10000) / 10000;
const vec = (v) => [r(v.x), r(v.y), r(v.z)];
const out = (obj) => console.log(`KB|${JSON.stringify(obj)}`);
const tick = () => system.currentTick - current.t0;
const health = (e) => e.getComponent("minecraft:health")?.currentValue;
const flatDistance = (a, b) => Math.hypot(a.location.x - b.location.x, a.location.z - b.location.z);
const isTarget = (e) => e.id === victim?.id || e.id === bystander?.id;
const isAttacker = (e) => e.id === attacker?.id || e.id === attacker2?.id;

world.beforeEvents.entityHurt.subscribe((e) => {
  if (!current || !isTarget(e.hurtEntity)) return;
  current.events.push({
    ev: "beforeHurt",
    t: tick(),
    who: e.hurtEntity.name,
    dmg: r(e.damage),
    cause: e.damageSource.cause,
    by: e.damageSource.damagingEntity?.name,
    hp: health(e.hurtEntity),
  });
  if (current.mode === "zero") e.damage = 0;
  else if (current.mode === "cancel") e.cancel = true;
});

world.afterEvents.entityHurt.subscribe((e) => {
  if (!current || !isTarget(e.hurtEntity)) return;
  current.events.push({
    ev: "afterHurt",
    t: tick(),
    who: e.hurtEntity.name,
    dmg: r(e.damage),
    cause: e.damageSource.cause,
    hp: health(e.hurtEntity),
    vel: vec(e.hurtEntity.getVelocity()),
  });
});

world.afterEvents.entityHitEntity.subscribe((e) => {
  if (!current || !isAttacker(e.damagingEntity)) return;
  const hit = e.hitEntity;
  const by = e.damagingEntity;
  const entry = { ev: "hit", t: tick(), by: by.name, who: hit.name ?? hit.typeId, sprinting: by.isSprinting, vel: vec(hit.getVelocity()) };
  const kb = by.isSprinting && current.kbSprint ? current.kbSprint : current.kb;
  if (kb && isTarget(hit)) {
    const [h, v] = kb;
    const dx = hit.location.x - by.location.x;
    const dz = hit.location.z - by.location.z;
    const len = Math.hypot(dx, dz) || 1;
    try {
      hit.applyKnockback({ x: (dx / len) * h, z: (dz / len) * h }, v);
      entry.kb = kb;
      entry.velAfterKb = vec(hit.getVelocity());
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
    attacker2 = spawnSimulatedPlayer({ dimension, ...ATTACKER2_START }, "Attacker2", GameMode.Adventure);
    bystander = spawnSimulatedPlayer({ dimension, ...BYSTANDER_START }, "Bystander", GameMode.Adventure);
    out({ id: "setup", part: "end", ok: true, modes: [attacker.getGameMode(), victim.getGameMode()] });
  } catch (err) {
    out({ id: "setup", part: "end", ok: false, error: String(err), stack: err?.stack });
  }
}

function hold(player, weapon) {
  player.getComponent("minecraft:inventory").container.setItem(0, weapon === "none" ? undefined : new ItemStack(`minecraft:${weapon}`));
  player.selectedSlotIndex = 0;
}

async function runCase(spec) {
  const { id, mode = "vanilla", kb = null, kbSprint = null, weapon = "none", hits = [0], sprint = "none", method = "entity", ticks = 30 } = spec;

  // Reset: everyone still, attacker and victim facing each other, full health, no hurt cooldown left.
  for (const p of [attacker, attacker2, victim, bystander]) p.stopMoving();
  attacker.isSprinting = false;
  const attackerStart = spec.attackerAt ? { x: spec.attackerAt[0], y: Y, z: spec.attackerAt[1] } : ATTACKER_START;
  attacker.teleport(sprint === "run" ? RUN_START : attackerStart, { rotation: { x: 0, y: 0 } });
  victim.teleport(VICTIM_START, { rotation: { x: 0, y: 180 } });
  attacker2.teleport(ATTACKER2_START, { rotation: { x: 0, y: -90 } });
  bystander.teleport(BYSTANDER_START, { rotation: { x: 0, y: 90 } });
  for (const p of [victim, bystander]) p.getComponent("minecraft:health").resetToMaxValue();
  hold(attacker, weapon);
  hold(attacker2, weapon);
  await system.waitTicks(30);
  attacker.lookAtEntity(victim);
  victim.lookAtEntity(attacker);
  await system.waitTicks(2);
  if (spec.attackerYaw !== undefined) {
    attacker.setRotation({ x: 0, y: spec.attackerYaw });
    await system.waitTicks(1);
  }

  if (sprint === "run") {
    attacker.isSprinting = true;
    attacker.moveRelative(0, 1, 1);
    for (let i = 0; i < 60 && flatDistance(attacker, victim) > 1.8; i++) await system.waitTicks(1);
  } else if (sprint === "flag") {
    attacker.isSprinting = true;
  }

  const start = victim.location;
  const hpBefore = health(victim);
  current = { mode, kb, kbSprint, events: [], t0: system.currentTick };
  const attacks = [];
  const samples = [];
  let next = 0;
  for (let t = 0; t <= ticks; t++) {
    while (next < hits.length && hits[next] === t) {
      const by = spec.by?.[next] === "b" ? attacker2 : attacker;
      const target = spec.targets?.[next] === "bystander" ? bystander : victim;
      if (spec.weapons?.[next]) hold(by, spec.weapons[next]);
      const info = { t, by: by.name, target: target.name, sprinting: by.isSprinting, gap: r(flatDistance(by, target)), attackerVel: vec(by.getVelocity()) };
      info.ok = method === "swing" ? by.attack() : by.attackEntity(target);
      info.sprintingAfter = by.isSprinting;
      info.velAfter = vec(target.getVelocity());
      info.hp = health(target);
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

  const rot = attacker.getRotation();
  out({ id, part: "meta", spec, hpBefore, hpAfter: health(victim), start: vec(start), attackerYaw: r(rot.y), attacks });
  for (let i = 0; i < events.length; i += 5) out({ id, part: "events", events: events.slice(i, i + 5) });
  for (let i = 0; i < samples.length; i += 10) out({ id, part: "samples", samples: samples.slice(i, i + 10) });
  out({ id, part: "end" });
}
