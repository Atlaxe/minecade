// The terminal in the world: the 3x3 console of minecade:terminal blocks, the hologram display
// above it (minecade:holo_display, whose "minecade:screen" property picks the picture), and a
// floating caption under the hologram. Everything is (re)built at boot; the area may not be loaded
// until a player is near, so placing retries until it works.
import { BlockPermutation, TextPrimitive, world, type Dimension, type Entity, type Vector3 } from "@minecraft/server";
import { describeError, log } from "@minecade/minigame-core";
import type { HoloScreen } from "./terminal-controller.ts";

/** The hologram's pictures, in the order of the lobby resource pack's Array.screens. */
const SCREENS: Record<HoloScreen, number> = { idle: 0, main: 1, main_play: 2, main_stats: 3 };
const DISPLAY = "minecade:holo_display";
const BLOCK = "minecade:terminal";

export class Hologram {
  private readonly dimension: Dimension;
  /** The middle terminal block. */
  private readonly point: Vector3;
  private display: Entity | undefined;
  private caption: TextPrimitive | undefined;
  private screen: HoloScreen = "idle";
  private captionText = "";
  private waitingLogged = false;
  private readyLogged = false;

  constructor(dimension: Dimension, point: Vector3) {
    this.dimension = dimension;
    this.point = point;
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

  show(screen: HoloScreen, caption: string): void {
    this.screen = screen;
    this.captionText = caption;
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

  private spawnDisplay(): void {
    for (const old of this.dimension.getEntities({ type: DISPLAY })) old.remove();
    const { x, y, z } = this.center;
    // The display's origin is the middle of its 3x3x3 volume, 2 blocks above the console top.
    this.display = this.dimension.spawnEntity(DISPLAY, { x, y: y + 2, z });
    // Text shapes outlive scripts; this is the only text the lobby draws.
    world.primitiveShapesManager.removeAll();
    const caption = new TextPrimitive({ dimension: this.dimension, x, y: y + 3.9, z }, "");
    caption.useRotation = false;
    caption.depthTest = true;
    caption.color = { red: 0.55, green: 0.87, blue: 1, alpha: 1 };
    caption.backgroundColorOverride = { red: 0, green: 0.06, blue: 0.14, alpha: 0.55 };
    caption.maximumRenderDistance = 48;
    world.primitiveShapesManager.addText(caption, this.dimension);
    this.caption = caption;
  }

  private apply(): void {
    try {
      if (this.display?.isValid) this.display.setProperty("minecade:screen", SCREENS[this.screen]);
      this.caption?.setText(this.captionText);
    } catch (error) {
      log.warn(`hologram update failed: ${describeError(error)}`);
    }
  }
}
