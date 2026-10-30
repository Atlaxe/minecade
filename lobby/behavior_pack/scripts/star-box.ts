// The star box (map.json "stars"): one big minecade:star_box entity around the lobby, its walls and
// floor drawn with stars, so the night sky has stars below the horizon too (Bedrock's own sky only
// has them above). It sits at the terminal, inside its ticking area, and is placed like the
// hologram: retried until the area is loaded, then kept (respawned if it goes missing). It always
// faces south (yaw 0): its east and west walls and its ceiling drift north to south, and stars
// spread out of the north wall's middle and sink into the south wall's (the resource pack's
// star_box_* render controllers), as if the lobby were flying north through space.
import type { Dimension, Entity, Vector3 } from "@minecraft/server";

const STAR_BOX = "minecade:star_box";

export class StarBox {
  private readonly dimension: Dimension;
  private readonly point: Vector3;
  private box: Entity | undefined;

  constructor(dimension: Dimension, point: Vector3) {
    this.dimension = dimension;
    this.point = point;
  }

  /** Spawns the box if it's missing. Throws while the area isn't loaded. */
  ensure(): void {
    if (this.box?.isValid) return;
    for (const old of this.dimension.getEntities({ type: STAR_BOX })) old.remove();
    this.box = this.dimension.spawnEntity(STAR_BOX, this.point, { initialRotation: 0 });
  }
}
