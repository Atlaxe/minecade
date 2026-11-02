// Marker entities that show every spawn and point, numbered by list. Hitting one opens its form.
// An entry with a saved facing gets a red line from the marker's top toward it: the marker spawns
// turned to the entry's yaw (the line is the model's front), and tilts the line by the entry's
// pitch through a client-synced property.
// They live only while the editor runs: a marker in a chunk nobody is near is saved with that
// chunk, so every chunk a marker was ever in is remembered (also in a world property, in case the
// server crashes), and clear() loads them all and removes every marker before the world is saved.
import { world, type Dimension, type Entity, type Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { MARKER_STYLES, markerPitch, sameYaw, type MarkerShape } from "./lists.ts";

export const MARKER = "minecade:editor_marker";
/** On each marker: its MarkerSpec key. */
const KEY_PROPERTY = "minecade:key";
/** On each marker: the yaw it was spawned with. */
const YAW_PROPERTY = "minecade:yaw";
/** Entity properties the client draws the facing line from (editor_marker.json). */
const FACED_PROPERTY = "minecade:faced";
const PITCH_PROPERTY = "minecade:pitch";
/** Which texture the marker gets (lists.ts MARKER_KINDS). */
const KIND_PROPERTY = "minecade:kind";
/** Which shape it gets (lists.ts MARKER_STYLES, or a game's model). */
const STYLE_PROPERTY = "minecade:style";
/**
 * The events that give a marker its game model's hitbox (the model's size, so a hit anywhere on it
 * counts) or take it back to the marker's own: the editor's template build adds them
 * (tools/editor/marker-models.ts addMarkerHitboxes).
 */
const NO_MODEL_EVENT = "minecade:no_model";
const FIRST_MODEL_STYLE = MARKER_STYLES.camera + 1;
/** A team's color over the kind's: 0xRRGGBB + 1, or 0 for none (the render controller's overlay). */
const TINT_PROPERTY = "minecade:tint";
/** On the world: the chunks markers were in, as JSON ["x,z", ...]. */
const CHUNKS_PROPERTY = "minecade:markerChunks";
const SYNC_TICKS = 20;
/** Ticking areas loaded at once while clearing; the pack's limit may be lower. */
const SWEEP_BATCH = 16;
/** Counts sweeps, so each names its own ticking areas. */
let sweeps = 0;

export class Markers<Spec extends MarkerShape = MarkerShape> {
  private readonly dimension: Dimension;
  private specs = new Map<string, Spec>();
  private readonly chunks = new Set<string>();
  /** Cleared for a save, until resume(). */
  private paused = false;
  /** Out of a camera's shot, until unhide(). */
  private hidden = false;

  constructor(dimension: Dimension, scope: Scope) {
    this.dimension = dimension;
    const saved = world.getDynamicProperty(CHUNKS_PROPERTY);
    if (typeof saved === "string") {
      try {
        for (const chunk of JSON.parse(saved) as string[]) this.chunks.add(chunk);
      } catch {
        // Unreadable: clear() still removes every marker in the loaded chunks.
      }
    }
    // Chunks load as players move, and a marker can only be placed in a loaded one.
    scope.interval(() => this.sync(), SYNC_TICKS);
  }

  /** Whether markers were placed and never cleared (by an earlier run whose save missed them, until clear()). */
  get remembered(): boolean {
    return this.chunks.size > 0;
  }

  /** Shows these markers, and only these, wherever their chunks are loaded. */
  show(specs: Spec[]): void {
    this.specs = new Map(specs.map((spec) => [spec.key, spec]));
    this.sync();
  }

  /** What a marker entity stands for, if it's a current marker. */
  specOf(entity: Entity): Spec | undefined {
    const key = entity.getDynamicProperty(KEY_PROPERTY);
    return typeof key === "string" ? this.specs.get(key) : undefined;
  }

  private sync(): void {
    if (this.paused || this.hidden) return;
    const shown = new Set<string>();
    for (const entity of this.dimension.getEntities({ type: MARKER })) {
      const spec = this.specOf(entity);
      // Turned another way: placed again below, so the line's yaw comes from the spawn.
      if (!spec || shown.has(spec.key) || !sameYaw(Number(entity.getDynamicProperty(YAW_PROPERTY) ?? 0), yawOf(spec))) {
        entity.remove();
        continue;
      }
      shown.add(spec.key);
      if (distance(entity.location, spec.at) > 0.01) {
        entity.teleport(spec.at);
        this.remember(spec.at);
      }
      if (entity.nameTag !== spec.label) entity.nameTag = spec.label;
      showFacing(entity, spec);
    }
    for (const spec of this.specs.values()) {
      if (shown.has(spec.key) || !this.dimension.isChunkLoaded(spec.at)) continue;
      try {
        const entity = this.dimension.spawnEntity(MARKER, spec.at, { initialRotation: yawOf(spec) });
        entity.setDynamicProperty(KEY_PROPERTY, spec.key);
        entity.setDynamicProperty(YAW_PROPERTY, yawOf(spec));
        entity.nameTag = spec.label;
        showFacing(entity, spec);
        this.remember(spec.at);
      } catch (error) {
        log.warn(`could not place the marker ${spec.key}: ${describeError(error)}`);
      }
    }
  }

  /**
   * Removes every marker, loading each chunk one was ever in, and stops showing them. Resolves with
   * how many are still in the world (0 when it's safe to save).
   */
  async clear(): Promise<number> {
    this.paused = true;
    await sweepChunks(this.dimension, [...this.chunks], () => this.removeAll());
    const left = this.dimension.getEntities({ type: MARKER }).length;
    if (left === 0) {
      this.chunks.clear();
      world.setDynamicProperty(CHUNKS_PROPERTY, undefined);
    }
    return left;
  }

  /** Takes every loaded marker away until unhide(), out of a camera's shot. */
  hide(): void {
    this.hidden = true;
    this.removeAll();
  }

  unhide(): void {
    this.hidden = false;
    this.sync();
  }

  /** Shows the markers again after clear(). */
  resume(): void {
    this.paused = false;
    this.sync();
  }

  private removeAll(): void {
    for (const entity of this.dimension.getEntities({ type: MARKER })) entity.remove();
  }

  private remember(at: Vector3): void {
    const chunk = chunkOf(at);
    if (this.chunks.has(chunk)) return;
    this.chunks.add(chunk);
    world.setDynamicProperty(CHUNKS_PROPERTY, JSON.stringify([...this.chunks]));
  }
}

/** The way a marker is turned: its entry's yaw, or south without a facing. */
function yawOf(spec: MarkerShape): number {
  return (spec.facing ?? spec.look)?.yaw ?? 0;
}

/** Shows or hides the facing line and sets its tilt. */
function showFacing(entity: Entity, spec: MarkerShape): void {
  // Every marker shows its line: its saved facing, or where it looks without one.
  const facing = spec.facing ?? spec.look;
  const faced = facing !== undefined;
  const pitch = markerPitch(facing);
  if (entity.getProperty(FACED_PROPERTY) !== faced) entity.setProperty(FACED_PROPERTY, faced);
  if (entity.getProperty(PITCH_PROPERTY) !== pitch) entity.setProperty(PITCH_PROPERTY, pitch);
  const kind = spec.kind ?? 0;
  if (entity.getProperty(KIND_PROPERTY) !== kind) entity.setProperty(KIND_PROPERTY, kind);
  const style = spec.style ?? 0;
  if (entity.getProperty(STYLE_PROPERTY) !== style) {
    entity.setProperty(STYLE_PROPERTY, style);
    entity.triggerEvent(style >= FIRST_MODEL_STYLE ? `minecade:model_${style}` : NO_MODEL_EVENT);
  }
  const tint = spec.tint === undefined ? 0 : spec.tint + 1;
  if (entity.getProperty(TINT_PROPERTY) !== tint) entity.setProperty(TINT_PROPERTY, tint);
}

/**
 * Loads `chunks` ("x,z") a batch at a time, calling `remove` once each batch is loaded and once
 * more at the end: to take entities out of every chunk they were ever in before the world is saved.
 */
export async function sweepChunks(dimension: Dimension, chunks: string[], remove: () => void): Promise<void> {
  const manager = world.tickingAreaManager;
  const batch = Math.max(1, Math.min(SWEEP_BATCH, manager.maxChunkCount - manager.chunkCount));
  const sweep = sweeps++;
  for (let start = 0; start < chunks.length; start += batch) {
    const created: string[] = [];
    try {
      const loading = chunks.slice(start, start + batch).map((chunk, i) => {
        const [x, z] = chunk.split(",").map(Number);
        const id = `minecade:sweep${sweep}_${i}`;
        if (manager.hasTickingArea(id)) manager.removeTickingArea(id);
        const loaded = manager.createTickingArea(id, { dimension, from: { x: x * 16, y: 0, z: z * 16 }, to: { x: x * 16 + 15, y: 0, z: z * 16 + 15 } });
        created.push(id);
        return loaded;
      });
      await Promise.all(loading);
      remove();
    } finally {
      for (const id of created) if (manager.hasTickingArea(id)) manager.removeTickingArea(id);
    }
  }
  remove();
}

/** The chunk a spot is in, as sweepChunks takes it. */
export function chunkOf(at: Vector3): string {
  return `${Math.floor(at.x / 16)},${Math.floor(at.z / 16)}`;
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
