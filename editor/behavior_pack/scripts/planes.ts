// Edit's boundaries as plane blocks (sheets.ts): what every map editor here sees drawn, together,
// since blocks are the world's (Select mode keeps its particle outlines, outlines.ts). Each sheet is
// painted a border part and a chunk column at a time, into air only, once its chunk is loaded; a
// sheet no one sees any more is erased (later, once its chunk is loaded again, for one that isn't:
// on a big map, the far parts a player still sees but the server doesn't run). A fill into air
// skips a 16-block slice of a chunk that holds no blocks at all (the void around a map, open sky:
// seen as walls missing there), so one plane is set by hand in each slice first. Breaking a block where a sheet runs
// paints it there, and every so often the loaded sheets are painted again, for blocks taken away
// some other way. While anyone looks through a camera they're all taken away, out of the picture.
// Like the markers, planes never stay in the world: every chunk one was painted in is remembered,
// and clear() removes them all before the world is saved.
import { BlockPermutation, BlockVolume, world, type Dimension } from "@minecraft/server";
import { describeError, log, type Box, type Scope, type Vec3 } from "@minecade/minigame-core";
import { sweepChunks } from "./markers.ts";
import type { HeightPlane, OutlineBox } from "./regions.ts";
import { PLANE_BLOCK, borderTiles, chunkPieces, overlaySheets, planeStates, sheetHas, sheetKey, uniqueSheets, type OverlayView, type Sheet } from "./sheets.ts";

/** On the world: the chunks planes were painted in and the heights they reached, as JSON. */
const CHUNKS_PROPERTY = "minecade:planeChunks";
const REFRESH_TICKS = 10;
/** How often the loaded sheets are painted again (in refreshes). */
const REPAINT_REFRESHES = 20;
/** A fill's most blocks (as /fill's). */
const FILL_LIMIT = 32768;
const AIR = "minecraft:air";

export interface OverlaySource {
  /** What each map editor sees (not those looking through a camera). */
  views(): OverlayView[];
  boxes(): OutlineBox[];
  heights(): HeightPlane[];
  /** The box the heights stretch across. */
  over(): Box | undefined;
  /** True while anyone looks through a camera. */
  hidden(): boolean;
}

/** A sheet's piece in one chunk column. */
interface Piece {
  sheet: Sheet;
  chunk: string;
  /** Painted, and nothing changed there since. */
  painted: boolean;
  /** Painted at some point and not erased since, so its planes may be in the world. */
  placed: boolean;
}

export class Overlay {
  private readonly dimension: Dimension;
  private readonly source: OverlaySource;
  /** The sheets shown, by key, in the order they were asked for, each in its pieces. */
  private shown = new Map<string, Piece[]>();
  /** Pieces taken away while their chunk wasn't loaded: erased once it is. */
  private stale: Piece[] = [];
  private readonly chunks = new Set<string>();
  private bottom = Infinity;
  private top = -Infinity;
  /** Cleared for a save, until resume(). */
  private paused = false;
  /** Taken away while someone looks through a camera. */
  private hidden = false;
  private refreshes = 0;
  private readonly permutations = new Map<string, BlockPermutation>();

  constructor(dimension: Dimension, scope: Scope, source: OverlaySource) {
    this.dimension = dimension;
    this.source = source;
    const saved = world.getDynamicProperty(CHUNKS_PROPERTY);
    if (typeof saved === "string") {
      try {
        const { chunks, bottom, top } = JSON.parse(saved) as { chunks: string[]; bottom: number; top: number };
        for (const chunk of chunks) this.chunks.add(chunk);
        this.bottom = bottom;
        this.top = top;
      } catch {
        // Unreadable: the planes in it stay until a block is placed there.
      }
    }
    scope.interval(() => this.refresh(), REFRESH_TICKS);
  }

  /** Whether planes were painted and never cleared (by an earlier run whose save missed them, until clear()). */
  get remembered(): boolean {
    return this.chunks.size > 0;
  }

  /** A block changed (broken or placed): paints the sheets through it there again. */
  blockChanged(at: Vec3): void {
    for (const pieces of this.shown.values()) for (const piece of pieces) if (sheetHas(piece.sheet, at)) piece.painted = false;
  }

  /**
   * Removes every plane, loading each chunk one was ever painted in, and stops painting them.
   * Resolves with how many of those chunks couldn't be cleared (0 when it's safe to save).
   */
  async clear(): Promise<number> {
    this.paused = true;
    for (const pieces of this.shown.values()) for (const piece of pieces) piece.painted = false;
    this.stale = [];
    await sweepChunks(this.dimension, [...this.chunks], () => this.clearLoaded());
    for (const pieces of this.shown.values()) for (const piece of pieces) piece.placed = this.chunks.has(piece.chunk);
    this.remember();
    return this.chunks.size;
  }

  /** Paints them again after clear(). */
  resume(): void {
    this.paused = false;
    this.refresh();
  }

  private refresh(): void {
    if (this.paused) return;
    try {
      if (this.source.hidden()) return this.hide();
      this.hidden = false;
      const boxes = this.source.boxes();
      const heights = this.source.heights();
      const over = this.source.over();
      this.show(uniqueSheets(this.source.views().flatMap((view) => overlaySheets(view, boxes, heights, over))));
      const repaint = ++this.refreshes % REPAINT_REFRESHES === 0;
      const erased = new Set(this.stale.filter((piece) => this.erase(piece)).map((piece) => piece.chunk));
      this.stale = this.stale.filter((piece) => !erased.has(piece.chunk));
      for (const pieces of this.shown.values()) for (const piece of pieces) if (repaint || erased.has(piece.chunk)) piece.painted = false;
      this.paint();
    } catch (error) {
      log.warn(`could not draw the boundaries: ${describeError(error)}`);
    }
  }

  /** Shows these sheets and only these: erases the others, then paints what's missing. */
  private show(sheets: Sheet[]): void {
    const touched = new Set<string>();
    const wanted = new Map(sheets.map((sheet) => [sheetKey(sheet), sheet]));
    for (const [key, pieces] of this.shown) {
      if (wanted.has(key)) continue;
      for (const piece of pieces) {
        if (!piece.placed) continue;
        touched.add(piece.chunk);
        if (!this.erase(piece)) this.stale.push(piece);
      }
    }
    const next = new Map<string, Piece[]>();
    for (const [key, sheet] of wanted) {
      next.set(key, this.shown.get(key) ?? borderTiles(sheet).flatMap(chunkPieces).map((piece) => ({ sheet: piece, chunk: chunkKey(piece), painted: false, placed: false })));
    }
    this.shown = next;
    // A sheet erased where another wanted the same blocks: the other paints them again.
    if (touched.size > 0) for (const pieces of next.values()) for (const piece of pieces) if (touched.has(piece.chunk)) piece.painted = false;
  }

  private paint(): void {
    let changed = false;
    for (const pieces of this.shown.values()) {
      for (const piece of pieces) {
        if (piece.painted || !this.loaded(piece)) continue;
        try {
          const permutation = this.permutation(piece.sheet);
          this.startSlices(piece.sheet, permutation);
          piece.placed = true;
          this.dimension.fillBlocks(volumeOf(piece.sheet), permutation, { blockFilter: { includeTypes: [AIR] }, ignoreChunkBoundErrors: true });
          piece.painted = true;
          changed = this.note(piece) || changed;
        } catch (error) {
          log.warn(`could not paint a boundary: ${describeError(error)}`);
          piece.painted = true;
        }
      }
    }
    if (changed) this.remember();
  }

  /**
   * Sets the piece's first block in each 16-block slice it crosses, where that's air, so a slice that
   * held nothing has a block for the fill to go on from.
   */
  private startSlices(sheet: Sheet, permutation: BlockPermutation): void {
    const [x, bottom, z] = sheet.min;
    for (let y = bottom; y <= sheet.max[1]; y = (Math.floor(y / 16) + 1) * 16) {
      const block = this.dimension.getBlock({ x, y, z });
      if (block?.isAir) block.setPermutation(permutation);
    }
  }

  /** Erases a piece's planes; false when its chunk isn't loaded. */
  private erase(piece: Piece): boolean {
    if (!this.loaded(piece)) return false;
    try {
      this.dimension.fillBlocks(volumeOf(piece.sheet), AIR, { blockFilter: { includePermutations: [this.permutation(piece.sheet)] }, ignoreChunkBoundErrors: true });
    } catch (error) {
      log.warn(`could not erase a boundary: ${describeError(error)}`);
    }
    piece.placed = false;
    return true;
  }

  /** Takes every painted plane away (they're painted again once nobody looks through a camera). */
  private hide(): void {
    if (this.hidden) return;
    this.hidden = true;
    for (const pieces of this.shown.values()) {
      for (const piece of pieces) {
        if (piece.placed && !this.erase(piece)) this.stale.push(piece);
        piece.painted = false;
      }
    }
  }

  /** Every plane in the remembered chunks that are loaded now, which are then forgotten. */
  private clearLoaded(): void {
    if (this.bottom > this.top) return;
    const height = Math.max(1, Math.floor(FILL_LIMIT / 256));
    for (const chunk of [...this.chunks]) {
      const [cx, cz] = chunk.split(",").map(Number);
      if (!this.dimension.isChunkLoaded({ x: cx * 16, y: 0, z: cz * 16 })) continue;
      try {
        for (let y = this.bottom; y <= this.top; y += height) {
          const volume = new BlockVolume({ x: cx * 16, y, z: cz * 16 }, { x: cx * 16 + 15, y: Math.min(this.top, y + height - 1), z: cz * 16 + 15 });
          this.dimension.fillBlocks(volume, AIR, { blockFilter: { includeTypes: [PLANE_BLOCK] }, ignoreChunkBoundErrors: true });
        }
        this.chunks.delete(chunk);
      } catch (error) {
        log.warn(`could not clear the boundaries in chunk ${chunk}: ${describeError(error)}`);
      }
    }
    if (this.chunks.size === 0) {
      this.bottom = Infinity;
      this.top = -Infinity;
    }
  }

  private loaded(piece: Piece): boolean {
    const [x, y, z] = piece.sheet.min;
    return this.dimension.isChunkLoaded({ x, y, z });
  }

  /** Notes a painted piece's chunk and heights; true when that's news. */
  private note(piece: Piece): boolean {
    const known = this.chunks.has(piece.chunk) && piece.sheet.min[1] >= this.bottom && piece.sheet.max[1] <= this.top;
    this.chunks.add(piece.chunk);
    this.bottom = Math.min(this.bottom, piece.sheet.min[1]);
    this.top = Math.max(this.top, piece.sheet.max[1]);
    return !known;
  }

  private remember(): void {
    world.setDynamicProperty(CHUNKS_PROPERTY, this.chunks.size === 0 ? undefined : JSON.stringify({ chunks: [...this.chunks], bottom: this.bottom, top: this.top }));
  }

  private permutation(sheet: Sheet): BlockPermutation {
    const key = `${sheet.axis}/${sheet.offset}/${sheet.color}/${sheet.edges ?? 0}`;
    let permutation = this.permutations.get(key);
    if (!permutation) {
      permutation = BlockPermutation.resolve(PLANE_BLOCK, planeStates(sheet));
      this.permutations.set(key, permutation);
    }
    return permutation;
  }
}

function volumeOf(sheet: Sheet): BlockVolume {
  const [x0, y0, z0] = sheet.min;
  const [x1, y1, z1] = sheet.max;
  return new BlockVolume({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 });
}

/** The chunk a piece is in ("x,z", as sweepChunks takes it). */
function chunkKey(piece: Sheet): string {
  return `${Math.floor(piece.min[0] / 16)},${Math.floor(piece.min[2] / 16)}`;
}
