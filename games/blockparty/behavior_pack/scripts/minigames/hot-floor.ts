// Hot Floor (FFA): a floor of colored tiles, 3 x 3 blocks each, high over the ground. A color is
// called; after a countdown every other tile vanishes, and whoever isn't on the color falls and is
// out. The tiles come back in new colors and the countdown gets shorter each round. The last one
// standing wins; the rest place by when they fell (falling together is a tie). Bots pick a tile of
// the color after a moment's reaction, now and then a wrong one. A bot off the color when the tiles
// go is out by the tile it stood on, not by waiting to see it fall: in the user's first games no bot
// ever dropped (two Hot Floors, the three bots tied first both times).
// Its arena map (arenas.ts) marks the Floor box: the tiles go in its lowest layer, as many 3 x 3
// tiles as fit each way from its lowest corner (at least 2 each way). Its spawns stand on the floor.
import { system, type Dimension, type Vector3 } from "@minecraft/server";
import { BOT_WALK, isPlayer, stepToward, thinkTicks, type Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { botPace, botSlip, botWait } from "./common.ts";
import { at, fill, inOrder, secondsText, spread, testField, type Field, type MinigameDef, type Outcome, type Play } from "./kit.ts";

const COLORS = [
  { block: "minecraft:red_concrete", name: "§cRed" },
  { block: "minecraft:yellow_concrete", name: "§eYellow" },
  { block: "minecraft:lime_concrete", name: "§aGreen" },
  { block: "minecraft:blue_concrete", name: "§9Blue" },
  { block: "minecraft:purple_concrete", name: "§5Purple" },
  { block: "minecraft:orange_concrete", name: "§6Orange" },
] as const;

/** Each tile's width in blocks, and the fewest tiles each way a floor needs. */
const TILE = 3;
const MIN_TILES = 2;
/** The test arena: tiles across each way, the floor's corner from the arena's corner, and its height over the arena's floor. */
const TEST_TILES = 6;
const EDGE = 3;
const FLOOR_Y = 6;
/** Ticks to get to the color: the first round's, then less each round, down to the last. */
const FIRST_COUNT = 80;
const COUNT_STEP = 6;
const LAST_COUNT = 30;
/** Ticks the other tiles stay gone. */
const GONE = 40;
const MAX_ROUNDS = 12;
/** How often a bot heads for a wrong tile (a Medium bot's: botSlip). */
const BOT_MISTAKE = 0.12;
/** Ticks after the tiles go before a bot that was off the color is taken out (if it hasn't fallen out already). */
const BOT_DROP = 8;

/** The tiles: their lowest corner (the floor's), and how many each way. */
interface Tiles {
  corner: Vector3;
  across: number;
  along: number;
}

function tilesOf(field: Field): Tiles | undefined {
  const floor = field.regions(MARKUP.floor)[0];
  if (!floor) return undefined;
  return { corner: floor.min, across: Math.floor((floor.max.x - floor.min.x + 1) / TILE), along: Math.floor((floor.max.z - floor.min.z + 1) / TILE) };
}

function tileMin(tiles: Tiles, tx: number, tz: number): Vector3 {
  return { x: tiles.corner.x + tx * TILE, y: tiles.corner.y, z: tiles.corner.z + tz * TILE };
}

/** The tile under a spot, if it's over the floor: [tx, tz]. */
function tileAt(tiles: Tiles, spot: Vector3): [number, number] | undefined {
  const tx = Math.floor((spot.x - tiles.corner.x) / TILE);
  const tz = Math.floor((spot.z - tiles.corner.z) / TILE);
  return tx >= 0 && tz >= 0 && tx < tiles.across && tz < tiles.along ? [tx, tz] : undefined;
}

function layTiles(dimension: Dimension, tiles: Tiles, colors: readonly number[]): void {
  for (let tx = 0; tx < tiles.across; tx++) {
    for (let tz = 0; tz < tiles.along; tz++) {
      const corner = tileMin(tiles, tx, tz);
      fill(dimension, corner, { x: corner.x + TILE - 1, y: corner.y, z: corner.z + TILE - 1 }, COLORS[colors[tx * tiles.along + tz]].block);
    }
  }
}

export const HOT_FLOOR: MinigameDef = {
  id: "hotfloor",
  name: "Hot Floor",
  kind: "ffa",
  rules: "A color is called: get onto it before the others vanish. Last one standing wins.",
  tutorial: [
    {
      objective: "A color is called. Get onto it before the rest of the floor drops away. Last one standing wins.",
      controls: [
        { input: "move", what: "Get to the color" },
        { input: "jump", what: "Hop across a gap" },
      ],
    },
  ],
  size: [EDGE * 2 + TEST_TILES * TILE, FLOOR_Y + 6, EDGE * 2 + TEST_TILES * TILE],
  build(dimension, min) {
    const tiles = tilesOf(this.testField(min))!;
    layTiles(
      dimension,
      tiles,
      Array.from({ length: tiles.across * tiles.along }, () => 0),
    );
  },
  testField(min) {
    const width = TEST_TILES * TILE;
    const middle = EDGE + width / 2;
    const floor = { min: { x: min.x + EDGE, y: min.y + FLOOR_Y, z: min.z + EDGE }, max: { x: min.x + EDGE + width - 1, y: min.y + FLOOR_Y, z: min.z + EDGE + width - 1 } };
    const spawns = spread(at(min, EDGE + 2, FLOOR_Y + 1, middle - 1), at(min, EDGE + width - 3, FLOOR_Y + 1, middle - 1), 4);
    return testField(min, this.size, { spawns, regions: { [MARKUP.floor]: [floor] } });
  },
  problem(field) {
    const tiles = tilesOf(field);
    if (!tiles) return "its arena map has no Floor box";
    return tiles.across < MIN_TILES || tiles.along < MIN_TILES ? `its Floor box fits ${tiles.across} x ${tiles.along} tiles of 3 x 3, and it needs at least ${MIN_TILES} each way` : undefined;
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { dimension, field, scope } = play;
    const tiles = tilesOf(field)!;
    const count = tiles.across * tiles.along;
    const floorY = tiles.corner.y;
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
      const colors = Array.from({ length: count }, () => Math.floor(play.random() * COLORS.length));
      // At least a few tiles of the color, more apart than together.
      for (let i = 0; i < Math.max(2, Math.round(count / 9)); i++) colors[Math.floor(play.random() * colors.length)] = color;
      layTiles(dimension, tiles, colors);
      const countdown = Math.max(LAST_COUNT, FIRST_COUNT - COUNT_STEP * (round - 1));
      dropping.clear();
      // Each bot's tile: the nearest of the color, now and then a wrong one near it.
      const targets = new Map<string, { at: Vector3; from: number }>();
      for (const who of play.inPlay()) {
        if (isPlayer(who.body)) continue;
        const here = who.body.location;
        let best: { at: Vector3; gap: number } | undefined;
        const wrong = play.random() < botSlip(play, BOT_MISTAKE);
        for (let tx = 0; tx < tiles.across; tx++) {
          for (let tz = 0; tz < tiles.along; tz++) {
            if ((colors[tx * tiles.along + tz] === color) === wrong) continue;
            const corner = tileMin(tiles, tx, tz);
            const middle = { x: corner.x + TILE / 2, y: corner.y + 1, z: corner.z + TILE / 2 };
            const gap = Math.hypot(middle.x - here.x, middle.z - here.z) + (wrong ? play.random() * 20 : 0);
            if (!best || gap < best.gap) best = { at: middle, gap };
          }
        }
        if (best) targets.set(who.key, { at: best.at, from: system.currentTick + thinkTicks(play.random, botWait(play, 6), botWait(play, 18)) });
      }
      for (let tick = 0; tick < countdown + GONE && !scope.disposed; tick++) {
        if (tick === countdown) {
          for (let tx = 0; tx < tiles.across; tx++) {
            for (let tz = 0; tz < tiles.along; tz++) {
              if (colors[tx * tiles.along + tz] === color) continue;
              const corner = tileMin(tiles, tx, tz);
              fill(dimension, corner, { x: corner.x + TILE - 1, y: corner.y, z: corner.z + TILE - 1 }, "minecraft:air");
            }
          }
          for (const who of play.inPlay()) {
            if (isPlayer(who.body)) continue;
            const tile = tileAt(tiles, who.body.location);
            if (!tile || colors[tile[0] * tiles.along + tile[1]] !== color) dropping.add(who.key);
          }
        }
        if (tick === countdown + BOT_DROP) for (const who of play.inPlay()) if (dropping.has(who.key)) fell(who, true);
        // The round and the color on the action bar line only (the user, 2026-11-18: no notice in the dialogue box).
        const colorName = COLORS[color].name.slice(2);
        play.status(tick < countdown ? `Round ${round}: ${colorName} in ${secondsText(countdown - tick)}` : `Round ${round}: ${colorName}`);
        for (const who of play.inPlay()) {
          const target = targets.get(who.key);
          if (target && system.currentTick >= target.from) stepToward(who.body, target.at, botPace(play, BOT_WALK));
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
