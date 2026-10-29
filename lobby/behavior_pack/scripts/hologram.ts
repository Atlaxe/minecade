// The terminal in the world: the 3x3 console of minecade:terminal blocks, the hologram display
// above it (minecade:holo_display: its "minecade:screen" property picks the picture and
// "minecade:game" the game icon), and on each of the hologram's four sides, text fixed to the
// panel: who's at the terminal, and the selected map. Everything is (re)built at boot; the area
// may not be loaded yet, so placing retries until it works.
import { BlockPermutation, TextPrimitive, world, type Dimension, type Entity, type Vector3 } from "@minecraft/server";
import { describeError, log } from "@minecade/minigame-core";
import type { HoloScreen, HoloView } from "./terminal-controller.ts";

/** The hologram's pictures, in the order of the lobby resource pack's Array.screens. */
const SCREENS: Record<HoloScreen, number> = { idle: 0, main: 1, main_play: 2, main_stats: 3, games: 4, game: 5 };
const DISPLAY = "minecade:holo_display";
const BLOCK = "minecade:terminal";
/** How far the text sits from the middle: just in front of the 3-block-wide panels. */
const TEXT_OUT = 1.56;
/**
 * The four sides: an outward direction and the text's yaw (0 faces south). If the text ever reads
 * from the inside, add 180 to every yaw.
 */
const SIDES = [
  { x: 0, z: 1, yaw: 0 },
  { x: -1, z: 0, yaw: 90 },
  { x: 0, z: -1, yaw: 180 },
  { x: 1, z: 0, yaw: 270 },
] as const;

interface SideText {
  name: TextPrimitive;
  info: TextPrimitive;
}

export class Hologram {
  private readonly dimension: Dimension;
  /** The middle terminal block. */
  private readonly point: Vector3;
  /** The game's icon index in the resource pack's Array.icons (0 for none). */
  private readonly iconOf: (game: string) => number;
  private display: Entity | undefined;
  private texts: SideText[] = [];
  private view: HoloView = { screen: "idle" };
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

  show(view: HoloView): void {
    this.view = view;
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
    const { y } = this.center;
    // The display's origin is the middle of its 3x3x3 volume, 2 blocks above the console top.
    this.display = this.dimension.spawnEntity(DISPLAY, { ...this.center, y: y + 2 });
    // Text shapes live in the world, not the entity; this is the only text the lobby draws.
    world.primitiveShapesManager.removeAll();
    this.texts = SIDES.map((side) => ({
      name: this.text(side, y + 0.8, { red: 1, green: 1, blue: 1, alpha: 1 }),
      info: this.text(side, y + 1.15, { red: 0.55, green: 0.87, blue: 1, alpha: 1 }),
    }));
  }

  private text(side: (typeof SIDES)[number], y: number, color: { red: number; green: number; blue: number; alpha: number }): TextPrimitive {
    const { x, z } = this.center;
    const text = new TextPrimitive({ dimension: this.dimension, x: x + side.x * TEXT_OUT, y, z: z + side.z * TEXT_OUT }, "");
    text.useRotation = true;
    text.rotation = { x: 0, y: side.yaw, z: 0 };
    text.textBackfaceVisible = false;
    text.backfaceVisible = false;
    text.depthTest = true;
    text.color = color;
    text.backgroundColorOverride = { red: 0, green: 0, blue: 0, alpha: 0 };
    text.maximumRenderDistance = 48;
    world.primitiveShapesManager.addText(text, this.dimension);
    return text;
  }

  private apply(): void {
    try {
      const { screen, user, game, map } = this.view;
      if (this.display?.isValid) {
        this.display.setProperty("minecade:screen", SCREENS[screen]);
        this.display.setProperty("minecade:game", screen === "game" && game ? this.iconOf(game) : 0);
      }
      for (const side of this.texts) {
        side.name.setText(user ?? "");
        side.info.setText(screen === "game" && map ? `Map: ${map}` : "");
      }
    } catch (error) {
      log.warn(`hologram update failed: ${describeError(error)}`);
    }
  }
}
