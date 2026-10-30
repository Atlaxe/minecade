// What the hologram shows, as plain data: one of two frames (the user's art), text elements placed
// on the panel, and up to two pictures. Each screen's layout mirrors its form: buttons are light
// blue text, the open or chosen one yellow. The terminal and the stats and
// team screens build this from the same views their forms use; hologram.ts draws it on all four
// sides. Positions and sizes are in HOLO_LAYOUT, to tune against the frame art.
import { ordinal } from "@minecade/minigame-core";
import { gamePicture, mapOptions, playerCount, playerRange, settingLabel, settingsFor, type MapOption } from "./game-screen.ts";
import type { CountdownView, GameChoice } from "./lobby-controller.ts";
import type { GameView } from "./menus.ts";
import { STAT_COLUMNS, badgeFor, type PlayersView, type StatsView } from "./stats-screens.ts";
import type { TeamPickView } from "./team-pick-controller.ts";

/** "logo": the logo up top, room below (idle and main). "panel": everything else. */
export type Frame = "logo" | "panel";
export type Tone = "title" | "normal" | "highlight" | "dim" | "warn";
/** What a piece of text stands for: a button, the open or chosen one, or a stat's tile. It shows as a color (no background, which would hide the glow). */
export type Box = "button" | "selected" | "tile";

export interface HoloElement {
  text: string;
  /** Blocks right of the panel's middle, as its reader sees it (the panel spans -1.5 to 1.5). */
  x: number;
  /** Blocks above the panel's middle (-1.5 to 1.5). */
  y: number;
  /** Text size; 1 is the normal size. */
  scale?: number;
  tone?: Tone;
  /** A § color code (a team's color) instead of the tone's color. */
  color?: string;
  box?: Box;
}

/** Where the picture goes: the top right corner, or across the top (the banner). */
export type PictureSpot = "corner" | "banner";

export interface HoloContent {
  frame: Frame;
  elements: HoloElement[];
  /** A 16:9 texture path (a game's picture or a map's preview), at the top right unless `pictureSpot` says otherwise. */
  picture?: string;
  pictureSpot?: PictureSpot;
  /** A square texture path (a player's badge), at the top left. */
  portrait?: string;
}

/** The most elements one screen uses (hologram.ts keeps this many text shapes per side). */
export const MAX_ELEMENTS = 48;

/**
 * Where things go, in blocks from the panel's middle. Text stays within `edge` of the middle, inside
 * the frame's border and corner brackets (at about 1.4). The picture and portrait spots are fixed in
 * the hologram's model (models/entity/holo_display.geo.json), all top-aligned with the title: the
 * picture spans x 0.08 to 1.28 and y 0.54 to 1.22, the banner (the picture across the top) x -1.1
 * to 1.1 and y -0.02 to 1.22, the portrait x -1.25 to -0.5 and y 0.47 to 1.22. (The model's x runs
 * opposite to the reader's: a spot on the reader's right has negative x in the model.)
 */
export const HOLO_LAYOUT = {
  /** One font pixel at scale 1, in blocks (measured in game: "Choose a game", 74 font pixels wide, is about 2.0 blocks at 1.15). */
  pixel: 0.024,
  /** A line's height in font pixels at scale 1 (for placing text by its top). */
  lineHeight: 8,
  /** How far from the middle text may reach, either way. */
  edge: 1.25,
  title: { y: 1.12, scale: 1.15 },
  /** Buttons under the logo (idle and main). */
  logoButtons: { y: -0.45, x: 0.62 },
  grid: { columns: [-0.85, 0, 0.85], width: 0.78, top: 0.66, rowGap: 0.42, rows: 5, scale: 0.6, lineGap: 0.13, countGap: 0.15, countScale: 0.42 },
  game: { left: -1.25, width: 1.25, players: 0.84, settingsTop: 0.4, settingGap: 0.26, settings: 6, scale: 0.6, valueGap: 0.08 },
  /** Game screen, layout 2: under the banner, two columns starting at `top`. */
  gameBanner: { top: -0.14, left: -1.25, leftWidth: 1.05, right: -0.1, titleScale: 0.9, playersGap: 0.06, scale: 0.55, settingGap: 0.24, settings: 4 },
  countdown: { gap: 0.12, titleScale: 1, headingScale: 0.9, numberScale: 3, mapScale: 0.55, noteScale: 0.45 },
  teams: { header: 0.72, membersTop: 0.42, memberGap: 0.25, members: 4, random: -0.82, status: -1.15, scale: 0.75, minScale: 0.45 },
  list: { top: 0.72, gap: 0.3, rows: 7, scale: 0.8 },
  stats: {
    left: -0.35,
    width: 1.6,
    tab: 1.14,
    tabScale: 0.5,
    name: 0.9,
    nameScale: 1,
    rank: 0.62,
    rankScale: 0.55,
    columns: [-0.84, 0, 0.84],
    columnWidth: 0.8,
    headings: 0.3,
    headingScale: 0.45,
    tilesTop: 0.08,
    tileGap: 0.24,
    labelGap: 0.11,
    tiles: 6,
    valueScale: 0.55,
    labelScale: 0.4,
    minScale: 0.28,
  },
} as const;

/** The font's advance for each character, in font pixels, where it isn't the usual 6 (5 wide plus 1 of spacing). */
const ADVANCES: Record<string, number> = Object.fromEntries(
  (
    [
      ["!',.:;i|", 2],
      ["`l", 3],
      [' "()*I[]t{}', 4],
      ["<>fk", 5],
      ["@~", 7],
    ] as const
  ).flatMap(([chars, advance]) => [...chars].map((char) => [char, advance])),
);

const text = (value: string, x: number, y: number, more: Partial<HoloElement> = {}): HoloElement => ({ text: value, x, y, ...more });

/** About how wide `value` is at `scale`, in blocks, from the font's character widths. */
export function textWidth(value: string, scale = 1): number {
  let pixels = 0;
  for (const char of value) pixels += ADVANCES[char] ?? 6;
  return pixels * scale * HOLO_LAYOUT.pixel;
}

/** How tall a line is at `scale`, in blocks. */
export function textHeight(scale = 1): number {
  return HOLO_LAYOUT.lineHeight * scale * HOLO_LAYOUT.pixel;
}

/** The y that puts a line's top at `top` (text is placed by its middle). */
function topAligned(top: number, scale: number): number {
  return top - textHeight(scale) / 2;
}

/** The largest scale, up to `maxScale` and no smaller than `minScale`, at which `value` fits `width`. */
export function fitScale(value: string, maxScale: number, width: number, minScale = maxScale): number {
  if (value.length === 0) return maxScale;
  return Math.max(minScale, Math.min(maxScale, width / textWidth(value)));
}

/** `value` cut down (ending in "..") so it fits `width` at `scale`. */
export function truncate(value: string, scale: number, width: number): string {
  // A hair of slack, so text shrunk to exactly `width` by fitScale() isn't cut by rounding.
  const fits = (candidate: string) => textWidth(candidate, scale) <= width + 1e-9;
  if (fits(value)) return value;
  let kept = value;
  while (kept.length > 1 && !fits(`${kept.trimEnd()}..`)) kept = kept.slice(0, -1);
  return `${kept.trimEnd()}..`;
}

/** `value` wrapped by words into lines that fit `width` at `scale`; the last allowed line is truncated. */
export function wrap(value: string, scale: number, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, scale) <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) lines.splice(maxLines - 1, lines.length, lines.slice(maxLines - 1).join(" "));
  return lines.map((part) => truncate(part, scale, width));
}

/** An element that starts at `left` instead of being centered (text is placed by its middle). */
function leftAligned(value: string, left: number, y: number, more: Partial<HoloElement> & { scale: number }): HoloElement {
  return text(value, left + textWidth(value, more.scale) / 2, y, more);
}

/** Text centered on `x`, shrunk to fit `width` (down to `minScale`), then truncated if it still doesn't. */
function fitted(value: string, x: number, y: number, width: number, maxScale: number, minScale: number, more: Partial<HoloElement> = {}): HoloElement {
  const scale = fitScale(value, maxScale, width, minScale);
  return text(truncate(value, scale, width), x, y, { scale, ...more });
}

/** Like `fitted`, but starting at `left`. */
function fittedLeft(value: string, left: number, y: number, width: number, maxScale: number, minScale: number, more: Partial<HoloElement> = {}): HoloElement {
  const scale = fitScale(value, maxScale, width, minScale);
  return leftAligned(truncate(value, scale, width), left, y, { ...more, scale });
}

/** The title, at most `width` wide (smaller for long ones), centered on `x`. */
const title = (value: string, x = 0, width = HOLO_LAYOUT.edge * 2): HoloElement =>
  fitted(value, x, HOLO_LAYOUT.title.y, width, HOLO_LAYOUT.title.scale, 0.6, { tone: "title" });

export function idleContent(): HoloContent {
  return { frame: "logo", elements: [text("  Tap the terminal  ", 0, HOLO_LAYOUT.logoButtons.y, { box: "button" })] };
}

/** Play and Stats side by side under the logo, the chosen one selected. */
export function mainContent(chosen?: "play" | "stats"): HoloContent {
  const { x, y } = HOLO_LAYOUT.logoButtons;
  return {
    frame: "logo",
    elements: [
      text("   Play   ", -x, y, { box: chosen === "play" ? "selected" : "button" }),
      text("   Stats   ", x, y, { box: chosen === "stats" ? "selected" : "button" }),
    ],
  };
}

/** The game grid: three columns of cards (name over players needed), long names on two smaller lines, dim without enough players. */
export function gamesContent(choices: GameChoice[]): HoloContent {
  const { columns, width, top, rowGap, rows, scale, lineGap, countGap, countScale } = HOLO_LAYOUT.grid;
  const room = columns.length * rows;
  const shown = choices.length > room ? choices.slice(0, room - 1) : choices;
  const elements = [title("Choose a game")];
  shown.forEach(({ game, playable }, index) => {
    const x = columns[index % columns.length];
    const y = top - Math.floor(index / columns.length) * rowGap;
    const lines = wrap(game.name, scale, width, 2);
    lines.forEach((line, row) => elements.push(text(line, x, y - row * lineGap, { scale, box: "button", tone: playable ? "normal" : "dim" })));
    elements.push(text(playerCount(game), x, y - (lines.length - 1) * lineGap - countGap, { scale: countScale, tone: playable ? "dim" : "warn" }));
  });
  if (shown.length < choices.length) {
    const index = shown.length;
    elements.push(text(`+${choices.length - index} more`, columns[index % columns.length], top - Math.floor(index / columns.length) * rowGap, { scale, tone: "dim" }));
  }
  return { frame: "panel", elements };
}

/**
 * One game, like its screen's left column, everything left-aligned: the name, the players, then the
 * map and the settings as a table of labels (white) and answers (yellow, like the chosen one). The
 * picture is at the top right: the chosen map's preview, or the game's while the map is random. The
 * map list and Start aren't shown: only the terminal's user picks those.
 */
export function gameContent(view: GameView): HoloContent {
  const L = HOLO_LAYOUT.game;
  const { game, playable } = view.choice;
  const chosen = chosenMap(view);
  return {
    frame: "panel",
    elements: [
      fittedLeft(game.name, L.left, HOLO_LAYOUT.title.y, L.width, HOLO_LAYOUT.title.scale, 0.6, { tone: "title" }),
      fittedLeft(playersLine(view.choice), L.left, L.players, L.width, L.scale, 0.4, { tone: playable ? "dim" : "warn" }),
      // The table sits below the picture, so the answers can run to the edge.
      ...table(gameRows(view, chosen).slice(0, L.settings + 1), { left: L.left, y: L.settingsTop, gap: L.settingGap, scale: L.scale, labelWidth: L.width / 2, right: HOLO_LAYOUT.edge }),
    ],
    picture: chosen?.preview ?? gamePicture(game),
  };
}

/**
 * One game, layout 2 (only in the Preview menu for now): the picture across the top (the banner),
 * then two columns starting at the same height, each left-aligned: the name and players on the
 * left, the map and settings table on the right.
 */
export function gameBannerContent(view: GameView): HoloContent {
  const L = HOLO_LAYOUT.gameBanner;
  const { game, playable } = view.choice;
  const chosen = chosenMap(view);
  const titleScale = fitScale(game.name, L.titleScale, L.leftWidth, 0.5);
  const playersTop = L.top - textHeight(titleScale) - L.playersGap;
  return {
    frame: "panel",
    elements: [
      fittedLeft(game.name, L.left, topAligned(L.top, titleScale), L.leftWidth, titleScale, titleScale, { tone: "title" }),
      fittedLeft(playersLine(view.choice), L.left, topAligned(playersTop, L.scale), L.leftWidth, L.scale, 0.4, { tone: playable ? "dim" : "warn" }),
      ...table(gameRows(view, chosen).slice(0, L.settings + 1), {
        left: L.right,
        y: topAligned(L.top, L.scale),
        gap: L.settingGap,
        scale: L.scale,
        labelWidth: (HOLO_LAYOUT.edge - L.right) / 2,
        right: HOLO_LAYOUT.edge,
      }),
    ],
    picture: chosen?.preview ?? gamePicture(game),
    pictureSpot: "banner",
  };
}

/** The game screen's chosen map, or undefined while the map is random. */
function chosenMap(view: GameView): MapOption | undefined {
  return view.random ? undefined : mapOptions(view.choice.game).find((option) => option.id === view.map);
}

/** The players a game takes, or how many more it needs. */
function playersLine({ game, playable, reason }: GameChoice): string {
  return playable ? playerRange(game) : `Needs ${reason?.replace(/^needs at least /, "") ?? "more players"}`;
}

/** The game screen's map (the chosen one, or Random) and settings, as a table's rows. */
function gameRows(view: GameView, chosen: MapOption | undefined): { label: string; value: string }[] {
  return [
    { label: "Map:", value: chosen?.name ?? "Random" },
    ...settingsFor(view.choice.game).map((setting) => ({ label: `${setting.label}:`, value: settingLabel(setting, view.settings[setting.id]) })),
  ];
}

/**
 * A table of labels (white) and answers (yellow, like the chosen one), `gap` apart from the first
 * row at `y`: the labels start at `left` (each at most `labelWidth` wide), and the answers line up
 * just right of the widest label and run to `right`.
 */
function table(rows: { label: string; value: string }[], at: { left: number; y: number; gap: number; scale: number; labelWidth: number; right: number }): HoloElement[] {
  const labels = rows.map((row, index) => fittedLeft(row.label, at.left, at.y - index * at.gap, at.labelWidth, at.scale, 0.4));
  const valueLeft = at.left + Math.max(...labels.map((label) => textWidth(label.text, label.scale))) + HOLO_LAYOUT.game.valueGap;
  return rows.flatMap((row, index) => [labels[index], fittedLeft(row.value, valueLeft, labels[index].y, at.right - valueLeft, at.scale, 0.4, { box: "selected" })]);
}

/**
 * A game that's starting, centered both ways: "Starting Sumo", the map and "Getting the server
 * ready" while its server boots, then "Starting Sumo in", the seconds left (big, in yellow) and the
 * map.
 */
export function countdownContent(view: CountdownView): HoloContent {
  const L = HOLO_LAYOUT.countdown;
  const map: Line = { value: `on ${view.map}`, scale: L.mapScale, more: { tone: "dim" } };
  const lines: Line[] =
    view.left === undefined
      ? [{ value: `Starting ${view.game}`, scale: L.titleScale, more: { tone: "title" } }, map, { value: "Getting the server ready", scale: L.noteScale, more: { tone: "dim" } }]
      : [{ value: `Starting ${view.game} in`, scale: L.headingScale }, { value: String(view.left), scale: L.numberScale, more: { tone: "highlight" } }, map];
  return { frame: "panel", elements: centered(lines, L.gap) };
}

interface Line {
  value: string;
  scale: number;
  more?: Partial<HoloElement>;
}

/** Lines stacked top to bottom, `gap` apart, each centered across, the whole block centered on the panel's middle. */
function centered(lines: Line[], gap: number): HoloElement[] {
  const shown = lines.map(({ value, scale, more }) => fitted(value, 0, 0, HOLO_LAYOUT.edge * 2, scale, scale / 2, more));
  const height = shown.reduce((sum, line) => sum + textHeight(line.scale), 0) + gap * (shown.length - 1);
  let top = height / 2;
  return shown.map((line) => {
    const y = topAligned(top, line.scale ?? 1);
    top -= textHeight(line.scale) + gap;
    return { ...line, y };
  });
}

/** Team picking: a column per team (its name and count in the team's color, then its players), who's still random, and when teams lock. */
export function teamsContent(view: TeamPickView): HoloContent {
  const L = HOLO_LAYOUT.teams;
  const span = HOLO_LAYOUT.edge * 2;
  const count = Math.max(1, view.teams.length);
  const width = span / count - 0.1;
  const elements = [title(view.game)];
  view.teams.forEach((team, index) => {
    const x = -HOLO_LAYOUT.edge + ((index + 0.5) * span) / count;
    elements.push(fitted(`${team.name} ${team.members.length}/${team.cap}`, x, L.header, width, L.scale, L.minScale, { color: team.color, box: "tile" }));
    const shown = team.members.length > L.members ? team.members.slice(0, L.members - 1) : team.members;
    shown.forEach((name, row) => elements.push(fitted(name, x, L.membersTop - row * L.memberGap, width, L.scale, L.minScale)));
    if (shown.length < team.members.length) {
      elements.push(fitted(`+${team.members.length - shown.length} more`, x, L.membersTop - shown.length * L.memberGap, width, L.scale, L.minScale, { tone: "dim" }));
    }
  });
  if (view.unpicked.length > 0) elements.push(fitted(`Random: ${names(view.unpicked)}`, 0, L.random, span, L.scale, L.minScale, { tone: "dim" }));
  elements.push(fitted(view.status, 0, L.status, span, L.scale, L.minScale, { tone: "highlight" }));
  return { frame: "panel", elements };
}

/** The stats list: a column of player rows, the viewer first like the form (but without its "(me)": the hologram is for everyone). */
export function statsListContent(view: PlayersView): HoloContent {
  const L = HOLO_LAYOUT.list;
  const span = HOLO_LAYOUT.edge * 2;
  const total = view.players.length + view.more;
  const shown = total > L.rows ? view.players.slice(0, L.rows - 1) : view.players;
  const elements = [title("Stats")];
  shown.forEach((name, row) => elements.push(fitted(name, 0, L.top - row * L.gap, span, L.scale, 0.4, { box: "button" })));
  if (shown.length < total) elements.push(text(`+${total - shown.length} more`, 0, L.top - shown.length * L.gap, { scale: L.scale, tone: "dim" }));
  return { frame: "panel", elements };
}

/**
 * A player's stats as a grid. The top row has the portrait (badge) on the left and, beside it, the
 * open tab's name, the player's name and their rank. Below it, the open tab's stats are a table
 * across the panel: three columns of value over label, the last row "+N more" when they don't fit.
 */
export function statsContent(view: StatsView): HoloContent {
  const L = HOLO_LAYOUT.stats;
  const elements: HoloElement[] = [];
  const portrait = badgeFor(view.player);
  const tab = view.tabs.find((candidate) => candidate.id === view.tab);
  if (tab) elements.push(fittedLeft(tab.name, L.left, L.tab, L.width, L.tabScale, L.minScale, { box: "selected" }));
  elements.push(fittedLeft(view.player, L.left, L.name, L.width, L.nameScale, 0.5, { tone: "title" }));
  if (view.columns.length === 0) {
    elements.push(fittedLeft("No stats yet", L.left, L.rank, L.width, L.rankScale, L.minScale, { tone: "dim" }));
    return { frame: "panel", elements, portrait };
  }
  if (view.placement) {
    elements.push(fittedLeft(`Rank ${ordinal(view.placement.rank)} of ${view.placement.of}`, L.left, L.rank, L.width, L.rankScale, L.minScale, { tone: "highlight" }));
  }
  view.columns.forEach((stats, column) => {
    const x = L.columns[column];
    elements.push(fitted(STAT_COLUMNS[column], x, L.headings, L.columnWidth, L.headingScale, L.minScale, { tone: "dim" }));
    const shown = stats.length > L.tiles ? stats.slice(0, L.tiles - 1) : stats;
    shown.forEach((stat, row) => {
      const y = L.tilesTop - row * L.tileGap;
      elements.push(fitted(stat.value, x, y, L.columnWidth, L.valueScale, L.minScale, { box: "tile" }));
      elements.push(fitted(stat.label, x, y - L.labelGap, L.columnWidth, L.labelScale, L.minScale, { tone: "dim" }));
    });
    if (shown.length < stats.length) {
      elements.push(fitted(`+${stats.length - shown.length} more`, x, L.tilesTop - shown.length * L.tileGap, L.columnWidth, L.labelScale, L.minScale, { tone: "dim" }));
    }
  });
  return { frame: "panel", elements, portrait };
}

/** Up to three names, then how many more: "Steve, Alex, Bob +2". */
function names(list: string[]): string {
  return list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} +${list.length - 3}`;
}
