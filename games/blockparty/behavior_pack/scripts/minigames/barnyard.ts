// Barnyard Bluff (1v3; docs/plans/block-party-minigames.md): a farm full of vanilla farm animals, and
// the hiders are players in disguise, each looking like a cow, a pig, a sheep or a chicken, acting
// like one. The farmer waits shut in the barn while they blend in, then has a few guesses: each hit
// on an animal uses one, and a hider hit is found and out. The farmer wins by finding them all; the
// hiders win if any is still hidden at time, or when the guesses run out. Until the players pack can
// swap a player's model (piece 22), a hider is invisible inside an animal of their kind that follows
// them. Bots: hiders wander and stop like the animals; the farmer hits an animal near a hider now and
// then, finding them with a chance.
import { world, type Entity, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, blockId, botFace, botStep, botStop, clock, everyTick, flat, inside, isPlayer, onPlan, pick, removeEntity, setBlock, spawnIn, spotIn, yawToward } from "./common.ts";
import { type MinigameDef, type Outcome, type Play } from "./kit.ts";

const ANIMALS = [
  { type: "minecraft:cow", name: "a cow" },
  { type: "minecraft:pig", name: "a pig" },
  { type: "minecraft:sheep", name: "a sheep" },
  { type: "minecraft:chicken", name: "a chicken" },
] as const;
/** Ticks between a bot farmer's guesses, and the chance one finds a hider. */
const BOT_GUESS = 90;
const BOT_FINDS = 0.4;

export const BARNYARD: MinigameDef = {
  id: "barnyard",
  name: "Barnyard Bluff",
  kind: "1v3",
  rules: "Hiders: act like a farm animal. Farmer: hit the animals you think are players, with only a few guesses.",
  tutorial: [
    {
      objective: "Some of the animals are players in disguise. Hit the ones you think they are: each hit uses a guess. Find them all to win.",
      controls: [
        { input: "attack", what: "Hit the animal you think is a player" },
        { input: "move", what: "Look over the herd" },
      ],
    },
    {
      objective: "You're disguised as a farm animal. Wander, stop, wander: act like one so the farmer can't tell. Still hidden at time, you win.",
      controls: [{ input: "move", what: "Act like an animal" }],
    },
  ],
  ...onPlan("barnyard"),
  problem(field) {
    if (!field.regions(MARKUP.herd)[0]) return "its arena map has no Herd";
    return field.points(MARKUP.farmer)[0] ? undefined : "its arena map has no Farmer spawn";
  },
  spawns(field, sides) {
    return [field.points(MARKUP.farmer).slice(0, sides[0] ?? 1), field.points(MARKUP.hiders).slice(0, sides[1] ?? 0)];
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, sides } = play;
    const [farmers, hiders] = sides;
    const farmer = farmers[0];
    const herd = field.regions(MARKUP.herd)[0];
    const hideTime = play.setting("hideTime") * 20;
    const total = play.setting("playTime") * 20;
    let guesses = play.setting("guesses");
    const found = new Set<string>();
    // The herd.
    const animals: Entity[] = [];
    for (let i = 0; i < play.setting("animals"); i++) {
      const animal = spawnIn(play, pick(ANIMALS, play.random).type, spotIn(herd, play.random, 1));
      if (animal) animals.push(animal);
    }
    // Each hider's disguise: an animal of its kind that follows them, the hider unseen inside it.
    const disguise = new Map<string, Entity>();
    for (const who of hiders) {
      const kind = pick(ANIMALS, play.random);
      const body = play.bodyOf(who);
      const animal = body ? spawnIn(play, kind.type, body.location) : undefined;
      if (animal) disguise.set(who.key, animal);
      try {
        body?.addEffect("invisibility", total + hideTime + 200, { showParticles: false });
      } catch {
        // gone
      }
      play.tell(who, `You're ${kind.name}. Act like one!`, 80);
    }
    const reveal = (who: Who) => {
      if (found.has(who.key)) return;
      found.add(who.key);
      removeEntity(disguise.get(who.key));
      disguise.delete(who.key);
      try {
        play.bodyOf(who)?.removeEffect("invisibility");
      } catch {
        // gone
      }
      play.out(who);
      play.say(`${farmer.name} found ${who.name}.`);
    };
    let open = false;
    const guess = (target: Entity) => {
      if (!open || guesses <= 0) return;
      const hider = hiders.find((who) => !found.has(who.key) && (disguise.get(who.key)?.id === target.id || play.bodyOf(who)?.id === target.id));
      const animal = animals.find((one) => one.isValid && one.id === target.id);
      if (!hider && !animal) return;
      guesses--;
      if (hider) reveal(hider);
      else play.tell(farmer, `Just an animal. ${guesses} ${guesses === 1 ? "guess" : "guesses"} left.`, 40);
    };
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (!isPlayer(damagingEntity) || play.bodyOf(farmer)?.id !== damagingEntity.id) return;
      guess(hitEntity);
    });
    const wander = new Map<string, { to: Vector3; until: number; still: boolean }>();
    const follow = (tick: number) => {
      for (const who of hiders) {
        const body = play.bodyOf(who);
        const animal = disguise.get(who.key);
        if (!body || !animal?.isValid) continue;
        try {
          const facing = body.getRotation().y;
          animal.teleport(body.location, { rotation: { x: 0, y: facing } });
        } catch {
          // gone
        }
        if (isPlayer(body)) continue;
        // A bot hider: wander, stop, wander, like the animals.
        let plan = wander.get(who.key);
        if (!plan || tick >= plan.until) {
          plan = { to: spotIn(herd, play.random, 1), until: tick + 40 + Math.floor(play.random() * 80), still: play.random() < 0.45 };
          wander.set(who.key, plan);
        }
        if (plan.still) botStop(play, who);
        else if (botStep(play, who, plan.to, BOT_WALK * 0.4, 0.4)) plan.still = true;
      }
      // Animals out of the herd go back in.
      if (tick % 20 === 0) for (const animal of animals) if (animal.isValid && !inside(herd, animal.location, 1)) animal.teleport(spotIn(herd, play.random, 1));
    };
    // 1. Blend in: the farmer held in the barn.
    play.freeze(farmer, hideTime);
    play.notice(`${farmer.name} is the farmer. The rest: blend in with the herd!`, 60);
    await everyTick(play, hideTime, (tick) => {
      follow(tick);
      if (tick % 5 === 0) play.status(`Blend in!  ${clock(hideTime - tick)}`);
    });
    // 2. Find them: the barn opens (a doorway two blocks ahead of the farmer's spawn, the way it faces).
    const barn = field.points(MARKUP.farmer)[0];
    if (barn) {
      const yaw = ((barn.yaw ?? 0) * Math.PI) / 180;
      const door = { x: Math.floor(barn.x - Math.sin(yaw) * 2), z: Math.floor(barn.z + Math.cos(yaw) * 2) };
      for (const dy of [0, 1]) {
        const at = { x: door.x, y: Math.floor(barn.y) + dy, z: door.z };
        if (blockId(play.dimension, at) !== "minecraft:air") setBlock(play.dimension, at, "minecraft:air");
      }
    }
    open = true;
    play.notice(`Find them! ${guesses} guesses.`, 40);
    await everyTick(play, total, (tick) => {
      follow(tick + hideTime);
      const farmerBody = play.bodyOf(farmer);
      if (farmerBody && !isPlayer(farmerBody) && tick % BOT_GUESS === BOT_GUESS - 1) {
        const left = hiders.filter((who) => !found.has(who.key));
        const target = play.random() < BOT_FINDS && left.length > 0 ? disguise.get(pick(left, play.random).key) : pick(animals.filter((one) => one.isValid), play.random);
        if (target) {
          botFace(farmerBody, target.location);
          guess(target);
        }
      } else if (farmerBody && !isPlayer(farmerBody)) {
        const middle = { x: (herd.min.x + herd.max.x + 1) / 2, y: farmerBody.location.y, z: (herd.min.z + herd.max.z + 1) / 2 };
        if (flat(farmerBody.location, middle) > 4) botStep(play, farmer, middle, BOT_WALK, 3);
        else farmerBody.setRotation({ x: 0, y: yawToward(farmerBody.location, middle) + Math.sin(tick / 20) * 90 });
      }
      if (tick % 5 === 0) play.status(`Found ${found.size} of ${hiders.length}  ${guesses} guesses  ${clock(total - tick)}`);
      return found.size >= hiders.length || guesses <= 0;
    });
    for (const who of hiders) {
      try {
        play.bodyOf(who)?.removeEffect("invisibility");
      } catch {
        // gone
      }
    }
    return { winner: found.size >= hiders.length ? 0 : 1 };
  },
};
