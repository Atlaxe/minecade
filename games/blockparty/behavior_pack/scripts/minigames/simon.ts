// Simon Says, with Do the Opposite (FFA; docs/plans/block-party-minigames.md). Each player faces a
// station of 4 colors (a 2 x 2 the game lays, terracotta, lit as concrete). Commands come one at a
// time, each with an answer time that shortens as it goes: hit a color, don't hit a color (hit one of
// the other three), jump, sneak, spin around, look up or down, keep moving, freeze; and the traps,
// don't jump, don't sneak, don't look up. A wrong answer, or none to a command that wants one, costs
// a heart; out at none. Last one in wins; the rest place by when they went out. Bots are right about
// 85% of the time (a Medium bot; the lobby's level moves it).
import { world, type Entity, type Player, type Vector3 } from "@minecraft/server";
import type { Who } from "../bots.ts";
import { MARKUP } from "./arenas.ts";
import { BOT_WALK, botArm, botCrouch, botFace, botJump, botOdds, botWait, clock, stepBot, everyTick, isPlayer, onPlan, pick, placesByOut, setBlock } from "./common.ts";
import { inOrder, type MinigameDef, type Outcome, type Play, type Spot } from "./kit.ts";

const COLORS = [
  { id: "red", name: "red", off: "minecraft:red_terracotta", on: "minecraft:red_concrete" },
  { id: "blue", name: "blue", off: "minecraft:blue_terracotta", on: "minecraft:blue_concrete" },
  { id: "yellow", name: "yellow", off: "minecraft:yellow_terracotta", on: "minecraft:yellow_concrete" },
  { id: "green", name: "green", off: "minecraft:lime_terracotta", on: "minecraft:lime_concrete" },
] as const;

type Command =
  | { kind: "hit"; color: number; dont: boolean }
  | { kind: "jump" | "sneak" | "spin" | "lookUp" | "lookDown" | "move" | "freeze" }
  | { kind: "dontJump" | "dontSneak" | "dontLookUp" };

const WORDS: Record<string, string> = {
  jump: "Jump!",
  sneak: "Sneak!",
  spin: "Spin around!",
  lookUp: "Look up!",
  lookDown: "Look down!",
  move: "Keep moving!",
  freeze: "Freeze!",
  dontJump: "Don't jump!",
  dontSneak: "Don't sneak!",
  dontLookUp: "Don't look up!",
};

function words(command: Command): string {
  if (command.kind === "hit") return `${command.dont ? "Don't hit" : "Hit"} ${COLORS[command.color].name}!`;
  return WORDS[command.kind];
}

/** A station's 4 color blocks: left and right of its point (across the way it faces), two high. */
function stationBlocks(spot: Spot): Vector3[] {
  const yaw = ((spot.yaw ?? 0) * Math.PI) / 180;
  // Across: the facing turned a quarter.
  const across = { x: Math.round(Math.cos(yaw)), z: Math.round(Math.sin(yaw)) };
  const base = { x: Math.floor(spot.x), y: Math.floor(spot.y), z: Math.floor(spot.z) };
  return [
    { x: base.x, y: base.y, z: base.z },
    { x: base.x + across.x, y: base.y, z: base.z + across.z },
    { x: base.x, y: base.y + 1, z: base.z },
    { x: base.x + across.x, y: base.y + 1, z: base.z + across.z },
  ];
}

/** What a player did during a command's answer time. */
interface Done {
  hit?: number;
  jumped: boolean;
  sneaked: boolean;
  turned: number;
  lastYaw?: number;
  lookedUp: boolean;
  lookedDown: boolean;
  /** Ticks with movement input, and without, after the first half second. */
  moved: number;
  still: number;
}

function fresh(): Done {
  return { jumped: false, sneaked: false, turned: 0, lookedUp: false, lookedDown: false, moved: 0, still: 0 };
}

function right(command: Command, done: Done): boolean {
  switch (command.kind) {
    case "hit":
      return command.dont ? done.hit !== undefined && done.hit !== command.color : done.hit === command.color;
    case "jump":
      return done.jumped;
    case "sneak":
      return done.sneaked;
    case "spin":
      return Math.abs(done.turned) >= 330;
    case "lookUp":
      return done.lookedUp;
    case "lookDown":
      return done.lookedDown;
    case "move":
      return done.still <= 2;
    case "freeze":
      return done.moved === 0 && !done.jumped;
    case "dontJump":
      return !done.jumped;
    case "dontSneak":
      return !done.sneaked;
    case "dontLookUp":
      return !done.lookedUp;
  }
}

export const SIMON: MinigameDef = {
  id: "simon",
  name: "Simon Says",
  kind: "ffa",
  // Its bots act out their answers with their heads (look up, look down, spin): no idle glances.
  botsIdle: false,
  rules: "Do what it says, and never what it says not to. A wrong answer costs a heart.",
  tutorial: [
    {
      objective: "Do what each command says before time's up: hit a color, jump, sneak, spin, look up or down, keep moving or freeze. A \"Don't\" means do anything but that. A wrong answer costs a heart.",
      controls: [
        { input: "attack", what: "Hit the color it calls" },
        { input: "move", what: "Keep moving or freeze" },
      ],
    },
  ],
  ...onPlan("simon"),
  problem(field) {
    return field.points(MARKUP.stations).length >= 2 ? undefined : "its arena map needs a station for each spawn";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, dimension, scope } = play;
    const everyone = play.sides.flat();
    const stations = field.points(MARKUP.stations);
    const display = field.points(MARKUP.display)[0];
    const blocksOf = new Map(everyone.map((who, i) => [who.key, stations[i] ? stationBlocks(stations[i]) : []]));
    const displayBlocks = display ? stationBlocks(display) : [];
    const lay = (lit: number | undefined) => {
      for (const blocks of [...blocksOf.values(), displayBlocks]) blocks.forEach((at, color) => setBlock(dimension, at, color === lit ? COLORS[color].on : COLORS[color].off));
    };
    lay(undefined);
    const hearts = new Map(everyone.map((who) => [who.key, play.setting("hearts")]));
    const outAt = new Map<string, number>();
    const done = new Map(everyone.map((who) => [who.key, fresh()]));
    // A hit on a color block: whose station, which color.
    const hitColor = (player: Player, at: Vector3) => {
      const key = player.name.toLowerCase();
      const blocks = blocksOf.get(key);
      const record = done.get(key);
      if (!blocks || !record || record.hit !== undefined) return;
      const color = blocks.findIndex((b) => b.x === at.x && b.y === at.y && b.z === at.z);
      if (color >= 0) record.hit = color;
    };
    scope.subscribe(world.afterEvents.entityHitBlock, ({ damagingEntity, hitBlock }) => {
      if (isPlayer(damagingEntity)) hitColor(damagingEntity, hitBlock.location);
    });
    scope.subscribe(world.afterEvents.playerInteractWithBlock, ({ player, block }) => hitColor(player, block.location));
    const commands = play.setting("commands");
    const first = play.setting("firstWindow") * 2;
    const last = play.setting("lastWindow") * 2;
    const dontShare = play.setting("dontShare") / 100;
    const statusOf = () => everyone.filter((who) => !outAt.has(who.key)).map((who) => `${who.name} ${"♥".repeat(hearts.get(who.key) ?? 0)}`).join("  ");
    for (let n = 0; n < commands && !scope.disposed; n++) {
      if (play.inPlay().length <= 1 && everyone.length > 1) break;
      const window = Math.round(first - ((first - last) * n) / Math.max(1, commands - 1));
      const roll = play.random();
      let command: Command;
      if (roll < 0.45) command = { kind: "hit", color: Math.floor(play.random() * 4), dont: play.random() < dontShare };
      else if (roll < 0.45 + dontShare * 0.4) command = { kind: pick(["dontJump", "dontSneak", "dontLookUp"] as const, play.random) };
      else command = { kind: pick(["jump", "sneak", "spin", "lookUp", "lookDown", "move", "freeze"] as const, play.random) };
      for (const who of everyone) done.set(who.key, fresh());
      lay(command.kind === "hit" ? command.color : undefined);
      play.notice(words(command), window + 10);
      // Each bot's answer: right most of the time, after a moment (a Medium bot's: botOdds and botWait), always inside the answer time.
      const botRight = new Map(everyone.filter((who) => !who.player).map((who) => [who.key, play.random() < botOdds(play, 0.85)]));
      const botAt = new Map(everyone.filter((who) => !who.player).map((who) => [who.key, Math.min(window - 1, botWait(play, 6 + Math.floor(play.random() * Math.max(1, window - 14))))]));
      await everyTick(play, window, (tick) => {
        for (const who of play.inPlay()) {
          const record = done.get(who.key)!;
          const body = play.bodyOf(who);
          if (!body) continue;
          if (isPlayer(body)) {
            const rotation = body.getRotation();
            if (record.lastYaw !== undefined) {
              let step = rotation.y - record.lastYaw;
              if (step > 180) step -= 360;
              if (step < -180) step += 360;
              record.turned += step;
            }
            record.lastYaw = rotation.y;
            if (rotation.x < -60) record.lookedUp = true;
            if (rotation.x > 60) record.lookedDown = true;
            if (body.isJumping) record.jumped = true;
            if (body.isSneaking) record.sneaked = true;
            if (tick >= 10) {
              const move = body.inputInfo.getMovementVector();
              if (Math.hypot(move.x, move.y) > 0.1) record.moved++;
              else record.still++;
            }
            continue;
          }
          // A bot: does it right (or wrong) at its moment.
          if (tick !== botAt.get(who.key)) continue;
          const good = botRight.get(who.key) ?? true;
          botAnswer(command, record, good, play.random);
          actOut(play, who, body, record, command);
          if (record.jumped) botJump(body);
          if (record.hit !== undefined) {
            const target = blocksOf.get(who.key)?.[record.hit];
            if (target) {
              botFace(body, target);
              botArm(play, who);
            }
          }
        }
        if (tick % 5 === 0) play.status(`${statusOf()}  ${clock(window - tick)}`);
      });
      // Judge: a wrong answer costs a heart.
      for (const who of play.inPlay()) {
        const record = done.get(who.key)!;
        if (right(command, record)) continue;
        const left = (hearts.get(who.key) ?? 1) - 1;
        hearts.set(who.key, left);
        if (left <= 0) {
          outAt.set(who.key, n);
          play.out(who);
          play.say(`${who.name} is out.`);
        } else play.tell(who, `Wrong! ${left} ${left === 1 ? "heart" : "hearts"} left.`);
      }
      lay(undefined);
      await scope.wait(16);
    }
    return { places: placesByOut(everyone.map((who) => who.key), outAt, (key) => hearts.get(key) ?? 0) };
  },
};

/** Ticks a bot holds a crouch or a look up or down for, and spins over. */
const ACT_HOLD = 14;
const SPIN_TICKS = 8;

/**
 * A bot shows its answer the way a player gives it: a crouch, a look up or down, a spin, a few steps
 * about (jumps and hits are done where it's judged).
 */
function actOut(play: Play, who: Who, body: Entity, record: Done, command: Command): void {
  const { scope } = play;
  if (record.sneaked) {
    botCrouch(play, who, true);
    scope.timeout(() => botCrouch(play, who, false), ACT_HOLD);
  }
  const turnBy = (pitch: number, yawStep: number, ticks: number) => {
    for (let t = 1; t <= ticks; t++) {
      scope.timeout(() => {
        try {
          if (!body.isValid) return;
          const { y } = body.getRotation();
          body.setRotation({ x: pitch, y: y + yawStep });
        } catch {
          // gone
        }
      }, t);
    }
  };
  if (record.lookedUp || record.lookedDown) {
    turnBy(record.lookedUp ? -80 : 80, 0, 1);
    scope.timeout(() => turnBy(0, 0, 1), ACT_HOLD);
  }
  if (record.turned > 0) turnBy(0, record.turned / SPIN_TICKS, SPIN_TICKS);
  if ((command.kind === "move" && record.still === 0) || (command.kind === "freeze" && record.moved > 0)) {
    // Moving (rightly, or when it should freeze): a few steps one way and back.
    const yaw = play.random() * Math.PI * 2;
    for (let t = 0; t < ACT_HOLD; t++) {
      const sign = t < ACT_HOLD / 2 ? 1 : -1;
      scope.timeout(() => {
        if (body.isValid) stepBot(body, -Math.sin(yaw) * BOT_WALK * sign, Math.cos(yaw) * BOT_WALK * sign);
      }, t);
    }
    scope.timeout(() => body.isValid && stepBot(body, 0, 0), ACT_HOLD);
  }
}

/** A bot's answer: what it does for `command`, right or wrong. */
function botAnswer(command: Command, record: Done, good: boolean, random: () => number): void {
  switch (command.kind) {
    case "hit":
      record.hit = good ? (command.dont ? (command.color + 1 + Math.floor(random() * 3)) % 4 : command.color) : command.dont ? command.color : (command.color + 1) % 4;
      return;
    case "jump":
    case "dontJump":
      record.jumped = command.kind === "jump" ? good : !good;
      return;
    case "sneak":
    case "dontSneak":
      record.sneaked = command.kind === "sneak" ? good : !good;
      return;
    case "spin":
      record.turned = good ? 360 : 90;
      return;
    case "lookUp":
    case "dontLookUp":
      record.lookedUp = command.kind === "lookUp" ? good : !good;
      return;
    case "lookDown":
      record.lookedDown = good;
      return;
    case "move":
      record.still = good ? 0 : 20;
      return;
    case "freeze":
      record.moved = good ? 0 : 5;
      return;
  }
}
