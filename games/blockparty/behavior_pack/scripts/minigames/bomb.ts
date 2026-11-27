// Bomb Disposal (1v3; docs/plans/block-party-minigames.md): 1. Plant: the trio wait shut in their
// room while the Bomber walks the arena and plants the bombs, each at a Bomb site (jump, or use a
// block, at a site); any left unplanted when time's up go to random sites. 2. Defuse: the room opens
// and the trio hunt for the bombs, which tick. Standing at a bomb defuses it (twice as fast with two),
// its progress on the defusers' own line; the Bomber's hit freezes a defuser and loses that bomb's
// progress. 3. The trio win by defusing them all before the fuse runs out; otherwise the Bomber
// wins. The bombs are TNT blocks for now. Bots: the Bomber plants at random sites, then hunts
// defusers; the squad heads for the nearest bomb.
import { ButtonState, InputButton, world, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, blockId, blocksOf, botStep, clock, everyTick, flat, isPlayer, nearestOf, onPlan, pick, setBlock, shuffled } from "./common.ts";
import { type MinigameDef, type Outcome, type Play, type Spot } from "./kit.ts";

const BOMB = "minecraft:tnt";
/** How close counts as at a site, or at a bomb. */
const AT_SITE = 1.6;
/** A bot bomber's hit reach and pause. */
const BOT_TAG = 2;
const BOT_TAG_EVERY = 20;

interface Bomb {
  at: Spot;
  /** Ticks of defusing done. */
  done: number;
  defused: boolean;
}

export const BOMB_DISPOSAL: MinigameDef = {
  id: "bomb",
  name: "Bomb Disposal",
  kind: "1v3",
  rules: "Bomber: plant the bombs, then stop the defusers. Squad: find every bomb and defuse it in time.",
  tutorial: [
    {
      objective: "Plant your bombs at the bomb sites while the squad is shut in: jump at a site. Then hit any defuser to freeze them and undo their work.",
      controls: [
        { input: "jump", what: "Plant a bomb at a site" },
        { input: "attack", what: "Freeze a defuser" },
      ],
    },
    {
      objective: "Find the bombs by their ticking and stand at each to defuse it, faster with two of you. Defuse them all before they blow.",
      controls: [{ input: "move", what: "Find the bombs, stand at one to defuse it" }],
    },
  ],
  ...onPlan("bomb"),
  problem(field) {
    if (field.points(MARKUP.bombSites).length < 1) return "its arena map has no Bomb sites";
    return field.points(MARKUP.bomber)[0] ? undefined : "its arena map has no Bomber spawn";
  },
  spawns(field, sides) {
    return [field.points(MARKUP.bomber).slice(0, sides[0] ?? 1), field.points(MARKUP.squad).slice(0, sides[1] ?? 0)];
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope, sides, dimension } = play;
    const [bombers, squad] = sides;
    const bomber = bombers[0];
    const sites = field.points(MARKUP.bombSites);
    const room = field.regions(MARKUP.squadRoom)[0];
    const plantTime = play.setting("plantTime") * 20;
    const fuse = play.setting("fuse") * 20;
    const count = Math.min(play.setting("bombs"), sites.length);
    const defuseTime = play.setting("defuseTime") * 20;
    const freeze = play.setting("freeze") * 20;
    const bombs: Bomb[] = [];
    const frozenUntil = new Map<string, number>();
    let tickNow = 0;
    const plantAt = (site: Spot) => {
      if (bombs.length >= count || bombs.some((bomb) => bomb.at === site)) return;
      bombs.push({ at: site, done: 0, defused: false });
      setBlock(dimension, site, BOMB);
      dimension.playSound("random.click", site);
      if (bombs.length < count) play.tell(bomber, `Planted ${bombs.length} of ${count}.`, 30);
    };
    const siteNear = (at: Vector3) => sites.find((site) => flat(site, at) < AT_SITE && Math.abs(site.y - at.y) < 2 && !bombs.some((bomb) => bomb.at === site));
    let planting = true;
    scope.subscribe(world.afterEvents.playerButtonInput, ({ player, button, newButtonState }) => {
      if (!planting || button !== InputButton.Jump || newButtonState !== ButtonState.Pressed || play.bodyOf(bomber)?.id !== player.id) return;
      const site = siteNear(player.location);
      if (site) plantAt(site);
    });
    scope.subscribe(world.afterEvents.playerInteractWithBlock, ({ player, block }) => {
      if (!planting || play.bodyOf(bomber)?.id !== player.id) return;
      const site = siteNear({ x: block.location.x + 0.5, y: block.location.y + 1, z: block.location.z + 0.5 });
      if (site) plantAt(site);
    });
    // The Bomber's hit freezes a defuser and loses that bomb's progress.
    const tag = (who: Who) => {
      if (planting || (frozenUntil.get(who.key) ?? 0) > tickNow) return;
      frozenUntil.set(who.key, tickNow + freeze);
      play.freeze(who, freeze);
      const body = play.bodyOf(who);
      for (const bomb of bombs) if (body && !bomb.defused && flat(body.location, bomb.at) < AT_SITE) bomb.done = 0;
      play.tell(who, "Frozen!", freeze);
    };
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (!isPlayer(damagingEntity) || play.bodyOf(bomber)?.id !== damagingEntity.id) return;
      const who = squad.find((one) => play.bodyOf(one)?.id === hitEntity.id);
      if (who) tag(who);
    });
    // 1. Plant: the trio held in their room.
    for (const who of squad) play.freeze(who, plantTime);
    play.notice(`${bomber.name} plants ${count} bombs. The squad waits.`, 60);
    const botSites = shuffled(sites, play.random).slice(0, count);
    await everyTick(play, plantTime, (tick) => {
      tickNow = tick;
      const body = play.bodyOf(bomber);
      if (body && !isPlayer(body)) {
        const next = botSites.find((site) => !bombs.some((bomb) => bomb.at === site));
        if (next && botStep(play, bomber, next, BOT_WALK * 1.2, 0.8)) plantAt(next);
      }
      if (tick % 5 === 0) play.status(`Planting: ${bombs.length} of ${count}  ${clock(plantTime - tick)}`);
      return bombs.length >= count;
    });
    planting = false;
    while (bombs.length < count) {
      const free = sites.filter((site) => !bombs.some((bomb) => bomb.at === site));
      if (free.length === 0) break;
      plantAt(pick(free, play.random));
    }
    // The room opens: its walls at the two lowest layers go.
    if (room) {
      const ring = blocksOf({ min: { x: room.min.x - 1, y: room.min.y, z: room.min.z - 1 }, max: { x: room.max.x + 1, y: room.min.y + 1, z: room.max.z + 1 } });
      for (const at of ring) {
        const inner = at.x >= room.min.x && at.x <= room.max.x && at.z >= room.min.z && at.z <= room.max.z;
        if (!inner && blockId(dimension, at) !== "minecraft:air") setBlock(dimension, at, "minecraft:air");
      }
    }
    play.notice("Find the bombs!", 40);
    // 2. Defuse.
    let lastBotTag = 0;
    await everyTick(play, fuse, (tick) => {
      tickNow = plantTime + tick;
      if (tick % 20 === 0) for (const bomb of bombs) if (!bomb.defused) dimension.playSound("random.click", bomb.at, { volume: 1.5 });
      for (const bomb of bombs) {
        if (bomb.defused) continue;
        const at = squad.filter((who) => {
          const body = play.bodyOf(who);
          return body && (frozenUntil.get(who.key) ?? 0) <= tickNow && flat(body.location, bomb.at) < AT_SITE && Math.abs(body.location.y - bomb.at.y) < 2;
        });
        if (at.length === 0) continue;
        bomb.done += at.length >= 2 ? 2 : 1;
        for (const who of at) play.tell(who, `Defusing: ${Math.min(100, Math.round((bomb.done / defuseTime) * 100))}%`, 10);
        if (bomb.done >= defuseTime) {
          bomb.defused = true;
          setBlock(dimension, bomb.at, "minecraft:air");
          play.say(`${at.map((who) => who.name).join(" and ")} defused a bomb.`);
        }
      }
      // Bots: the squad to the nearest live bomb; the Bomber after the nearest defuser.
      const live = bombs.filter((bomb) => !bomb.defused);
      for (const who of squad) {
        const body = play.bodyOf(who);
        if (!body || isPlayer(body) || (frozenUntil.get(who.key) ?? 0) > tickNow) continue;
        let best: Bomb | undefined;
        for (const bomb of live) if (!best || flat(body.location, bomb.at) < flat(body.location, best.at)) best = bomb;
        if (best) botStep(play, who, best.at, BOT_WALK, 0.6);
      }
      const bomberBody = play.bodyOf(bomber);
      if (bomberBody && !isPlayer(bomberBody)) {
        const prey = nearestOf(play, bomberBody.location, squad.filter((who) => (frozenUntil.get(who.key) ?? 0) <= tickNow));
        if (prey && prey.gap < BOT_TAG && tick - lastBotTag >= BOT_TAG_EVERY) {
          lastBotTag = tick;
          tag(prey.who);
        } else if (prey) botStep(play, bomber, prey.body.location, BOT_WALK * 1.1, 1.2);
      }
      if (tick % 5 === 0) play.status(`Bombs left ${live.length}  ${clock(fuse - tick)}`);
      return live.length === 0;
    });
    const left = bombs.filter((bomb) => !bomb.defused);
    if (left.length > 0) {
      for (const bomb of left) {
        try {
          dimension.spawnParticle("minecraft:huge_explosion_emitter", bomb.at);
        } catch {
          // unloaded
        }
        dimension.playSound("random.explode", bomb.at, { volume: 3 });
        setBlock(dimension, bomb.at, "minecraft:air");
      }
      play.say("The bombs went off.");
    }
    return { winner: left.length === 0 ? 1 : 0 };
  },
};
