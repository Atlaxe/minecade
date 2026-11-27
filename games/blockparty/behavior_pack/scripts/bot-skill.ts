// How well Block Party's bots play (the user, 2026-11-27): the lobby's Bots option is one choice of
// Easy, Medium, Hard or No bots, and every bot in the game plays at that level. Medium is how bots
// played before there were levels: each minigame's own numbers. Easy reacts later, moves slower,
// throws wider and gets more calls wrong; Hard is the other way, though never past a player's sprint.
//
// A minigame's bot reads its level from its Play (play.skill). The helpers in minigames/common.ts
// apply most of it: a bot's steps (botStep, botRun, botWalkTo and botBrawl go at pace()), its hits
// (botBrawl and Hearts.botSwing wait() between them). Each minigame applies the rest where its bots
// decide: its own waits and reaction times (wait), its throws' error (aim), the odds of a right call
// (odds) and of a mistake (slip).

/** A bot's walk and run in blocks a tick (a player's walk and sprint), as bots.ts has them; kept here so this file stands alone. */
const SPRINT = 0.28;

export const BOT_LEVELS = ["easy", "medium", "hard"] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];

/** The lobby's Bots option: its values in the order the option goes round (the first is the default). */
export const BOT_OPTION = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "none", label: "No bots" },
] as const;

export interface BotSkill {
  level: BotLevel;
  /** Times a bot's speed (never past a sprint, unless it was already). */
  speed: number;
  /** Times a bot's waits: before it reacts or sets off, and between its hits, throws and digs. */
  slow: number;
  /** Times its throws' and shots' error. */
  aim: number;
  /** How much better (above 0) or worse (below) its calls are than Medium's, in log-odds. */
  sharp: number;
}

export const BOT_SKILLS: Readonly<Record<BotLevel, BotSkill>> = {
  easy: { level: "easy", speed: 0.8, slow: 1.6, aim: 2, sharp: -1 },
  medium: { level: "medium", speed: 1, slow: 1, aim: 1, sharp: 0 },
  hard: { level: "hard", speed: 1.1, slow: 0.65, aim: 0.45, sharp: 1.3 },
};

/** Medium's: how bots play where nothing says otherwise (tests, a minigame tried from the Tests menu). */
export const MEDIUM: BotSkill = BOT_SKILLS.medium;

/** The lobby option's value as a level: undefined for No bots ("none"); anything else unknown (an old count) is the default, Easy. */
export function botLevelOf(value: string | undefined): BotLevel | undefined {
  if (value === "none") return undefined;
  return (BOT_LEVELS as readonly string[]).includes(value ?? "") ? (value as BotLevel) : BOT_LEVELS[0];
}

/** A Medium bot's `speed` (blocks a tick) for a bot of `skill`: faster or slower, but past a sprint only if it already was. */
export function pace(skill: BotSkill, speed: number): number {
  const scaled = speed * skill.speed;
  return scaled > speed ? Math.min(scaled, Math.max(speed, SPRINT)) : scaled;
}

/** A Medium bot's wait in ticks (a reaction time, a gap between hits) for a bot of `skill`: at least a tick. */
export function wait(skill: BotSkill, ticks: number): number {
  return Math.max(1, Math.round(ticks * skill.slow));
}

/** A Medium bot's throw or shot error (blocks off) for a bot of `skill`. */
export function aim(skill: BotSkill, error: number): number {
  return error * skill.aim;
}

/**
 * The odds a bot of `skill` gets a call right (a quiz answer, a guess, a good pick) that a Medium bot
 * gets right at `chance`: moved in log-odds, so 0.6 is about 0.35 on Easy and 0.85 on Hard, and
 * 0.85 is about 0.68 and 0.95. Never and always stay so.
 */
export function odds(skill: BotSkill, chance: number): number {
  if (chance <= 0 || chance >= 1 || skill.sharp === 0) return Math.min(1, Math.max(0, chance));
  const shifted = Math.log(chance / (1 - chance)) + skill.sharp;
  return 1 / (1 + Math.exp(-shifted));
}

/** The odds a bot of `skill` slips (a mistake, a late start, a wrong tile) that a Medium bot makes at `chance`: 0.12 is about 0.27 on Easy and 0.04 on Hard. */
export function slip(skill: BotSkill, chance: number): number {
  return 1 - odds(skill, 1 - chance);
}
