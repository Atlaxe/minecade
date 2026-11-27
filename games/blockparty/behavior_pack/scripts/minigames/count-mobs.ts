// Count the Mobs (FFA; docs/plans/block-party-minigames.md): everyone looks through one fixed camera
// (the Pen camera) at a pen. Sheep in grays (white, light gray, gray, black) come into the pen and
// leave it through the gates, in groups, walked by script. The round names a color or all sheep.
// Count with jump (each press adds one) and sneak (takes one off); each player sees only their own
// count. When the round ends the sheep stop and the counts show: the closest scores most (3, 2, 1;
// spot on, 1 more). Most points after the rounds wins. Bots' counts land within 2 of the right one.
// The players' bodies wait at their spawns, held.
import { ButtonState, EntityComponentTypes, InputButton, world, type Entity, type Vector3 } from "@minecraft/server";
import { MARKUP } from "./arenas.ts";
import { clock, everyTick, inside, onPlan, pick, placesBy, removeEntity, spawnIn, spotIn, yawToward } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** Vanilla's sheep colors by its color index: white 0, light gray 8, gray 7, black 15. */
const GRAYS = [
  { name: "white", color: 0 },
  { name: "light gray", color: 8 },
  { name: "gray", color: 7 },
  { name: "black", color: 15 },
] as const;
/** A walked sheep's step, blocks a tick. */
const SHEEP_STEP = 0.12;
/** Ticks the counts show after a round. */
const SHOW = 70;

interface Sheep {
  entity: Entity;
  gray: number;
  /** Where it walks to next, and whether it leaves after (out through a gate). */
  to: Vector3;
  leaving: boolean;
  /** Ticks it grazes in the pen before it leaves (leavers only). */
  stay: number;
}

export const COUNT_MOBS: MinigameDef = {
  id: "countmobs",
  name: "Count the Mobs",
  kind: "ffa",
  rules: "Count the sheep the round names as they come and go. Jump adds one, sneak takes one off.",
  tutorial: [
    {
      objective: "Sheep come into the pen and leave again. Count the ones the round names: when it ends, the closest count scores the most.",
      controls: [
        { input: "jump", what: "Count one" },
        { input: "sneak", what: "Take one off" },
      ],
    },
  ],
  ...onPlan("countmobs"),
  problem(field) {
    if (!field.regions(MARKUP.pen)[0]) return "its arena map has no Pen";
    if (field.points(MARKUP.gates).length < 1) return "its arena map has no Gates";
    return field.points(MARKUP.penCamera)[0] ? undefined : "its arena map has no Pen camera";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope } = play;
    const pen = field.regions(MARKUP.pen)[0];
    const gates = field.points(MARKUP.gates);
    const camera = field.points(MARKUP.penCamera)[0];
    const everyone = play.sides.flat();
    const rounds = play.setting("rounds");
    const roundTime = play.setting("roundTime") * 20;
    const most = play.setting("mostSheep");
    const points = new Map(everyone.map((who) => [who.key, 0]));
    // Everyone held, looking through the pen camera.
    for (const who of everyone) {
      play.freeze(who, (roundTime + SHOW + 40) * rounds + 100);
      try {
        who.player?.camera.setCamera("minecraft:free", { location: camera, rotation: { x: camera.pitch ?? 30, y: camera.yaw ?? 0 } });
      } catch {
        // gone
      }
    }
    const counts = new Map(everyone.map((who) => [who.key, 0]));
    let counting = false;
    scope.subscribe(world.afterEvents.playerButtonInput, ({ player, button, newButtonState }) => {
      if (!counting || newButtonState !== ButtonState.Pressed) return;
      const who = everyone.find((one) => one.player?.id === player.id);
      if (!who) return;
      const add = button === InputButton.Jump ? 1 : button === InputButton.Sneak ? -1 : 0;
      if (add === 0) return;
      counts.set(who.key, Math.max(0, (counts.get(who.key) ?? 0) + add));
      play.tell(who, `Your count: ${counts.get(who.key)}`, 400);
    });
    for (let round = 1; round <= rounds && !scope.disposed; round++) {
      const named = play.random() < 0.3 ? -1 : Math.floor(play.random() * GRAYS.length);
      const label = named < 0 ? "all the sheep" : `the ${GRAYS[named].name} sheep`;
      for (const who of everyone) counts.set(who.key, 0);
      const sheep: Sheep[] = [];
      counting = true;
      play.notice(`Round ${round}: count ${label}!`, 60);
      const waveEvery = Math.max(20, Math.floor(roundTime / 6));
      await everyTick(play, roundTime, (tick) => {
        // A group comes in now and then; some leave again after grazing.
        if (tick % waveEvery === 0 && tick < roundTime - 40) {
          const room = most - sheep.filter((one) => !one.leaving).length;
          const group = Math.min(room, 1 + Math.floor(play.random() * 4));
          for (let i = 0; i < group; i++) {
            const gate = pick(gates, play.random);
            const gray = Math.floor(play.random() * GRAYS.length);
            const entity = spawnIn(play, "minecraft:sheep", gate);
            if (!entity) continue;
            try {
              const color = entity.getComponent(EntityComponentTypes.Color);
              if (color) color.value = GRAYS[gray].color;
            } catch {
              // a sheep that keeps its own color
            }
            sheep.push({ entity, gray, to: spotIn(pen, play.random, 1), leaving: play.random() < 0.35, stay: 30 + Math.floor(play.random() * 60) });
          }
        }
        for (const one of [...sheep]) {
          if (!one.entity.isValid) continue;
          const at = one.entity.location;
          const dx = one.to.x - at.x;
          const dz = one.to.z - at.z;
          const gap = Math.hypot(dx, dz);
          if (gap > 0.2) {
            const step = Math.min(SHEEP_STEP, gap);
            try {
              one.entity.teleport({ x: at.x + (dx / gap) * step, y: at.y, z: at.z + (dz / gap) * step }, { rotation: { x: 0, y: yawToward(at, one.to) } });
            } catch {
              // gone
            }
          } else if (one.leaving && inside(pen, at, 1)) {
            if (--one.stay <= 0) one.to = pick(gates, play.random);
          } else if (one.leaving) {
            removeEntity(one.entity);
            sheep.splice(sheep.indexOf(one), 1);
          }
        }
        if (tick % 5 === 0) play.status(`Count ${label}  ${clock(roundTime - tick)}`);
      });
      counting = false;
      // The right count: the named sheep in the pen now.
      const right = sheep.filter((one) => one.entity.isValid && inside(pen, one.entity.location, 1) && (named < 0 || one.gray === named)).length;
      for (const who of everyone) if (!who.player) counts.set(who.key, Math.max(0, right + Math.floor(play.random() * 5) - 2));
      const off = (key: string) => Math.abs((counts.get(key) ?? 0) - right);
      const order = placesBy(everyone.map((who) => who.key), off, true);
      order.forEach((group, place) => {
        for (const key of group) points.set(key, (points.get(key) ?? 0) + Math.max(0, 3 - place) + (off(key) === 0 ? 1 : 0));
      });
      play.notice(`There were ${right}.\n${everyone.map((who) => `${who.name} ${counts.get(who.key)}`).join("   ")}`, SHOW);
      play.status(everyone.map((who) => `${who.name} ${points.get(who.key)}`).join("  "));
      await scope.wait(SHOW);
      for (const one of sheep) removeEntity(one.entity);
    }
    return { places: placesBy(everyone.map((who) => who.key), (key) => points.get(key) ?? 0) };
  },
};
