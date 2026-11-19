// Sends a number over a head as its particle (numbers.ts says why a particle): one a tick, where the
// number's middle is, with its cell, its size, and the way it moves (blocks a second) so it glides to
// where the next one starts.
import { MolangVariableMap, type Dimension, type Vector3 } from "@minecraft/server";
import { NUMBER_PARTICLE, cellOf, halfSize, type NumberKind } from "./numbers.ts";

export interface NumberSprite {
  kind: NumberKind;
  value: number;
  /** Where the number's middle is now. */
  at: Vector3;
  /** Blocks a second it's moving, if it is. */
  velocity?: Vector3;
  /** Its size (1 at rest; the pop swells it). */
  scale: number;
}

/** One tick of a number: its particle, there now. */
export function sendNumber(dimension: Dimension, sprite: NumberSprite): void {
  const [halfWidth, halfHeight] = halfSize(sprite.kind, sprite.scale);
  if (halfWidth <= 0 || halfHeight <= 0) return;
  const variables = new MolangVariableMap();
  variables.setFloat("variable.cell", cellOf(sprite.kind, sprite.value));
  variables.setFloat("variable.half_w", halfWidth);
  variables.setFloat("variable.half_h", halfHeight);
  variables.setFloat("variable.vx", sprite.velocity?.x ?? 0);
  variables.setFloat("variable.vy", sprite.velocity?.y ?? 0);
  variables.setFloat("variable.vz", sprite.velocity?.z ?? 0);
  try {
    dimension.spawnParticle(NUMBER_PARTICLE, sprite.at, variables);
  } catch {
    // unloaded
  }
}
