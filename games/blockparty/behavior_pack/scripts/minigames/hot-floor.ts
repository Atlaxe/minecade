// Hot Floor (FFA): a floor of colored tiles high over the ground. A color is called; after a
// countdown every other tile vanishes, and whoever isn't on the color falls and is out. The tiles
// come back in new colors and the countdown gets shorter each round. The last one standing wins;
// the rest place by when they fell (falling together is a tie). Bots pick a tile of the color after
// a moment's reaction, now and then a wrong one. A bot off the color when the tiles go is out by the
// tile it stood on, not by waiting to see it fall: in the user's first games no bot ever dropped (two
// Hot Floors, the three bots tied first both times).
import { system, type Dimension, type Vector3 } from "@minecraft/server";
import { BOT_WALK, isPlayer, stepToward, thinkTicks, type Who } from "../bots.ts";
import { at, fill, secondsText, spread, TITLE, type MinigameDef, type Outcome, type Play } from "./kit.ts";

const COLORS = [
  { block: "minecraft:red_concrete", name: "§cRed" },
  { block: "minecraft:yellow_concrete", name: "§eYellow" },
  { block: "minecraft:lime_concrete", name: "§aGreen" },
  { block: "minecraft:blue_concrete", name: "§9Blue" },
  { block: "minecraft:purple_concrete", name: "§5Purple" },
  { block: "minecraft:orange_concrete", name: "§6Orange" },
] as const;

/** Tiles across each way, and each tile's width in blocks. */
const TILES = 6;
const TILE = 3;
/** The floor's corner from the arena's corner, and its height over the arena's floor. */
const EDGE = 3;
const FLOOR_Y = 6;
/** Ticks to get to the color: the first round's, then less each round, down to the last. */
const FIRST_COUNT = 80;
const COUNT_STEP = 6;
const LAST_COUNT = 30;
/** Ticks the other tiles stay gone. */
const GONE = 40;
const MAX_ROUNDS = 12;
/** How often a bot heads for a wrong tile. */
const BOT_MISTAKE = 0.12;
/** Ticks after the tiles go before a bot that was off the color is taken out (if it hasn't fallen out already). */
const BOT_DROP = 8;

function tileMin(min: Vector3, tx: number, tz: number): Vector3 {
  return { x: min.x + EDGE + tx * TILE, y: min.y + FLOOR_Y, z: min.z + EDGE + tz * TILE };
}

/** The tile under a spot, if it's over the floor: [tx, tz]. */
function tileAt(min: Vector3, spot: Vector3): [number, number] | undefined {
  const tx = Math.floor((spot.x - (min.x + EDGE)) / TILE);
  const tz = Math.floor((spot.z - (min.z + EDGE)) / TILE);
  return tx >= 0 && tz >= 0 && tx < TILES && tz < TILES ? [tx, tz] : undefined;
}

function layTiles(dimension: Dimension, min: Vector3, colors: readonly number[]): void {
  for (let tx = 0; tx < TILES; tx++) {
    for (let tz = 0; tz < TILES; tz++) {
      const corner = tileMin(min, tx, tz);
      fill(dimension, corner, { x: corner.x + TILE - 1, y: corner.y, z: corner.z + TILE - 1 }, COLORS[colors[tx * TILES + tz]].block);
    }
  }
}

export const HOT_FLOOR: MinigameDef = {
  id: "hotfloor",
  name: "Hot Floor",
  kind: "ffa",
  rules: "A color is called: get onto it before the others vanish. Last one standing wins.",
  size: [EDGE * 2 + TILES * TILE, FLOOR_Y + 6, EDGE * 2 + TILES * TILE],
  build(dimension, min) {
    layTiles(
      dimension,
      min,
      Array.from({ length: TILES * TILES }, () => 0),
    );
  },
  spawns(min, sides) {
    const total = sides.reduce((sum, count) => sum + count, 0);
    const middle = EDGE + (TILES * TILE) / 2;
    const spots = spread(at(min, EDGE + 2, FLOOR_Y + 1, middle - 1), at(min, EDGE + TILES * TILE - 3, FLOOR_Y + 1, middle - 1), total);
    let next = 0;
    return sides.map((count) => spots.slice(next, (next += count)));
  },
  async play(play: Play): Promise<Outcome> {
    const { dimension, min, scope } = play;
    const floorY = min.y + FLOOR_Y;
    const started = play.inPlay().length;
    /** Who fell in which round, by key. */
    const fellIn = new Map<string, number>();
    let round = 0;
    /** Bots that stood off the color when the tiles went, by key. */
    const dropping = new Set<string>();
    const fell = (who: Who, said: boolean) => {
      fellIn.set(who.key, round);
      play.out(who);
      if (said) play.say(`${who.name} fell.`);
    };
    const checkFalls = () => {
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        if (!body || body.location.y < floorY - 1.5) fell(who, body !== undefined);
      }
    };
    for (round = 1; round <= MAX_ROUNDS; round++) {
      const color = Math.floor(play.random() * COLORS.length);
      const colors = Array.from({ length: TILES * TILES }, () => Math.floor(play.random() * COLORS.length));
      // At least a few tiles of the color, more apart than together.
      for (let i = 0; i < 4; i++) colors[Math.floor(play.random() * colors.length)] = color;
      layTiles(dimension, min, colors);
      const count = Math.max(LAST_COUNT, FIRST_COUNT - COUNT_STEP * (round - 1));
      play.title(COLORS[color].name, `Round ${round}`, TITLE.land);
      dropping.clear();
      // Each bot's tile: the nearest of the color, now and then a wrong one near it.
      const targets = new Map<string, { at: Vector3; from: number }>();
      for (const who of play.inPlay()) {
        if (isPlayer(who.body)) continue;
        const here = who.body.location;
        let best: { at: Vector3; gap: number } | undefined;
        const wrong = play.random() < BOT_MISTAKE;
        for (let tx = 0; tx < TILES; tx++) {
          for (let tz = 0; tz < TILES; tz++) {
            if ((colors[tx * TILES + tz] === color) === wrong) continue;
            const corner = tileMin(min, tx, tz);
            const middle = { x: corner.x + TILE / 2, y: corner.y + 1, z: corner.z + TILE / 2 };
            const gap = Math.hypot(middle.x - here.x, middle.z - here.z) + (wrong ? play.random() * 20 : 0);
            if (!best || gap < best.gap) best = { at: middle, gap };
          }
        }
        if (best) targets.set(who.key, { at: best.at, from: system.currentTick + thinkTicks(play.random, 6, 18) });
      }
      for (let tick = 0; tick < count + GONE && !scope.disposed; tick++) {
        if (tick === count) {
          for (let tx = 0; tx < TILES; tx++) {
            for (let tz = 0; tz < TILES; tz++) {
              if (colors[tx * TILES + tz] === color) continue;
              const corner = tileMin(min, tx, tz);
              fill(dimension, corner, { x: corner.x + TILE - 1, y: corner.y, z: corner.z + TILE - 1 }, "minecraft:air");
            }
          }
          for (const who of play.inPlay()) {
            if (isPlayer(who.body)) continue;
            const tile = tileAt(min, who.body.location);
            if (!tile || colors[tile[0] * TILES + tile[1]] !== color) dropping.add(who.key);
          }
        }
        if (tick === count + BOT_DROP) for (const who of play.inPlay()) if (dropping.has(who.key)) fell(who, true);
        play.status(tick < count ? `${COLORS[color].name.slice(2)} in ${secondsText(count - tick)}` : `Round ${round}`);
        for (const who of play.inPlay()) {
          const target = targets.get(who.key);
          if (target && system.currentTick >= target.from) stepToward(who.body, target.at, BOT_WALK);
        }
        checkFalls();
        await scope.wait(1);
      }
      const left = play.inPlay().length;
      if (left === 0 || (started >= 2 && left <= 1)) break;
    }
    // Places: everyone still standing first, then who fell later before who fell sooner.
    const standing = play.inPlay().map((who) => who.key);
    const rounds = [...new Set(fellIn.values())].sort((a, b) => b - a);
    const places = [...(standing.length > 0 ? [standing] : []), ...rounds.map((fell) => [...fellIn].filter(([, r]) => r === fell).map(([key]) => key))];
    return { places };
  },
};
