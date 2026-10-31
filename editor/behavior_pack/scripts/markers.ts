// Marker entities that show every spawn and point, numbered by list. Hitting one opens its form.
// An entry with a saved facing gets a red line from the marker's top toward it: the marker spawns
// turned to the entry's yaw (the line is the model's front), and tilts the line by the entry's
// pitch through a client-synced property.
// They live only while the editor runs: a marker in a chunk nobody is near is saved with that
// chunk, so every chunk a marker was ever in is remembered (also in a world property, in case the
// server crashes), and clear() loads them all and removes every marker before the world is saved.
import { world, type Dimension, type Entity, type Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { markerPitch, sameYaw, type MarkerSpec } from "./lists.ts";

export const MARKER = "minecade:editor_marker";
/** On each marker: its MarkerSpec key. */
const KEY_PROPERTY = "minecade:key";
/** On each marker: the yaw it was spawned with. */
const YAW_PROPERTY = "minecade:yaw";
/** Entity properties the client draws the facing line from (editor_marker.json). */
const FACED_PROPERTY = "minecade:faced";
const PITCH_PROPERTY = "minecade:pitch";
/** On the world: the chunks markers were in, as JSON ["x,z", ...]. */
const CHUNKS_PROPERTY = "minecade:markerChunks";
const SYNC_TICKS = 20;
/** Ticking areas loaded at once while clearing; the pack's limit may be lower. */
const SWEEP_BATCH = 16;

export class Markers {
  private readonly dimension: Dimension;
  private specs = new Map<string, MarkerSpec>();
  private readonly chunks = new Set<string>();
  private paused = false;

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

  /** Shows these markers, and only these, wherever their chunks are loaded. */
  show(specs: MarkerSpec[]): void {
    this.specs = new Map(specs.map((spec) => [spec.key, spec]));
    this.sync();
  }

  /** What a marker entity stands for, if it's a current marker. */
  specOf(entity: Entity): MarkerSpec | undefined {
    const key = entity.getDynamicProperty(KEY_PROPERTY);
    return typeof key === "string" ? this.specs.get(key) : undefined;
  }

  private sync(): void {
    if (this.paused) return;
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
    const manager = world.tickingAreaManager;
    const chunks = [...this.chunks];
    const batch = Math.max(1, Math.min(SWEEP_BATCH, manager.maxChunkCount - manager.chunkCount));
    for (let start = 0; start < chunks.length; start += batch) {
      const created: string[] = [];
      try {
        const loading = chunks.slice(start, start + batch).map((chunk, i) => {
          const [x, z] = chunk.split(",").map(Number);
          const id = `minecade:sweep${i}`;
          const loaded = manager.createTickingArea(id, { dimension: this.dimension, from: { x: x * 16, y: 0, z: z * 16 }, to: { x: x * 16 + 15, y: 0, z: z * 16 + 15 } });
          created.push(id);
          return loaded;
        });
        await Promise.all(loading);
        this.removeAll();
      } finally {
        for (const id of created) if (manager.hasTickingArea(id)) manager.removeTickingArea(id);
      }
    }
    this.removeAll();
    const left = this.dimension.getEntities({ type: MARKER }).length;
    if (left === 0) {
      this.chunks.clear();
      world.setDynamicProperty(CHUNKS_PROPERTY, undefined);
    }
    return left;
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
    const chunk = `${Math.floor(at.x / 16)},${Math.floor(at.z / 16)}`;
    if (this.chunks.has(chunk)) return;
    this.chunks.add(chunk);
    world.setDynamicProperty(CHUNKS_PROPERTY, JSON.stringify([...this.chunks]));
  }
}

/** The way a marker is turned: its entry's yaw, or south without a facing. */
function yawOf(spec: MarkerSpec): number {
  return spec.facing?.yaw ?? 0;
}

/** Shows or hides the facing line and sets its tilt. */
function showFacing(entity: Entity, spec: MarkerSpec): void {
  const faced = spec.facing !== undefined;
  const pitch = markerPitch(spec.facing);
  if (entity.getProperty(FACED_PROPERTY) !== faced) entity.setProperty(FACED_PROPERTY, faced);
  if (entity.getProperty(PITCH_PROPERTY) !== pitch) entity.setProperty(PITCH_PROPERTY, pitch);
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
