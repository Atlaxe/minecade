// Cannon Duel (2v2; docs/plans/block-party-minigames.md): each team has a cannon. The loader fetches
// a cannonball from the team's Ammo pile and loads the cannon (walking to each); the aimer stands at
// the cannon, turns it by looking and fires (a use of the Fire stick: an attack at the air reaches no
// script). A ball that lands in the other team's Target scores. First to the hits wins; at time, more
// hits wins, equal is a draw. The cannon is the spot for now and the ball a snowball thrown hard from
// it. Bots: the loader walks between pile and cannon; the aimer fires with some error.
import { EntityComponentTypes, world, type Vector3 } from "@minecraft/server";
import { MARKUP, PAINTER_TEAMS } from "./arenas.ts";
import { BOT_WALK, botAim, botStep, clock, everyTick, flat, inside, isPlayer, item, now, onPlan, throwFrom, winnerBy } from "./common.ts";
import { middleOf, type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** How close counts as at the pile or the cannon. */
const NEAR = 1.8;
/** A shot's speed, blocks a tick. */
const SHOT = 2.2;

export const CANNONS: MinigameDef = {
  id: "cannons",
  name: "Cannon Duel",
  kind: "2v2",
  rules: "Loader: bring cannonballs from the pile to the cannon. Aimer: aim and fire at the other team's target.",
  tutorial: [
    {
      objective: "One of you loads (walk to your pile, then to the cannon), the other aims by looking and fires with the Fire stick. Land balls in the other team's target. First to the hits wins.",
      controls: [
        { input: "move", what: "Loader: pile to cannon" },
        { input: "use", what: "Aimer: fire the cannon" },
      ],
    },
  ],
  ...onPlan("cannons"),
  problem(field) {
    for (const team of PAINTER_TEAMS) {
      if (!field.points(`${MARKUP.cannon}.${team.id}`)[0]) return `its arena map has no ${team.name} cannon`;
      if (!field.regions(`${MARKUP.target}.${team.id}`)[0]) return `its arena map has no ${team.name} target`;
    }
    return undefined;
  },
  spawns(field, sides) {
    return sides.map((count, side) => field.teamSpawns(PAINTER_TEAMS[side]?.id ?? "").slice(0, count));
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, sides } = play;
    const teams = PAINTER_TEAMS.slice(0, 2);
    const cannons = teams.map((team) => field.points(`${MARKUP.cannon}.${team.id}`)[0]);
    const ammo = teams.map((team, i) => field.points(`${MARKUP.ammo}.${team.id}`)[0] ?? cannons[i]);
    const targets = teams.map((team) => field.regions(`${MARKUP.target}.${team.id}`)[0]);
    const total = play.setting("playTime") * 20;
    const needed = play.setting("hitsToWin");
    const reload = play.setting("reload") * 20;
    const hits = [0, 0];
    const loaded = [false, false];
    const carrying = new Set<string>();
    const readyAt = [0, 0];
    // Roles: the first of each side aims, standing at the cannon; the second loads.
    const aimers = sides.map((side) => side[0]);
    const loaders = sides.map((side) => side[1] ?? side[0]);
    sides.forEach((side, s) => {
      const aimer = aimers[s];
      const body = play.bodyOf(aimer);
      if (body && cannons[s]) body.teleport(cannons[s], { rotation: { x: 0, y: cannons[s].yaw ?? 0 } });
      play.freeze(aimer, total + 100);
      play.give(aimer, item("minecraft:carrot_on_a_stick", { name: "Fire" }), 0);
      if (side.length > 1) play.tell(loaders[s], "You load: pile, then cannon.", 60);
      play.tell(aimer, "You aim: look and fire.", 60);
    });
    const balls = new Map<string, number>();
    const fire = (s: number, at: Vector3) => {
      if (!loaded[s] || now() < readyAt[s]) return;
      const body = play.bodyOf(aimers[s]);
      if (!body) return;
      loaded[s] = false;
      readyAt[s] = now() + reload;
      const ball = throwFrom(play, body, at, { speed: SHOT, lift: 0.1 });
      if (ball) balls.set(ball.id, s);
      play.dimension.playSound("random.explode", body.location, { volume: 0.6, pitch: 1.6 });
    };
    // The aimer's Fire: along where they look.
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (itemStack.typeId !== "minecraft:carrot_on_a_stick") return;
      const s = aimers.findIndex((who) => who.player?.id === source.id);
      if (s < 0) return;
      const view = source.getViewDirection();
      fire(s, { x: source.location.x + view.x * 30, y: source.location.y + 1.5 + view.y * 30, z: source.location.z + view.z * 30 });
    });
    const landed = (id: string, at: Vector3) => {
      const s = balls.get(id);
      if (s === undefined) return;
      balls.delete(id);
      // Each team shoots at its own Target: the box in front of the other team.
      if (inside(targets[s], at, 1)) {
        hits[s]++;
        play.say(`${teams[s].name} hit the target.`);
      }
    };
    scope.subscribe(world.afterEvents.projectileHitBlock, (event) => landed(event.projectile.id, event.location));
    scope.subscribe(world.afterEvents.projectileHitEntity, (event) => landed(event.projectile.id, event.location));
    let winner: number | undefined;
    await everyTick(play, total, (tick) => {
      for (let s = 0; s < sides.length; s++) {
        const loader = loaders[s];
        const body = play.bodyOf(loader);
        if (!body) continue;
        // The loader picks up at the pile and loads at the cannon.
        if (!carrying.has(loader.key) && !loaded[s] && flat(body.location, ammo[s]) < NEAR) {
          carrying.add(loader.key);
          if (loader.player) play.give(loader, item("minecraft:fire_charge", { name: "Cannonball" }), 1);
        } else if (carrying.has(loader.key) && flat(body.location, cannons[s]) < NEAR + 0.5) {
          carrying.delete(loader.key);
          loaded[s] = true;
          loader.player?.getComponent(EntityComponentTypes.Inventory)?.container?.setItem(1, undefined);
          play.tell(aimers[s], "Loaded!", 30);
        }
        if (!isPlayer(body) && loader !== aimers[s]) botStep(play, loader, carrying.has(loader.key) ? cannons[s] : loaded[s] ? cannons[s] : ammo[s], BOT_WALK, 1);
        // A bot aimer fires at the target with some error (a Medium bot's 4 blocks wide: botAim).
        const aimer = aimers[s];
        const aimBody = play.bodyOf(aimer);
        if (aimBody && !isPlayer(aimBody) && loaded[s] && now() >= readyAt[s]) {
          const goal = middleOf(targets[s]);
          const gap = flat(aimBody.location, goal);
          const spread = botAim(play, 4);
          fire(s, { x: goal.x + (play.random() - 0.5) * spread, y: goal.y + gap * 0.08, z: goal.z + (play.random() - 0.5) * spread });
        }
      }
      // A one-player side (a bot) loads itself after the reload.
      for (let s = 0; s < sides.length; s++) if (loaders[s] === aimers[s] && !loaded[s] && now() >= readyAt[s]) loaded[s] = true;
      if (hits[0] >= needed) winner = 0;
      else if (hits[1] >= needed) winner = 1;
      if (tick % 5 === 0) play.status(`${teams[0].color}Red ${hits[0]}  ${teams[1].color}Blue ${hits[1]}  §f${clock(total - tick)}`);
      return winner !== undefined;
    });
    return { winner: winner ?? winnerBy(hits) };
  },
};
