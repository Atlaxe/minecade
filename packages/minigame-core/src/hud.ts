// The HUD timer and countdown sounds, shared by games and the lobby.
//
// Timer: Bedrock has no script API for placing text on the HUD, so the clock rides on the action
// bar. A game sends "<mark><mm:ss>|<rest>", and the core resource pack
// (packages/minigame-core/resource_pack/ui/hud_screen.json) shows the clock top right with a clock
// icon and the rest as the normal action bar line. The mark and time are plain ASCII with a fixed
// width (9 characters), so JSON UI can split them with '%.9s'. Without the pack the line still
// reads sensibly: "::T04:59|Lives: 2".
import type { Player } from "@minecraft/server";

export const TIMER_MARK = "::T";
/** The mark for the last 30 seconds: the clock turns red. */
export const TIMER_URGENT_MARK = "::R";
const URGENT_SECONDS = 30;

/** The action bar text for a stage clock plus the usual line (which may be empty). */
export function hudLine(secondsLeft: number | undefined, rest = ""): string {
  if (secondsLeft === undefined) return rest;
  const whole = Math.min(99 * 60 + 59, Math.max(0, Math.ceil(secondsLeft)));
  const clock = `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  return `${whole <= URGENT_SECONDS ? TIMER_URGENT_MARK : TIMER_MARK}${clock}|${rest}`;
}

export type Chime = "tick" | "bell" | "go";

/** Countdown sounds: a tick for each second, a bell for the last three, and a flourish for "Go!". */
export const CHIMES: Readonly<Record<Chime, { id: string; pitch: number; volume: number }>> = {
  tick: { id: "note.hat", pitch: 1.0, volume: 0.7 },
  bell: { id: "note.bell", pitch: 1.0, volume: 1.0 },
  go: { id: "random.levelup", pitch: 1.2, volume: 0.8 },
};

/** The chime for a countdown number: 3, 2 and 1 ring a bell, anything higher ticks, 0 is "Go!". */
export function countdownChime(secondsLeft: number): Chime {
  if (secondsLeft <= 0) return "go";
  return secondsLeft <= 3 ? "bell" : "tick";
}

/** Plays a chime to one player. Never throws: a player who just left is skipped. */
export function playChime(player: Player, chime: Chime): void {
  const { id, pitch, volume } = CHIMES[chime];
  try {
    if (player.isValid) player.playSound(id, { pitch, volume });
  } catch {
    // left between the check and the call
  }
}
