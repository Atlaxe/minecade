// The Colors tool: the map's water, grass and foliage colors (map.json "colors"). A use opens its
// screen, and so does tapping Colors in the map menu: the Biome list (every biome, for all three
// colors), the Water, Grass and Foliage lists (every biome again, for that one color), Type colors,
// Remove colors, and Set colors to save them. The colors show on the map's servers through a pack
// that loads when a server starts, so after a change the host starts Edit again to show them.
import type { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { BIOME_COLORS, COLOR_PARTS, COLOR_PART_NAMES, colorsText, parseColor, shownColors, tidyColors, type ColorPart } from "@minecade/minigame-core";
import { sideTitle } from "./marks.ts";
import { colorsScreenEntries, type ColorsList } from "./menu.ts";
import type { ToolHost } from "./tool-host.ts";

export class ColorsTool {
  private readonly host: ToolHost;

  constructor(host: ToolHost) {
    this.host = host;
  }

  /** A use: the screen (`back` opens the map menu). */
  use(player: Player, back?: () => Promise<void>): Promise<void> {
    return this.screen(player, back);
  }

  /** The action bar line while the tool is held. */
  hint(): string {
    return `Use: set the map's water, grass and foliage colors   Now: ${colorsText(this.host.map().colors)}`;
  }

  /** The screen: lists to pick colors from, then Set colors saves them. */
  async screen(player: Player, back?: () => Promise<void>): Promise<void> {
    let colors = shownColors(this.host.map().colors);
    const picked: Partial<Record<ColorsList, string>> = {};
    let open: ColorsList | undefined;
    for (;;) {
      const entries = colorsScreenEntries({ colors, picked, ...(open ? { open } : {}), set: this.host.map().colors !== undefined, back: back !== undefined });
      const form = new ActionFormData().title(sideTitle("Colors"));
      for (const entry of entries) form.button(entry.text, entry.icon);
      const response = await this.host.show(player, form);
      const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
      if (!action || !player.isValid) return;
      if (action.kind === "back") return back?.();
      if (action.kind === "save") return this.set(player, colors);
      if (action.kind === "remove") {
        this.host.edit(player, { op: "colors" }, "Colors removed: the map has plains' own again. Edit starts again to show them.");
        return;
      }
      if (action.kind === "open") open = open === action.list ? undefined : action.list;
      else if (action.kind === "biome") {
        const biome = BIOME_COLORS.find((candidate) => candidate.id === action.id);
        if (biome) {
          colors = { water: biome.water, grass: biome.grass, foliage: biome.foliage };
          picked.biome = biome.id;
          for (const part of COLOR_PARTS) picked[part] = biome.id;
        }
        open = undefined;
      } else if (action.kind === "part") {
        const biome = BIOME_COLORS.find((candidate) => candidate.id === action.id);
        if (biome) {
          colors = { ...colors, [action.part]: biome[action.part] };
          picked[action.part] = biome.id;
        }
        open = undefined;
      } else if (action.kind === "type") colors = (await this.typeColors(player, colors)) ?? colors;
    }
  }

  private set(player: Player, colors: Record<ColorPart, string>): void {
    const now = JSON.stringify(tidyColors(this.host.map().colors) ?? null);
    if (JSON.stringify(tidyColors(colors) ?? null) === now) return this.host.tell(player, `The colors are already ${colorsText(colors)}.`);
    const tidy = tidyColors(colors);
    if (!tidy) {
      this.host.edit(player, { op: "colors" }, "Colors set to plains' own. Edit starts again to show them.");
      return;
    }
    this.host.edit(player, { op: "colors", colors: tidy }, `Colors set to ${colorsText(colors)}. Edit starts again to show them.`);
  }

  /** Colors typed into a side form, one box per part; undefined (and why) when one isn't a color. */
  private async typeColors(player: Player, colors: Record<ColorPart, string>): Promise<Record<ColorPart, string> | undefined> {
    const form = new ModalFormData().title(sideTitle("Colors"));
    for (const part of COLOR_PARTS) form.textField(COLOR_PART_NAMES[part], colors[part], { defaultValue: colors[part] });
    form.submitButton("Done");
    const response = await this.host.show(player, form);
    if (!response?.formValues || !player.isValid) return undefined;
    const typed = { ...colors };
    for (const [i, part] of COLOR_PARTS.entries()) {
      const color = parseColor(String(response.formValues[i] ?? ""));
      if (!color) {
        this.host.tell(player, `§c${COLOR_PART_NAMES[part]} needs a color: "#" and six hex digits, such as #44AFF5.`);
        return undefined;
      }
      typed[part] = color;
    }
    return typed;
  }
}
