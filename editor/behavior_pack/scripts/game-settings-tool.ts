// The Game settings tool: the game's own settings for this map (its config's map.settings, such as
// Build Swap's build padding), each a whole number map.json keeps under the setting's key. A use
// opens its screen, and so do tapping a setting in the map menu and /gamesettings: the Setting list
// (when the game has more than one), the value typed or nudged one at a time, Use the default to
// take the map's own value away, and Set to save it.
import type { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { mapSettingValue, mapSettings, settingFits, settingText } from "@minecade/minigame-core";
import { sideTitle } from "./marks.ts";
import { gameSettingScreenEntries, settingValueText, type GameSetting } from "./menu.ts";
import type { ToolHost } from "./tool-host.ts";

export class GameSettingsTool {
  private readonly host: ToolHost;
  /** The setting a use opens, by lowercased gamertag: the one picked last. */
  private readonly picked = new Map<string, string>();

  constructor(host: ToolHost) {
    this.host = host;
  }

  /** The game's settings, in its config's order (none for the lobby, or a game without any). */
  get settings(): GameSetting[] {
    return mapSettings(this.host.rules.requires);
  }

  /** A use: the screen, on the setting picked last (`back` opens the map menu). */
  use(player: Player, back?: () => Promise<void>): Promise<void> {
    return this.screen(player, undefined, back);
  }

  /** The action bar line while the tool is held. */
  hint(player: Player): string {
    const setting = this.settingOf(player);
    if (!setting) return "This game has no settings of its own";
    return `Use: change the game's settings   ${setting.label}: ${settingValueText(this.host.map(), setting)}`;
  }

  /** The screen, on `key` (else the setting picked last): its value typed or nudged, then Set. */
  async screen(player: Player, key?: string, back?: () => Promise<void>): Promise<void> {
    if (key) this.picked.set(player.name.toLowerCase(), key);
    let setting = this.settingOf(player);
    if (!setting) return this.host.tell(player, "This game has no settings of its own.");
    let value = this.valueOf(setting);
    let open = false;
    for (;;) {
      const entries = gameSettingScreenEntries({ settings: this.settings, key: setting.key, value, set: this.host.map()[setting.key] !== undefined, open, back: back !== undefined });
      const form = new ActionFormData().title(sideTitle("Game settings"));
      for (const entry of entries) form.button(entry.text, entry.icon);
      const response = await this.host.show(player, form);
      const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
      if (!action || !player.isValid) return;
      if (action.kind === "back") return back?.();
      if (action.kind === "save") return this.set(player, setting, value);
      if (action.kind === "default") return this.useDefault(player, setting);
      if (action.kind === "open") open = !open;
      else if (action.kind === "setting") {
        this.picked.set(player.name.toLowerCase(), action.key);
        setting = this.settingOf(player) ?? setting;
        value = this.valueOf(setting);
        open = false;
      } else if (action.kind === "type") value = (await this.typeValue(player, setting, value)) ?? value;
      else if (action.kind === "nudge") value = Math.min(setting.max, Math.max(setting.min, value + action.by));
    }
  }

  /** The setting a use opens: the one picked last, else the first. */
  private settingOf(player: Player): GameSetting | undefined {
    const settings = this.settings;
    const key = this.picked.get(player.name.toLowerCase());
    return settings.find((setting) => setting.key === key) ?? settings[0];
  }

  private valueOf(setting: GameSetting): number {
    return mapSettingValue(setting, this.host.map(), setting.key);
  }

  private set(player: Player, setting: GameSetting, value: number): void {
    const text = settingText(setting, value);
    if (this.host.map()[setting.key] === value) return this.host.tell(player, `${setting.label} is already ${text}.`);
    this.host.edit(player, { op: "extra", key: setting.key, value }, `${setting.label} set to ${text}.`);
  }

  private useDefault(player: Player, setting: GameSetting): void {
    if (this.host.map()[setting.key] === undefined) return this.host.tell(player, `${setting.label} is already the default.`);
    this.host.edit(player, { op: "extra", key: setting.key }, `${setting.label} is the default again: ${settingText(setting, setting.default)}.`);
  }

  /** A number typed into a side form; undefined (and why) when it isn't one. */
  private async typeValue(player: Player, setting: GameSetting, start: number): Promise<number | undefined> {
    const form = new ModalFormData()
      .title(sideTitle("Game settings"))
      .textField(`${setting.label} (a whole number from ${setting.min} to ${setting.max})`, String(start), { defaultValue: String(start) })
      .submitButton("Done");
    const response = await this.host.show(player, form);
    if (!response?.formValues || !player.isValid) return undefined;
    const typed = String(response.formValues[0] ?? "").trim();
    const value = /^-?\d+$/.test(typed) ? Number(typed) : undefined;
    if (!settingFits(setting, value)) {
      this.host.tell(player, `§c${setting.label} must be a whole number from ${setting.min} to ${setting.max}.`);
      return undefined;
    }
    return value;
  }
}
