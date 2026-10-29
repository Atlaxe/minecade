// The terminal in the world: the 3x3 console of minecade:terminal blocks, and the hologram above
// it. The hologram (minecade:holo_display) shows a frame picked by its "minecade:screen" property
// and, on the game screen, a picture (a game's or a map's) picked by "minecade:picture";
// everything else is text drawn on each of its four sides (holo-content.ts says what). Everything
// is (re)built at boot; the area may not be loaded yet, so placing retries until it works.
import { BlockPermutation, TextPrimitive, world, type Dimension, type Entity, type RGBA, type Vector3 } from "@minecraft/server";
import { describeError, log } from "@minecade/minigame-core";
import { MAX_LINES, type Frame, type HoloContent, type Tone } from "./holo-content.ts";

/** The frames, in the order of the lobby resource pack's Array.screens. */
const FRAMES: Record<Frame, number> = { logo: 0, panel: 1 };
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

/** The four sides, as outward directions (south, west, north, east). */
const SIDES = [
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
  { x: 1, z: 0 },
].map((side) => ({ ...side, yaw: readerYaw(side.x, side.z) }));
type SideDirection = (typeof SIDES)[number];

/**
 * Where text goes, in blocks from the middle of the panel (which spans -1.5 to +1.5). Tune these
 * to fit the frame art.
 */
const LAYOUT = {
  title: 1.1,
  /** The first line on the logo frame (under the logo). */
  logoLines: -0.2,
  /** The first line on the panel frame, without and with a picture (the picture spans -0.375 to 0.75). */
  panelLines: 0.75,
  pictureLines: -0.6,
  lineGap: 0.28,
};

/** Text colors. Text isn't blended with the glowing panel behind it, so these show as they are. */
const TONES: Record<Tone, RGBA> = {
  title: { red: 1, green: 1, blue: 1, alpha: 1 },
  normal: { red: 1, green: 1, blue: 1, alpha: 1 },
  highlight: { red: 1, green: 0.9, blue: 0.35, alpha: 1 },
  dim: { red: 0.72, green: 0.8, blue: 0.88, alpha: 1 },
  warn: { red: 1, green: 0.55, blue: 0.55, alpha: 1 },
};

interface Side {
  title: TextPrimitive;
  lines: TextPrimitive[];
}

export class Hologram {
  private readonly dimension: Dimension;
  /** The middle terminal block. */
  private readonly point: Vector3;
  /** The resource pack's Array.pictures (holoPictures in minigame-core); index 0 is none. */
  private readonly pictures: string[];
  private display: Entity | undefined;
  private sides: Side[] = [];
  private content: HoloContent = { frame: "logo", lines: [] };
  private waitingLogged = false;
  private readyLogged = false;

  constructor(dimension: Dimension, point: Vector3, pictures: string[]) {
    this.dimension = dimension;
    this.point = point;
    this.pictures = pictures;
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
    this.sides = SIDES.map((side) => ({
      title: this.text(side, 1.3),
      lines: Array.from({ length: MAX_LINES }, () => this.text(side, 1)),
    }));
  }

  private text(side: SideDirection, scale: number): TextPrimitive {
    const text = new TextPrimitive({ dimension: this.dimension, ...this.middle }, "");
    text.useRotation = true;
    text.rotation = { x: 0, y: side.yaw, z: 0 };
    text.scale = scale;
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
      const { frame, title, lines, picture } = this.content;
      if (this.display?.isValid) {
        this.display.setProperty("minecade:screen", FRAMES[frame]);
        this.display.setProperty("minecade:picture", picture ? Math.max(0, this.pictures.indexOf(picture)) : 0);
      }
      const first = frame === "logo" ? LAYOUT.logoLines : picture ? LAYOUT.pictureLines : LAYOUT.panelLines;
      SIDES.forEach((side, index) => {
        const rows = this.sides[index];
        if (!rows) return;
        this.place(rows.title, side, LAYOUT.title, title ?? "", TONES.title);
        rows.lines.forEach((row, i) => {
          const content = lines[i];
          this.place(row, side, first - i * LAYOUT.lineGap, content?.text ?? "", TONES[content?.tone ?? "normal"]);
        });
      });
    } catch (error) {
      log.warn(`hologram update failed: ${describeError(error)}`);
    }
  }

  private place(text: TextPrimitive, side: SideDirection, height: number, value: string, color: RGBA): void {
    const { x, y, z } = this.middle;
    text.setLocation({ dimension: this.dimension, x: x + side.x * TEXT_OUT, y: y + height, z: z + side.z * TEXT_OUT });
    text.color = color;
    text.setText(value);
  }
}
