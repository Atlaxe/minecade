// The dialogue box's codes (docs/plans/block-party-ui.md, "The dialogue box"), pure so the tests can
// check what goes on screen. The box rides the scoreboard sidebar, which everyone sees alike: its
// title is the core's GAME_SIDEBAR_MARK (the core pack hides the vanilla sidebar for it), who the box
// is for, and the speaker's name in their color; its participants are the box's rows, top to
// bottom, each starting with a code that says what it is: the speaker's face, the line on show, a
// button (the selected one marked), the jump button's prompt, or the skip strip. Codes are formatting codes, which never
// render, so each row shows as its text. Each thing the box draws tests for one code (the workshop's
// JSON UI tool shows a block when its row "has a word"), so the selected button carries the
// button's code too. The pack's ui/jui_blockparty_dialogue.json (built by that tool from its
// blockparty_dialogue component) draws them and must use the same codes (a test checks).
import { GAME_SIDEBAR_MARK } from "@minecade/minigame-core";

/** The dialogue box's own mark in the title, after GAME_SIDEBAR_MARK: the box shows only while it's there (other things may share the sidebar). */
export const BOX_MARK = "§d§l§g";
/** The box is for one player, who steers its buttons (the words two thirds, the buttons beside them). */
export const BOX_ONE = "§k§1";
/** The box is spoken to everyone: the words take the whole width, no buttons. */
export const BOX_EVERYONE = "§k§2";
/** The title has the speaker's name after it (a Game line has no name tab). */
export const NAMED = "§k§8";
/**
 * The fork box's mark (the word "bpf", the workshop's blockparty_fork component) in place of the
 * dialogue box's: a choice of way at a fork, its buttons the only thing in it, side by side across
 * the box. Then how many ways: the component lays out two (§q§2) or three (§q§3) across.
 */
export const FORK_MARK = "§b§p§f";
export const FORK_WAYS = { two: "§q§2", three: "§q§3" } as const;
/** A name color: one color code, then bold or italic (the workshop's characters.json). */
const NAME_COLOR = /^§[0-9a-jmnpqstuv](?:§[lo]){0,2}$/;
/** A face's name: the pack's textures/blockparty/faces/<face> (Block Party's private faces pack). */
const FACE = /^[a-z0-9_]+$/;

/**
 * What each row is: a row of the line on show, a button, the selected button (a button that's also
 * marked selected), the skip strip (its text is the votes, "1/3"), the jump button's prompt (its
 * text is empty: only the leader goes on, so it names nobody), and the speaker's face (its text is
 * the face's name, which the UI cuts out at FACE_AT to name the picture). §k§5 was who had jumped,
 * before only the leader went on.
 */
export const ROW = {
  words: "§k§1",
  button: "§k§2",
  selected: "§k§2§k§3",
  skip: "§k§4",
  prompt: "§k§6",
  face: "§k§7",
} as const;
/** Where a face row's face name starts, in bytes (the UI's {{row.face}} field): its code, its index and §r, 4 codes of 3 bytes. */
export const FACE_AT = 12;
/** The code a selected button has besides the button's own. */
export const SELECTED = "§k§3";
/**
 * A picture left of a button's words, as a code after its index (the dialogue box shows the
 * picture for it): Chance Time's potions, each the color of what's inside (vanilla's fire
 * resistance, leaping, nausea and slow falling bottles).
 */
export const BUTTON_ICONS = { "potion.coins": "§p§1", "potion.items": "§p§2", "potion.board": "§p§3", "potion.stars": "§p§4" } as const;
export type ButtonIcon = keyof typeof BUTTON_ICONS;

/** Each row's place among its kind, as a code, so two rows with the same text stay two rows. */
const INDEX = "0123456789abcdef";

/** The most of a line one row holds (a longer one goes on in the next row). */
export const ROW_CHARS = 110;

export type BoxMode = "one" | "everyone" | "fork";

/**
 * The sidebar's title: the marks, who the box is for, and the speaker's name in their color (a name
 * color that isn't one is left out, so it can't be read as the title's codes).
 */
export function boxTitle(mode: BoxMode, name: string, color = ""): string {
  if (mode === "fork") return forkTitle(2);
  return `${GAME_SIDEBAR_MARK}${BOX_MARK}${mode === "one" ? BOX_ONE : BOX_EVERYONE}${name ? NAMED : ""}§r${name && NAME_COLOR.test(color) ? color : ""}${name}`;
}

/** The fork box's title: its mark and how many ways it lays out across (three for three or more). */
export function forkTitle(ways: number): string {
  return `${GAME_SIDEBAR_MARK}${FORK_MARK}${ways >= 3 ? FORK_WAYS.three : FORK_WAYS.two}§r`;
}

export interface BoxRows {
  /** The speaker's face (its name: textures/blockparty/faces/<face>), if they have one. */
  face?: string;
  /** The line on show, a row each. */
  words: readonly string[];
  /** The buttons, if the line asks something. */
  buttons?: readonly string[];
  /** Which button is picked now. */
  selected?: number;
  /** A picture left of each button's words, if it has one. */
  icons?: readonly (ButtonIcon | undefined)[];
  /** The skip strip, while everyone can vote to skip: the votes ("1/3"). */
  skip?: string;
  /** The jump button's prompt, while a jump goes on (its text: "", it names nobody). */
  prompt?: string;
}

/** The sidebar's rows, top to bottom. */
export function boxRows(rows: BoxRows): string[] {
  const row = (code: string, i: number, text: string, icon = "") => `${code}§${INDEX[i % INDEX.length]}${icon}§r${safe(text)}`;
  const out = rows.face && FACE.test(rows.face) ? [row(ROW.face, 0, rows.face)] : [];
  rows.words.forEach((text, i) => out.push(row(ROW.words, i, text)));
  (rows.buttons ?? []).forEach((text, i) => {
    const icon = rows.icons?.[i];
    out.push(row(i === rows.selected ? ROW.selected : ROW.button, i, text, icon ? BUTTON_ICONS[icon] : ""));
  });
  if (rows.prompt !== undefined) out.push(row(ROW.prompt, 0, rows.prompt));
  if (rows.skip) out.push(row(ROW.skip, 0, rows.skip));
  return out;
}

/**
 * A row's text with every run of codes put in an order that can't read as a row's code: obfuscated
 * (§k) last in its run, once, so the text never holds "§k§" (the user's "§k§1" would read as words).
 */
export function safe(text: string): string {
  return text.replace(/(?:§.)+/g, (run) => (run.includes("§k") ? `${run.replaceAll("§k", "")}§k` : run));
}

/** The text without formatting codes: what shows. */
export function visible(text: string): string {
  return text.replace(/§./g, "");
}

/**
 * The formatting a part of the text leaves on for what follows: its last color since the last reset,
 * then bold, italic and obfuscated, each once (so a row never starts with a pile of codes that could
 * read as a row's code).
 */
function carried(text: string): string {
  let color = "";
  const formats = new Set<string>();
  for (const match of text.matchAll(/§(.)/g)) {
    const code = match[1];
    if (code === "r") {
      color = "";
      formats.clear();
    } else if (code === "l" || code === "o" || code === "k") formats.add(code);
    else color = match[0];
  }
  return color + ["l", "o", "k"].filter((code) => formats.has(code)).map((code) => `§${code}`).join("");
}

/** Words a period follows without ending the sentence: titles ("Dr. Oink"). A single capital ("Chris P. Bacon") is one too. */
const TITLES = new Set(["mr", "mrs", "ms", "dr", "st", "mt", "jr", "sr", "vs"]);

/** Whether the period at `at` ends a short word that doesn't end a sentence (an initial, a title). */
function abbreviation(text: string, at: number): boolean {
  const word = /([A-Za-z]+)$/.exec(text.slice(Math.max(0, at - 4), at).replace(/§./g, ""))?.[1] ?? "";
  if (!word || /[A-Za-z]/.test(text[at - word.length - 1] ?? "")) return false;
  return /^[A-Z]$/.test(word) || TITLES.has(word.toLowerCase());
}

/**
 * A line's sentences, each one sound of the speaker's voice while the line is in the dialogue box
 * (the box shows the whole line at once): split after ., ! or ? (and a closing quote
 * or bracket) where a space follows, and at line breaks; not after an initial or a title ("Chris P.
 * Bacon", "Dr. Oink"). A color that runs on carries into the next sentence.
 */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const push = (end: number) => {
    const part = text.slice(start, end).trim();
    if (part) out.push(part);
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\n") {
      push(i);
      start = i + 1;
      continue;
    }
    if (char !== "." && char !== "!" && char !== "?") continue;
    if (char === "." && text[i + 1] !== "." && text[i - 1] !== "." && abbreviation(text, i)) continue;
    let end = i + 1;
    // Closing punctuation and formatting codes stay with the sentence.
    while (end < text.length && (/[.!?"')\]]/.test(text[end]) || (text[end] === "§" && end + 1 < text.length))) end += text[end] === "§" ? 2 : 1;
    if (end < text.length && /\s/.test(text[end])) {
      push(end);
      start = end + 1;
      i = end;
    }
  }
  push(text.length);
  // A color left on carries into the next sentence.
  for (let i = 1; i < out.length; i++) {
    const codes = carried(out[i - 1]);
    if (codes && !out[i].startsWith("§")) out[i] = codes + out[i];
  }
  return out;
}

/** A line in rows of at most ROW_CHARS that show, cut at spaces. */
export function rowsOf(sentence: string): string[] {
  const rows: string[] = [];
  let rest = sentence;
  while (visible(rest).length > ROW_CHARS) {
    // The last space before the limit (counting only what shows).
    let shown = 0;
    let cut = -1;
    for (let i = 0; i < rest.length && shown <= ROW_CHARS; i++) {
      if (rest[i] === "§") {
        i++;
        continue;
      }
      if (rest[i] === " ") cut = i;
      shown++;
    }
    if (cut <= 0) break;
    rows.push(rest.slice(0, cut));
    rest = carried(rest.slice(0, cut)) + rest.slice(cut + 1);
  }
  rows.push(rest);
  return rows;
}

/** Ticks to read a sentence: a moment, and a little for each letter (the time between voice sounds, and how long a line waits with no player to go on). */
export function readTicks(sentence: string): number {
  return Math.round(Math.min(100, Math.max(24, 16 + visible(sentence).length * 1.1)));
}

/**
 * Steering with the movement keys (W and S, a stick, a touch pad): a step each time the vector leaves
 * the middle past STEER_AT, and while it's held, again after STEER_HOLD ticks and then every
 * STEER_REPEAT (the UI plan's 0.4 s, then 0.15 s).
 */
export const STEER_AT = 0.5;
export const STEER_HOLD = 8;
export const STEER_REPEAT = 3;

export class Steering {
  private held = 0;
  private since = 0;

  /** This tick's step from the vector's forward part (W is up the list, -1; S down, +1), or 0. */
  step(forward: number): -1 | 0 | 1 {
    const way = forward > STEER_AT ? -1 : forward < -STEER_AT ? 1 : 0;
    if (way === 0 || way !== this.held) {
      this.held = way;
      this.since = 0;
      return way;
    }
    this.since++;
    if (this.since >= STEER_HOLD && (this.since - STEER_HOLD) % STEER_REPEAT === 0) return way;
    return 0;
  }

  reset(): void {
    this.held = 0;
    this.since = 0;
  }
}
