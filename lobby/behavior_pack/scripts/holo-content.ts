// What the hologram shows, as plain data: one of two frames (the user's art), text elements placed
// on the panel, and up to two pictures. Each screen's layout mirrors its form: buttons are light
// blue text, the open or chosen one yellow. The terminal and the stats and
// team screens build this from the same views their forms use; hologram.ts draws it on all four
// sides. Positions and sizes are in HOLO_LAYOUT, to tune against the frame art.
import { ordinal } from "@minecade/minigame-core";
import { gamePicture, mapOptions, playerCount, playerRange, settingLabel, settingsFor } from "./game-screen.ts";
import type { GameChoice } from "./lobby-controller.ts";
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

export interface HoloContent {
  frame: Frame;
  elements: HoloElement[];
  /** A 16:9 texture path (a game's picture or a map's preview), at the top right. */
  picture?: string;
  /** A square texture path (a player's badge), at the top left. */
  portrait?: string;
}

/** The most elements one screen uses (hologram.ts keeps this many text shapes per side). */
export const MAX_ELEMENTS = 48;

/**
 * Where things go, in blocks from the panel's middle. The picture and portrait spots are fixed in
 * the hologram's model (models/entity/holo_display.geo.json): the picture spans x 0.13 to 1.38
 * and y 0.31 to 1.02, the portrait x -1.38 to -0.5 and y 0.19 to 1.06. (The model's x runs
 * opposite to the reader's: a spot on the reader's right has negative x in the model.)
 */
export const HOLO_LAYOUT = {
  /** About how wide one character is at scale 1, in blocks (measured in game: about 0.135). */
  charWidth: 0.14,
  title: { y: 1.12, scale: 1.15 },
  /** Buttons under the logo (idle and main). */
  logoButtons: { y: -0.45, x: 0.62 },
  grid: { columns: [-1, 0, 1], width: 0.92, top: 0.66, rowGap: 0.42, rows: 5, scale: 0.6, lineGap: 0.13, countGap: 0.15, countScale: 0.42 },
  game: { left: -1.35, width: 1.4, players: 0.84, random: 0.45, settingsTop: 0.15, settingGap: 0.3, settings: 4, scale: 0.6, mapsHeading: 0.13, mapColumns: [0.44, 1.06], mapWidth: 0.58, mapsTop: -0.1, mapGap: 0.28, mapRows: 5 },
  teams: { header: 0.72, membersTop: 0.42, memberGap: 0.25, members: 4, random: -0.82, status: -1.15, scale: 0.75, minScale: 0.45 },
  list: { top: 0.72, gap: 0.3, rows: 7, scale: 0.8 },
  stats: { leftX: -0.94, tab: -0.12, rightX: 0.6, rightWidth: 1.7, rank: 0.84, columns: [0.02, 0.62, 1.22], columnWidth: 0.56, headings: 0.58, tilesTop: 0.36, tileGap: 0.3, labelGap: 0.12, tiles: 6, valueScale: 0.55, labelScale: 0.4, minScale: 0.28 },
} as const;

const text = (value: string, x: number, y: number, more: Partial<HoloElement> = {}): HoloElement => ({ text: value, x, y, ...more });

/** The title, at most `width` wide (smaller for long ones), centered on `x`. */
const title = (value: string, x = 0, width = 2.8): HoloElement => {
  const scale = fitScale(value, HOLO_LAYOUT.title.scale, width, 0.6);
  return text(truncate(value, scale, width), x, HOLO_LAYOUT.title.y, { scale, tone: "title" });
};

/** Roughly how wide `value` is at `scale`, in blocks (the font is proportional, so this is an estimate). */
export function textWidth(value: string, scale = 1): number {
  return value.length * scale * HOLO_LAYOUT.charWidth;
}

/** The largest scale, up to `maxScale` and no smaller than `minScale`, at which `value` fits `width`. */
export function fitScale(value: string, maxScale: number, width: number, minScale = maxScale): number {
  if (value.length === 0) return maxScale;
  return Math.max(minScale, Math.min(maxScale, width / textWidth(value)));
}

/** `value` cut down (ending in "..") so it fits `width` at `scale`. */
export function truncate(value: string, scale: number, width: number): string {
  if (textWidth(value, scale) <= width) return value;
  const room = Math.max(1, Math.floor(width / (scale * HOLO_LAYOUT.charWidth)) - 2);
  return `${value.slice(0, room).trimEnd()}..`;
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
 * One game, like its screen: on the left the name, players, the Random map switch and the settings,
 * left-aligned; on the right the picture (the chosen map's preview, or the game's while the map is
 * random) over the maps in two columns, the chosen one selected and all of them dim while random.
 * Start isn't shown: only the terminal's user can press it.
 */
export function gameContent(view: GameView): HoloContent {
  const L = HOLO_LAYOUT.game;
  const { game, playable, reason } = view.choice;
  const maps = mapOptions(game);
  const chosen = view.random ? undefined : maps.find((option) => option.id === view.map);
  const line = (value: string, y: number, more: Partial<HoloElement> = {}) => {
    const scale = fitScale(value, L.scale, L.width, 0.4);
    return leftAligned(truncate(value, scale, L.width), L.left, y, { scale, ...more });
  };
  const titleScale = fitScale(game.name, HOLO_LAYOUT.title.scale, L.width, 0.6);
  const elements = [
    leftAligned(truncate(game.name, titleScale, L.width), L.left, HOLO_LAYOUT.title.y, { scale: titleScale, tone: "title" }),
    line(playable ? playerRange(game) : `Needs ${reason?.replace(/^needs at least /, "") ?? "more players"}`, L.players, { tone: playable ? "dim" : "warn" }),
    line(`Random map: ${view.random ? "On" : "Off"}`, L.random, { box: view.random ? "selected" : "button" }),
  ];
  settingsFor(game)
    .slice(0, L.settings)
    .forEach((setting, index) => elements.push(line(`${setting.label}: ${settingLabel(setting, view.settings[setting.id])}`, L.settingsTop - index * L.settingGap, { box: "button" })));
  const middle = (L.mapColumns[0] + L.mapColumns[L.mapColumns.length - 1]) / 2;
  elements.push(text("Maps", middle, L.mapsHeading, { scale: 0.45, tone: "dim" }));
  const room = L.mapColumns.length * L.mapRows;
  const shown = maps.length > room ? maps.slice(0, room - 1) : maps;
  shown.forEach((map, index) => {
    const x = L.mapColumns[index % L.mapColumns.length];
    const y = L.mapsTop - Math.floor(index / L.mapColumns.length) * L.mapGap;
    const scale = fitScale(map.name, L.scale, L.mapWidth, 0.4);
    elements.push(text(truncate(map.name, scale, L.mapWidth), x, y, { scale, box: map.id === chosen?.id ? "selected" : "button", tone: view.random ? "dim" : "normal" }));
  });
  if (shown.length < maps.length) {
    const index = shown.length;
    elements.push(text(`+${maps.length - index} more`, L.mapColumns[index % L.mapColumns.length], L.mapsTop - Math.floor(index / L.mapColumns.length) * L.mapGap, { scale: 0.45, tone: "dim" }));
  }
  return { frame: "panel", elements, picture: chosen?.preview ?? gamePicture(game) };
}

/** Team picking: a column per team (its name and count in the team's color, then its players), who's still random, and when teams lock. */
export function teamsContent(view: TeamPickView): HoloContent {
  const L = HOLO_LAYOUT.teams;
  const count = Math.max(1, view.teams.length);
  const elements = [title(view.game)];
  view.teams.forEach((team, index) => {
    const x = -1.5 + ((index + 0.5) * 3) / count;
    elements.push(text(` ${team.name} ${team.members.length}/${team.cap} `, x, L.header, { scale: L.scale, color: team.color, box: "tile" }));
    const shown = team.members.length > L.members ? team.members.slice(0, L.members - 1) : team.members;
    const width = 3 / count - 0.1;
    shown.forEach((name, row) => {
      const scale = fitScale(name, L.scale, width, L.minScale);
      elements.push(text(truncate(name, scale, width), x, L.membersTop - row * L.memberGap, { scale }));
    });
    if (shown.length < team.members.length) {
      elements.push(text(`+${team.members.length - shown.length} more`, x, L.membersTop - shown.length * L.memberGap, { scale: L.scale, tone: "dim" }));
    }
  });
  if (view.unpicked.length > 0) elements.push(text(`Random: ${names(view.unpicked)}`, 0, L.random, { scale: L.scale, tone: "dim" }));
  elements.push(text(view.status, 0, L.status, { scale: L.scale, tone: "highlight" }));
  return { frame: "panel", elements };
}

/** The stats list: a column of player rows, the viewer first with "(me)". */
export function statsListContent(view: PlayersView): HoloContent {
  const L = HOLO_LAYOUT.list;
  const total = view.players.length + view.more;
  const shown = total > L.rows ? view.players.slice(0, L.rows - 1) : view.players;
  const elements = [title("Stats")];
  shown.forEach((name, row) => elements.push(text(` ${name}${name === view.viewer ? " (me)" : ""} `, 0, L.top - row * L.gap, { scale: L.scale, box: "button" })));
  if (shown.length < total) elements.push(text(`+${total - shown.length} more`, 0, L.top - shown.length * L.gap, { scale: L.scale, tone: "dim" }));
  return { frame: "panel", elements };
}

/**
 * A player's stats, like their screen: on the left the portrait (badge) with the open tab's name
 * under it; on the right the name, the rank, and the open tab's stats in three columns (value over
 * label), sized to fit their columns.
 */
export function statsContent(view: StatsView): HoloContent {
  const L = HOLO_LAYOUT.stats;
  const elements = [title(view.player, L.rightX, L.rightWidth)];
  const tab = view.tabs.find((candidate) => candidate.id === view.tab);
  if (tab) {
    const scale = fitScale(tab.name, L.valueScale + 0.15, 1.1, L.minScale);
    elements.push(text(truncate(tab.name, scale, 1.1), L.leftX, L.tab, { scale, box: "selected" }));
  }
  if (view.columns.length === 0) {
    elements.push(text("No stats yet", L.rightX, L.rank, { scale: L.valueScale + 0.15, tone: "dim" }));
    return { frame: "panel", elements, portrait: badgeFor(view.player) };
  }
  if (view.placement) elements.push(text(`Rank ${ordinal(view.placement.rank)} of ${view.placement.of}`, L.rightX, L.rank, { scale: L.valueScale + 0.15, tone: "highlight" }));
  view.columns.forEach((stats, column) => {
    const x = L.columns[column];
    elements.push(text(STAT_COLUMNS[column], x, L.headings, { scale: fitScale(STAT_COLUMNS[column], L.labelScale, L.columnWidth, L.minScale), tone: "dim" }));
    stats.slice(0, L.tiles).forEach((stat, row) => {
      const y = L.tilesTop - row * L.tileGap;
      const valueScale = fitScale(stat.value, L.valueScale, L.columnWidth, L.minScale);
      const labelScale = fitScale(stat.label, L.labelScale, L.columnWidth, L.minScale);
      elements.push(text(truncate(stat.value, valueScale, L.columnWidth), x, y, { scale: valueScale, box: "tile" }));
      elements.push(text(truncate(stat.label, labelScale, L.columnWidth), x, y - L.labelGap, { scale: labelScale, tone: "dim" }));
    });
  });
  return { frame: "panel", elements, portrait: badgeFor(view.player) };
}

/** Up to three names, then how many more: "Steve, Alex, Bob +2". */
function names(list: string[]): string {
  return list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} +${list.length - 3}`;
}
