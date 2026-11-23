// Block Party's walk check, headless: lays the test board (test-board.ts) on a void world with the
// markers' floors, and walks a SimulatedPlayer over each of its 12 stretches the way the game walks a
// player (walk-plan.ts plans the leg, walk-follow.ts says each tick's push, applyKnockback pushes),
// printing every tick. With server-authoritative movement the server moves a real player the same
// way, so where a SimulatedPlayer sticks a player does too. "bot" walks the game's bot entity instead,
// set moving each tick as the game moves a bot (bots.ts, moveBot). "off=<blocks>" starts each stretch
// that far to the left of its line (the line still runs through the space's middle), so the steer back
// onto it shows: the leg line has its most off the line and where it ended up.
// Bundled by spike/blockparty/walk.ts, which reads the BP|{json} lines it prints.
import { GameMode, system, world, type Entity, type Vector3 } from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";
import { yawTo, type Vec3 } from "../../../games/blockparty/behavior_pack/scripts/board.ts";
import { BOT_ENTITY, moveBot } from "../../../games/blockparty/behavior_pack/scripts/bots.ts";
import { floorBlocks, FLOOR_BLOCK } from "../../../games/blockparty/behavior_pack/scripts/space-markers.ts";
import { WorldTerrain } from "../../../games/blockparty/behavior_pack/scripts/terrain.ts";
import { layTestBoard, testBoardSpaces } from "../../../games/blockparty/behavior_pack/scripts/test-board.ts";
import { followTick, knockbackFor, legOf, newFollow } from "../../../games/blockparty/behavior_pack/scripts/walk-follow.ts";
import { planLeg } from "../../../games/blockparty/behavior_pack/scripts/walk-plan.ts";
import { BlockPermutation } from "@minecraft/server";

const MIDDLE: Vec3 = [0.5, 64, 48.5];
const PER_TICK = 0.4;
/** Ticks a leg may run past its length before it counts as stuck (pieces.ts's STUCK_SLACK). */
const SLACK = 30;

const out = (id: string, data: object): void => console.log(`BP|${JSON.stringify({ id, ...data })}`);
const wait = (ticks: number): Promise<void> => new Promise((resolve) => system.runTimeout(() => resolve(), ticks));
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

async function run(bot: boolean, only: number[] | undefined, off: number): Promise<void> {
  const dimension = world.getDimension("overworld");
  const [mx, my, mz] = MIDDLE;
  await world.tickingAreaManager.createTickingArea("bp_walk", { dimension, from: { x: mx - 24, y: my - 8, z: mz - 24 }, to: { x: mx + 24, y: my + 8, z: mz + 24 } });
  await wait(4);
  const spaces = testBoardSpaces(MIDDLE);
  layTestBoard(dimension, MIDDLE);
  for (const space of spaces) {
    for (const { at, cell } of floorBlocks(space)) {
      const block = dimension.getBlock({ x: at[0], y: at[1], z: at[2] });
      if (block?.isAir) block.setPermutation(BlockPermutation.resolve(FLOOR_BLOCK, { "blockparty:cell": cell }));
    }
  }
  await wait(4);
  // What a ray down reports on each kind of top (the reader turns these into ground heights).
  const probes: [string, number, number][] = [
    ["path (full block)", -10, -12],
    ["stair", -9, -12],
    ["slab", 12, -1],
    ["carpet", 2, 12],
    ["daylight detector", 0, 12],
    ["ladder over its column", 12, 8],
  ];
  for (const [what, dx, dz] of probes) {
    const x = Math.floor(mx) + dx + 0.5;
    const z = Math.floor(mz) + dz + 0.5;
    const hit = dimension.getBlockFromRay({ x, y: my + 6, z }, { x: 0, y: -1, z: 0 }, { maxDistance: 12, includeLiquidBlocks: true, includePassableBlocks: false });
    out("ray", { what, block: hit?.block.typeId ?? null, y: hit?.block.location.y ?? null, face: hit?.face ?? null, faceY: hit ? r3(hit.faceLocation.y) : null });
  }
  const terrain = new WorldTerrain(dimension, () => spaces);
  const start = { x: spaces[0].at[0], y: spaces[0].at[1], z: spaces[0].at[2] };
  const sim: Entity = bot ? dimension.spawnEntity(BOT_ENTITY, start) : spawnSimulatedPlayer({ dimension, ...start }, "Walker", GameMode.Adventure);
  await wait(20);
  for (let i = 0; i < spaces.length; i++) {
    if (only && !only.includes(i)) continue;
    const from = spaces[i];
    const to = spaces[(i + 1) % spaces.length];
    // Off to the line's left (-uz, ux) by `off`.
    const line = legOf(from.at, to.at);
    sim.teleport({ x: from.at[0] - line.uz * off, y: from.at[1] + 0.05, z: from.at[2] + line.ux * off }, { rotation: { x: 0, y: yawTo(from.at, to.at) } });
    await wait(15);
    const here = sim.location;
    const a: Vec3 = off === 0 ? [here.x, here.y, here.z] : [from.at[0], here.y, from.at[2]];
    const b = to.at;
    const leg = legOf(a, b);
    const plan = planLeg(terrain, a, b, PER_TICK);
    out("plan", { i, start: r3(here.y), heights: plan.heights.map(r3), air: plan.air.map((x) => (x ? 1 : 0)), climbs: plan.climbs, blocked: plan.blocked ?? null, step: r3(plan.step) });
    const state = newFollow();
    const budget = Math.ceil(leg.span / PER_TICK) + plan.climbTicks + SLACK;
    let outcome = "stuck";
    let ticks = 0;
    for (; ticks < budget; ticks++) {
      const at: Vector3 = sim.location;
      const v = sim.getVelocity();
      const next = followTick(plan, leg, state, at, PER_TICK);
      const row: (number | string)[] = [ticks, r3(at.x - a[0]), r3(at.y), r3(at.z - a[2]), r3(v.x), r3(v.y), r3(v.z), r3(next.along)];
      if (next.kind !== "push") {
        out("t", { i, r: row, k: next.kind });
        outcome = next.kind === "end" ? "end" : next.why;
        break;
      }
      const push = knockbackFor(next.want, next.up, v, sim.isOnGround);
      row.push(r3(next.target), r3(next.up), r3(bot ? next.up : push.strength), plan.air[Math.round(Math.max(0, next.along) / plan.step)] ? 1 : 0, next.climbing ? 1 : 0, sim.isOnGround ? 1 : 0);
      out("t", { i, r: row });
      if (bot) moveBot(sim, next.want.x, next.up, next.want.z);
      else sim.applyKnockback({ x: push.x, z: push.z }, push.strength);
      await wait(1);
    }
    const end = sim.location;
    const side = (end.x - a[0]) * -leg.uz + (end.z - a[2]) * leg.ux;
    out("leg", { i, outcome, ticks, budget, endY: r3(end.y), bY: r3(b[1]), alongLeft: r3(leg.span - ((end.x - a[0]) * leg.ux + (end.z - a[2]) * leg.uz)), drift: r3(state.drift), side: r3(side) });
    if (bot) moveBot(sim, 0, 0, 0);
    else sim.applyKnockback({ x: 0, z: 0 }, 0);
    await wait(5);
  }
  out("done", {});
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id === "bp:walk") {
    const words = event.message.split(" ").filter(Boolean);
    const bot = words.includes("bot");
    const list = words.find((word) => /^[\d,]+$/.test(word));
    const off = Number(words.find((word) => word.startsWith("off="))?.slice(4) ?? 0) || 0;
    out("started", {});
    run(bot, list?.split(",").map(Number), off).catch((error) => out("done", { error: String(error) }));
  }
});
