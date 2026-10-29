// The terminal in the world: the 3x3 console of minecade:terminal blocks, and the hologram above
// it. The hologram (minecade:holo_display) shows a frame picked by its "minecade:screen" property
// and, on the game screen, a game's picture picked by "minecade:game"; everything else is text
// drawn on each of its four sides (holo-content.ts says what). Everything is (re)built at boot;
// the area may not be loaded yet, so placing retries until it works.
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
 * The four sides: an outward direction and the text's yaw. Measured in game: yaw 0 reads from the
 * south, 180 from the north, 270 from the west and 90 from the east.
 */
const SIDES = [
  { x: 0, z: 1, yaw: 0 },
  { x: -1, z: 0, yaw: 270 },
  { x: 0, z: -1, yaw: 180 },
  { x: 1, z: 0, yaw: 90 },
] as const;

/**
 * Where text goes, in blocks from the middle of the panel (which spans -1.5 to +1.5). Tune these
 * to fit the frame art.
 */
const LAYOUT = {
  title: 1.1,
  /** The first line on the logo frame (under the logo). */
  logoLines: -0.2,
  /** The first line on the panel frame, without and with a game picture (the picture spans -0.375 to 0.75). */
  panelLines: 0.75,
  iconLines: -0.62,
  lineGap: 0.32,
};

const TONES: Record<Tone, RGBA> = {
  title: { red: 0.86, green: 0.96, blue: 1, alpha: 1 },
  normal: { red: 0.55, green: 0.87, blue: 1, alpha: 1 },
  highlight: { red: 1, green: 0.92, blue: 0.45, alpha: 1 },
  dim: { red: 0.45, green: 0.58, blue: 0.7, alpha: 1 },
  warn: { red: 1, green: 0.45, blue: 0.45, alpha: 1 },
};

interface Side {
  title: TextPrimitive;
  lines: TextPrimitive[];
}

export class Hologram {
  private readonly dimension: Dimension;
  /** The middle terminal block. */
  private readonly point: Vector3;
  /** The game's picture index in the resource pack's Array.icons (0 for none). */
  private readonly iconOf: (game: string) => number;
  private display: Entity | undefined;
  private sides: Side[] = [];
  private content: HoloContent = { frame: "logo", lines: [] };
  private waitingLogged = false;
  private readyLogged = false;

  constructor(dimension: Dimension, point: Vector3, iconOf: (game: string) => number) {
    this.dimension = dimension;
    this.point = point;
    this.iconOf = iconOf;
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

  private text(side: (typeof SIDES)[number], scale: number): TextPrimitive {
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
      const { frame, title, lines, icon } = this.content;
      if (this.display?.isValid) {
        this.display.setProperty("minecade:screen", FRAMES[frame]);
        this.display.setProperty("minecade:game", icon ? this.iconOf(icon) : 0);
      }
      const first = frame === "logo" ? LAYOUT.logoLines : icon ? LAYOUT.iconLines : LAYOUT.panelLines;
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

  private place(text: TextPrimitive, side: (typeof SIDES)[number], height: number, value: string, color: RGBA): void {
    const { x, y, z } = this.middle;
    text.setLocation({ dimension: this.dimension, x: x + side.x * TEXT_OUT, y: y + height, z: z + side.z * TEXT_OUT });
    text.color = color;
    text.setText(value);
  }
}
