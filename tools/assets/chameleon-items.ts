// Writes Chameleon's ability items (games/chameleon/behavior_pack/items/) and their icons, names
// and texture list in its resource pack: Wear block, Pose, Lock position, Taunt and Free look for
// the hiders, and the seekers' Detector, which the game hands out (game.config.ts HOTBARS) in place
// of the colored wool they were until now (the user asked for textures, 2026-11-11). Each icon is a
// 16 by 16 picture drawn here from simple shapes in the ability's old wool color, then outlined in
// a darker shade, the way Minecraft's own items are. The chameleon pack (the workshop's
// chameleon-test) knows each by its id and name. Rerun after changing them, and commit the files:
//
//     npx tsx tools/assets/chameleon-items.ts
//
// A test checks the committed files match (games/chameleon/test/chameleon.test.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, type Image } from "../skins/png.ts";
import { ABILITY_ITEMS, type AbilityItem } from "../../games/chameleon/behavior_pack/scripts/abilities.ts";

const chameleon = (path: string) => fileURLToPath(new URL(`../../games/chameleon/${path}`, import.meta.url));
const SIZE = 16;

type Rgb = readonly [number, number, number];
const hex = (value: number): Rgb => [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];

/** A 16 by 16 picture being drawn: shapes fill pixels whose middles they cover. */
class Canvas {
  readonly pixels: (Rgb | undefined)[] = Array(SIZE * SIZE).fill(undefined);

  at(x: number, y: number): Rgb | undefined {
    return x < 0 || y < 0 || x >= SIZE || y >= SIZE ? undefined : this.pixels[y * SIZE + x];
  }

  set(x: number, y: number, color: Rgb): void {
    if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) this.pixels[y * SIZE + x] = color;
  }

  /** Every pixel whose middle passes `inside`. */
  fill(inside: (x: number, y: number) => boolean, color: Rgb): this {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (inside(x + 0.5, y + 0.5)) this.set(x, y, color);
    return this;
  }

  rect(x0: number, y0: number, x1: number, y1: number, color: Rgb): this {
    return this.fill((x, y) => x >= x0 && x <= x1 + 1 && y >= y0 && y <= y1 + 1, color);
  }

  polygon(points: readonly (readonly [number, number])[], color: Rgb): this {
    return this.fill((x, y) => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }, color);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: Rgb): this {
    return this.fill((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, color);
  }

  /** A ring `width` thick at radius `r`. */
  ring(cx: number, cy: number, r: number, width: number, color: Rgb): this {
    return this.fill((x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= width / 2, color);
  }

  /** Every empty pixel beside a drawn one (not diagonally) in `color`: the item's outline. */
  outline(color: Rgb): this {
    const edge: [number, number][] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (this.at(x, y)) continue;
        if (this.at(x - 1, y) || this.at(x + 1, y) || this.at(x, y - 1) || this.at(x, y + 1)) edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) this.set(x, y, color);
    return this;
  }

  image(): Image {
    const data = new Uint8Array(SIZE * SIZE * 4);
    this.pixels.forEach((color, i) => {
      if (!color) return;
      data.set([...color, 255], i * 4);
    });
    return { width: SIZE, height: SIZE, data };
  }
}

/** Wear block (lime): a block seen from above a corner, its top lightest. */
function wearBlock(): Canvas {
  const [top, left, right, edge] = [hex(0x9be15d), hex(0x5fae2e), hex(0x3f8020), hex(0x1d3f0d)];
  return new Canvas()
    .polygon([[8, 1], [14.5, 4.5], [8, 8], [1.5, 4.5]], top)
    .polygon([[1.5, 4.5], [8, 8], [8, 15], [1.5, 11.5]], left)
    .polygon([[8, 8], [14.5, 4.5], [14.5, 11.5], [8, 15]], right)
    .outline(edge);
}

/** Pose (yellow): a figure striking a pose, arms up and legs apart. */
function pose(): Canvas {
  const [body, shade, edge] = [hex(0xfff1a8), hex(0xe9c94f), hex(0x5b4709)];
  return new Canvas()
    .ellipse(8, 3, 2.2, 2.2, body) // the head, a line of outline under it
    .rect(6, 6, 9, 10, body)
    .rect(8, 6, 9, 10, shade)
    .polygon([[6.5, 6.2], [6.5, 7.9], [2.6, 3.6], [3.6, 2.6]], body)
    .polygon([[9.5, 6.2], [9.5, 7.9], [13.4, 3.6], [12.4, 2.6]], shade)
    .polygon([[6, 10.5], [8, 10.5], [5.4, 14.6], [3.6, 14]], body)
    .polygon([[8, 10.5], [10, 10.5], [12.4, 14], [10.6, 14.6]], shade)
    .outline(edge);
}

/** Lock position (purple): a padlock. */
function lock(): Canvas {
  const [shackle, metal, shine, hole, edge] = [hex(0xc9c9d6), hex(0x9a5be0), hex(0xbd8ef2), hex(0x2b1149), hex(0x2b1149)];
  return new Canvas()
    .rect(4, 3, 5, 7, shackle)
    .rect(10, 3, 11, 7, shackle)
    .rect(5, 1, 10, 2, shackle)
    .rect(3, 7, 12, 13, metal)
    .rect(3, 7, 12, 7, shine)
    .rect(7, 9, 8, 10, hole)
    .rect(7, 11, 7, 12, hole)
    .outline(edge);
}

/** Taunt (orange): a megaphone, sound coming out. */
function taunt(): Canvas {
  const [cone, dark, rim, wave, edge] = [hex(0xffa23a), hex(0xd8741a), hex(0xffd29a), hex(0xfff3e0), hex(0x5a2a05)];
  return new Canvas()
    .polygon([[1.5, 6], [4, 6], [10.5, 2], [10.5, 14], [4, 10], [1.5, 10]], cone)
    .rect(1, 6, 1, 9, dark)
    .rect(10, 2, 10, 13, rim)
    .rect(4, 10, 5, 12, dark)
    .outline(edge)
    .rect(13, 4, 13, 4, wave)
    .rect(14, 5, 14, 10, wave)
    .rect(13, 11, 13, 11, wave);
}

/** Free look (light blue): an eye. */
function freeLook(): Canvas {
  const [white, iris, pupil, shine, edge] = [hex(0xf2f7ff), hex(0x4cb4ff), hex(0x0b2a44), hex(0xffffff), hex(0x12334f)];
  return new Canvas()
    .ellipse(8, 8, 6.8, 4.2, white)
    .ellipse(8, 8, 3.1, 3.1, iris)
    .ellipse(8, 8, 1.4, 1.4, pupil)
    .rect(6, 6, 6, 6, shine)
    .outline(edge);
}

/** Detector (cyan): a radar screen with a blip on it. */
function detector(): Canvas {
  const [screen, ring, sweep, blip, edge] = [hex(0x0d3d40), hex(0x2fd9d9), hex(0x7ff7f2), hex(0xfff36a), hex(0x041b1d)];
  return new Canvas()
    .ellipse(8, 8, 6.6, 6.6, screen)
    .ring(8, 8, 4.4, 0.9, ring)
    .ring(8, 8, 2, 0.9, ring)
    .polygon([[7.6, 8.4], [8.4, 7.6], [12.6, 3.6], [12, 3]], sweep)
    .rect(10, 9, 10, 10, blip)
    .rect(7, 7, 8, 8, sweep)
    .outline(edge);
}

const ICONS: Record<AbilityItem["id"], () => Canvas> = {
  wear_block: wearBlock,
  pose,
  lock,
  taunt,
  free_look: freeLook,
  detector,
};

const iconKey = (item: AbilityItem) => `minecade_chameleon_${item.id}`;

export function chameleonItemFiles(): Record<string, string | Buffer> {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const files: Record<string, string | Buffer> = {};
  for (const item of ABILITY_ITEMS) {
    files[`behavior_pack/items/chameleon_${item.id}.json`] = json({
      format_version: "1.21.120",
      "minecraft:item": {
        description: { identifier: item.item, menu_category: { category: "none" } },
        components: {
          "minecraft:icon": { textures: { default: iconKey(item) } },
          "minecraft:display_name": { value: item.name },
          "minecraft:max_stack_size": 1,
        },
      },
    });
    files[`resource_pack/textures/minecade/chameleon/${item.id}.png`] = encodePng(ICONS[item.id]().image());
  }
  files["resource_pack/textures/item_texture.json"] = json({
    resource_pack_name: "minecade_chameleon",
    texture_name: "atlas.items",
    texture_data: Object.fromEntries(ABILITY_ITEMS.map((item) => [iconKey(item), { textures: `textures/minecade/chameleon/${item.id}` }])),
  });
  files["resource_pack/texts/en_US.lang"] = `${ABILITY_ITEMS.map((item) => `item.${item.item}.name=${item.name}`).join("\n")}\n`;
  files["resource_pack/texts/languages.json"] = json(["en_US"]);
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [path, content] of Object.entries(chameleonItemFiles())) {
    mkdirSync(dirname(chameleon(path)), { recursive: true });
    writeFileSync(chameleon(path), content);
  }
  console.log("wrote Chameleon's ability items and their icons");
}
