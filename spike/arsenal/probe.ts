// Arsenal check (the pack script spike/arsenal/run.ts bundles): makes every arsenal item and reads
// its cooldown, spawns every arsenal entity and sets its model property, and measures the raycasts
// the bullets rely on (where getBlockFromRay says a block face is, how far getEntitiesFromRay says
// a mob is, whether a block stops it), then fires a rocket and sees where it goes.
//   scriptevent arms:probe        runs it and prints "ARMS|" lines, then "ARMS|done"
import { EntityComponentTypes, ItemComponentTypes, ItemStack, MolangVariableMap, system, world, type Vector3 } from "@minecraft/server";
import { ARSENAL_MODELS, ARSENAL_PICKUP, MODEL_PROPERTY, PARTICLES, PRIMED_ARSENAL, ROCKET, THROWN_ARSENAL, arsenalItem } from "../../packages/guns/src/defs.ts";

const Y = 101;
const out = (value: unknown) => console.log(`ARMS|${JSON.stringify(value)}`);
const error = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught));
const at = (x: number, y: number, z: number): Vector3 => ({ x, y: Y + y, z });

system.afterEvents.scriptEventReceive.subscribe(({ id }) => {
  if (id === "arms:probe") system.run(() => void probe());
});

async function probe(): Promise<void> {
  const dimension = world.getDimension("overworld");
  for (const id of ARSENAL_MODELS.map(arsenalItem)) {
    try {
      // Its category can't be read from a script on 2.11.0: only whether it has one.
      out({ id: "item", item: id, cooldown: new ItemStack(id).getComponent(ItemComponentTypes.Cooldown) !== undefined });
    } catch (caught) {
      out({ id: "item", item: id, error: error(caught) });
    }
  }
  for (const type of [THROWN_ARSENAL, PRIMED_ARSENAL, ARSENAL_PICKUP, ROCKET]) {
    try {
      const entity = dimension.spawnEntity(type, at(0.5, 5, 0.5));
      if (type !== ROCKET) entity.setProperty(MODEL_PROPERTY, ARSENAL_MODELS.length - 1);
      // A property set takes effect at the end of the tick.
      await delay(1);
      out({ id: "entity", type, model: type === ROCKET ? undefined : entity.getProperty(MODEL_PROPERTY), projectile: entity.getComponent(EntityComponentTypes.Projectile) !== undefined });
      entity.remove();
    } catch (caught) {
      out({ id: "entity", type, error: error(caught) });
    }
  }
  // A floor, a wall 5 blocks south of the eye, and a mob 3 blocks south, standing on the floor.
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 8; z++) dimension.setBlockType(at(x, -1, z), "minecraft:stone");
  for (let x = -2; x <= 2; x++) for (let y = 0; y < 3; y++) dimension.setBlockType(at(x, y, 6), "minecraft:stone");
  const eye = at(0.5, 1.62, 0.5);
  const south = { x: 0, y: 0, z: 1 };
  const block = dimension.getBlockFromRay(eye, south, { maxDistance: 20, includeLiquidBlocks: false, includePassableBlocks: false });
  out({ id: "blockRay", block: block && { x: block.block.x, y: block.block.y, z: block.block.z }, face: block?.face, faceLocation: block?.faceLocation });
  const mob = dimension.spawnEntity("minecraft:armor_stand", at(0.5, 0, 3.5));
  await delay(5);
  const free = dimension.getEntitiesFromRay(eye, south, { maxDistance: 20, ignoreBlockCollision: true });
  out({ id: "entityRay", hits: free.map((hit) => ({ type: hit.entity.typeId, distance: hit.distance, feet: hit.entity.location, head: safeHead(hit.entity) })) });
  const walled = dimension.getEntitiesFromRay(at(0.5, 1.62, 8.5), { x: 0, y: 0, z: -1 }, { maxDistance: 20 });
  out({ id: "entityRayBehindWall", hits: walled.map((hit) => ({ type: hit.entity.typeId, distance: hit.distance })) });
  mob.remove();
  const variables = new MolangVariableMap();
  variables.setVector3("variable.dir", south);
  variables.setFloat("variable.dist", 5);
  variables.setFloat("variable.speed", 160);
  for (const particle of Object.values(PARTICLES)) {
    try {
      dimension.spawnParticle(particle, eye, variables);
    } catch (caught) {
      out({ id: "particle", particle, error: error(caught) });
    }
  }
  // A rocket shot level from high up: each tick's place.
  for (const [type, x] of [[ROCKET, 0.5]] as const) {
    const rocket = dimension.spawnEntity(type, at(x, 30, -10));
    rocket.getComponent(EntityComponentTypes.Projectile)?.shoot({ x: 0, y: 0, z: 1.6 });
    const path: string[] = [];
    for (let tick = 0; tick < 10 && rocket.isValid; tick++) {
      path.push(`${rocket.location.y.toFixed(3)}@${rocket.location.z.toFixed(2)}`);
      await delay(1);
    }
    out({ id: "rocket", type, path });
    if (rocket.isValid) rocket.remove();
  }
  out({ id: "done" });
}

function safeHead(entity: { getHeadLocation(): Vector3 }): Vector3 | string {
  try {
    return entity.getHeadLocation();
  } catch (caught) {
    return error(caught);
  }
}

function delay(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
}
