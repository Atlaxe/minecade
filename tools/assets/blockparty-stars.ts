// Draws the zoom layers of Block Party's star field (games/blockparty/behavior_pack/scripts/stars.ts):
// see-through stars on a picture the shape of the screen (16:9), each drawn as a streak pointing away
// from the middle, bright at its head and fading back toward the middle, longer the further out it
// is. The HUD centers each picture and grows it (stars.ts, ZOOM_FROM to ZOOM_TO), so the stars rush
// outward and their streaks stretch as they go, as out of a ship's front window. The same every run
// (a fixed seed for each layer).
//
//   games/blockparty/resource_pack/textures/blockparty/stars/zoom_<n>.png    1024x576, one per layer
//
// Placeholders to paint over: like scope-hud.ts it writes only a file that isn't there (delete one
// to get it back), and --force writes them all again over any edits.
//
//     npx tsx tools/assets/blockparty-stars.ts [--force]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../skins/png.ts";
import { ZOOM_LAYERS } from "../../games/blockparty/behavior_pack/scripts/stars.ts";

const WIDTH = 1024;
const HEIGHT = 576;
/** Stars on each picture. */
const STARS = 240;
/** The longest streak (at a corner), in pixels; one at the middle is a dot. */
const LONGEST = 40;

const file = (layer: number) => fileURLToPath(new URL(`../../games/blockparty/resource_pack/textures/blockparty/stars/zoom_${layer}.png`, import.meta.url));

/** A small seeded random number generator (mulberry32), 0 to 1. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** One layer's picture: each star's brightness is its opacity, its color white or a pale blue at full strength. */
function zoomLayer(seed: number): Buffer {
  const rng = random(seed);
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  // A pixel takes the brighter of what's there and what's put on it.
  const put = (x: number, y: number, color: readonly number[], alpha: number) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || alpha <= 0) return;
    const at = (y * WIDTH + x) * 4;
    const value = Math.min(255, Math.round(alpha));
    if (data[at + 3] >= value) return;
    data.set([color[0], color[1], color[2], value], at);
  };
  // A point between pixels, shared among the four around it.
  const splat = (x: number, y: number, color: readonly number[], alpha: number) => {
    const left = Math.floor(x);
    const top = Math.floor(y);
    const right = x - left;
    const down = y - top;
    put(left, top, color, alpha * (1 - right) * (1 - down) * 1.6);
    put(left + 1, top, color, alpha * right * (1 - down) * 1.6);
    put(left, top + 1, color, alpha * (1 - right) * down * 1.6);
    put(left + 1, top + 1, color, alpha * right * down * 1.6);
  };
  const middle = { x: WIDTH / 2, y: HEIGHT / 2 };
  const farthest = Math.hypot(middle.x, middle.y);
  const between = (low: number, high: number) => low + Math.floor(rng() * (high - low + 1));
  for (let star = 0; star < STARS; star++) {
    const x = rng() * WIDTH;
    const y = rng() * HEIGHT;
    const roll = rng();
    const level = roll < 0.7 ? between(110, 170) : roll < 0.95 ? between(175, 235) : between(235, 255);
    const color = rng() < 0.25 ? [190, 222, 255] : [255, 255, 255];
    const away = { x: x - middle.x, y: y - middle.y };
    const out = Math.hypot(away.x, away.y) || 1;
    const length = 1 + LONGEST * (out / farthest) ** 1.4;
    // From the head back toward the middle, fading.
    for (let along = 0; along <= length; along += 0.4) {
      const fade = (1 - along / length) ** 1.6;
      splat(x - (away.x / out) * along, y - (away.y / out) * along, color, level * fade);
    }
    if (roll >= 0.95) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) splat(x + dx, y + dy, color, level * 0.5);
  }
  return encodePng({ width: WIDTH, height: HEIGHT, data });
}

const force = process.argv.includes("--force");
for (let layer = 0; layer < ZOOM_LAYERS; layer++) {
  const path = file(layer);
  if (existsSync(path) && !force) {
    console.log(`kept ${path} (--force to redraw)`);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, zoomLayer(101 + layer * 37));
  console.log(`wrote ${path}`);
}
