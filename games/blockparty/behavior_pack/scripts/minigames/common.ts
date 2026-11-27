// What the minigames built on a test arena of test-arenas.ts share (docs/plans/block-party-minigames.md,
// "How a minigame is built"): the arena from its plan, places from scores or from who went out when,
// a tick loop, the moves their bots make, the game's own entities and blocks, and the items they hand
// out. Kept small: each minigame's own rules stay in its file.
import { BlockPermutation, ItemLockMode, ItemStack, system, type Block, type Dimension, type Entity, type Vector3 } from "@minecraft/server";
import { BOT_RUN, BOT_WALK, hop, isPlayer, stepBot, stepToward, type Who } from "../bots.ts";
import { TEST_ARENAS, layTestArena, testArenaCopies, testArenaField } from "./test-arenas.ts";
import { middleOf, secondsText, type Field, type MinigameDef, type Play, type Spot, type WorldBox } from "./kit.ts";

export { BOT_RUN, BOT_WALK, hop, isPlayer, stepBot, stepToward };

/**
 * A minigame's test arena (test-arenas.ts) as its MinigameDef's size, build and testField, with its
 * Kill Y. A tiled one (arenas.ts, TILED) is laid as many copies side by side as fit, each copy's
 * markup in the field's tiles.
 */
export function onPlan(id: string): Pick<MinigameDef, "size" | "build" | "testField"> {
  const plan = TEST_ARENAS[id];
  if (!plan) throw new Error(`no test arena for ${id}`);
  const copies = testArenaCopies(id);
  const fieldAt = (min: Vector3): Field => {
    const field = testArenaField(plan, min);
    return plan.killY !== undefined ? { ...field, killY: min.y + plan.killY } : field;
  };
  const size: [number, number, number] = [plan.size[0] * copies, plan.size[1], plan.size[2]];
  return {
    size,
    build(dimension, min) {
      layTestArena(dimension, plan, min, copies);
    },
    testField(min) {
      const first = fieldAt(min);
      if (copies <= 1) return first;
      return { ...first, size, tiles: Array.from({ length: copies }, (_, copy) => fieldAt({ x: min.x + copy * plan.size[0], y: min.y, z: min.z })) };
    },
  };
}

/** A field's copies: its tiles, or itself alone. */
export function tilesOf(field: Field): Field[] {
  return field.tiles && field.tiles.length > 0 ? field.tiles : [field];
}

/** Places best first from a score each (higher is better, or lower with `lower`); equal scores tie. */
export function placesBy(keys: readonly string[], score: (key: string) => number, lower = false): string[][] {
  const sorted = [...keys].sort((a, b) => (lower ? score(a) - score(b) : score(b) - score(a)));
  const places: string[][] = [];
  let last: number | undefined;
  for (const key of sorted) {
    const value = score(key);
    if (last !== undefined && value === last) places[places.length - 1].push(key);
    else places.push([key]);
    last = value;
  }
  return places;
}

/**
 * Places from who went out when: everyone still in first, tied (or by `standing`'s score when it's
 * given), then the later out before the sooner; out on the same tick ties.
 */
export function placesByOut(keys: readonly string[], outAt: ReadonlyMap<string, number>, standing?: (key: string) => number): string[][] {
  const still = keys.filter((key) => !outAt.has(key));
  const first = still.length === 0 ? [] : standing ? placesBy(still, standing) : [still];
  const gone = placesBy(
    keys.filter((key) => outAt.has(key)),
    (key) => outAt.get(key) ?? 0,
  );
  return [...first, ...gone];
}

/** A team minigame's winner from each side's score: the higher, or a draw. */
export function winnerBy(scores: readonly number[]): number | undefined {
  if (scores.length < 2 || scores[0] === scores[1]) return undefined;
  return scores[0] > scores[1] ? 0 : 1;
}

/**
 * Runs `each` once a tick for up to `ticks` ticks, until it returns true or the minigame ends.
 * Resolves with how many ticks it ran.
 */
export async function everyTick(play: Play, ticks: number, each: (tick: number) => boolean | void): Promise<number> {
  let tick = 0;
  for (; tick < ticks && !play.scope.disposed; tick++) {
    if (each(tick) === true) break;
    await play.scope.wait(1);
  }
  return tick;
}

/** "Time 12 s". */
export function clock(ticksLeft: number): string {
  return secondsText(ticksLeft);
}

/** Who's a bot among those still in. */
export function botsIn(play: Play): Who[] {
  return play.inPlay().filter((who) => !who.player);
}

/** A level distance. */
export function flat(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** The nearest of `others` still in to `from`, and how far. */
export function nearestOf(play: Play, from: Vector3, others: readonly Who[]): { who: Who; body: Entity; gap: number } | undefined {
  let best: { who: Who; body: Entity; gap: number } | undefined;
  for (const who of others) {
    if (play.isOut(who)) continue;
    const body = play.bodyOf(who);
    if (!body) continue;
    const gap = flat(from, body.location);
    if (!best || gap < best.gap) best = { who, body, gap };
  }
  return best;
}

/** A random spot standing on a box's floor (its lowest layer plus one), `inset` blocks in from its sides. */
export function spotIn(box: WorldBox, random: () => number, inset = 1): Vector3 {
  const span = (lo: number, hi: number) => {
    const from = lo + inset;
    const to = hi + 1 - inset;
    return to > from ? from + random() * (to - from) : (lo + hi + 1) / 2;
  };
  return { x: span(box.min.x, box.max.x), y: box.min.y + 1, z: span(box.min.z, box.max.z) };
}

/** Whether a spot is inside a box (whole blocks, both corners in). */
export function inside(box: WorldBox, at: Vector3, margin = 0): boolean {
  return at.x >= box.min.x - margin && at.x < box.max.x + 1 + margin && at.y >= box.min.y - margin && at.y < box.max.y + 1 + margin && at.z >= box.min.z - margin && at.z < box.max.z + 1 + margin;
}

/** A field's floor box: the arena's whole footprint at its floor (for wandering when it marks none). */
export function wholeFloor(field: Field): WorldBox {
  return { min: { x: field.min.x, y: field.min.y, z: field.min.z }, max: { x: field.min.x + field.size[0] - 1, y: field.min.y, z: field.min.z + field.size[2] - 1 } };
}

/**
 * A bot's step this tick toward `target` at `speed`, unless a push is carrying it (Play.pushed).
 * True once it's there.
 */
export function botStep(play: Play, who: Who, target: Vector3, speed = BOT_WALK, near = 0.3): boolean {
  const body = play.bodyOf(who);
  if (!body || isPlayer(body) || play.pushed(who)) return false;
  return stepToward(body, target, speed, near);
}

/** A bot stands still (keeping its fall), unless a push is carrying it. */
export function botStop(play: Play, who: Who): void {
  const body = play.bodyOf(who);
  if (!body || isPlayer(body) || play.pushed(who)) return;
  stepBot(body, 0, 0);
}

/** Turns a bot to face a spot. */
export function botFace(body: Entity, at: Vector3): void {
  try {
    const yaw = (Math.atan2(-(at.x - body.location.x), at.z - body.location.z) * 180) / Math.PI;
    body.setRotation({ x: 0, y: yaw });
  } catch {
    // gone
  }
}

/** Whether a body is on the ground (a bot's fall has stopped, a player's on ground). */
export function grounded(body: Entity): boolean {
  try {
    return isPlayer(body) ? body.isOnGround : Math.abs(body.getVelocity().y) < 0.01;
  } catch {
    return false;
  }
}

/** A bot's jump, if it's on the ground. */
export function botJump(body: Entity): void {
  if (!isPlayer(body) && grounded(body)) hop(body);
}

/** A spot's yaw toward another. */
export function yawToward(from: Vector3, to: Vector3): number {
  return (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;
}

/** The game's own entity (or a vanilla one) at `at`, gone when the minigame ends (its scope). */
export function spawnIn(play: Play, typeId: string, at: Vector3, yaw?: number, name?: string): Entity | undefined {
  try {
    const entity = play.dimension.spawnEntity(typeId as never, at);
    if (yaw !== undefined) entity.setRotation({ x: 0, y: yaw });
    if (name !== undefined) entity.nameTag = name;
    play.scope.add(() => {
      try {
        if (entity.isValid) entity.remove();
      } catch {
        // gone
      }
    });
    return entity;
  } catch {
    return undefined;
  }
}

/** Removes an entity, if it's still there. */
export function removeEntity(entity: Entity | undefined): void {
  try {
    if (entity?.isValid) entity.remove();
  } catch {
    // gone
  }
}

/** The block at a spot, if its chunk is loaded. */
export function blockAt(dimension: Dimension, at: Vector3): Block | undefined {
  try {
    return dimension.getBlock({ x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) });
  } catch {
    return undefined;
  }
}

/** Sets one block (with states), quietly when its chunk isn't loaded. */
export function setBlock(dimension: Dimension, at: Vector3, id: string, states?: Record<string, string | number | boolean>): void {
  try {
    const block = blockAt(dimension, at);
    if (!block) return;
    if (states) block.setPermutation(BlockPermutation.resolve(id, states));
    else block.setType(id);
  } catch {
    // unloaded, or not a block this server knows
  }
}

/** The block id at a spot ("" when it can't be read). */
export function blockId(dimension: Dimension, at: Vector3): string {
  try {
    return blockAt(dimension, at)?.typeId ?? "";
  } catch {
    return "";
  }
}

/** Every block of a box, lowest layer first. */
export function blocksOf(box: WorldBox): Vector3[] {
  const blocks: Vector3[] = [];
  for (let y = box.min.y; y <= box.max.y; y++) for (let x = box.min.x; x <= box.max.x; x++) for (let z = box.min.z; z <= box.max.z; z++) blocks.push({ x, y, z });
  return blocks;
}

/** An item to hand out, kept in its slot and named. */
export function item(id: string, options: { amount?: number; name?: string; lore?: string[]; canDestroy?: string[]; canPlaceOn?: string[]; free?: boolean } = {}): ItemStack {
  const stack = new ItemStack(id, options.amount ?? 1);
  if (!options.free) stack.lockMode = ItemLockMode.slot;
  if (options.name) stack.nameTag = options.name;
  if (options.lore) stack.setLore(options.lore);
  if (options.canDestroy) stack.setCanDestroy(options.canDestroy);
  if (options.canPlaceOn) stack.setCanPlaceOn(options.canPlaceOn);
  return stack;
}

/** Whether a body has fallen below the field's Kill Y (or `below` blocks under `floorY`). */
export function fellOut(field: Field, body: Entity, floorY?: number, below = 3): boolean {
  try {
    const y = body.location.y;
    if (field.killY !== undefined) return y < field.killY;
    return floorY !== undefined && y < floorY - below;
  } catch {
    return false;
  }
}

/** The lowest spawn's floor (the block under the first spawn). */
export function floorOf(spawns: readonly Spot[], field: Field): number {
  const first = spawns[0];
  return first ? Math.floor(first.y) - 1 : field.min.y;
}

/** Moves a player or bot to a spot, facing its way (a bot's speed is cleared). */
export function moveTo(who: Who, body: Entity | undefined, spot: Spot): void {
  if (!body) return;
  try {
    body.teleport({ x: spot.x, y: spot.y, z: spot.z }, spot.yaw !== undefined ? { rotation: { x: 0, y: spot.yaw } } : undefined);
    if (!who.player) body.clearVelocity();
  } catch {
    // gone
  }
}

/** A box's middle, standing on its top. */
export const middle = middleOf;

/** Which side each key is on. */
export function sideMap(sides: readonly (readonly Who[])[]): Map<string, number> {
  return new Map(sides.flatMap((side, index) => side.map((who) => [who.key, index] as const)));
}

/** Ticks since the server started (for cooldowns kept across ticks). */
export function now(): number {
  return system.currentTick;
}

/** One of a list at random. */
export function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length) % Math.max(1, list.length)];
}

/** A list shuffled. */
export function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The look direction of a body (a bot's from its yaw, level). */
export function viewOf(body: Entity): Vector3 {
  try {
    if (isPlayer(body)) return body.getViewDirection();
    const yaw = (body.getRotation().y * Math.PI) / 180;
    return { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  } catch {
    return { x: 0, y: 0, z: 1 };
  }
}

/** The angle in degrees between where a body looks and the way to a spot. */
export function lookAngle(body: Entity, at: Vector3): number {
  try {
    const eye = isPlayer(body) ? body.getHeadLocation() : { x: body.location.x, y: body.location.y + 1.6, z: body.location.z };
    const view = viewOf(body);
    const to = { x: at.x - eye.x, y: at.y - eye.y, z: at.z - eye.z };
    const length = Math.hypot(to.x, to.y, to.z) || 1;
    const dot = (view.x * to.x + view.y * to.y + view.z * to.z) / length;
    return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
  } catch {
    return 180;
  }
}
