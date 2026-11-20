// Block Party's dice, from games/blockparty/dice.json (the user asked for one place to add dice and
// say how each looks and what it does; docs/plans/block-party.md, "The dice file"). Each die has:
//   - name, and letters: the one or two capitals standing in for its icon in the item panel;
//   - block: the block floating over the roller's head while it's out, until it has a texture;
//   - texture: its model's body (a die the size of a player head): one 8 x 8 square worn on every
//     face, or 24 x 16, six 8 x 8 squares, faces 1 to 3 on the top row and 4 to 6 under them (or the
//     same at 2x, 3x...). Each face's value is a layer over it: its show text in the game's Minecraft
//     Ten font, raised off the face in the die's ink color, or the face's picture raised the same way.
//     tools/blockparty/dice-pack.ts makes the model's files from this file (test/dice.test.ts says
//     when it has to run again);
//   - ink: the color of the numbers on its faces ("#rrggbb"; a face can have its own), or
//     number: { ink, shadow }, the same two in the look the file's top-level "number" has (the user
//     writes the dice that way; "ink" and "shadow" win if both are there);
//   - shadow: a shadow under the numbers on its faces, as Minecraft draws one under text: true for
//     Minecraft's own (the ink at a quarter of its brightness), a color, or false (none, the
//     default); a face can have its own. It sits a pixel right of and below the number, lower;
//   - panel: what the item panel shows for it: its six "faces", its "description", or "both";
//   - count: how many times it's rolled at once, the moves added up (the Triple Die's 3);
//   - value: what the Shop works from (it pays half to buy it back); test: only the Tests hand it out;
//   - say: a line (its id in the user's dialogue file) the dialogue box says when it's rolled;
//   - faces: six, each its move, and what else it does: coins for the roller (or taken from them),
//     an event (FACE_EVENTS), a line to say when it comes up, what the item panel and the die model
//     show on it (up to two characters; its move unless it says), and its own ink and shadow.
// The file's "number" is the look of the moves left over a walker's head after a roll (counts.ts):
// its ink and shadow, the same way. Its "gain" and "loss" are the looks of the coins, Stars and items
// a transfer counts over a head, "+3" coming in and "-3" going out (transfers.ts).
// Pure (no Minecraft), so the tests and the dice pack tool read it too.
import file from "../../dice.json";

/** What a face can do besides moving (docs/plans/block-party.md, "The dice file"). */
export const FACE_EVENTS = {
  /** Roll the same die once more and add it (its face's own effects too). */
  again: "Roll again",
  /** Everyone gets `amount` coins (a minus takes them, never below 0). */
  everyone_coins: "Everyone gets coins",
  /** The roller's coins swap with a random other player's. */
  coin_swap: "Swap coins with a random player",
  /** The next minigame pays double. */
  double_minigame: "The next minigame pays double",
  /** Everyone's pieces swap spaces at random. */
  swap_places: "Everyone swaps places",
  /** Everyone goes back `amount` spaces (the roller too, before they walk). */
  everyone_back: "Everyone goes back",
} as const;
export type FaceEvent = keyof typeof FACE_EVENTS;

/** What the item panel shows for a die. */
export const PANEL_SHOWS = ["faces", "description", "both"] as const;
export type PanelShows = (typeof PANEL_SHOWS)[number];

export interface DieFace {
  move: number;
  /** Coins for the roller (a minus takes them). */
  coins: number;
  event?: FaceEvent;
  /** The event's amount (everyone_coins' coins, others_back's spaces). */
  amount: number;
  /** What the item panel and the die model show on this face: up to 2 characters. */
  show: string;
  /** The color of its number on the die model ("#rrggbb"): its own, else its die's. */
  ink: string;
  /** The color of its number's shadow ("#rrggbb"), if it has one: its own setting, else its die's. */
  shadow?: string;
  /** A line said when it comes up (fills: player, die, roll, coins, other). */
  say?: string;
}

export interface DieDef {
  id: string;
  name: string;
  letters: string;
  block: string;
  /** Its model's body picture, if it has one (else its block floats). */
  texture?: string;
  /** The color of the numbers on its model's faces ("#rrggbb"). */
  ink: string;
  /** Its faces' shadow setting: Minecraft's (true), a color, or none (left out). */
  shadow?: Shadow;
  panel: PanelShows;
  description: string;
  count: number;
  value: number;
  test: boolean;
  /** A line said when it's rolled (fills: player, die, roll). */
  say?: string;
  faces: readonly DieFace[];
}

/** The id of the die everyone always holds. */
export const STANDARD_DIE = "standard";
/** Each event's amount when a face doesn't give one. */
const DEFAULT_AMOUNTS: Partial<Record<FaceEvent, number>> = { everyone_coins: 5, everyone_back: 3 };
/** A line's id, as the dialogue file names them ("dice.mystery.coin-swap"). */
const LINE_ID = /^[a-z0-9][a-z0-9._-]*$/;
/** The most extra rolls Roll again adds to one roll. */
export const MAX_AGAIN = 3;
/** The numbers' color on a die that doesn't say. */
export const DEFAULT_INK = "#1e1e1e";
/** An ink color, as the dice file writes one. */
const INK = /^#[0-9a-fA-F]{6}$/;

/** A shadow setting: true for Minecraft's own under the ink, or a color ("#rrggbb"). */
export type Shadow = true | string;

/** The look of the moves left over a walker's head after a roll (the dice file's "number"). */
export interface NumberLook {
  ink: string;
  /** Its shadow's color, if it has one. */
  shadow?: string;
}
/** The number's look when the file doesn't say: white with Minecraft's shadow, as the game writes text. */
export const DEFAULT_NUMBER: NumberLook = { ink: "#ffffff", shadow: "#3f3f3f" };
/** A transfer's count when the file doesn't say: Minecraft's gold coming in, its red going out, with its shadows. */
export const DEFAULT_GAIN: NumberLook = { ink: "#ffaa00", shadow: "#3f2a00" };
export const DEFAULT_LOSS: NumberLook = { ink: "#ff5555", shadow: "#3f1515" };

/** Minecraft's text shadow under `ink`: each channel a quarter as bright (white's is #3f3f3f). */
export function shadowOf(ink: string): string {
  return `#${[1, 3, 5].map((at) => Math.floor(Number.parseInt(ink.slice(at, at + 2), 16) / 4).toString(16).padStart(2, "0")).join("")}`;
}

/** A shadow setting as the file writes it: true, false (none), or a color; undefined when left out. */
function readShadow(value: unknown, problem: (text: string) => void): Shadow | false | undefined {
  if (value === undefined || value === true || value === false) return value;
  if (typeof value === "string" && INK.test(value)) return value.toLowerCase();
  problem('"shadow" is true (Minecraft\'s), false (none) or a color like "#3f3f3f"');
  return undefined;
}

/** The shadow's color for a setting over `ink`, if there is one. */
function shadowColor(setting: Shadow | false | undefined, ink: string): string | undefined {
  if (setting === true) return shadowOf(ink);
  return typeof setting === "string" ? setting : undefined;
}

/** The looks of the numbers over heads: the moves left, and a transfer's count coming in and going out. */
export interface NumberLooks {
  number: NumberLook;
  gain: NumberLook;
  loss: NumberLook;
}

/** The dice in a dice file, the numbers' looks, and what's wrong with it (each problem in words; a die with one is left out). */
export function readDice(raw: unknown): { dice: DieDef[]; problems: string[] } & NumberLooks {
  const problems: string[] = [];
  const dice: DieDef[] = [];
  const top = (raw ?? {}) as Record<string, unknown>;
  const look = (key: keyof NumberLooks, fallback: NumberLook) => readNumber(key, top[key], fallback, (problem) => problems.push(`${key}: ${problem}`));
  const looks: NumberLooks = { number: look("number", DEFAULT_NUMBER), gain: look("gain", DEFAULT_GAIN), loss: look("loss", DEFAULT_LOSS) };
  const list = top.dice;
  if (!list || typeof list !== "object" || Array.isArray(list)) return { dice, ...looks, problems: ['the file needs "dice": { "<id>": { ... } }'] };
  for (const [id, value] of Object.entries(list as Record<string, unknown>)) {
    const before = problems.length;
    const die = readDie(id, value, (problem) => problems.push(`${id}: ${problem}`));
    if (die && problems.length === before) dice.push(die);
  }
  if (!dice.some((die) => die.id === STANDARD_DIE)) problems.push(`there must be a "${STANDARD_DIE}" die: everyone always holds it`);
  return { dice, ...looks, problems };
}

/** A number's look (the file's `key`): its ink (the fallback's if left out) and shadow (Minecraft's if left out). */
function readNumber(key: string, value: unknown, fallback: NumberLook, problem: (text: string) => void): NumberLook {
  if (value === undefined) return fallback;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    problem(`"${key}" is an object: { "ink": "${fallback.ink}", "shadow": true }`);
    return fallback;
  }
  const look = value as Record<string, unknown>;
  const ink = look.ink ?? fallback.ink;
  if (typeof ink !== "string" || !INK.test(ink)) problem(`"ink" is a color like "${fallback.ink}"`);
  const color = typeof ink === "string" && INK.test(ink) ? ink.toLowerCase() : fallback.ink;
  const shadow = shadowColor(readShadow(look.shadow ?? true, problem), color);
  return { ink: color, ...(shadow ? { shadow } : {}) };
}

function readDie(id: string, entry: unknown, problem: (text: string) => void): DieDef | undefined {
  if (!/^[a-z][a-z0-9_]*$/.test(id) || id === "default") problem('an id is lowercase letters, digits and underscores, starting with a letter (and not "default")');
  if (!entry || typeof entry !== "object") {
    problem("each die is an object");
    return undefined;
  }
  const die = entry as Record<string, unknown>;
  const text = (key: string, fallback?: string): string => {
    const got = die[key];
    if (got === undefined && fallback !== undefined) return fallback;
    if (typeof got !== "string" || got === "") problem(`"${key}" must be some text`);
    return typeof got === "string" ? got : "";
  };
  const whole = (key: string, fallback: number, min: number, max: number): number => {
    const got = die[key] ?? fallback;
    if (typeof got !== "number" || !Number.isInteger(got) || got < min || got > max) problem(`"${key}" must be a whole number from ${min} to ${max}`);
    return typeof got === "number" ? got : fallback;
  };
  const name = text("name");
  const letters = text("letters");
  // The item panel finds a die's icon by its letters (textures/blockparty/icons/<letters>), and the
  // game reads text that starts with a digit as a number in the panel's binding and shows nothing
  // for it: the One Die's "1D" came out as the missing-texture picture (the user, 2026-11-20).
  if (!/^[A-Z][A-Z0-9]?$/.test(letters)) problem('"letters" must be one or two capitals (a digit can be the second)');
  const block = text("block");
  const texture = die.texture === undefined || die.texture === "" ? undefined : text("texture");
  if (texture !== undefined && (!texture.startsWith("textures/") || texture.endsWith(".png"))) problem('"texture" is a path in the pack, like "textures/blockparty/dice/golden" (no .png)');
  // "number": { ink, shadow } says the same as "ink" and "shadow" (the look the file's top-level number has).
  const number = die.number === undefined ? undefined : die.number && typeof die.number === "object" && !Array.isArray(die.number) ? (die.number as Record<string, unknown>) : undefined;
  if (die.number !== undefined && !number) problem('"number" is an object: { "ink": "#1e1e1e", "shadow": true }');
  const ink = die.ink ?? number?.ink ?? DEFAULT_INK;
  if (typeof ink !== "string" || !INK.test(ink)) problem('"ink" is a color like "#1e1e1e"');
  const dieInk = typeof ink === "string" && INK.test(ink) ? ink.toLowerCase() : DEFAULT_INK;
  const shadow = readShadow(die.shadow ?? number?.shadow, problem);
  const panel = die.panel ?? "faces";
  if (!PANEL_SHOWS.includes(panel as PanelShows)) problem(`"panel" must be ${PANEL_SHOWS.map((show) => `"${show}"`).join(", ")}`);
  const description = text("description", "");
  if (panel !== "faces" && description === "") problem(`a die whose panel shows its description needs a "description"`);
  const count = whole("count", 1, 1, 5);
  const value = whole("value", 0, 0, 999);
  if (die.test !== undefined && typeof die.test !== "boolean") problem('"test" must be true or false');
  const say = die.say === undefined || die.say === "" ? undefined : text("say");
  if (say !== undefined && !LINE_ID.test(say)) problem('"say" is a line id from the dialogue file, like "dice.triple"');
  const faces = Array.isArray(die.faces) ? die.faces : [];
  if (faces.length !== 6) problem('"faces" must list six faces');
  return {
    id,
    name,
    letters,
    block,
    ...(texture !== undefined ? { texture } : {}),
    ink: dieInk,
    ...(shadow ? { shadow } : {}),
    panel: panel as PanelShows,
    description,
    count,
    value,
    test: die.test === true,
    ...(say !== undefined ? { say } : {}),
    faces: faces.slice(0, 6).map((face, i) => readFace(face, dieInk, shadow, (text) => problem(`face ${i + 1}: ${text}`))),
  };
}

function readFace(value: unknown, dieInk: string, dieShadow: Shadow | false | undefined, problem: (text: string) => void): DieFace {
  const face = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const move = face.move;
  if (typeof move !== "number" || !Number.isInteger(move) || move < 0 || move > 99) problem('"move" must be a whole number from 0 to 99');
  const coins = face.coins ?? 0;
  if (typeof coins !== "number" || !Number.isInteger(coins) || Math.abs(coins) > 999) problem('"coins" must be a whole number from -999 to 999');
  const event = face.event;
  if (event !== undefined && !(typeof event === "string" && event in FACE_EVENTS)) problem(`"event" must be one of ${Object.keys(FACE_EVENTS).join(", ")}`);
  const known = typeof event === "string" && event in FACE_EVENTS ? (event as FaceEvent) : undefined;
  const amount = face.amount ?? (known ? (DEFAULT_AMOUNTS[known] ?? 0) : 0);
  if (typeof amount !== "number" || !Number.isInteger(amount) || Math.abs(amount) > 999) problem('"amount" must be a whole number');
  const moves = typeof move === "number" ? move : 0;
  const show = face.show ?? String(moves);
  if (typeof show !== "string" || !/^[\x20-\x7e]{0,2}$/.test(show)) problem('"show" must be at most two plain characters');
  const ink = face.ink ?? dieInk;
  if (typeof ink !== "string" || !INK.test(ink)) problem('"ink" is a color like "#1e1e1e"');
  const say = face.say;
  if (say !== undefined && !(typeof say === "string" && LINE_ID.test(say))) problem('"say" is a line id from the dialogue file, like "dice.cursed.lucky"');
  const faceInk = typeof ink === "string" && INK.test(ink) ? ink.toLowerCase() : dieInk;
  const own = readShadow(face.shadow, problem);
  const shadow = shadowColor(own ?? dieShadow, faceInk);
  return {
    move: moves,
    coins: typeof coins === "number" ? coins : 0,
    ...(known ? { event: known } : {}),
    amount: typeof amount === "number" ? amount : 0,
    show: typeof show === "string" ? show : String(moves),
    ink: faceInk,
    ...(shadow ? { shadow } : {}),
    ...(typeof say === "string" && say !== "" ? { say } : {}),
  };
}

const read = readDice(file);
/** What's wrong with dice.json (the game logs it; the tests fail on it). */
export const DICE_PROBLEMS: readonly string[] = read.problems;
/** Every die, by id, in the file's order. */
export const DICE: Readonly<Record<string, DieDef>> = Object.fromEntries(read.dice.map((die) => [die.id, die]));
/** The look of the moves left over a walker's head (the file's "number"). */
export const NUMBER: NumberLook = read.number;
/** The looks of a transfer's count over a head, coming in and going out (the file's "gain" and "loss"). */
export const GAIN: NumberLook = read.gain;
export const LOSS: NumberLook = read.loss;

/** A die's burst when it's hit: chips of its body (the dice tool writes one for every die with a model). */
export const burstParticle = (id: string) => `blockparty:die_burst_${id}`;
/** The die everyone always holds (a plain 1 to 6 if the file has none). */
export const STANDARD: DieDef = DICE[STANDARD_DIE] ?? {
  id: STANDARD_DIE,
  name: "Standard Die",
  letters: "D",
  block: "minecraft:white_concrete",
  ink: DEFAULT_INK,
  panel: "faces",
  description: "",
  count: 1,
  value: 0,
  test: false,
  faces: [1, 2, 3, 4, 5, 6].map((move) => ({ move, coins: 0, amount: 0, show: String(move), ink: DEFAULT_INK })),
};

/** A die by id: the standard die for one that isn't in the file. */
export function dieOf(id: string | undefined): DieDef {
  return (id !== undefined ? DICE[id] : undefined) ?? STANDARD;
}

/** A roll: every face thrown (a Triple's three, Roll again's extra), and the spaces they come to. */
export interface RollOutcome {
  die: DieDef;
  /** Each throw's face, by index (0 to 5), in order. */
  faces: number[];
  /** The spaces to walk: every throw's move added up. */
  move: number;
}

/** Rolls `die`: `count` throws, and one more for each Roll again (at most MAX_AGAIN more). */
export function rollDie(die: DieDef, random: () => number): RollOutcome {
  const faces: number[] = [];
  let throws = die.count;
  for (let i = 0; i < throws; i++) {
    const face = Math.min(die.faces.length - 1, Math.floor(random() * die.faces.length));
    faces.push(face);
    if (die.faces[face]?.event === "again" && throws < die.count + MAX_AGAIN) throws++;
  }
  return { die, faces, move: faces.reduce((sum, face) => sum + die.faces[face].move, 0) };
}

/** The faces a roll threw, in order. */
export function thrown(outcome: RollOutcome): DieFace[] {
  return outcome.faces.map((face) => outcome.die.faces[face]);
}

/** The roll's throws in words: "3 + 5 + 2" for more than one throw, else "". */
export function throwsText(outcome: RollOutcome): string {
  return outcome.faces.length > 1 ? outcome.faces.map((face) => outcome.die.faces[face].move).join(" + ") : "";
}

/** The dice with a model (a texture), in the file's order, after the model's blank default (tools/blockparty/dice-model.ts lists them). */
export function modelDice(dice: readonly DieDef[] = Object.values(DICE)): DieDef[] {
  return dice.filter((die) => die.texture !== undefined);
}

/** The die model's property value for `die` (its body and faces, 1 on; 0 is the blank default), or undefined for a die with no texture. */
export function modelIndex(die: DieDef, dice: readonly DieDef[] = Object.values(DICE)): number | undefined {
  const at = modelDice(dice).findIndex((candidate) => candidate.id === die.id);
  return at < 0 ? undefined : at + 1;
}
