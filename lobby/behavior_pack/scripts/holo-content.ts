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
 * and y 0.31 to 1.02, the portrait x -1.38 to -0.5 and y 0.19 to 1.06.
 */
export const HOLO_LAYOUT = {
  title: { y: 1.12, scale: 1.15 },
  /** Buttons under the logo (idle and main). */
  logoButtons: { y: -0.45, x: 0.62 },
  grid: { columns: [-1, 0, 1], top: 0.62, rowGap: 0.42, rows: 5, scale: 0.7, countGap: 0.17, countScale: 0.55 },
  game: { leftX: -0.75, players: 0.84, random: 0.45, settingsTop: 0.1, settingGap: 0.35, settings: 3, start: -1.15, mapColumns: [0.42, 1.08], mapsTop: 0.05, mapGap: 0.3, mapRows: 4, scale: 0.75 },
  teams: { header: 0.72, membersTop: 0.42, memberGap: 0.25, members: 4, random: -0.82, status: -1.15, scale: 0.75 },
  list: { top: 0.72, gap: 0.3, rows: 7, scale: 0.8 },
  stats: { tabsX: -0.94, tabsTop: -0.12, tabGap: 0.3, tabs: 4, rightX: 0.6, rank: 0.84, columns: [0.0, 0.6, 1.2], headings: 0.55, tilesTop: 0.3, tileGap: 0.36, labelGap: 0.15, tiles: 5, valueScale: 0.8, labelScale: 0.5 },
} as const;

const text = (value: string, x: number, y: number, more: Partial<HoloElement> = {}): HoloElement => ({ text: value, x, y, ...more });
const title = (value: string, x = 0): HoloElement => text(value, x, HOLO_LAYOUT.title.y, { scale: HOLO_LAYOUT.title.scale, tone: "title" });

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

/** The game grid: three columns of cards (name over players needed), dim without enough players. */
export function gamesContent(choices: GameChoice[]): HoloContent {
  const { columns, top, rowGap, rows, scale, countGap, countScale } = HOLO_LAYOUT.grid;
  const room = columns.length * rows;
  const shown = choices.length > room ? choices.slice(0, room - 1) : choices;
  const elements = [title("Choose a game")];
  shown.forEach(({ game, playable }, index) => {
    const x = columns[index % columns.length];
    const y = top - Math.floor(index / columns.length) * rowGap;
    elements.push(text(` ${game.name} `, x, y, { scale, box: "button", tone: playable ? "normal" : "dim" }));
    elements.push(text(playerCount(game), x, y - countGap, { scale: countScale, tone: playable ? "dim" : "warn" }));
  });
  if (shown.length < choices.length) {
    const index = shown.length;
    elements.push(text(`+${choices.length - index} more`, columns[index % columns.length], top - Math.floor(index / columns.length) * rowGap, { scale, tone: "dim" }));
  }
  return { frame: "panel", elements };
}

/**
 * One game, like its screen: on the left the name, players, the Random map switch, the settings and
 * Start; on the right the picture (the chosen map's preview, or the game's while the map is random)
 * over the maps in two columns, the chosen one selected and all of them dim while random.
 */
export function gameContent(view: GameView): HoloContent {
  const L = HOLO_LAYOUT.game;
  const { game, playable, reason } = view.choice;
  const maps = mapOptions(game);
  const chosen = view.random ? undefined : maps.find((option) => option.id === view.map);
  const elements = [
    title(game.name, L.leftX),
    text(playable ? playerRange(game) : `Needs ${reason?.replace(/^needs at least /, "") ?? "more players"}`, L.leftX, L.players, { scale: L.scale, tone: playable ? "dim" : "warn" }),
    text(` Random map: ${view.random ? "On" : "Off"} `, L.leftX, L.random, { scale: L.scale, box: view.random ? "selected" : "button" }),
  ];
  settingsFor(game)
    .slice(0, L.settings)
    .forEach((setting, index) => {
      elements.push(text(` ${setting.label}: ${settingLabel(setting, view.settings[setting.id])} `, L.leftX, L.settingsTop - index * L.settingGap, { scale: L.scale, box: "button" }));
    });
  elements.push(text("     Start     ", L.leftX, L.start, { scale: L.scale, box: "button", tone: playable ? "normal" : "dim" }));
  const room = L.mapColumns.length * L.mapRows;
  const shown = maps.length > room ? maps.slice(0, room - 1) : maps;
  shown.forEach((map, index) => {
    const x = L.mapColumns[index % L.mapColumns.length];
    const y = L.mapsTop - Math.floor(index / L.mapColumns.length) * L.mapGap;
    elements.push(text(` ${map.name} `, x, y, { scale: L.scale, box: map.id === chosen?.id ? "selected" : "button", tone: view.random ? "dim" : "normal" }));
  });
  if (shown.length < maps.length) {
    const index = shown.length;
    elements.push(text(`+${maps.length - index} more`, L.mapColumns[index % L.mapColumns.length], L.mapsTop - Math.floor(index / L.mapColumns.length) * L.mapGap, { scale: L.scale, tone: "dim" }));
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
    shown.forEach((name, row) => elements.push(text(name, x, L.membersTop - row * L.memberGap, { scale: L.scale })));
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
 * A player's stats, like their screen: on the left the portrait (badge) over the tabs, the open one
 * selected; on the right the name, the rank, and the open tab's stats in three columns of tiles
 * (value over label).
 */
export function statsContent(view: StatsView): HoloContent {
  const L = HOLO_LAYOUT.stats;
  const elements = [title(view.player, L.rightX)];
  const tabs = view.tabs.length > L.tabs ? view.tabs.slice(0, L.tabs) : view.tabs;
  tabs.forEach((tab, row) => elements.push(text(` ${tab.name} `, L.tabsX, L.tabsTop - row * L.tabGap, { scale: L.valueScale, box: tab.id === view.tab ? "selected" : "button" })));
  if (view.columns.length === 0) {
    elements.push(text("No stats yet", L.rightX, L.rank, { scale: L.valueScale, tone: "dim" }));
    return { frame: "panel", elements, portrait: badgeFor(view.player) };
  }
  if (view.placement) elements.push(text(`Rank ${ordinal(view.placement.rank)} of ${view.placement.of}`, L.rightX, L.rank, { scale: L.valueScale, tone: "highlight" }));
  view.columns.forEach((stats, column) => {
    const x = L.columns[column];
    elements.push(text(STAT_COLUMNS[column], x, L.headings, { scale: L.labelScale, tone: "dim" }));
    stats.slice(0, L.tiles).forEach((stat, row) => {
      const y = L.tilesTop - row * L.tileGap;
      elements.push(text(` ${stat.value} `, x, y, { scale: L.valueScale, box: "tile" }));
      elements.push(text(stat.label, x, y - L.labelGap, { scale: L.labelScale, tone: "dim" }));
    });
  });
  return { frame: "panel", elements, portrait: badgeFor(view.player) };
}

/** Up to three names, then how many more: "Steve, Alex, Bob +2". */
function names(list: string[]): string {
  return list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} +${list.length - 3}`;
}
