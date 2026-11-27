// Enderman Roulette (FFA; docs/plans/block-party-minigames.md). An Enderman stands in front of
// everyone; each round everyone stares at it while it grows restless (particles, a hum), and at a
// hidden moment it snaps, screaming: anyone still looking at it is out. Looking away first is safe,
// and the longer you stared the more you score: the safe players score in the order they looked
// away, the last the most (as many points as players), the first 1. Once you look away you're done
// for the round. Players out place below everyone still in, by when they went out; those still in
// after the last round place by points. Players are held where they stand and only turn. Bots look
// away at a random moment of the round's window, now and then too late.
import { MARKUP } from "./arenas.ts";
import { botFace, botSlip, everyTick, isPlayer, lookAngle, onPlan, placesByOut, spawnIn } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** Ticks between rounds. */
const BETWEEN = 50;
/** How often a bot looks away too late (a Medium bot's: botSlip). */
const BOT_LATE = 0.18;

export const ENDERMAN: MinigameDef = {
  id: "enderman",
  name: "Enderman Roulette",
  kind: "ffa",
  rules: "Stare at the Enderman, and look away before it snaps. The longer you stare, the more you score.",
  tutorial: [
    {
      objective: "Stare at the Enderman and look away before it snaps: anyone still looking is out. The last to look away scores the most.",
      controls: [{ input: "move", what: "You only turn: look away with the mouse or stick" }],
    },
  ],
  ...onPlan("enderman"),
  problem(field) {
    return field.points(MARKUP.enderman)[0] ? undefined : "its arena map has no Enderman";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, dimension } = play;
    const spot = field.points(MARKUP.enderman)[0];
    const head = { x: spot.x, y: spot.y + 2.6, z: spot.z };
    const everyone = play.sides.flat();
    spawnIn(play, "blockparty:enderman", spot, spot.yaw ?? 180, "");
    const rounds = play.setting("rounds");
    const cone = play.setting("cone");
    const snapMin = play.setting("snapMin") * 2;
    const snapMax = Math.max(snapMin + 1, play.setting("snapMax") * 2);
    const points = new Map(everyone.map((who) => [who.key, 0]));
    const outAt = new Map<string, number>();
    // Held where they stand for the whole game: only turning.
    for (const who of everyone) play.freeze(who, (snapMax + BETWEEN + 40) * rounds + 200);
    const looking = (who: (typeof everyone)[number]) => {
      const body = play.bodyOf(who);
      return body ? lookAngle(body, head) <= cone : false;
    };
    for (let round = 1; round <= rounds && !scope.disposed; round++) {
      const left = play.inPlay();
      if (left.length <= 1 && everyone.length > 1) break;
      const snap = snapMin + Math.floor(play.random() * (snapMax - snapMin));
      // Bots stare first, then look away at their moment (some too late).
      const botAway = new Map(left.filter((who) => !who.player).map((who) => [who.key, play.random() < botSlip(play, BOT_LATE) ? snap + 5 : Math.floor(play.random() * snap * 0.95)]));
      for (const who of left) {
        const body = play.bodyOf(who);
        if (body && !isPlayer(body)) botFace(body, head);
      }
      play.notice(`Round ${round}: stare at it...`, 40);
      await scope.wait(30);
      /** Who looked away, in order. */
      const away: string[] = left.filter((who) => !looking(who)).map((who) => who.key);
      await everyTick(play, snap, (tick) => {
        for (const who of play.inPlay()) {
          if (away.includes(who.key)) continue;
          const body = play.bodyOf(who);
          if (!body) continue;
          if (!isPlayer(body)) {
            if (tick >= (botAway.get(who.key) ?? snap)) {
              botFace(body, { x: body.location.x * 2 - head.x, y: body.location.y, z: body.location.z * 2 - head.z });
              away.push(who.key);
            }
            continue;
          }
          if (!looking(who)) away.push(who.key);
        }
        // Restless: more as it goes.
        if (tick % Math.max(2, 10 - Math.floor((tick / snap) * 8)) === 0) {
          try {
            dimension.spawnParticle("minecraft:portal_reverse_particle", { x: spot.x + (play.random() - 0.5), y: spot.y + 1 + play.random() * 2, z: spot.z + (play.random() - 0.5) });
          } catch {
            // unloaded
          }
        }
        if (tick % 20 === 0) dimension.playSound("mob.endermen.idle", spot, { volume: 1 + tick / snap });
        if (tick % 5 === 0) play.status(`Round ${round} of ${rounds}  looked away ${away.length}`);
      });
      if (scope.disposed) break;
      dimension.playSound("mob.endermen.scream", spot, { volume: 3 });
      for (const who of play.inPlay()) {
        if (away.includes(who.key)) continue;
        outAt.set(who.key, round);
        play.out(who);
        play.say(`${who.name} was still looking.`);
      }
      // The safe score in the order they looked away: the first 1, the last the most.
      away.forEach((key, i) => {
        if (!outAt.has(key)) points.set(key, (points.get(key) ?? 0) + i + 1);
      });
      play.status(everyone.map((who) => `${who.name} ${points.get(who.key) ?? 0}`).join("  "));
      await scope.wait(BETWEEN);
    }
    return { places: placesByOut(everyone.map((who) => who.key), outAt, (key) => points.get(key) ?? 0) };
  },
};
