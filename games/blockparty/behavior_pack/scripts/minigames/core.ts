// Defend the Core (1v3; docs/plans/block-party-minigames.md): the raider, with strong gear and many
// hearts, must break the Core (hits on it). The three defenders, each with a few hearts and back at
// their spawn a moment after going down, fight the raider off. Real damage. The raider wins by
// breaking the Core; the defenders by taking the raider down or holding until time. Bots: the raider
// heads for the core and fights back when a defender is close; defenders chase the raider.
import { world } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { botArm, botFace, botStep, botWait, clock, everyTick, flat, Hearts, isPlayer, item, moveTo, now, onPlan, setBlock, wear } from "./common.ts";
import { type MinigameDef, type Outcome, type Play } from "./kit.ts";

const CORE_BLOCK = "minecraft:beacon";
/** Ticks between a bot raider's hits on the core (a Medium bot's: botWait). */
const BOT_CORE_EVERY = 12;

export const CORE: MinigameDef = {
  id: "core",
  name: "Defend the Core",
  kind: "1v3",
  rules: "Raider: break the Core. Defenders: take the raider down, or hold out till time.",
  tutorial: [
    {
      objective: "Break the Core: hit it until it gives. The defenders keep coming back, so fight them off when they close in.",
      controls: [
        { input: "attack", what: "Hit the core and the defenders" },
        { input: "move", what: "Get to the core" },
      ],
    },
    {
      objective: "Fight the raider off the Core. You come back a moment after going down. Take the raider down, or hold out till time.",
      controls: [
        { input: "attack", what: "Hit the raider" },
        { input: "move", what: "Chase the raider" },
      ],
    },
  ],
  ...onPlan("core"),
  problem(field) {
    if (!field.points(MARKUP.core)[0]) return "its arena map has no Core";
    return field.points(MARKUP.raider)[0] ? undefined : "its arena map has no Raider spawn";
  },
  spawns(field, sides) {
    return [field.points(MARKUP.raider).slice(0, sides[0] ?? 1), field.points(MARKUP.defenders).slice(0, sides[1] ?? 0)];
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, sides, dimension } = play;
    const [raiders, defenders] = sides;
    const raider = raiders[0];
    const coreAt = field.points(MARKUP.core)[0];
    const coreBlock = { x: Math.floor(coreAt.x), y: Math.floor(coreAt.y), z: Math.floor(coreAt.z) };
    const spawns = field.points(MARKUP.defenders);
    const total = play.setting("playTime") * 20;
    const needed = play.setting("coreHits");
    const respawn = Math.max(1, play.setting("respawn") * 20);
    let coreHits = 0;
    let raiderDown = false;
    const resting = new Set<string>();
    setBlock(dimension, coreBlock, CORE_BLOCK);
    const down = (who: Who) => {
      if (who === raider) {
        raiderDown = true;
        play.say(`${raider.name} was taken down.`);
        return;
      }
      if (resting.has(who.key)) return;
      resting.add(who.key);
      play.tell(who, "Down! Back in a moment.");
      // Back at their spawn, held there a moment, then whole again.
      const spawn = spawns[defenders.indexOf(who)] ?? spawns[0];
      moveTo(who, play.bodyOf(who), spawn);
      play.freeze(who, respawn);
      scope.timeout(() => {
        hearts.heal(who);
        resting.delete(who.key);
      }, respawn);
    };
    const hearts = new Hearts(play, down, 10);
    hearts.setMax(raider, play.setting("raiderHearts") * 2);
    play.give(raider, item("minecraft:iron_sword"), 0);
    wear(raider, { head: "minecraft:iron_helmet", chest: "minecraft:iron_chestplate", legs: "minecraft:iron_leggings", feet: "minecraft:iron_boots" });
    for (const who of defenders) {
      play.give(who, item("minecraft:stone_sword"), 0);
      wear(who, { chest: "minecraft:leather_chestplate" });
      hearts.setMax(who, 10);
    }
    const hitCore = () => {
      coreHits++;
      dimension.playSound("random.anvil_land", coreAt, { volume: 0.6, pitch: 1 + coreHits / needed });
      if (coreHits >= needed) {
        setBlock(dimension, coreBlock, "minecraft:air");
        play.say("The Core broke.");
      }
    };
    scope.subscribe(world.afterEvents.entityHitBlock, ({ damagingEntity, hitBlock }) => {
      const loc = hitBlock.location;
      if (loc.x === coreBlock.x && loc.y === coreBlock.y && loc.z === coreBlock.z && play.bodyOf(raider)?.id === damagingEntity.id) hitCore();
    });
    let coreSwing = 0;
    play.notice(`${raider.name} raids the Core. Hit it ${needed} times to break it.`);
    await everyTick(play, total, (tick) => {
      const raiderBody = play.bodyOf(raider);
      if (raiderBody && !isPlayer(raiderBody) && !raiderDown) {
        const near = defenders.find((who) => {
          const body = play.bodyOf(who);
          return body && !resting.has(who.key) && flat(body.location, raiderBody.location) < 3;
        });
        if (near && hearts.botSwing(raider, [near], 6, down)) {
          // fought back
        } else if (flat(raiderBody.location, coreAt) > 1.8) botStep(play, raider, coreAt, 0.2, 1.5);
        else if (now() - coreSwing >= botWait(play, BOT_CORE_EVERY)) {
          coreSwing = now();
          botFace(raiderBody, coreAt);
          botArm(play, raider);
          hitCore();
        }
      }
      for (const who of defenders) {
        const body = play.bodyOf(who);
        if (!body || isPlayer(body) || resting.has(who.key) || !raiderBody) continue;
        if (!hearts.botSwing(who, [raider], 3, down)) botStep(play, who, raiderBody.location, 0.22, 1.8);
      }
      if (tick % 5 === 0) play.status(`Core ${needed - coreHits} hits left  ${clock(total - tick)}`);
      return raiderDown || coreHits >= needed;
    });
    return { winner: coreHits >= needed && !raiderDown ? 0 : 1 };
  },
};
