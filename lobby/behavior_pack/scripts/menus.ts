// The terminal's themed menus. A form's title starts with a layout mark, formatting codes that
// never render; the lobby resource pack (ui/server_form.json and ui/minecade_forms.json) shows
// marked forms with Minecade's holographic layout. Without the pack, they're plain forms with a
// readable title.
import { ActionFormData } from "@minecraft/server-ui";

/** Layout marks. Each must match the resource pack's UI files (a test checks). */
export const LAYOUT = {
  main: "§m§a§i§n",
} as const;

export const MAIN_MENU_CHOICES = ["play", "stats"] as const;

/** Play and Stats, under the Minecade logo, with a status line. */
export function mainMenuForm(status: string): ActionFormData {
  return new ActionFormData()
    .title(`${LAYOUT.main}§rMinecade`)
    .body(status)
    .button("Play", "textures/minecade/ui/icon_play")
    .button("Stats", "textures/minecade/ui/icon_stats");
}
