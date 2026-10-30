// The terminal's themed menus. A form's title starts with a layout mark, formatting codes that
// never render; the lobby resource pack (ui/server_form.json and ui/minecade_forms.json) shows
// marked forms with Minecade's holographic layouts, and sorts their buttons into columns by the
// markers in game-screen.ts. Without the pack, they're plain forms with readable titles and buttons.
// Every themed menu's first button is the X (top right), which main.ts turns into CLOSE.
import { ActionFormData } from "@minecraft/server-ui";
import { say } from "@minecade/minigame-core";
import { MARK, gameButtons, gamePicture, mapOptions, playerCount, playerRange, settingLabel, settingsFor, type GameSetting } from "./game-screen.ts";
import type { GameChoice } from "./lobby-controller.ts";
import { PREVIEW_SCREENS } from "./holo-preview.ts";
import { hasSkin, headFor, portraitFor } from "./skins.ts";
import { statsButtons, type PlayersView, type StatsView } from "./stats-screens.ts";

/** Layout marks. Each must match the resource pack's UI files (a test checks). */
export const LAYOUT = {
  main: "§m§a§i§n",
  games: "§g§r§i§d",
  game: "§g§a§m§e",
  players: "§s§l§s§t",
  stats: "§s§d§t§l",
} as const;

/** Icons drawn inline in text, from the lobby resource pack's font/glyph_E3.png (one 16x16 cell each). */
export const GLYPH = {
  player: "",
  /** A setting's bars: the chosen value, and the others. */
  barOn: "",
  barOff: "",
} as const;

export const MAIN_MENU_CHOICES = ["play", "stats", "preview"] as const;

/** The X: every themed menu's first button, shown in its top right corner (menuChoice() turns it into CLOSE). */
export const CLOSE_BUTTON = `${MARK.close}Close`;

/** A themed menu: its title (starting with its layout mark), then the X. */
function themedForm(title: string): ActionFormData {
  return new ActionFormData().title(title).button(CLOSE_BUTTON);
}

/** Play and Stats under the Minecade logo; with DEV_HOLO_PREVIEW, a small Preview button in the corner too. */
export function mainMenuForm(preview = false): ActionFormData {
  const form = themedForm(`${LAYOUT.main}§rMinecade`)
    .button("Play", "textures/minecade/ui/icon_play")
    .button("Stats", "textures/minecade/ui/icon_stats");
  if (preview) form.button(`${MARK.preview}Preview`);
  return form;
}

/** DEV_HOLO_PREVIEW: a plain list of the hologram's screens. */
export function previewForm(): ActionFormData {
  const form = new ActionFormData().title("Hologram preview").body("Pick a screen. It stays on the hologram until you tap the terminal again.");
  for (const screen of PREVIEW_SCREENS) form.button(screen.name);
  return form;
}

/** A card per game, three columns across: its 16:9 picture, its name, and a player icon with the players it needs (red when short). */
export function gamesForm(choices: GameChoice[]): ActionFormData {
  const form = themedForm(`${LAYOUT.games}§rPlay`);
  choices.forEach(({ game, playable }, index) => {
    form.button(`${MARK.games[index % 3]}${game.name}\n${playable ? "§7" : "§c"}${GLYPH.player} ${playerCount(game)}`, gamePicture(game));
  });
  return form;
}

/** One bar per value, the chosen one bright (the first when the value is unknown, as settingLabel does). */
export function settingBars(setting: GameSetting, current: string | undefined): string {
  const chosen = Math.max(0, setting.values.findIndex((option) => option.value === current));
  return setting.values.map((_, index) => (index === chosen ? GLYPH.barOn : GLYPH.barOff)).join("");
}

export interface GameView {
  choice: GameChoice;
  /** Random map, or the chosen one. */
  random: boolean;
  /** The chosen map's id (the first map until another is picked). */
  map: string;
  settings: Record<string, string>;
}

/** The game screen: the Random map switch, the settings, map tiles (two columns, the chosen one outlined), and Start. */
export function gameForm(view: GameView): ActionFormData {
  const { game, playable, reason } = view.choice;
  const info = [game.description ? say.minor(game.description) : "", say.info(playerRange(game))];
  if (!playable) info.push(say.warn(`${game.name} ${reason}.`));
  const form = themedForm(`${LAYOUT.game}§r${game.name}`).body(info.filter(Boolean).join("\n\n"));
  const maps = mapOptions(game);
  const settings = settingsFor(game);
  for (const { action, mark } of gameButtons(game)) {
    if (action.kind === "random") {
      form.button(`${mark}${view.random ? MARK.on : ""}Random map`);
    } else if (action.kind === "setting") {
      const setting = settings.find((candidate) => candidate.id === action.id)!;
      const current = view.settings[setting.id];
      form.button(`${mark}${setting.label}: ${settingLabel(setting, current)}\n${settingBars(setting, current)}`);
    } else if (action.kind === "map") {
      const map = maps.find((option) => option.id === action.map)!;
      const state = view.random ? MARK.dim : map.id === view.map ? MARK.selected : "";
      form.button(`${mark}${state}${map.name}`, map.preview);
    } else {
      form.button(`${mark}${playable ? "Start" : "§7Start"}`);
    }
  }
  return form;
}

/** The stats list: a row per player with their badge, the viewer first with "(me)". */
export function playersForm(view: PlayersView): ActionFormData {
  const form = themedForm(`${LAYOUT.players}§rStats`);
  if (view.more > 0) form.body(say.minor(`And ${view.more} more not listed.`));
  for (const name of view.players) form.button(`${MARK.player}${name}${name === view.viewer ? " §7(me)" : ""}`, headFor(name));
  return form;
}

/**
 * A player's stats: their portrait (badge), a tab per view (the open one outlined), the rank as the
 * body, and the open tab's stats as tiles in three columns (value over label).
 */
export function statsForm(view: StatsView): ActionFormData {
  const form = themedForm(`${LAYOUT.stats}§r${view.player}`).body(view.body);
  for (const button of statsButtons(view)) {
    if (button.kind === "portrait") form.button(`${MARK.portrait}${hasSkin(view.player) ? MARK.render : ""}${view.player}`, portraitFor(view.player));
    else if (button.kind === "tab") form.button(`${MARK.tab}${button.tab.id === view.tab ? MARK.selected : ""}${button.tab.name}`);
    else form.button(`${MARK.stats[button.column]}§f${button.stat.value}\n§7${button.stat.label}`);
  }
  return form;
}
