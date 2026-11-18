// Draws the nearer layers of Block Party's star field (games/blockparty/behavior_pack/scripts/
// stars.ts): see-through stars, drawn the way make-assets.py draws Minecade's star field (mostly
// faint single pixels, some brighter, a few bright with a small cross of glow, some tinted blue),
// but on nothing, so the far layer (Minecade's own stars, on black) shows between them. Each wraps
// at its edges, since it repeats as it slides. The same every run (a fixed seed for each).
//
//   games/blockparty/resource_pack/textures/blockparty/stars/mid.png    256x256, shown at its size
//   games/blockparty/resource_pack/textures/blockparty/stars/near.png   256x256, shown twice its size
//
// Placeholders to paint over: like scope-hud.ts it writes only a file that isn't there (delete one
// to get it back), and --force writes both again over any edits. A layer's tile size and speed are
// in stars.ts (STAR_LAYERS): a new size there needs a new picture here.
//
//     npx tsx tools/assets/blockparty-stars.ts [--force]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../skins/png.ts";

const SIZE = 256;

const file = (name: string) => fileURLToPath(new URL(`../../games/blockparty/resource_pack/textures/blockparty/stars/${name}.png`, import.meta.url));

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

/**
 * `count` stars on nothing: each star's brightness is its opacity, its color white or a pale blue at
 * full strength. `least` is the faintest a star gets (0 to 255): the near layer's are brighter.
 */
function starLayer(seed: number, count: number, least: number): Buffer {
  const rng = random(seed);
  const data = new Uint8Array(SIZE * SIZE * 4);
  const put = (x: number, y: number, color: readonly number[], alpha: number) => {
    const at = ((((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)) * 4;
    if (data[at + 3] >= alpha) return;
    data.set([color[0], color[1], color[2], alpha], at);
  };
  const between = (low: number, high: number) => low + Math.floor(rng() * (high - low + 1));
  for (let star = 0; star < count; star++) {
    const x = Math.floor(rng() * SIZE);
    const y = Math.floor(rng() * SIZE);
    const roll = rng();
    const level = roll < 0.8 ? between(least, Math.max(least, 130)) : roll < 0.97 ? between(150, 220) : between(230, 255);
    const color = rng() < 0.2 ? [178, 217, 255] : [255, 255, 255];
    put(x, y, color, level);
    if (roll >= 0.97) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(x + dx, y + dy, color, Math.round(level * 0.45));
  }
  return encodePng({ width: SIZE, height: SIZE, data });
}

const force = process.argv.includes("--force");
for (const [name, draw] of [
  ["mid", () => starLayer(23, 260, 70)],
  ["near", () => starLayer(41, 70, 110)],
] as const) {
  const path = file(name);
  if (existsSync(path) && !force) {
    console.log(`kept ${path} (--force to redraw)`);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, draw());
  console.log(`wrote ${path}`);
}
