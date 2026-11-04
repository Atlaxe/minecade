// A leap the way a player looks (Bridges' Leap feather, Siege's Scout), as plain math: no Minecraft
// imports, so a game.config.ts test can check it.

/** A leap's strength: `forward` along the ground and `lift` up on a level look, `up` straight up. */
export interface LeapConfig {
  forward: number;
  lift: number;
  up: number;
}

/**
 * The leap's push, the way the player looks: on a level look, `forward` along the ground and `lift`
 * up (so it leaves the ground); looking up, less forward and more up, to `up` straight up; looking
 * down, less lift, to none straight down. For applyKnockback.
 */
export function leapPush(view: { x: number; y: number; z: number }, leap: LeapConfig): { x: number; z: number; vertical: number } {
  const length = Math.hypot(view.x, view.y, view.z) || 1;
  const [x, y, z] = [view.x / length, view.y / length, view.z / length];
  const vertical = y >= 0 ? leap.lift + y * (leap.up - leap.lift) : leap.lift * (1 + y);
  return { x: x * leap.forward, z: z * leap.forward, vertical };
}
