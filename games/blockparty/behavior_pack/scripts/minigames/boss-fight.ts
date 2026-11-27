// Boss Fight (1v3; docs/plans/block-party-minigames.md): the solo is the Wither: flying (jump to rise,
// falling slowly) and firing skulls (the Skull stick, a use); its health is its own (the Wither's
// health setting), shown on everyone's line. The trio each have hearts and lives, with bows and
// swords. As its health falls the Wither loses its powers in turn: below the first mark no more blue
// (dangerous) skulls, below the second no more black ones, below the third it can't fly. The trio win
// by bringing its health to nothing; the Wither wins when the trio are all out or time runs out.
// Real damage; skull blasts break no blocks. For now the Wither is the player as they are (the Wither
// form and a boss bar come with their spikes, pieces 22 and 23). Bots: the Wither hovers and fires at
// the nearest player; the trio shoot from range and close in to hit.
import { ButtonState, InputButton, world } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { botAim, botStep, botWait, clock, everyTick, fellOut, flat, floorOf, grounded, Hearts, isPlayer, item, moveTo, nearestOf, now, onPlan, throwFrom, wear } from "./common.ts";
import { type MinigameDef, type Outcome, type Play } from "./kit.ts";

/** Ticks between the Wither's skulls (a player's and a bot's), and a bot trio's arrows (the bots' a Medium bot's: botWait). */
const SKULL_EVERY = 16;
const BOT_SKULL_EVERY = 40;
const BOT_ARROW_EVERY = 30;
/** A rise's push, and how high a bot Wither hovers over the floor. */
const RISE = 0.55;
const HOVER = 4;
/** Ticks a trio member who went down waits before coming back. */
const BACK_AFTER = 40;

export const BOSS_FIGHT: MinigameDef = {
  id: "bossfight",
  name: "Boss Fight",
  kind: "1v3",
  rules: "Wither: fly, fire skulls and take the trio down. Trio: bring the Wither's health to nothing.",
  tutorial: [
    {
      objective: "You're the Wither: jump to rise, fire skulls and take the trio down before time. As your health falls you lose your blue skulls, then your black ones, then flight.",
      controls: [
        { input: "use", what: "Fire a skull" },
        { input: "jump", what: "Rise" },
        { input: "attack", what: "Hit" },
      ],
    },
    {
      objective: "Bring the Wither's health to nothing before time. You have a few lives each.",
      controls: [
        { input: "attack", what: "Hit" },
        { input: "use", what: "Shoot" },
        { input: "move", what: "Dodge the skulls" },
      ],
    },
  ],
  ...onPlan("bossfight"),
  problem(field) {
    return field.points(MARKUP.boss)[0] ? undefined : "its arena map has no Boss spawn";
  },
  spawns(field, sides) {
    return [field.points(MARKUP.boss).slice(0, sides[0] ?? 1), field.points(MARKUP.trio).slice(0, sides[1] ?? 0)];
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, sides, dimension } = play;
    const [bosses, trio] = sides;
    const boss = bosses[0];
    const trioSpawns = field.points(MARKUP.trio);
    const total = play.setting("playTime") * 20;
    const maxHealth = play.setting("bossHealth");
    const lives = new Map(trio.map((who) => [who.key, play.setting("trioLives")]));
    const marks = { blue: play.setting("loseBlue") / 100, black: play.setting("loseBlack") / 100, flight: play.setting("loseFlight") / 100 };
    const floorY = floorOf(trioSpawns, field);
    let health = maxHealth;
    let bossDown = false;
    const resting = new Set<string>();
    const out = (who: Who) => {
      if (play.isOut(who)) return;
      play.out(who);
      play.say(`${who.name} is out.`);
    };
    const trioDown = (who: Who) => {
      if (who === boss || resting.has(who.key)) return;
      const left = (lives.get(who.key) ?? 1) - 1;
      lives.set(who.key, left);
      if (left <= 0) return out(who);
      resting.add(who.key);
      play.tell(who, `Down! ${left} ${left === 1 ? "life" : "lives"} left.`, 40);
      const spawn = trioSpawns[trio.indexOf(who)] ?? trioSpawns[0];
      moveTo(who, play.bodyOf(who), spawn);
      play.freeze(who, BACK_AFTER);
      scope.timeout(() => {
        hearts.heal(who);
        resting.delete(who.key);
      }, BACK_AFTER);
    };
    const hurtBoss = (amount: number) => {
      if (bossDown) return;
      health = Math.max(0, health - amount);
      if (health <= 0) {
        bossDown = true;
        play.say(`The Wither (${boss.name}) is down.`);
      }
    };
    const hearts = new Hearts(play, (who) => (who === boss ? undefined : trioDown(who)));
    // Hits on the Wither go into its own health; its vanilla hearts stay whole.
    play.onHurt((victim, damage) => {
      if (victim !== boss) return undefined;
      hurtBoss(damage);
      return 0;
    });
    // A bot Wither takes hits through its script hearts: mirror them into its health.
    if (!boss.player) hearts.setMax(boss, 1000);
    play.give(boss, item("minecraft:carrot_on_a_stick", { name: "Skull" }), 0);
    for (const who of trio) {
      play.give(who, item("minecraft:iron_sword"), 0);
      play.give(who, item("minecraft:bow"), 1);
      play.give(who, item("minecraft:arrow", { amount: 64, free: true }), 2);
      wear(who, { chest: "minecraft:chainmail_chestplate" });
    }
    const share = () => health / maxHealth;
    const flying = () => share() >= marks.flight;
    const effects = () => {
      try {
        if (flying()) boss.player?.addEffect("slow_falling", 60, { showParticles: false });
        else boss.player?.removeEffect("slow_falling");
      } catch {
        // gone
      }
    };
    let lastSkull = 0;
    const fireSkull = (at: { x: number; y: number; z: number }) => {
      if (now() - lastSkull < SKULL_EVERY) return;
      const body = play.bodyOf(boss);
      if (!body) return;
      // Blue (dangerous) while it has them, then black, then none.
      const type = share() >= marks.blue && Math.floor(now() / SKULL_EVERY) % 3 === 0 ? "minecraft:wither_skull_dangerous" : share() >= marks.black ? "minecraft:wither_skull" : undefined;
      if (!type) return;
      lastSkull = now();
      throwFrom(play, body, at, { type, speed: 1.2, lift: 0 });
    };
    const griefing = world.gameRules.mobGriefing;
    world.gameRules.mobGriefing = false;
    scope.add(() => (world.gameRules.mobGriefing = griefing));
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (itemStack.typeId !== "minecraft:carrot_on_a_stick" || boss.player?.id !== source.id) return;
      const view = source.getViewDirection();
      fireSkull({ x: source.location.x + view.x * 20, y: source.location.y + 1.5 + view.y * 20, z: source.location.z + view.z * 20 });
    });
    scope.subscribe(world.afterEvents.playerButtonInput, ({ player, button, newButtonState }) => {
      if (button !== InputButton.Jump || newButtonState !== ButtonState.Pressed || boss.player?.id !== player.id || !flying()) return;
      try {
        player.applyKnockback({ x: 0, z: 0 }, RISE);
      } catch {
        // gone
      }
    });
    const lastArrow = new Map<string, number>();
    let lastBotSkull = 0;
    await everyTick(play, total, (tick) => {
      if (tick % 20 === 0) effects();
      // A bot Wither's script hearts are its health.
      if (!boss.player) {
        const lost = 1000 - hearts.health(boss);
        if (lost > 0) {
          hearts.setMax(boss, 1000);
          hurtBoss(lost);
        }
      }
      const bossBody = play.bodyOf(boss);
      if (bossBody && fellOut(field, bossBody, floorY)) moveTo(boss, bossBody, field.points(MARKUP.boss)[0]);
      if (bossBody && !isPlayer(bossBody) && !bossDown) {
        const prey = nearestOf(play, bossBody.location, trio.filter((who) => !resting.has(who.key)));
        // Hover a few blocks up while it can fly, toward the nearest player.
        try {
          if (flying() && bossBody.location.y < floorY + 1 + HOVER) bossBody.applyImpulse({ x: 0, y: 0.12, z: 0 });
        } catch {
          // gone
        }
        if (prey) {
          if (prey.gap > 6) botStep(play, boss, prey.body.location, 0.16, 5);
          if (tick - lastBotSkull >= botWait(play, BOT_SKULL_EVERY)) {
            lastBotSkull = tick;
            lastSkull = 0;
            fireSkull({ x: prey.body.location.x, y: prey.body.location.y + 1, z: prey.body.location.z });
          }
          if (!flying() || prey.gap < 2.4) hearts.botSwing(boss, [prey.who], 6, trioDown);
        }
      }
      for (const who of trio) {
        const body = play.bodyOf(who);
        if (!body || play.isOut(who) || resting.has(who.key)) continue;
        if (fellOut(field, body, floorY)) {
          trioDown(who);
          continue;
        }
        if (isPlayer(body) || !bossBody) continue;
        // A bot: arrows from range, a hit up close.
        const gap = flat(body.location, bossBody.location);
        if (gap < 2.6 && grounded(bossBody)) {
          if (hearts.botSwing(who, [boss], 0, trioDown)) hurtBoss(5);
        } else if (tick - (lastArrow.get(who.key) ?? -99) >= botWait(play, BOT_ARROW_EVERY)) {
          lastArrow.set(who.key, tick);
          throwFrom(play, body, { x: bossBody.location.x, y: bossBody.location.y + 1.2, z: bossBody.location.z }, { type: "minecraft:arrow", speed: 2, error: botAim(play, 1) });
        }
        botStep(play, who, bossBody.location, 0.2, gap < 8 ? 7 : 2);
      }
      if (tick % 5 === 0) play.status(`Wither ${Math.ceil(health)} of ${maxHealth}  ${clock(total - tick)}`);
      return bossDown || trio.every((who) => play.isOut(who));
    });
    return { winner: bossDown ? 1 : 0 };
  },
};
