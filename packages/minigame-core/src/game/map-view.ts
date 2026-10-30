// Read-only access to the running map's map.json, with the geometry helpers games need.
import { KILL_REGION, positionXyz, teamKey, type Box, type MapConfig, type MapPosition, type Vec3 } from "../map-config.ts";

export class MapView {
  readonly config: MapConfig;

  constructor(config: MapConfig) {
    this.config = config;
  }

  /** Positions may carry a fixed facing ([x, y, z, yaw, pitch]; facingOf reads it). */
  get spawns(): MapPosition[] {
    return this.config.spawns;
  }

  get spectatorSpawn(): MapPosition {
    const spawn = this.config.spectatorSpawn;
    if (spawn) return [...spawn] as MapPosition;
    const [x, y, z] = this.config.spawns[0] ?? [0, 70, 0];
    return [x, y + 5, z];
  }

  get bounds(): Box | undefined {
    return this.config.bounds;
  }

  get killY(): number | undefined {
    return this.config.killY;
  }

  /** Boxes that put a player out, like falling below killY (regions.kill). */
  get killRegions(): Box[] {
    return this.config.regions?.[KILL_REGION] ?? [];
  }

  teamSpawns(key: string): MapPosition[] {
    return this.config.teamSpawns?.[key] ?? [];
  }

  /** A named point list, or one team's ("<name>.<team>") when `team` is given. */
  points(name: string, team?: string): MapPosition[] {
    return this.config.points?.[teamKey(name, team)] ?? [];
  }

  /** A named region list, or one team's ("<name>.<team>") when `team` is given. */
  regions(name: string, team?: string): Box[] {
    return this.config.regions?.[teamKey(name, team)] ?? [];
  }

  /** The middle of the bounds (or the first spawn), which spawns face. */
  center(): Vec3 {
    const bounds = this.config.bounds;
    if (!bounds) return this.config.spawns[0] ? positionXyz(this.config.spawns[0]) : [0, 64, 0];
    return [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2) as Vec3;
  }

  /**
   * True below killY, outside the bounds, or inside a kill region. Bounds are inclusive blocks:
   * x 12.7 is inside a max of 12. Spectators are checked without kill regions (they fly over them).
   */
  outOfBounds(position: { x: number; y: number; z: number }, options: { killRegions?: boolean } = {}): boolean {
    if (this.config.killY !== undefined && position.y < this.config.killY) return true;
    if ((options.killRegions ?? true) && this.killRegions.some((box) => inside(position, box))) return true;
    const bounds = this.config.bounds;
    return bounds !== undefined && !inside(position, bounds);
  }
}

export function inside(position: { x: number; y: number; z: number }, box: Box): boolean {
  const point = [position.x, position.y, position.z];
  return point.every((value, axis) => value >= box.min[axis] && value < box.max[axis] + 1);
}
