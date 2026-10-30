// The hologram look for a skin render: the hologram's blue by brightness, glowing edges and faint
// scanlines, on a transparent background. The hologram draws additively (black and transparent
// show nothing there), and the menus draw it over their own background.
import { blankImage, type Image } from "./png.ts";

/** The hologram's cyan and its brightest highlight (tools/assets/make-assets.py CYAN and BRIGHT). */
const CYAN = [90, 210, 255];
const BRIGHT = [190, 240, 255];

export function hologramLook(render: Image): Image {
  const out = blankImage(render.width, render.height);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < render.width && y < render.height && render.data[(y * render.width + x) * 4 + 3] >= 128;
  for (let y = 0; y < render.height; y++) {
    for (let x = 0; x < render.width; x++) {
      const at = (y * render.width + x) * 4;
      if (!solid(x, y)) continue;
      out.data[at + 3] = 255;
      const edge = !solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1);
      const brightness = (0.3 * render.data[at] + 0.59 * render.data[at + 1] + 0.11 * render.data[at + 2]) / 255;
      const shade = (0.25 + 0.9 * brightness) * (y % 3 === 2 ? 0.75 : 1);
      const color = edge ? BRIGHT : CYAN.map((channel) => Math.min(255, Math.round(channel * shade)));
      out.data.set(color, at);
    }
  }
  return out;
}
