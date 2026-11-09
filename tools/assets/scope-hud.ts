// Writes the gun scope the HUD draws over the screen while a player aims a scoped gun (the Sniper
// Rifle): textures/minecade/hud/scope.png, a square lens (clear inside a circle, black around it,
// darkening toward its rim, with a reticle), and black.png, which fills the screen either side of it
// (the core pack's ui/hud_screen.json, mc_scope). Rerun after changing the numbers, and commit the
// files.
//
//     npx tsx tools/assets/scope-hud.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../skins/png.ts";

const hud = (name: string) => fileURLToPath(new URL(`../../packages/minigame-core/resource_pack/textures/minecade/hud/${name}`, import.meta.url));

/** The lens texture's side, in pixels. */
const SIZE = 512;
/** The clear circle's radius, as a share of half the side: a little black shows above and below it. */
const LENS = 0.94;
/** How far in from the rim the lens starts to darken, as a share of its radius. */
const SHADE_FROM = 0.8;
/** The reticle: its lines' half widths near the middle and out toward the rim, and the gap in the middle, in pixels. */
const THIN = 1;
const THICK = 3;
const THICK_FROM = 0.55;
const GAP = 6;

/** The lens: black outside the circle, shading in toward the rim, a reticle across the middle. */
function lens(): Buffer {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const middle = SIZE / 2;
  const radius = middle * LENS;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x + 0.5 - middle;
      const dy = y + 0.5 - middle;
      const out = Math.hypot(dx, dy) / radius;
      let alpha = out >= 1 ? 255 : out <= SHADE_FROM ? 0 : Math.round(255 * ((out - SHADE_FROM) / (1 - SHADE_FROM)) ** 2);
      // The reticle: a cross, thin near the middle and thick out toward the rim, open in the middle.
      const along = Math.max(Math.abs(dx), Math.abs(dy));
      const across = Math.min(Math.abs(dx), Math.abs(dy));
      const halfWidth = along / radius >= THICK_FROM ? THICK : THIN;
      if (out < 1 && along > GAP && across <= halfWidth) alpha = 255;
      data.set([0, 0, 0, alpha], (y * SIZE + x) * 4);
    }
  }
  return encodePng({ width: SIZE, height: SIZE, data });
}

/** Plain black, for either side of the lens. */
function black(): Buffer {
  const data = new Uint8Array(16 * 16 * 4);
  for (let at = 0; at < data.length; at += 4) data[at + 3] = 255;
  return encodePng({ width: 16, height: 16, data });
}

for (const [name, content] of [
  ["scope.png", lens()],
  ["black.png", black()],
] as const) {
  mkdirSync(dirname(hud(name)), { recursive: true });
  writeFileSync(hud(name), content);
}
console.log("wrote the scope's HUD textures");
