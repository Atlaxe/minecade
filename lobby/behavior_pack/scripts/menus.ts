// The terminal's themed menus. A form's title starts with a layout mark, formatting codes that
// never render; the lobby resource pack (ui/server_form.json and ui/minecade_forms.json) shows
// marked forms with Minecade's holographic layouts. Without the pack, they're plain forms with
// readable titles and buttons.
import { ActionFormData } from "@minecraft/server-ui";
import { say } from "@minecade/minigame-core";
import { MAP_SLOTS, SETTING_SLOTS, mapOptions, playerRange, settingLabel, settingsFor } from "./game-screen.ts";
import type { GameChoice } from "./lobby-controller.ts";

/** Layout marks. Each must match the resource pack's UI files (a test checks). */
export const LAYOUT = {
  main: "§m§a§i§n",
  games: "§g§r§i§d",
  game: "§g§a§m§e",
} as const;

/** Starts the selected map tile's text, so the pack can highlight it. Must match minecade_forms.json. */
export const SELECTED = "§s§e§l§r";

export const MAIN_MENU_CHOICES = ["play", "stats"] as const;

/** Play and Stats under the Minecade logo. */
export function mainMenuForm(): ActionFormData {
  return new ActionFormData()
    .title(`${LAYOUT.main}§rMinecade`)
    .button("Play", "textures/minecade/ui/icon_play")
    .button("Stats", "textures/minecade/ui/icon_stats");
}

/** A tile per game: its icon, its name, and the players it needs (in red when there aren't enough). */
export function gamesForm(choices: GameChoice[]): ActionFormData {
  const form = new ActionFormData().title(`${LAYOUT.games}§rPlay`);
  for (const { game, playable, reason } of choices) {
    form.button(`${game.name}\n${playable ? `§7${playerRange(game)}` : `§c${reason}`}`, game.icon);
  }
  return form;
}

export interface GameView {
  choice: GameChoice;
  /** The selected map id, or "random". */
  map: string;
  settings: Record<string, string>;
}

/**
 * The game screen: map tiles (padded to MAP_SLOTS), then Start, then the settings (padded to
 * SETTING_SLOTS), so the pack can place Start and the settings by their fixed index.
 */
export function gameForm(view: GameView): ActionFormData {
  const { game, playable, reason } = view.choice;
  const info = [game.description ? say.minor(game.description) : "", say.info(playerRange(game))];
  if (!playable) info.push(say.warn(`${game.name} ${reason}.`));
  const form = new ActionFormData().title(`${LAYOUT.game}§r${game.name}`).body(info.filter(Boolean).join("\n\n"));
  const maps = mapOptions(game);
  for (let i = 0; i < MAP_SLOTS; i++) {
    const map = maps[i];
    if (map) form.button(`${map.id === view.map ? SELECTED : ""}${map.name}`, map.icon);
    else form.button("");
  }
  form.button(playable ? "Start" : "§7Start");
  const settings = settingsFor(game);
  for (let i = 0; i < SETTING_SLOTS; i++) {
    const setting = settings[i];
    form.button(setting ? `${setting.label}: ${settingLabel(setting, view.settings[setting.id])}` : "");
  }
  return form;
}
