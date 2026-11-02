// The Time tool: the map's time of day (map.json's "time"), where its servers stop the daylight
// cycle. A use opens its screen, and so does tapping the time in the map menu: the Time list (Noon,
// Dusk, Midnight, Dawn, or Custom: a time typed on the 24-hour clock, nudged an hour either way),
// the world showing the time picked while the screen is open, Set time to save it, and Remove.
import { world, type Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { MAP_TIMES, mapTimeTicks } from "@minecade/minigame-core";
import { sideTitle } from "./marks.ts";
import { timeScreenEntries } from "./menu.ts";
import { clockText, hoursLater, parseClock, presetOf, timeText } from "./time-of-day.ts";
import type { ToolHost } from "./tool-host.ts";

/** The editor's time on a map without one. */
export const NOON = MAP_TIMES.noon;

export class TimeTool {
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
    return `Use: set the map's time of day   Now: ${timeText(this.host.map().time)}`;
  }

  /** The screen: the time picked shows in the world until it closes, and Set time saves it. */
  async screen(player: Player, back?: () => Promise<void>): Promise<void> {
    const time = this.host.map().time;
    let preset = presetOf(time);
    let ticks = mapTimeTicks(time) ?? NOON;
    let open = false;
    try {
      for (;;) {
        world.setTimeOfDay(ticks);
        const entries = timeScreenEntries({ ...(preset ? { preset } : {}), ticks, open, set: time !== undefined, back: back !== undefined });
        const form = new ActionFormData().title(sideTitle("Time"));
        for (const entry of entries) form.button(entry.text, entry.icon);
        const response = await this.host.show(player, form);
        const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
        if (!action || !player.isValid) return;
        if (action.kind === "back") return back?.();
        if (action.kind === "save") return this.set(player, preset ?? ticks);
        if (action.kind === "remove") {
          this.host.edit(player, { op: "time" }, "Time removed: the editor shows noon.");
          return;
        }
        if (action.kind === "open") open = !open;
        else if (action.kind === "preset") {
          preset = action.preset;
          ticks = MAP_TIMES[action.preset];
          open = false;
        } else if (action.kind === "custom") {
          preset = undefined;
          open = false;
        } else if (action.kind === "type") ticks = (await this.typeTime(player, ticks)) ?? ticks;
        else if (action.kind === "hour") ticks = hoursLater(ticks, action.by);
      }
    } finally {
      // The map's time again, saved or not.
      world.setTimeOfDay(mapTimeTicks(this.host.map().time) ?? NOON);
    }
  }

  private set(player: Player, time: keyof typeof MAP_TIMES | number): void {
    const now = this.host.map().time;
    if (now === time) return this.host.tell(player, `The time is already ${timeText(time)}.`);
    this.host.edit(player, { op: "time", time }, `Time set to ${timeText(time)}.`);
  }

  /** A time typed into a side form; undefined (and why) when it isn't one. */
  private async typeTime(player: Player, ticks: number): Promise<number | undefined> {
    const clock = clockText(ticks);
    const form = new ModalFormData().title(sideTitle("Time")).textField("Time (24-hour clock, such as 14:30)", clock, { defaultValue: clock }).submitButton("Done");
    const response = await this.host.show(player, form);
    if (!response?.formValues || !player.isValid) return undefined;
    const typed = parseClock(String(response.formValues[0] ?? ""));
    if (typed === undefined) this.host.tell(player, "§cA time is hours and minutes on the 24-hour clock, from 00:00 to 23:59.");
    return typed;
  }
}
