// Capture the Wool (2v2; docs/plans/block-party-minigames.md): each team's wool stands at its base.
// Walk into the other team's wool to take it and bring it to your own base. A rival's hit on the
// carrier (a tag: no push) sends the wool home and the carrier back to their spawn a moment later.
// First to the captures wins; at time, more captures wins, else a draw. The carrier holds the wool.
// Bots: one goes for the wool, one stays home and tags a carrier who comes near.
import { world, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP, PAINTER_TEAMS } from "./arenas.ts";
import { BOT_RUN, BOT_WALK, botArm, botHold, botLook, botStep, clock, everyTick, flat, isPlayer, item, moveTo, onPlan, setBlock, sideMap, winnerBy } from "./common.ts";
import { over, type MinigameDef, type Outcome, type Play } from "./kit.ts";

const WOOL = ["minecraft:red_wool", "minecraft:blue_wool"] as const;
/** How close a player gets to the wool to take it, and a bot to tag. */
const TAKE = 1.3;
const TAG = 1.8;

export const WOOL_GAME: MinigameDef = {
  id: "wool",
  name: "Capture the Wool",
  kind: "2v2",
  rules: "Take the other team's wool and bring it to your base. Tag their carrier to send it home.",
  tutorial: [
    {
      objective: "Walk into the other team's wool to take it, and bring it to your own base. Hit their carrier to send the wool home.",
      controls: [
        { input: "move", what: "Take the wool home" },
        { input: "attack", what: "Tag the carrier" },
        { input: "sprint", what: "Run" },
      ],
    },
  ],
  ...onPlan("wool"),
  problem(field) {
    for (const team of PAINTER_TEAMS) {
      if (!field.points(`${MARKUP.wool}.${team.id}`)[0]) return `its arena map has no ${team.name} wool`;
      if (!field.regions(`${MARKUP.base}.${team.id}`)[0]) return `its arena map has no ${team.name} base`;
    }
    return undefined;
  },
  spawns(field, sides) {
    return sides.map((count, side) => field.teamSpawns(PAINTER_TEAMS[side]?.id ?? "").slice(0, count));
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, sides, dimension } = play;
    const teams = PAINTER_TEAMS.slice(0, 2);
    const woolAt = teams.map((team) => field.points(`${MARKUP.wool}.${team.id}`)[0]);
    const bases = teams.map((team) => field.regions(`${MARKUP.base}.${team.id}`)[0]);
    const spawns = teams.map((team) => field.teamSpawns(team.id));
    const sideOf = sideMap(sides);
    const total = play.setting("playTime") * 20;
    const needed = play.setting("captures");
    const respawn = Math.max(1, play.setting("respawn") * 20);
    const captures = [0, 0];
    /** Who carries each team's wool (by the wool's team), if anyone. */
    const carrier: (Who | undefined)[] = [undefined, undefined];
    const resting = new Set<string>();
    const standWool = (team: number) => setBlock(dimension, woolAt[team], WOOL[team]);
    const takeWool = (team: number) => setBlock(dimension, woolAt[team], "minecraft:air");
    standWool(0);
    standWool(1);
    const startOf = (who: Who) => {
      const side = sideOf.get(who.key) ?? 0;
      return spawns[side][sides[side].indexOf(who)] ?? spawns[side][0];
    };
    const tagged = (who: Who) => {
      const team = carrier.findIndex((one) => one?.key === who.key);
      if (team < 0) return;
      carrier[team] = undefined;
      standWool(team);
      play.say(`${who.name} was tagged: the ${teams[team].name} wool goes home.`);
      resting.add(who.key);
      who.player?.getComponent("minecraft:inventory")?.container?.setItem(0, undefined);
      if (!who.player) botHold(play, who, undefined);
      scope.timeout(() => {
        resting.delete(who.key);
        moveTo(who, play.bodyOf(who), startOf(who));
      }, respawn);
      moveTo(who, play.bodyOf(who), startOf(who));
    };
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (!isPlayer(damagingEntity)) return;
      const attacker = sides.flat().find((who) => who.player?.id === damagingEntity.id);
      const victim = carrier.find((who) => who && play.bodyOf(who)?.id === hitEntity.id);
      if (attacker && victim && sideOf.get(attacker.key) !== sideOf.get(victim.key)) tagged(victim);
    });
    // Each team's bots: the first goes for the wool, the second stays home.
    const roles = new Map(sides.flatMap((side) => side.filter((who) => !who.player).map((who, i) => [who.key, i === 0 ? "raid" : "home"] as const)));
    let winner: number | undefined;
    await everyTick(play, total, (tick) => {
      for (const who of play.inPlay()) {
        if (resting.has(who.key)) continue;
        const body = play.bodyOf(who);
        const side = sideOf.get(who.key);
        if (!body || side === undefined) continue;
        const rival = 1 - side;
        // Take the rival wool, capture at home.
        if (!carrier[rival] && flat(body.location, woolAt[rival]) < TAKE && Math.abs(body.location.y - woolAt[rival].y) < 2) {
          carrier[rival] = who;
          takeWool(rival);
          botArm(play, who);
          play.give(who, item(WOOL[rival], { name: `${teams[rival].name} wool` }), 0);
          play.say(`${who.name} took the ${teams[rival].name} wool.`);
        }
        if (carrier[rival]?.key === who.key && over(bases[side], body.location, 1, 3)) {
          carrier[rival] = undefined;
          captures[side]++;
          standWool(rival);
          who.player?.getComponent("minecraft:inventory")?.container?.setItem(0, undefined);
          if (!who.player) {
            botArm(play, who);
            botHold(play, who, undefined);
          }
          play.say(`${who.name} captured the ${teams[rival].name} wool for ${teams[side].name}.`);
          if (captures[side] >= needed) winner = side;
        }
        if (who.player) continue;
        // Bots.
        const enemyCarrier = carrier[side];
        const enemyBody = enemyCarrier && play.bodyOf(enemyCarrier);
        if (enemyCarrier && enemyBody && flat(body.location, enemyBody.location) < TAG) {
          botLook(play, who, enemyBody.location, true);
          botArm(play, who);
          tagged(enemyCarrier);
          continue;
        }
        let target: Vector3;
        if (carrier[rival]?.key === who.key) target = { x: (bases[side].min.x + bases[side].max.x + 1) / 2, y: bases[side].max.y + 1, z: (bases[side].min.z + bases[side].max.z + 1) / 2 };
        else if (enemyBody && (roles.get(who.key) === "home" || flat(body.location, enemyBody.location) < 8)) target = enemyBody.location;
        else if (roles.get(who.key) === "raid" && !carrier[rival]) target = woolAt[rival];
        else target = woolAt[side];
        botStep(play, who, target, roles.get(who.key) === "raid" ? BOT_RUN * 0.9 : BOT_WALK, 0.4);
      }
      if (tick % 5 === 0) play.status(`${teams[0].color}${teams[0].name} ${captures[0]}  ${teams[1].color}${teams[1].name} ${captures[1]}  §f${clock(total - tick)}`);
      return winner !== undefined;
    });
    return { winner: winner ?? winnerBy(captures) };
  },
};
