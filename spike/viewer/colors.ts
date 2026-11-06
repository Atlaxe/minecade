// Map viewer spike, step 2: builds every block's face colors from the client and the blocks pack
// (looks.ts), times it, says how many of the blocks the maps use have a look, and writes, all in
// work\viewer\spike\ (git-ignored, as the colors come from the client's textures):
//   faces.json     each block's up, down and side color (the plan's method, tinted)
//   colors.json    each block's top color, for overview.ts
//   swatches.html  about 25 blocks: the texture, the whole texture's average, the plan's color
//   swatches.png   the same without names, in the same order
//   npx tsx spike/viewer/colors.ts [<world folder> ...]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, workingDir } from "../../tools/maps/paths.ts";
import { encodeRgbaPng, type Picture } from "./image.ts";
import { commonColor, loadLooks, tinted, wholeAverage, type Face, type Rgba } from "./looks.ts";
import { decodeWorld } from "./world.ts";

const out = join(repoRoot, "work", "viewer", "spike");
mkdirSync(out, { recursive: true });
const blocksPack = [join(repoRoot, "packs", "blocks"), join(repoRoot, "..", "network", "packs", "blocks")].find((dir) => existsSync(join(dir, "behavior_pack", "manifest.json")));

let started = performance.now();
const looks = loadLooks(undefined, blocksPack);
const loadMs = performance.now() - started;
started = performance.now();
const faces: Record<string, Record<Face, Rgba>> = {};
const colorOf = new Map<string, Rgba>();
for (const [path, picture] of looks.pictures) colorOf.set(path, tinted(commonColor(picture), looks.tints.get(path)));
for (const [name, textures] of looks.faces) faces[name] = { up: colorOf.get(textures.up)!, down: colorOf.get(textures.down)!, side: colorOf.get(textures.side)! };
const colorMs = performance.now() - started;
const custom = [...looks.faces.keys()].filter((name) => name.startsWith("minecade:")).length;
console.log(`looks: ${looks.faces.size} blocks (${custom} custom), ${looks.pictures.size} textures, ${looks.tints.size} tinted; read and decoded in ${loadMs.toFixed(0)} ms, colors in ${colorMs.toFixed(0)} ms`);
writeFileSync(join(out, "faces.json"), JSON.stringify(faces));
writeFileSync(join(out, "colors.json"), JSON.stringify(Object.fromEntries(Object.entries(faces).map(([name, face]) => [name, face.up.slice(0, 3)]))));

// Coverage: the blocks the maps use (and any worlds given), by how many blocks of each.
const worlds = [...["bridges/temples", "sumo/sinkhole", "siege/strife", "quiver/kgb", "buildswap/roman", "lobby/spaceship"].map((path) => join(workingDir(path.split("/")[0]), path.split("/")[1], "world")), ...process.argv.slice(2)];
for (const world of worlds) {
  if (!existsSync(join(world, "db"))) continue;
  const decoded = decodeWorld(world);
  const counts = new Map<string, number>();
  for (const layers of decoded.sections.values()) {
    for (const id of layers[0]) if (id !== 0) counts.set(decoded.palette.blocks[id].name, (counts.get(decoded.palette.blocks[id].name) ?? 0) + 1);
  }
  const missing = [...counts].filter(([name]) => !looks.faces.has(name)).sort((a, b) => b[1] - a[1]);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const missingBlocks = missing.reduce((sum, [, n]) => sum + n, 0);
  console.log(`  ${world.split(/[\\/]/).slice(-3, -1).join("/")}: ${counts.size - missing.length} of ${counts.size} kinds have a look (${(100 - (100 * missingBlocks) / total).toFixed(1)}% of blocks). Without: ${missing.slice(0, 14).map(([name, n]) => `${name.replace("minecraft:", "")} ${n}`).join(", ")}`);
}

// Swatches.
const SWATCH = ["stone", "grass_block", "grass", "dirt", "oak_planks", "oak_log", "sand", "cobblestone", "deepslate", "tuff", "iron_ore", "diamond_ore", "brick_block", "white_wool", "glass", "oak_leaves", "spruce_leaves", "water", "sandstone", "brown_terracotta", "moss_block", "smooth_basalt", "gravel", "red_concrete", "glowstone", "mud", "clay", "stone_bricks", "short_grass"];
const shown = SWATCH.map((name) => `minecraft:${name}`).filter((name) => looks.faces.has(name));
const SCALE = 4;
const CELL = 16 * SCALE;
const GAP = 8;
const sheet: Picture = { width: 3 * CELL + 4 * GAP, height: shown.length * (CELL + GAP) + GAP, data: new Uint8Array((3 * CELL + 4 * GAP) * (shown.length * (CELL + GAP) + GAP) * 4).fill(255) };
const rows: string[] = [];
shown.forEach((name, row) => {
  const path = looks.faces.get(name)!.up;
  const picture = looks.pictures.get(path)!;
  const tint = looks.tints.get(path);
  const whole = tinted(wholeAverage(picture), tint);
  const common = tinted(commonColor(picture), tint);
  const top = GAP + row * (CELL + GAP);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const sx = Math.floor((x * picture.width) / CELL);
      const sy = Math.floor((y * picture.height) / CELL);
      const source = picture.data.subarray((sy * picture.width + sx) * 4, (sy * picture.width + sx) * 4 + 4);
      const texel = tinted([source[0], source[1], source[2], source[3]], tint);
      const put = (column: number, color: Rgba) => sheet.data.set([color[0], color[1], color[2], 255], ((top + y) * sheet.width + GAP + column * (CELL + GAP) + x) * 4);
      put(0, texel[3] < 128 ? [255, 255, 255, 255] : texel);
      put(1, whole);
      put(2, common);
    }
  }
  const css = (color: Rgba) => `rgba(${color[0]},${color[1]},${color[2]},${(color[3] / 255).toFixed(2)})`;
  rows.push(`<tr><td>${name.replace("minecraft:", "")}<br><small>${path.split("/").pop()}${tint ? ", tinted" : ""}</small></td><td><div class="t" style="background-position:0 -${row * (CELL + GAP) + GAP}px"></div></td><td><div class="c" style="background:${css(whole)}"></div></td><td><div class="c" style="background:${css(common)}"></div></td></tr>`);
});
const png = encodeRgbaPng(sheet);
writeFileSync(join(out, "swatches.png"), png);
writeFileSync(
  join(out, "swatches.html"),
  `<!doctype html><meta charset="utf-8"><title>Block colors</title><style>body{font:14px system-ui;margin:24px}td{padding:4px 12px;vertical-align:middle}.t{width:${CELL}px;height:${CELL}px;background:url(data:image/png;base64,${png.toString("base64")}) no-repeat;background-position-x:-${GAP}px;image-rendering:pixelated}.c{width:${CELL}px;height:${CELL}px;border:1px solid #ccc}</style>
<h1>Block colors (map viewer spike)</h1><p>Top face of each block: its texture, the whole texture's average, and the plan's color (the average of the most common color).</p>
<table><tr><th>Block</th><th>Texture</th><th>Whole average</th><th>Most common color</th></tr>${rows.join("")}</table>`.replace(/background-position:0 /g, `background-position:-${GAP}px `),
);
console.log(`swatches: ${shown.length} blocks: ${shown.map((name) => name.replace("minecraft:", "")).join(", ")}`);
