// The mode box: which editor server the player is on (Select, Edit, or Build for builders in
// Edit), with the world or map, in a small box top center. Bedrock has no script API for HUD text,
// so the line rides on the title: a title starting with MODE_MARK shows in the box
// (editor/resource_pack/ui/hud_screen.json), the way the game clock rides on the action bar
// (packages/minigame-core/src/hud.ts). Nothing else on the editor's servers sends titles.
import { world, type Player } from "@minecraft/server";
import type { Scope } from "@minecade/minigame-core";

/** Starts every title that is a mode line. Must match editor/resource_pack/ui/hud_screen.json. */
export const MODE_MARK = "§r§m§o§r";

export type Mode = "select" | "edit" | "build";

const MODES: Readonly<Record<Mode, string>> = { select: "§bSelect", edit: "§aEdit", build: "§eBuild" };
/** How often the line is sent again; each one stays up longer than that, so it never fades. */
const REFRESH_TICKS = 100;
const STAY_TICKS = 400;

/** The title for the mode box: the mode in its color, then the world or map in gray. */
export function modeLine(mode: Mode, detail = ""): string {
  return `${MODE_MARK}${MODES[mode]}${detail ? `§7   ${detail}` : ""}`;
}

/** Keeps every player's mode line up: when they spawn, and every few seconds after. */
export function keepModeLine(scope: Scope, lineOf: (player: Player) => string): void {
  const show = (player: Player) => {
    try {
      if (player.isValid) player.onScreenDisplay.setTitle(lineOf(player), { fadeInDuration: 0, stayDuration: STAY_TICKS, fadeOutDuration: 0 });
    } catch {
      // left between the check and the call
    }
  };
  scope.subscribe(world.afterEvents.playerSpawn, ({ player }) => scope.defer(() => show(player)));
  scope.interval(() => {
    for (const player of world.getAllPlayers()) show(player);
  }, REFRESH_TICKS);
}
