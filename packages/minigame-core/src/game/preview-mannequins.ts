// A preview's mannequins: the map editor's stand-ins for players (map.json's mannequins), standing
// in the preview where they stand in Edit, when the map's "Show in previews" switch is on (the
// editor's preview build turns them into previewMannequins, with each look worked out for the
// preview's pack). They're the fake player's entity in its mannequin form (no gravity, can't be
// hurt or pushed), without a name, so the game never counts them: they only stand there.
//
// Entities can only be placed in loaded chunks, so each is placed once its chunk loads, found again
// by a property on it (a body stays in its chunk when that unloads).
import { world, type Dimension, type Entity } from "@minecraft/server";
import { describeError, log } from "../log.ts";
import type { PreviewMannequin } from "../map-config.ts";
import type { Scope } from "../scope.ts";
import { FAKE_PLAYER } from "./fakes.ts";

/** On each body: its place in the list. */
const INDEX_PROPERTY = "minecade:previewMannequin";
const MANNEQUIN_EVENT = "minecade:mannequin";
const SYNC_TICKS = 20;

export class PreviewMannequins {
  private readonly dimension: Dimension;
  private readonly list: PreviewMannequin[];

  constructor(scope: Scope, list: PreviewMannequin[]) {
    this.dimension = world.getDimension("overworld");
    this.list = list;
    scope.interval(() => this.sync(), SYNC_TICKS);
  }

  private sync(): void {
    const placed = new Set<number>();
    for (const entity of this.dimension.getEntities({ type: FAKE_PLAYER })) {
      const index = entity.getDynamicProperty(INDEX_PROPERTY);
      if (typeof index === "number") placed.add(index);
    }
    this.list.forEach((mannequin, index) => {
      const [x, y, z, yaw] = mannequin.at;
      if (placed.has(index) || !this.dimension.isChunkLoaded({ x, y, z })) return;
      try {
        const body = this.dimension.spawnEntity(FAKE_PLAYER, { x, y, z }, { initialRotation: yaw });
        body.triggerEvent(MANNEQUIN_EVENT);
        body.nameTag = "";
        body.setDynamicProperty(INDEX_PROPERTY, index);
        dress(body, mannequin);
      } catch (error) {
        log.warn(`could not place a mannequin: ${describeError(error)}`);
      }
    });
  }
}

function dress(body: Entity, mannequin: PreviewMannequin): void {
  body.setProperty("minecade:skin", mannequin.skin);
  body.setProperty("minecade:tint", mannequin.tint);
  body.setProperty("minecade:pose", mannequin.pose);
  if (mannequin.hold) body.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${mannequin.hold}`);
}
