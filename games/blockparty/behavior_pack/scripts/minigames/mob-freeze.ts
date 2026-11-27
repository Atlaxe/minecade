// Mob Freeze (FFA; docs/plans/block-party-minigames.md): Red Light, Green Light. Everyone starts on a
// line facing a Warden at the far end. While it looks away, players creep toward it; it turns around
// after a warning sound, and anyone moving while it watches (the movement keys or stick, or a jump,
// after a short reaction time) goes back to the start line. First over the Finish wins; when time
// runs out the rest place by how close they got. Bots walk while it looks away and stop at the
// warning, now and then a moment late.
import type { Player } from "@minecraft/server";
import { SHOWN } from "../animations.ts";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, botSlip, botStep, botStop, clock, everyTick, flat, moveTo, onPlan, placesBy, spawnIn } from "./common.ts";
import { inOrder, middleOf, over, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** How often a bot stops late (and goes back; a Medium bot's: botSlip). */
const BOT_LATE = 0.15;

function moving(player: Player): boolean {
  try {
    const move = player.inputInfo.getMovementVector();
    return Math.hypot(move.x, move.y) > 0.1 || player.isJumping;
  } catch {
    return false;
  }
}

export const MOB_FREEZE: MinigameDef = {
  id: "mobfreeze",
  name: "Mob Freeze",
  kind: "ffa",
  rules: "Creep toward the Warden while it looks away. Move while it watches and you go back to the start.",
  tutorial: [
    {
      objective: "Creep toward the Warden while it looks away. Freeze when it turns around: anyone it sees moving goes back to the start. First over the Finish wins.",
      controls: [
        { input: "move", what: "Creep toward the mob while it looks away" },
        { input: "sprint", what: "Go faster" },
      ],
    },
  ],
  ...onPlan("mobfreeze"),
  problem(field) {
    if (!field.points(MARKUP.mob)[0]) return "its arena map has no Warden";
    return field.regions(MARKUP.finish)[0] ? undefined : "its arena map has no Finish";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field } = play;
    const spot = field.points(MARKUP.mob)[0];
    const finish = field.regions(MARKUP.finish)[0];
    const goal = middleOf(finish);
    const everyone = play.sides.flat();
    const starts = new Map(everyone.map((who, i) => [who.key, field.spawns[i] ?? field.spawns[0]]));
    const facing = spot.yaw ?? 180;
    const warden = spawnIn(play, "blockparty:warden", spot, facing + 180, "");
    try {
      warden?.setProperty(SHOWN, true);
    } catch {
      // gone
    }
    const tenths = (key: string) => Math.round(play.setting(key) * 2);
    const total = play.setting("playTime") * 20;
    const finished: string[] = [];
    let phase: "away" | "warning" | "watching" = "away";
    let phaseLeft = tenths("awayMin") + Math.floor(play.random() * Math.max(1, tenths("awayMax") - tenths("awayMin")));
    let watched = 0;
    /** Bots that stop late this turn, by key. */
    let late = new Set<string>();
    const turn = (yaw: number) => {
      try {
        warden?.setRotation({ x: 0, y: yaw });
      } catch {
        // gone
      }
    };
    play.notice("Creep up while it looks away!");
    await everyTick(play, total, (tick) => {
      phaseLeft--;
      if (phaseLeft <= 0) {
        if (phase === "away") {
          phase = "warning";
          phaseLeft = Math.max(1, tenths("warning"));
          play.dimension.playSound("mob.warden.heartbeat", spot, { volume: 2 });
          late = new Set(everyone.filter((who) => !who.player && play.random() < botSlip(play, BOT_LATE)).map((who) => who.key));
        } else if (phase === "warning") {
          phase = "watching";
          phaseLeft = tenths("watch");
          watched = 0;
          turn(facing);
          play.dimension.playSound("mob.warden.roar", spot, { volume: 2 });
        } else {
          phase = "away";
          phaseLeft = tenths("awayMin") + Math.floor(play.random() * Math.max(1, tenths("awayMax") - tenths("awayMin")));
          turn(facing + 180);
        }
      }
      if (phase === "watching") watched++;
      for (const who of play.inPlay()) {
        if (finished.includes(who.key)) continue;
        const body = play.bodyOf(who);
        if (!body) continue;
        if (over(finish, body.location)) {
          finished.push(who.key);
          play.say(`${who.name} made it${finished.length === 1 ? " first" : ""}.`);
          botStop(play, who);
          continue;
        }
        // A bot walks while it looks away (and a late one into the first moments of its look).
        if (!who.player) {
          const go = phase === "away" || (late.has(who.key) && (phase === "warning" || watched < tenths("grace") + 6));
          if (go) botStep(play, who, { x: goal.x, y: body.location.y, z: goal.z }, BOT_WALK * 0.8);
          else botStop(play, who);
        }
        if (phase !== "watching" || watched <= tenths("grace")) continue;
        const caught = who.player ? moving(who.player) : late.has(who.key);
        if (!caught) continue;
        late.delete(who.key);
        const start = starts.get(who.key);
        if (start) moveTo(who, body, start);
        play.tell(who, "It saw you move! Back to the start.");
      }
      if (tick % 5 === 0) play.status(`Made it ${finished.length}  ${clock(total - tick)}`);
      return finished.length >= everyone.filter((who) => play.bodyOf(who)).length;
    });
    // Those who made it in order, then the rest by how close they got.
    const gapOf = (key: string) => {
      const who = everyone.find((one) => one.key === key);
      const body = who && play.bodyOf(who);
      return body ? Math.round(flat(body.location, goal) * 10) : 9999;
    };
    const rest = everyone.map((who) => who.key).filter((key) => !finished.includes(key));
    return { places: [...finished.map((key) => [key]), ...placesBy(rest, gapOf, true)] };
  },
};
