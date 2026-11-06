// Where the viewer's clicks put things, as game Edit's tools do: a point lands on top of the block
// clicked, where it was clicked (or at the block's middle with Center on block); a click on a
// block's side or underside goes just in front of it and drops to the floor below. Facings are
// yaws in degrees (0 faces south, 90 west), snapped to steps. Plain TypeScript, tested.
import type { Facing, MapPosition } from "@minecade/minigame-core/config";
import { entryPosition } from "../../../editor/behavior_pack/scripts/lists.ts";
import { lookAtSpot, type Hit, type Volume } from "./volume.ts";

export type Spot = { x: number; y: number; z: number };

/** How far in front of a block's side a spot goes, so a player standing there isn't in the wall (game Edit's). */
const SIDE_GAP = 0.3;

/**
 * Where a click on a block puts a point (world coordinates, y the feet): on its top where it was
 * clicked; in front of a side or under it, dropped to the first block below (undefined with none).
 */
export function floorSpot(volume: Volume, hit: Pick<Hit, "block" | "normal" | "point">): Spot | undefined {
  const [ox, oy, oz] = volume.origin;
  if (hit.normal[1] === 1) return { x: hit.point[0] + ox, y: hit.block[1] + 1 + oy, z: hit.point[2] + oz };
  const p = hit.point.map((value, axis) => value + hit.normal[axis] * SIDE_GAP);
  const [gx, gz] = [Math.floor(p[0]), Math.floor(p[2])];
  for (let gy = Math.min(Math.floor(p[1]), volume.size[1] - 1); gy >= 0; gy--) {
    if (volume.drawn[lookAtSpot(volume, gx, gy, gz)]) return { x: p[0] + ox, y: gy + 1 + oy, z: p[2] + oz };
  }
  return undefined;
}

/** An entry's position at a spot: the block's middle (whole numbers) with `center`, else the exact point. */
export function placedPosition(spot: Spot, center: boolean, facing?: Facing): MapPosition {
  return entryPosition(spot, center, facing);
}

/** A yaw from -180 (exclusive) to 180, never -0. */
export function normalYaw(yaw: number): number {
  const turned = ((((yaw + 180) % 360) + 360) % 360) - 180;
  return (turned === -180 ? 180 : turned) + 0;
}

/** The yaw from one spot toward another, in steps of `step` degrees (1 for whole degrees). */
export function yawToward(from: Spot, to: Spot, step: number): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return 0;
  const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
  return normalYaw(Math.round(yaw / step) * step);
}
