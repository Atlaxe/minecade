// The terminal's themed menus. A form's title starts with a layout mark, formatting codes that
// never render; the lobby resource pack (ui/server_form.json and ui/minecade_forms.json) shows
// marked forms with Minecade's holographic layouts, and sorts their buttons into columns by the
// markers in game-screen.ts. Without the pack, they're plain forms with readable titles and buttons.
import { ActionFormData } from "@minecraft/server-ui";
import { say } from "@minecade/minigame-core";
import { MARK, gameButtons, mapOptions, playerRange, settingLabel, settingsFor } from "./game-screen.ts";
import type { GameChoice } from "./lobby-controller.ts";

/** Layout marks. Each must match the resource pack's UI files (a test checks). */
export const LAYOUT = {
  main: "§m§a§i§n",
  games: "§g§r§i§d",
  game: "§g§a§m§e",
} as const;

export const MAIN_MENU_CHOICES = ["play", "stats"] as const;

/** Play and Stats under the Minecade logo. */
export function mainMenuForm(): ActionFormData {
  return new ActionFormData()
    .title(`${LAYOUT.main}§rMinecade`)
    .button("Play", "textures/minecade/ui/icon_play")
    .button("Stats", "textures/minecade/ui/icon_stats");
}

/** A card per game, three columns across: its 16:9 picture, its name, and the players it needs (red when short). */
export function gamesForm(choices: GameChoice[]): ActionFormData {
  const form = new ActionFormData().title(`${LAYOUT.games}§rPlay`);
  choices.forEach(({ game, playable, reason }, index) => {
    form.button(`${MARK.games[index % 3]}${game.name}\n${playable ? `§7${playerRange(game)}` : `§c${reason}`}`, game.icon);
  });
  return form;
}

export interface GameView {
  choice: GameChoice;
  /** The selected map id, or "random". */
  map: string;
  settings: Record<string, string>;
}

/** The game screen: map tiles (two columns, the chosen one outlined), the settings, and Start. */
export function gameForm(view: GameView): ActionFormData {
  const { game, playable, reason } = view.choice;
  const info = [game.description ? say.minor(game.description) : "", say.info(playerRange(game))];
  if (!playable) info.push(say.warn(`${game.name} ${reason}.`));
  const form = new ActionFormData().title(`${LAYOUT.game}§r${game.name}`).body(info.filter(Boolean).join("\n\n"));
  const maps = mapOptions(game);
  const settings = settingsFor(game);
  for (const { action, mark } of gameButtons(game)) {
    if (action.kind === "map") {
      const map = maps.find((option) => option.id === action.map)!;
      form.button(`${mark}${map.id === view.map ? MARK.selected : ""}${map.name}`, map.preview);
    } else if (action.kind === "setting") {
      const setting = settings.find((candidate) => candidate.id === action.id)!;
      form.button(`${mark}${setting.label}: ${settingLabel(setting, view.settings[setting.id])}`);
    } else {
      form.button(`${mark}${playable ? "Start" : "§7Start"}`);
    }
  }
  return form;
}
