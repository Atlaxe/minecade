// Tug of War (2v2; docs/plans/block-party-minigames.md): both teams hold one rope stretched over a
// pool, Red at one end and Blue at the other, everyone watching through one camera from the side.
// Press jump as fast as you can: every press is a tug toward your end. Teammates pressing within a
// moment of each other both pull harder. The flag in the rope's middle slides toward the team pulling
// harder; pull it far enough your way and the other team is dragged into the water. At time, the team
// the flag is nearer wins; dead center is a draw. The players are held on the rope and moved with it
// (their jump is off); the rope is particles and the flag the board's coin, for now. Bots press 6 to
// 9 times a second, in time with their teammate about half the time (a Medium bot; the lobby's level
// moves both).
import { ButtonState, InputButton, world, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP, PAINTER_TEAMS } from "./arenas.ts";
import { botJump, botOdds, botWait, clock, everyTick, now, onPlan, sideMap, spawnIn } from "./common.ts";
import { type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** How much of the gap to its target the flag closes each tick (it slides). */
const SLIDE = 0.25;
/** The gap between teammates on the rope, and from the flag to the first of each team. */
const SPACING = 1.6;
const FIRST = 3;

export const TUG_OF_WAR: MinigameDef = {
  id: "tugofwar",
  name: "Tug of War",
  kind: "2v2",
  rules: "Press jump as fast as you can to pull the rope your way. Tug together for a stronger pull.",
  tutorial: [
    {
      objective: "Press jump as fast as you can: each press tugs the rope your way. Press together with your teammate to pull harder. Drag the other team into the water.",
      controls: [{ input: "jump", what: "Tug: as fast as you can, with your teammate" }],
    },
  ],
  ...onPlan("tugofwar"),
  problem(field) {
    return field.regions(MARKUP.rope)[0] ? undefined : "its arena map has no Rope";
  },
  spawns(field, sides) {
    return sides.map((count, side) => field.teamSpawns(PAINTER_TEAMS[side]?.id ?? "").slice(0, count));
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, sides, dimension } = play;
    const rope = field.regions(MARKUP.rope)[0];
    const sideOf = sideMap(sides);
    const total = play.setting("playTime") * 20;
    const pullToWin = play.setting("pullToWin");
    const tugPull = play.setting("tugPull") / 100;
    const together = play.setting("together") * 2;
    const boost = play.setting("togetherBoost") / 100;
    // The rope's long way, and which end is Red's (the one nearer Red's spawns).
    const alongX = rope.max.x - rope.min.x >= rope.max.z - rope.min.z;
    const middle = { x: (rope.min.x + rope.max.x + 1) / 2, y: rope.min.y, z: (rope.min.z + rope.max.z + 1) / 2 };
    const redSpawn = field.teamSpawns(PAINTER_TEAMS[0].id)[0];
    const redSign = redSpawn ? Math.sign((alongX ? redSpawn.x - middle.x : redSpawn.z - middle.z) || -1) : -1;
    /** Where on the rope (blocks along it from the middle, Red's way negative times redSign). */
    const pointAt = (offset: number): Vector3 => (alongX ? { x: middle.x + offset, y: middle.y, z: middle.z } : { x: middle.x, y: middle.y, z: middle.z + offset });
    /** The flag's place: how far toward Red's end it is (negative: toward Blue). */
    let flag = 0;
    let target = 0;
    const lastTug = new Map<string, number>();
    const tugs = [0, 0];
    const marker = spawnIn(play, "blockparty:coin", pointAt(0), undefined, "");
    // Everyone on the rope, held there; the camera from the side.
    const camera = field.points(MARKUP.tugCamera)[0];
    const view = camera ?? (alongX ? { x: middle.x, y: middle.y + 6, z: middle.z - 14, yaw: 0, pitch: 15 } : { x: middle.x - 14, y: middle.y + 6, z: middle.z, yaw: -90, pitch: 15 });
    for (const who of sides.flat()) {
      play.freeze(who, total + 200);
      try {
        who.player?.camera.setCamera("minecraft:free", { location: view, rotation: { x: view.pitch ?? 15, y: view.yaw ?? 0 } });
      } catch {
        // gone
      }
    }
    const place = () => {
      sides.forEach((side, s) =>
        side.forEach((who, i) => {
          const body = play.bodyOf(who);
          if (!body) return;
          // Red stands toward its end (redSign), Blue the other way, the flag between them.
          const sign = s === 0 ? redSign : -redSign;
          const spot = pointAt(flag * redSign + sign * (FIRST + i * SPACING));
          if (Math.hypot(body.location.x - spot.x, body.location.z - spot.z) > 0.08) {
            try {
              body.teleport({ x: spot.x, y: body.location.y, z: spot.z }, { rotation: { x: 0, y: alongX ? (sign > 0 ? 90 : -90) : sign > 0 ? 180 : 0 } });
              if (!who.player) body.clearVelocity();
            } catch {
              // gone
            }
          }
        }),
      );
      try {
        if (marker?.isValid) marker.teleport(pointAt(flag * redSign));
      } catch {
        // gone
      }
    };
    const tug = (who: Who) => {
      const side = sideOf.get(who.key);
      if (side === undefined) return;
      const mate = sides[side].find((one) => one.key !== who.key);
      const inTime = mate !== undefined && now() - (lastTug.get(mate.key) ?? -999) <= together;
      lastTug.set(who.key, now());
      tugs[side]++;
      const pull = tugPull * (inTime ? boost : 1);
      target += side === 0 ? pull : -pull;
    };
    scope.subscribe(world.afterEvents.playerButtonInput, ({ player, button, newButtonState }) => {
      if (button !== InputButton.Jump || newButtonState !== ButtonState.Pressed) return;
      const who = sides.flat().find((one) => one.player?.id === player.id);
      if (who) tug(who);
    });
    const nextBot = new Map(sides.flat().filter((who) => !who.player).map((who) => [who.key, 2]));
    let winner: number | undefined;
    await everyTick(play, total, (tick) => {
      for (const who of sides.flat()) {
        if (who.player || tick < (nextBot.get(who.key) ?? 0)) continue;
        tug(who);
        // A tug is a jump, as a player's: a hop whenever it's on the ground.
        const body = play.bodyOf(who);
        if (body) botJump(body);
        // In time with a teammate about half the time (a Medium bot's: botWait and botOdds).
        const side = sideOf.get(who.key) ?? 0;
        const mate = sides[side].find((one) => one.key !== who.key && !one.player);
        // At most 10 presses a second, as fast as a quick player: a Hard bot's waits would come out 1 or 2 ticks.
        nextBot.set(who.key, tick + Math.max(2, botWait(play, 2 + Math.floor(play.random() * 2))));
        if (mate && play.random() < botOdds(play, 0.5)) nextBot.set(mate.key, tick + 1);
      }
      flag += (target - flag) * SLIDE;
      place();
      if (tick % 3 === 0) {
        for (let d = -pullToWin - FIRST - 2; d <= pullToWin + FIRST + 2; d += 0.7) {
          try {
            const at = pointAt(d);
            dimension.spawnParticle("minecraft:villager_happy", { x: at.x, y: at.y + 1, z: at.z });
          } catch {
            // unloaded
          }
        }
      }
      if (Math.abs(flag) >= pullToWin) {
        winner = flag > 0 ? 0 : 1;
        return true;
      }
      if (tick % 5 === 0) play.status(`${PAINTER_TEAMS[0].color}Red ${tugs[0]}  ${PAINTER_TEAMS[1].color}Blue ${tugs[1]}  §f${clock(total - tick)}`);
    });
    if (winner !== undefined) {
      // The losers are dragged in.
      const losers = sides[1 - winner];
      play.say(`${winner === 0 ? "Red" : "Blue"} pulled ${losers.map((who) => who.name).join(" and ")} into the water.`);
      for (const who of losers) {
        try {
          play.bodyOf(who)?.teleport({ x: middle.x, y: middle.y + 1, z: middle.z });
        } catch {
          // gone
        }
      }
      await scope.wait(30);
      return { winner };
    }
    const near = Math.round(flag * 10);
    return { winner: near === 0 ? undefined : near > 0 ? 0 : 1 };
  },
};
