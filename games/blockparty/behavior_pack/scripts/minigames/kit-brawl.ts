// Kit Brawl (FFA, and 2v2 by its teams; docs/plans/block-party-minigames.md): everyone gets the same
// kit, picked at random by weight from the kit file (games/blockparty/minigames/kitbrawl.json) each
// time, and fights. Real damage: out at no hearts, or a fall (Kill Y). Last one in wins; at time the
// rest place by hearts left, then by when they went out. Bots walk at the nearest player and hit
// about twice a second, as hard as the kit's first item; with a bow in the kit they shoot it from
// range too (drawn, then let go: botShoot), as many arrows as the kit gives.
import type { Who } from "../bots.ts";
import file from "../../../minigames/kitbrawl.json";
import { botAim, botDrawing, botShoot, botStep, botWait, byWeight, clock, everyTick, fellOut, floorOf, Hearts, item, nearestOf, onPlan, placesByOut, sideMap, wear, type Armor } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play } from "./kit.ts";

export interface Kit {
  name: string;
  weight?: number;
  items: { id: string; amount?: number }[];
  armor?: Armor;
}

export const KITS: readonly Kit[] = file.kits;

/** How far off a bot shoots its bow (blocks), and ticks between its shots (each a Medium bot's: botAim, botWait). */
const BOT_BOW_ERROR = 1;
const BOT_BOW_EVERY = 40;
/** How far a foe is for a bot to shoot rather than close in (blocks): nearer than this it fights hand to hand. */
const BOW_FROM = 5;
const BOW_TO = 18;

/** A bot's hit with a kit's first item, in half hearts. */
function botDamage(kit: Kit): number {
  const id = kit.items[0]?.id ?? "";
  if (id.includes("diamond")) return 7;
  if (id.includes("iron")) return 6;
  if (id.includes("stone")) return 5;
  if (id.includes("_sword") || id.includes("_axe")) return 4;
  return 2;
}

export const KIT_BRAWL: MinigameDef = {
  id: "kitbrawl",
  name: "Kit Brawl",
  kind: "ffa",
  rules: "Everyone gets the same kit. Fight: out at no hearts. Last one in wins.",
  tutorial: [
    {
      objective: "Everyone gets the same kit. Fight for real: lose all your hearts and you're out. Last one in wins.",
      controls: [
        { input: "attack", what: "Hit" },
        { input: "move", what: "Close in, or back off" },
        { input: "use", what: "Shoot a bow, eat food" },
      ],
    },
  ],
  ...onPlan("kitbrawl"),
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, sides } = play;
    const everyone = sides.flat();
    const total = play.setting("playTime") * 20;
    const floorY = floorOf(field.spawns, field);
    const kit = byWeight(KITS, play.random);
    const sideOf = sideMap(sides);
    const outAt = new Map<string, number>();
    let tick = 0;
    const out = (who: Who, why: string) => {
      if (play.isOut(who)) return;
      outAt.set(who.key, tick);
      play.out(who);
      play.say(`${who.name} ${why}.`);
    };
    const hearts = new Hearts(play, (who) => out(who, "is out"));
    for (const who of everyone) {
      kit.items.forEach((each, slot) => play.give(who, item(each.id, { amount: each.amount, free: true }), slot));
      if (kit.armor) wear(who, kit.armor);
    }
    play.notice(`Kit: ${kit.name}`);
    const foesOf = (who: Who) => play.inPlay().filter((one) => sideOf.get(one.key) !== sideOf.get(who.key));
    // A bow in the kit: each bot's arrows, and when it last shot.
    const bow = kit.items.some((each) => each.id === "minecraft:bow");
    const arrows = new Map(everyone.map((who) => [who.key, bow ? kit.items.filter((each) => each.id === "minecraft:arrow").reduce((sum, each) => sum + (each.amount ?? 1), 0) : 0]));
    const lastShot = new Map<string, number>();
    const sidesLeft = () => new Set(play.inPlay().map((who) => sideOf.get(who.key))).size;
    await everyTick(play, total, (t) => {
      tick = t;
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        if (!body) continue;
        if (fellOut(field, body, floorY)) {
          out(who, "fell");
          continue;
        }
        if (who.player || botDrawing(who)) continue;
        if (!hearts.botSwing(who, foesOf(who), botDamage(kit), (one) => out(one, "is out"))) {
          const foe = nearestOf(play, body.location, foesOf(who));
          if (!foe) continue;
          const left = arrows.get(who.key) ?? 0;
          if (left > 0 && foe.gap > BOW_FROM && foe.gap < BOW_TO && t - (lastShot.get(who.key) ?? -999) >= botWait(play, BOT_BOW_EVERY)) {
            const at = () => {
              const now = play.bodyOf(foe.who);
              return now && !play.isOut(foe.who) ? { x: now.location.x, y: now.location.y + 1.2, z: now.location.z } : undefined;
            };
            if (botShoot(play, who, at, { error: botAim(play, BOT_BOW_ERROR) })) {
              lastShot.set(who.key, t);
              arrows.set(who.key, left - 1);
              continue;
            }
          }
          botStep(play, who, foe.body.location, 0.22, 1.8);
        }
      }
      if (t % 5 === 0) play.status(`${play.inPlay().length} left  ${clock(total - t)}`);
      return everyone.length > 1 ? sidesLeft() <= 1 : play.inPlay().length === 0;
    });
    if (sides.every((side) => side.length === 1)) return { places: placesByOut(everyone.map((who) => who.key), outAt, (key) => hearts.health(everyone.find((who) => who.key === key)!)) };
    // Teams: the side with someone still in, else more hearts left.
    const health = sides.map((side) => side.filter((who) => !play.isOut(who)).reduce((sum, who) => sum + hearts.health(who) + 100, 0));
    return { winner: health[0] === health[1] ? undefined : health[0] > health[1] ? 0 : 1 };
  },
};
