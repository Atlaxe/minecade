// Block Party's board screens (docs/plans/block-party-ui.md): the player cards top right, the board
// menu top left, the item panel bottom left and the results screen, and before a minigame its
// announcement and its tutorial, each as the rows it puts on the game's sidebar. Pure, so the tests
// can check what goes on screen.
//
// Everyone sees the same screens, so they ride the scoreboard sidebar under the core's
// GAME_SIDEBAR_MARK, beside the dialogue box's rows (sidebar-rows.ts puts them together). The client
// shows only the top 15 rows, so each screen packs into few: one row per card, one for the menu, two
// for the item panel, one per player for the results. A row is formatting codes (which never render)
// that say what it is and switch its parts on and off, then fields at fixed places, each padded with
// spaces to its width: the screen's JSON UI cuts each field out by its place in bytes (UTF-8, as the
// game counts with '%.Ns') and takes the spaces out. The last field runs to the end of the row.
//
// The look is the user's: each screen is a component of the workshop's JSON UI builder
// (blockparty_cards, blockparty_menu, blockparty_panel, blockparty_results, blockparty_round,
// blockparty_announce, blockparty_tutorial), shown while the sidebar's
// title holds the screen's word, with its rows' fields as {{row.<field>}}. The fields' places here
// and in the components must agree; test/screens.test.ts checks the installed files against this.

/** Each screen's word: its codes in the sidebar's title show the screen (its component's word). */
export const SCREEN_WORDS = { cards: "bpc", menu: "bpm", panel: "bpi", results: "bpr", round: "bpn", announce: "bpa", tutorial: "bpt" } as const;
/**
 * The results' rows under this word instead show only to a player whose action bar line asks for
 * them (their own results screen after a drop: STANDINGS_CODE, ui/hud_screen.json's bp_standings).
 */
export const STANDINGS_WORD = "bpv";
export type ScreenId = keyof typeof SCREEN_WORDS;

/** A word's letters as formatting codes: "bpc" is "§b§p§c". */
export const codesOf = (word: string): string => [...word].map((ch) => `§${ch}`).join("");

/** A part of a row's layout. */
type Part =
  /** Codes that are always there (what the row is). */
  | { kind: "code"; word: string }
  /** A code letter then a digit's code: "§s§2" (a picked number, 0 to 9). */
  | { kind: "pick"; name: string; letter: string }
  /** A code letter then §1 or §0: a switch, shown in the UI as the word "<letter>1". */
  | { kind: "flag"; name: string; letter: string }
  /** Plain text padded with spaces to `length` bytes (numbers to the right, text to the left). */
  | { kind: "field"; name: string; length: number; align: "left" | "right" }
  /** The rest of the row (the last part). */
  | { kind: "rest"; name: string };

/** Where a field sits in its row, as the UI cuts it: `from` bytes in, `length` long (0: to the row's end). */
export interface Field {
  from: number;
  length: number;
}

/** A row's layout. */
export interface Layout {
  parts: readonly Part[];
}

const PART_BYTES = { code: 0, pick: 6, flag: 6 } as const;

/** Each field's place in a row of `layout`. */
export function fieldsOf(layout: Layout): Record<string, Field> {
  const out: Record<string, Field> = {};
  let at = 0;
  for (const part of layout.parts) {
    if (part.kind === "code") at += bytes(codesOf(part.word));
    else if (part.kind === "pick" || part.kind === "flag") at += PART_BYTES[part.kind];
    else if (part.kind === "field") {
      out[part.name] = { from: at, length: part.length };
      at += part.length;
    } else out[part.name] = { from: at, length: 0 };
  }
  return out;
}

/** The words a row's switches and picks show as in the UI ("t1" while `turn` is on, "s2" for selected 2). */
export function wordsOf(layout: Layout): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of layout.parts) {
    if (part.kind === "code") out[part.word] = part.word;
    else if (part.kind === "flag") out[part.name] = `${part.letter}1`;
    else if (part.kind === "pick") out[part.name] = part.letter;
  }
  return out;
}

type Values = Readonly<Record<string, string | number | boolean | undefined>>;

/** A row of `layout` with `values` in it. */
export function encode(layout: Layout, values: Values): string {
  let out = "";
  for (const part of layout.parts) {
    const value = "name" in part ? values[part.name] : undefined;
    if (part.kind === "code") out += codesOf(part.word);
    else if (part.kind === "pick") out += `§${part.letter}§${Math.max(0, Math.min(9, Math.floor(Number(value) || 0)))}`;
    else if (part.kind === "flag") out += `§${part.letter}§${value ? 1 : 0}`;
    else if (part.kind === "field") out += pad(ascii(String(value ?? "")), part.length, part.align);
    else out += String(value ?? "").replace(/§/g, "");
  }
  return out;
}

/** UTF-8 bytes in `text`. */
export function bytes(text: string): number {
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    n += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Text for a field: printable ASCII only (one byte each), so the places hold; anything else is "?". */
function ascii(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, "?");
}

function pad(text: string, length: number, align: "left" | "right"): string {
  const cut = text.slice(0, length);
  return align === "right" ? cut.padStart(length, " ") : cut.padEnd(length, " ");
}

/** A number for a field `length` wide: 0 or more, at most all nines. */
function amount(value: number, length: number): number {
  return Math.max(0, Math.min(10 ** length - 1, Math.floor(value)));
}

/** "1st" to "4th". */
export function placeText(place: number | undefined): string {
  if (place === undefined || place < 1) return "";
  return `${place}${place === 1 ? "st" : place === 2 ? "nd" : place === 3 ? "rd" : "th"}`;
}

/** The letter on a player's stand-in head: the first letter or digit of their name, as a capital. */
export function initialOf(name: string): string {
  const first = [...name].find((ch) => /[a-z0-9]/i.test(ch));
  return first ? first.toUpperCase() : "?";
}

// ---- Player cards ---------------------------------------------------------------------------

/**
 * What an empty item slot on a card holds: the screens show items as pictures by their letters
 * (textures/blockparty/icons/<letters>, tools/blockparty/item-icons.ts), and this one's picture is
 * clear, so an empty slot draws nothing rather than a picture the pack doesn't have.
 */
export const EMPTY_ICON = "__";

/**
 * A card: which seat (so each row is its own), whose turn (the highlight), not shown yet (the card
 * keeps its place but draws nothing), the row under the line (a place or items), the head picture
 * (else the letter); then the Stars, the coins, the place, three item icons' letters, the letter, and
 * the head picture's path.
 */
export const CARD: Layout = {
  parts: [
    { kind: "code", word: "kc" },
    { kind: "pick", name: "seat", letter: "c" },
    { kind: "flag", name: "turn", letter: "t" },
    { kind: "flag", name: "hidden", letter: "h" },
    { kind: "flag", name: "bottom", letter: "b" },
    { kind: "flag", name: "picture", letter: "g" },
    { kind: "field", name: "stars", length: 2, align: "right" },
    { kind: "field", name: "coins", length: 3, align: "right" },
    { kind: "field", name: "place", length: 3, align: "left" },
    { kind: "field", name: "item1", length: 2, align: "left" },
    { kind: "field", name: "item2", length: 2, align: "left" },
    { kind: "field", name: "item3", length: 2, align: "left" },
    { kind: "field", name: "letter", length: 1, align: "left" },
    { kind: "rest", name: "head" },
  ],
};

export interface CardSeat {
  name: string;
  stars: number;
  coins: number;
  /** Their place in the standings (ties share one), once there are standings. */
  place?: number;
  /** The letters of each item they hold. */
  items: readonly string[];
  /** Their head's picture (a texture path), once the pack has one. */
  head?: string;
  turn: boolean;
  /** Revealed yet (the turn order reveal shows the cards one by one). */
  shown: boolean;
}

/** The cards, one row per seat in turn order (first on the left). */
export function cardRows(seats: readonly CardSeat[]): string[] {
  return seats.map((seat, index) =>
    encode(CARD, {
      seat: index,
      turn: seat.turn && seat.shown,
      hidden: !seat.shown,
      bottom: seat.place !== undefined || seat.items.length > 0,
      picture: seat.head !== undefined && seat.head !== "",
      stars: amount(seat.stars, 2),
      coins: amount(seat.coins, 3),
      place: placeText(seat.place),
      item1: seat.items[0] ?? EMPTY_ICON,
      item2: seat.items[1] ?? EMPTY_ICON,
      item3: seat.items[2] ?? EMPTY_ICON,
      letter: initialOf(seat.name),
      head: seat.head ?? "",
    }),
  );
}

// ---- The board menu -------------------------------------------------------------------------

/** The board menu's buttons, top to bottom. */
export const MENU_BUTTONS = ["dice", "items", "board"] as const;
export type MenuButton = (typeof MENU_BUTTONS)[number];

/** The menu: which button is selected, and which are disabled (dimmer, skipped). */
export const MENU: Layout = {
  parts: [
    { kind: "code", word: "km" },
    { kind: "pick", name: "selected", letter: "s" },
    { kind: "flag", name: "diceOff", letter: "u" },
    { kind: "flag", name: "itemsOff", letter: "v" },
    { kind: "flag", name: "boardOff", letter: "j" },
    { kind: "flag", name: "open", letter: "n" },
  ],
};

export interface MenuState {
  selected: MenuButton;
  disabled: readonly MenuButton[];
  /** Something the menu opened is up (the item panel, the board view): the menu waits behind it. */
  open: boolean;
}

export function menuRow(state: MenuState): string {
  return encode(MENU, {
    selected: MENU_BUTTONS.indexOf(state.selected),
    diceOff: state.disabled.includes("dice"),
    itemsOff: state.disabled.includes("items"),
    boardOff: state.disabled.includes("board"),
    open: state.open,
  });
}

// ---- The item panel -------------------------------------------------------------------------

/**
 * The panel's main row: chevrons (more than one to pick from), its faces showing (a die whose dice
 * file entry shows them), its icon's letters, six faces (each what the dice file says it shows: its
 * move, or up to two characters), its name.
 */
export const PANEL: Layout = {
  parts: [
    { kind: "code", word: "ki" },
    { kind: "flag", name: "chevrons", letter: "a" },
    { kind: "flag", name: "die", letter: "f" },
    { kind: "field", name: "icon", length: 2, align: "left" },
    { kind: "field", name: "face1", length: 2, align: "right" },
    { kind: "field", name: "face2", length: 2, align: "right" },
    { kind: "field", name: "face3", length: 2, align: "right" },
    { kind: "field", name: "face4", length: 2, align: "right" },
    { kind: "field", name: "face5", length: 2, align: "right" },
    { kind: "field", name: "face6", length: 2, align: "right" },
    { kind: "rest", name: "name" },
  ],
};

/** The panel's second row: what an item does, or a die's description (a die whose panel shows it). */
export const PANEL_TEXT: Layout = {
  parts: [
    { kind: "code", word: "kj" },
    { kind: "rest", name: "what" },
  ],
};

/** A die as the panel shows it (dice.ts's DieDef): its faces, its description, or both, as its panel says. */
export interface PanelDie {
  name: string;
  letters: string;
  panel: "faces" | "description" | "both";
  description: string;
  faces: readonly { show: string }[];
}

export type PanelShow = { die: PanelDie } | { item: { name: string; letters: string; description: string } };

/** The panel's rows: the thing showing now, with chevrons when there's more than one to step through. */
export function panelRows(show: PanelShow, chevrons: boolean): string[] {
  if ("die" in show) {
    const { die } = show;
    const faces = die.panel !== "description";
    const shown = Object.fromEntries(die.faces.slice(0, 6).map((face, i) => [`face${i + 1}`, faces ? face.show : ""]));
    const main = encode(PANEL, { chevrons, die: faces, icon: die.letters, ...shown, name: die.name });
    return die.panel === "faces" || die.description === "" ? [main] : [main, encode(PANEL_TEXT, { what: die.description })];
  }
  return [encode(PANEL, { chevrons, die: false, icon: show.item.letters, name: show.item.name }), encode(PANEL_TEXT, { what: show.item.description })];
}

// ---- The results screen ---------------------------------------------------------------------

/**
 * A player's row: which seat (each row its own), 1st's border, the head picture, how far it's drawn
 * from its place while it slides to a new one (the builder's row slide: 5 is its place, 2 to 4 a
 * quarter, half or three quarters of a row up, 6 to 8 down); the place, Stars, coins, the letter,
 * the picture's path.
 */
export const RESULT: Layout = {
  parts: [
    { kind: "code", word: "ks" },
    { kind: "pick", name: "seat", letter: "q" },
    { kind: "flag", name: "border", letter: "e" },
    { kind: "flag", name: "picture", letter: "g" },
    { kind: "pick", name: "slide", letter: "d" },
    { kind: "field", name: "place", length: 3, align: "left" },
    { kind: "field", name: "stars", length: 2, align: "right" },
    { kind: "field", name: "coins", length: 3, align: "right" },
    { kind: "field", name: "letter", length: 1, align: "left" },
    { kind: "rest", name: "head" },
  ],
};

export interface ResultRow {
  seat: number;
  name: string;
  place: number;
  stars: number;
  coins: number;
  border: boolean;
  head?: string;
  /** Quarters of a row it's drawn away from its place, down positive (-3 to 3), while it slides. */
  slide?: number;
}

/** A slide's code digit for a row at its place (the builder's row slide). */
export const SLIDE_HOME = 5;
/** Steps a row slides in, from one place to the next: quarters. */
export const SLIDE_STEPS = 4;

/** The results' rows, top to bottom as shown. */
export function resultRows(rows: readonly ResultRow[]): string[] {
  return rows.map((row) =>
    encode(RESULT, {
      seat: row.seat,
      border: row.border,
      picture: row.head !== undefined && row.head !== "",
      slide: SLIDE_HOME + Math.max(1 - SLIDE_STEPS, Math.min(SLIDE_STEPS - 1, Math.round(row.slide ?? 0))),
      place: placeText(row.place),
      stars: amount(row.stars, 2),
      coins: amount(row.coins, 3),
      letter: initialOf(row.name),
      head: row.head ?? "",
    }),
  );
}

// ---- The round, bottom right ----------------------------------------------------------------

/** The round's one row: its text ("Round 3 / 10", the user's round.hud line). */
export const ROUND: Layout = {
  parts: [
    { kind: "code", word: "kn" },
    { kind: "rest", name: "text" },
  ],
};

/**
 * The round's row: `text` as roundText gives it, its colors kept (a row's free text loses every §
 * otherwise, encode's "rest"), all but §k: the rows' codes are §k and a letter, so text can't fake one.
 */
export function roundRow(text: string): string {
  return `${encode(ROUND, { text: "" })}${text.replace(/§k/g, "")}`;
}

/** The round's colors (the user, 2026-11-18): "Round 3 /" light gray, the rounds in all ("10") dark gray. */
export const ROUND_COLORS = { round: "§7", rounds: "§8" } as const;
/** Marks where the {rounds} fill is in the said line, so its color goes in there whatever the line says around it. */
const ROUNDS_MARK = "\u0001";

/**
 * The round's text from the user's round.hud line (`say` fills it: "Round {round} / {rounds}"): the
 * line's own colors taken out (a fill's style), then the round's put in, the rounds in all darker.
 */
export function roundText(say: (fills: { round: number; rounds: string }) => string, round: number, rounds: number): string {
  const said = say({ round, rounds: `${ROUNDS_MARK}${rounds}` }).replace(/§./g, "");
  return said === "" ? "" : `${ROUND_COLORS.round}${said.replace(ROUNDS_MARK, ROUND_COLORS.rounds)}`;
}

// ---- The minigame announcement (block-party-ui.md) --------------------------------------------

/**
 * The heading: the component's own "Minigame!", and under it the format ("Free for all") once it
 * shows (its switch on).
 */
export const ANNOUNCE_HEAD: Layout = {
  parts: [
    { kind: "code", word: "ka" },
    { kind: "flag", name: "showFormat", letter: "f" },
    { kind: "rest", name: "format" },
  ],
};

/** A minigame on the wheel: its place (each row its own), under the pointer while it spins, the pick once it's landed, its name. */
export const ANNOUNCE_WHEEL: Layout = {
  parts: [
    { kind: "code", word: "kw" },
    { kind: "pick", name: "slot", letter: "w" },
    { kind: "flag", name: "spinning", letter: "s" },
    { kind: "flag", name: "landed", letter: "l" },
    { kind: "rest", name: "name" },
  ],
};

/** The announcement as it stands: the heading alone, then the format, then the wheel spinning and landed. */
export interface AnnounceScreen {
  format?: string;
  wheel?: { names: readonly string[]; at: number; landed: boolean };
}

/** The announcement's rows: the heading, then the wheel's top to bottom. */
export function announceRows(screen: AnnounceScreen): string[] {
  const head = encode(ANNOUNCE_HEAD, { showFormat: screen.format !== undefined, format: plain(screen.format ?? "") });
  const wheel = screen.wheel;
  if (!wheel) return [head];
  return [head, ...wheel.names.map((name, slot) => encode(ANNOUNCE_WHEEL, { slot, spinning: slot === wheel.at && !wheel.landed, landed: slot === wheel.at && wheel.landed, name: plain(name) }))];
}

// ---- The minigame tutorial (block-party-ui.md, "The minigame tutorial") ------------------------

/** The minigame's name, top of the panel. */
export const TUTORIAL_NAME: Layout = {
  parts: [
    { kind: "code", word: "kt" },
    { kind: "rest", name: "name" },
  ],
};
/** What to do: the first side's (or everyone's), and the second side's (the action bar's SIDE_TWO_CODE shows it). */
export const TUTORIAL_GOAL: Layout = {
  parts: [
    { kind: "code", word: "ko" },
    { kind: "rest", name: "text" },
  ],
};
export const TUTORIAL_GOAL_TWO: Layout = {
  parts: [
    { kind: "code", word: "kp" },
    { kind: "rest", name: "text" },
  ],
};
/** A control: which (each row its own), the action ("Jump") in its key box, and what it does. */
export const TUTORIAL_CONTROL: Layout = {
  parts: [
    { kind: "code", word: "kx" },
    { kind: "pick", name: "index", letter: "x" },
    { kind: "field", name: "action", length: 10, align: "left" },
    { kind: "rest", name: "what" },
  ],
};
export const TUTORIAL_CONTROL_TWO: Layout = {
  parts: [
    { kind: "code", word: "kq" },
    { kind: "pick", name: "index", letter: "x" },
    { kind: "field", name: "action", length: 10, align: "left" },
    { kind: "rest", name: "what" },
  ],
};
/** The Ready strip, bottom right: how many are ready ("1/4"). The action bar's READY_CODE says "Ready!" to a player who is. */
export const TUTORIAL_READY: Layout = {
  parts: [
    { kind: "code", word: "kr" },
    { kind: "rest", name: "votes" },
  ],
};

/** One side's part of a minigame's tutorial: what to do, and its controls (an action and what it does). */
export interface TutorialSide {
  objective: string;
  controls?: readonly { action: string; what: string }[];
}

export interface TutorialScreen {
  name: string;
  /** The first side's (or everyone's), then the second side's if it has one of its own. */
  sides: readonly TutorialSide[];
  ready: number;
  total: number;
}

/** Most controls a side shows (the sidebar's rows are few). */
export const MAX_CONTROLS = 3;

/** The tutorial's rows: the name, each side's objective and controls, and the Ready strip. */
export function tutorialRows(screen: TutorialScreen): string[] {
  const rows = [encode(TUTORIAL_NAME, { name: plain(screen.name) })];
  screen.sides.slice(0, 2).forEach((side, index) => {
    rows.push(encode(index === 0 ? TUTORIAL_GOAL : TUTORIAL_GOAL_TWO, { text: plain(side.objective) }));
    (side.controls ?? []).slice(0, MAX_CONTROLS).forEach((control, i) => rows.push(encode(index === 0 ? TUTORIAL_CONTROL : TUTORIAL_CONTROL_TWO, { index: i, action: control.action, what: plain(control.what) })));
  });
  rows.push(encode(TUTORIAL_READY, { votes: `${Math.min(screen.ready, screen.total)}/${screen.total}` }));
  return rows;
}

/** Text with its formatting codes taken out (a name's color would leave its letter in a row). */
function plain(text: string): string {
  return text.replace(/§./g, "");
}

/** Every screen's row layouts, for the tests and the builder's components (the fields each one cuts). */
export const SCREEN_LAYOUTS = {
  cards: { rows: { card: CARD } },
  menu: { rows: { menu: MENU } },
  panel: { rows: { panel: PANEL, text: PANEL_TEXT } },
  results: { rows: { result: RESULT } },
  round: { rows: { round: ROUND } },
  announce: { rows: { head: ANNOUNCE_HEAD, wheel: ANNOUNCE_WHEEL } },
  tutorial: { rows: { name: TUTORIAL_NAME, goal: TUTORIAL_GOAL, goalTwo: TUTORIAL_GOAL_TWO, control: TUTORIAL_CONTROL, controlTwo: TUTORIAL_CONTROL_TWO, ready: TUTORIAL_READY } },
} as const satisfies Record<ScreenId, { rows: Record<string, Layout> }>;
