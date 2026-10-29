// Read-only access to the running map's map.json, with the geometry helpers games need.
import type { Box, MapConfig, Vec3 } from "../map-config.ts";

export class MapView {
  readonly config: MapConfig;

  constructor(config: MapConfig) {
    this.config = config;
  }

  get spawns(): Vec3[] {
    return this.config.spawns;
  }

  get spectatorSpawn(): Vec3 {
    const [x, y, z] = this.config.spectatorSpawn ?? this.config.spawns[0] ?? [0, 70, 0];
    return this.config.spectatorSpawn ? [x, y, z] : [x, y + 5, z];
  }

  get bounds(): Box | undefined {
    return this.config.bounds;
  }

  get killY(): number | undefined {
    return this.config.killY;
  }

  teamSpawns(key: string): Vec3[] {
    return this.config.teamSpawns?.[key] ?? [];
  }

  points(name: string): Vec3[] {
    return this.config.points?.[name] ?? [];
  }

  regions(name: string): Box[] {
    return this.config.regions?.[name] ?? [];
  }

  /** The middle of the bounds (or the first spawn), which spawns face. */
  center(): Vec3 {
    const bounds = this.config.bounds;
    if (!bounds) return this.config.spawns[0] ?? [0, 64, 0];
    return [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2) as Vec3;
  }

  /** True below killY or outside the bounds. Bounds are inclusive blocks: x 12.7 is inside a max of 12. */
  outOfBounds(position: { x: number; y: number; z: number }): boolean {
    if (this.config.killY !== undefined && position.y < this.config.killY) return true;
    const bounds = this.config.bounds;
    return bounds !== undefined && !inside(position, bounds);
  }
}

export function inside(position: { x: number; y: number; z: number }, box: Box): boolean {
  const point = [position.x, position.y, position.z];
  return point.every((value, axis) => value >= box.min[axis] && value < box.max[axis] + 1);
}
