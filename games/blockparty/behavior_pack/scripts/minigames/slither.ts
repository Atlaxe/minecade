// Slither (FFA, and 2v2 by its teams; docs/plans/block-party-minigames.md): everyone starts on a
// small patch of their own color and grows it by walking: the floor block under you takes your color
// when it's unpainted and next to (side by side, not corner to corner) a block already yours. Nobody
// paints over anyone else. Most blocks at time wins; it ends early when nobody can grow. Bots walk
// along their edge toward the most unpainted floor.
import type { Vector3 } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, botStep, clock, everyTick, onPlan, placesBy, setBlock, winnerBy } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

const COLORS = [
  { block: "minecraft:red_concrete", name: "§cRed" },
  { block: "minecraft:blue_concrete", name: "§9Blue" },
  { block: "minecraft:lime_concrete", name: "§aGreen" },
  { block: "minecraft:yellow_concrete", name: "§eYellow" },
] as const;
const WHITE = "minecraft:white_concrete";

export const SLITHER: MinigameDef = {
  id: "slither",
  name: "Slither",
  kind: "ffa",
  rules: "Grow your color by walking from its edge. Nobody paints over anyone. Most floor wins.",
  tutorial: [
    {
      objective: "Walk to grow your color: a block takes it when it's next to one already yours. Nobody paints over anyone, so cut the others off. Most floor wins.",
      controls: [
        { input: "move", what: "Grow your color from its edge" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("slither"),
  problem(field) {
    return field.regions(MARKUP.floor)[0] ? undefined : "its arena map has no Floor box";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, dimension, sides } = play;
    const floor = field.regions(MARKUP.floor)[0];
    const x0 = floor.min.x;
    const z0 = floor.min.z;
    const y = floor.min.y;
    const width = floor.max.x - x0 + 1;
    const depth = floor.max.z - z0 + 1;
    const total = play.setting("playTime") * 20;
    const patch = play.setting("startPatch");
    /** Each block's side (x * depth + z), -1 unpainted. */
    const owner = new Int8Array(width * depth).fill(-1);
    const counts = sides.map(() => 0);
    const sideOf = new Map(sides.flatMap((side, index) => side.map((who) => [who.key, index] as const)));
    const paint = (fx: number, fz: number, side: number) => {
      owner[fx * depth + fz] = side;
      counts[side]++;
      setBlock(dimension, { x: x0 + fx, y, z: z0 + fz }, COLORS[side % COLORS.length].block);
    };
    // The floor white, then each player's starting patch around where they stand.
    for (let fx = 0; fx < width; fx++) for (let fz = 0; fz < depth; fz++) setBlock(dimension, { x: x0 + fx, y, z: z0 + fz }, WHITE);
    sides.forEach((side, index) =>
      side.forEach((who) => {
        const body = play.bodyOf(who);
        if (!body) return;
        const cx = Math.floor(body.location.x) - x0;
        const cz = Math.floor(body.location.z) - z0;
        for (let dx = 0; dx < patch; dx++) {
          for (let dz = 0; dz < patch; dz++) {
            const fx = cx + dx - Math.floor(patch / 2);
            const fz = cz + dz - Math.floor(patch / 2);
            if (fx >= 0 && fz >= 0 && fx < width && fz < depth && owner[fx * depth + fz] < 0) paint(fx, fz, index);
          }
        }
      }),
    );
    const next = (fx: number, fz: number, side: number) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dz]) => {
        const nx = fx + dx;
        const nz = fz + dz;
        return nx >= 0 && nz >= 0 && nx < width && nz < depth && owner[nx * depth + nz] === side;
      });
    const canGrow = () => {
      for (let fx = 0; fx < width; fx++) for (let fz = 0; fz < depth; fz++) if (owner[fx * depth + fz] < 0 && sides.some((_, side) => next(fx, fz, side))) return true;
      return false;
    };
    const targets = new Map<string, Vector3>();
    const pickTarget = (from: Vector3, side: number): Vector3 => {
      // An unpainted block on its edge, the nearest of a few looked at, else anywhere unpainted.
      let best: { at: Vector3; score: number } | undefined;
      for (let i = 0; i < 40; i++) {
        const fx = Math.floor(play.random() * width);
        const fz = Math.floor(play.random() * depth);
        if (owner[fx * depth + fz] >= 0 || !next(fx, fz, side)) continue;
        const at = { x: x0 + fx + 0.5, y: y + 1, z: z0 + fz + 0.5 };
        const score = Math.hypot(at.x - from.x, at.z - from.z);
        if (!best || score < best.score) best = { at, score };
      }
      return best?.at ?? { x: x0 + play.random() * width, y: y + 1, z: z0 + play.random() * depth };
    };
    play.notice(sides.map((side, index) => `${COLORS[index % COLORS.length].name}§r ${side.map((who) => who.name).join(" and ")}`).join("   "));
    await everyTick(play, total, (tick) => {
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        const side = sideOf.get(who.key);
        if (!body || side === undefined) continue;
        const fx = Math.floor(body.location.x) - x0;
        const fz = Math.floor(body.location.z) - z0;
        if (fx >= 0 && fz >= 0 && fx < width && fz < depth && Math.abs(body.location.y - (y + 1)) < 1.2 && owner[fx * depth + fz] < 0 && next(fx, fz, side)) paint(fx, fz, side);
        if (!who.player) {
          const target = targets.get(who.key);
          const stale = !target || owner[(Math.floor(target.x) - x0) * depth + (Math.floor(target.z) - z0)] >= 0;
          if (stale || botStep(play, who, target, BOT_WALK, 0.4)) targets.set(who.key, pickTarget(body.location, side));
        }
      }
      if (tick % 5 === 0) play.status(`${sides.map((_, index) => `${COLORS[index % COLORS.length].name} ${counts[index]}`).join("  ")}  §f${clock(total - tick)}`);
      return tick % 20 === 0 && tick > 0 && !canGrow();
    });
    if (sides.every((side) => side.length === 1)) return { places: placesBy(sides.map((side) => side[0].key), (key) => counts[sideOf.get(key) ?? 0]) };
    return { winner: winnerBy(counts) };
  },
};
