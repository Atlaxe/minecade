// Cactus Slap (FFA; docs/plans/block-party-minigames.md): a platform ringed by cactus. Everyone holds
// a slap stick whose hit sends a player flying (Knockback, 4 times vanilla's by default). Touch a
// cactus and you're out; a fall off (Kill Y) is out too. Last one in wins; the rest place by when
// they went out; at time everyone still in ties first. In the sudden death's pool. Touching is a
// cactus block within a hair of the player's box, checked each tick (hits do no damage, so vanilla's
// cactus hurts nobody). Bots walk at the nearest player and slap.
import type { Vector3 } from "@minecraft/server";
import { blockId, item, onPlan } from "./common.ts";
import { inOrder, type MinigameDef, type Play } from "./kit.ts";
import { knockOff } from "./sumo-duel.ts";

/** How far past a player's box a cactus touches them. */
const REACH = 0.36;

function touchesCactus(play: Play, at: Vector3): boolean {
  for (const dy of [0.1, 1.1]) {
    for (const [dx, dz] of [
      [REACH, 0],
      [-REACH, 0],
      [0, REACH],
      [0, -REACH],
      [REACH, REACH],
      [-REACH, -REACH],
      [REACH, -REACH],
      [-REACH, REACH],
    ]) {
      if (blockId(play.dimension, { x: at.x + dx, y: at.y + dy, z: at.z + dz }) === "minecraft:cactus") return true;
    }
  }
  return false;
}

export const CACTUS: MinigameDef = {
  id: "cactus",
  name: "Cactus Slap",
  kind: "ffa",
  rules: "Slap the others into the cactus. Touch a cactus and you're out.",
  tutorial: [
    {
      objective: "Slap the others into the cactus ringing the platform. Touch a cactus yourself and you're out. Last one in wins.",
      controls: [
        { input: "attack", what: "Slap" },
        { input: "move", what: "Keep off the cactus" },
        { input: "jump", what: "Dodge" },
      ],
    },
  ],
  ...onPlan("cactus"),
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  play(play) {
    for (const who of play.sides.flat()) play.give(who, item("minecraft:stick", { name: "Slap Stick" }));
    return knockOff(play, (_who, at) => (touchesCactus(play, at) ? "touched a cactus" : undefined));
  },
};
