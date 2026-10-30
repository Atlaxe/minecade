// The terminal in the world: the 3x3 console of minecade:terminal blocks, and the hologram above
// it. The hologram (minecade:holo_display) shows a frame picked by its "minecade:screen" property,
// a 16:9 picture (a game's or a map's) picked by "minecade:picture" (in the corner or across the
// top, by "minecade:picture_spot") and a square portrait (a player's badge) picked by
// "minecade:portrait"; everything else is text placed on each of its four
// sides, some with a box behind it for a button (holo-content.ts says what and where). Everything
// is (re)built at boot; the area may not be loaded yet, so placing retries until it works.
import { BlockPermutation, TextPrimitive, world, type Dimension, type Entity, type RGBA, type Vector3 } from "@minecraft/server";
import { describeError, log } from "@minecade/minigame-core";
import { MAX_ELEMENTS, type Box, type Frame, type HoloContent, type HoloElement, type PictureSpot, type Tone } from "./holo-content.ts";

/** The frames, in the order of the lobby resource pack's Array.screens. */
const FRAMES: Record<Frame, number> = { logo: 0, panel: 1 };
/** The picture's spots, as the holo_picture render controller shows them. */
const PICTURE_SPOTS: Record<PictureSpot, number> = { corner: 0, banner: 1, tall: 2 };
const DISPLAY = "minecade:holo_display";
const BLOCK = "minecade:terminal";

/** How far the text sits from the middle: just in front of the 3-block-wide panels. */
const TEXT_OUT = 1.56;

/**
 * A text's y rotation is the direction its reader faces, turning the opposite way from Minecraft's
 * player yaw: 0 is read facing south, 90 facing east, 180 north, 270 west (measured in game). Text
 * on a side is read by someone outside facing the middle: south side 180, west 90, north 0, east 270.
 */
function readerYaw(x: number, z: number): number {
  return (((Math.atan2(-x, -z) * 180) / Math.PI) % 360 + 360) % 360;
}

/**
 * The four sides, as outward directions (south, west, north, east), with the direction that is
 * right for someone reading that side from outside: (outward z, -outward x).
 */
const SIDES = [
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
  { x: 1, z: 0 },
].map((side) => ({ ...side, yaw: readerYaw(side.x, side.z), rightX: side.z, rightZ: -side.x }));
type SideDirection = (typeof SIDES)[number];

/** Text colors. Text isn't blended with the glowing panel behind it, so these show as they are. */
const TONES: Record<Tone, RGBA> = {
  title: { red: 1, green: 1, blue: 1, alpha: 1 },
  normal: { red: 1, green: 1, blue: 1, alpha: 1 },
  highlight: { red: 1, green: 0.9, blue: 0.35, alpha: 1 },
  dim: { red: 0.72, green: 0.8, blue: 0.88, alpha: 1 },
  warn: { red: 1, green: 0.55, blue: 0.55, alpha: 1 },
};

/**
 * How a box shows. Text never gets a background (a solid background would hide the hologram's
 * glow), so buttons are light blue like the forms' text and the selected one is yellow.
 */
const BOX_COLORS: Record<Box, RGBA | undefined> = {
  button: { red: 0.62, green: 0.86, blue: 1, alpha: 1 },
  selected: TONES.highlight,
  tile: undefined,
};
const NO_BACKGROUND: RGBA = { red: 0, green: 0, blue: 0, alpha: 0 };

/** Minecraft's § color codes as text colors, for lines in a team's color. */
const CODE_COLORS: Record<string, RGBA> = Object.fromEntries(
  (
    [
      ["§0", 0x000000], ["§1", 0x0000aa], ["§2", 0x00aa00], ["§3", 0x00aaaa],
      ["§4", 0xaa0000], ["§5", 0xaa00aa], ["§6", 0xffaa00], ["§7", 0xaaaaaa],
      ["§8", 0x555555], ["§9", 0x5555ff], ["§a", 0x55ff55], ["§b", 0x55ffff],
      ["§c", 0xff5555], ["§d", 0xff55ff], ["§e", 0xffff55], ["§f", 0xffffff],
    ] as const
  ).map(([code, rgb]) => [code, { red: (rgb >> 16) / 255, green: ((rgb >> 8) & 0xff) / 255, blue: (rgb & 0xff) / 255, alpha: 1 }]),
);

export class Hologram {
  private readonly dimension: Dimension;
  /** The middle terminal block. */
  private readonly point: Vector3;
  /** The resource pack's Array.pictures and Array.portraits (holoPictures, holoPortraits in minigame-core); index 0 is none. */
  private readonly pictures: string[];
  private readonly portraits: string[];
  private display: Entity | undefined;
  /** Each side's text shapes, MAX_ELEMENTS of them. */
  private sides: TextPrimitive[][] = [];
  private content: HoloContent = { frame: "logo", elements: [] };
  private waitingLogged = false;
  private readyLogged = false;

  constructor(dimension: Dimension, point: Vector3, pictures: string[], portraits: string[]) {
    this.dimension = dimension;
    this.point = point;
    this.pictures = pictures;
    this.portraits = portraits;
  }

  /** The top center of the terminal: where the projection starts. */
  get center(): Vector3 {
    return { x: this.point.x + 0.5, y: this.point.y + 1, z: this.point.z + 0.5 };
  }

  /** Places the console and the display if they're missing. Returns false while the area isn't loaded. */
  ensure(): boolean {
    try {
      this.placeConsole();
      if (!this.display?.isValid) this.spawnDisplay();
      this.apply();
      if (!this.readyLogged) log.info(`terminal ready at ${this.point.x} ${this.point.y} ${this.point.z}`);
      this.readyLogged = true;
      return true;
    } catch (error) {
      if (!this.waitingLogged) log.info(`terminal not placed yet (${describeError(error)}); retrying every 5 s`);
      this.waitingLogged = true;
      return false;
    }
  }

  show(content: HoloContent): void {
    this.content = content;
    this.apply();
  }

  /** The console: parts 0 to 8 in reading order from the north-west corner (rows run north to south). */
  private placeConsole(): void {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const location = { x: this.point.x + dx, y: this.point.y, z: this.point.z + dz };
        const part = (dz + 1) * 3 + (dx + 1);
        const permutation = BlockPermutation.resolve(BLOCK, { "minecade:part": part });
        const block = this.dimension.getBlock(location);
        if (!block) throw new Error(`no block at ${location.x} ${location.y} ${location.z}`);
        if (!block.permutation.matches(BLOCK, { "minecade:part": part })) this.dimension.setBlockPermutation(location, permutation);
      }
    }
  }

  /** The panel's middle, 2 blocks above the console top: the display's origin. */
  private get middle(): Vector3 {
    const { x, y, z } = this.center;
    return { x, y: y + 2, z };
  }

  private spawnDisplay(): void {
    for (const old of this.dimension.getEntities({ type: DISPLAY })) old.remove();
    this.display = this.dimension.spawnEntity(DISPLAY, this.middle);
    // Text shapes live in the world, not the entity; this is the only text the lobby draws.
    world.primitiveShapesManager.removeAll();
    this.sides = SIDES.map((side) => Array.from({ length: MAX_ELEMENTS }, () => this.text(side)));
  }

  private text(side: SideDirection): TextPrimitive {
    const text = new TextPrimitive({ dimension: this.dimension, ...this.middle }, "");
    text.useRotation = true;
    text.rotation = { x: 0, y: side.yaw, z: 0 };
    text.textBackfaceVisible = false;
    text.backfaceVisible = false;
    text.depthTest = true;
    text.backgroundColorOverride = { red: 0, green: 0, blue: 0, alpha: 0 };
    text.maximumRenderDistance = 48;
    world.primitiveShapesManager.addText(text, this.dimension);
    return text;
  }

  private apply(): void {
    try {
      const { frame, elements, picture, pictureSpot, portrait } = this.content;
      if (this.display?.isValid) {
        this.display.setProperty("minecade:screen", FRAMES[frame]);
        this.display.setProperty("minecade:picture", picture ? Math.max(0, this.pictures.indexOf(picture)) : 0);
        this.display.setProperty("minecade:picture_spot", PICTURE_SPOTS[pictureSpot ?? "corner"]);
        this.display.setProperty("minecade:portrait", portrait ? Math.max(0, this.portraits.indexOf(portrait)) : 0);
      }
      SIDES.forEach((side, index) => {
        this.sides[index]?.forEach((shape, i) => this.place(shape, side, elements[i]));
      });
    } catch (error) {
      log.warn(`hologram update failed: ${describeError(error)}`);
    }
  }

  /** A team's color first, then selected (yellow), then a dim, warning or title tone, then a button's light blue, else white. */
  private colorOf(element: HoloElement | undefined): RGBA {
    if (element?.color && CODE_COLORS[element.color]) return CODE_COLORS[element.color];
    if (element?.box === "selected") return TONES.highlight;
    const tone = element?.tone ?? "normal";
    if (tone !== "normal") return TONES[tone];
    return (element?.box && BOX_COLORS[element.box]) || TONES.normal;
  }

  /** Puts an element on a side (or blanks the shape when there's none). */
  private place(text: TextPrimitive, side: SideDirection, element: HoloElement | undefined): void {
    const { x, y, z } = this.middle;
    const across = element?.x ?? 0;
    text.setLocation({
      dimension: this.dimension,
      x: x + side.x * TEXT_OUT + side.rightX * across,
      y: y + (element?.y ?? 0),
      z: z + side.z * TEXT_OUT + side.rightZ * across,
    });
    text.scale = element?.scale ?? 1;
    text.color = this.colorOf(element);
    text.backgroundColorOverride = NO_BACKGROUND;
    text.setText(element?.text ?? "");
  }
}
