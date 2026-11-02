// The Time tool's pure parts: a map's time of day (map.json's "time", where the daylight cycle
// stops on its servers) as a preset (Noon, Dusk, Midnight, Dawn) or a custom time on a 24-hour clock
// ("14:30"), so they can be tested without a server. Minecraft's day starts at 6:00 (tick 0), and
// each hour is 1000 ticks.
import { MAP_TIMES, mapTimeTicks, type MapTime } from "@minecade/minigame-core/config";

/** The common times, in the Time list's order, each as the name map.json keeps. */
export const TIME_PRESETS = [
  { id: "noon", label: "Noon" },
  { id: "sunset", label: "Dusk" },
  { id: "midnight", label: "Midnight" },
  { id: "sunrise", label: "Dawn" },
] as const satisfies readonly { id: keyof typeof MAP_TIMES; label: string }[];

export type TimePreset = (typeof TIME_PRESETS)[number]["id"];

const DAY = 24000;
const HOUR = 1000;

/** A time's preset, or undefined for a custom one (ticks, or a name the list doesn't offer). */
export function presetOf(time: MapTime | undefined): TimePreset | undefined {
  return TIME_PRESETS.find((preset) => preset.id === time)?.id;
}

/** A time on the 24-hour clock: "06:00" for tick 0, "18:00" for 12000. */
export function clockText(ticks: number): string {
  const day = ((ticks % DAY) + DAY) % DAY;
  const hours = (Math.floor(day / HOUR) + 6) % 24;
  const minutes = Math.floor(((day % HOUR) * 60) / HOUR);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** The ticks a typed time stands for ("14:30", "9:05", "0930", "14"), or undefined when it isn't one. */
export function parseClock(text: string): number | undefined {
  const match = /^\s*(\d{1,2})(?::?(\d{2}))?\s*$/.exec(text);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  // Rounded up, so the clock shows the same minute back.
  return (((hours - 6 + 24) % 24) * HOUR + Math.ceil((minutes * HOUR) / 60)) % DAY;
}

/** A time `by` hours later (earlier when negative), around the clock. */
export function hoursLater(ticks: number, by: number): number {
  return (((ticks + by * HOUR) % DAY) + DAY) % DAY;
}

/** A map's time in a few words: "Noon (12:00)", "14:30", or "not set". */
export function timeText(time: MapTime | undefined): string {
  const ticks = mapTimeTicks(time);
  if (ticks === undefined) return "not set";
  const preset = TIME_PRESETS.find((candidate) => candidate.id === presetOf(time));
  return preset ? `${preset.label} (${clockText(ticks)})` : clockText(ticks);
}
