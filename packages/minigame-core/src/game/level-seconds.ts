// Seconds shown as a player's level, the number over the hotbar (Bridges' arrow coming back,
// Siege's ability cooldowns), counting down without Minecraft's level-up chime.
import type { Player } from "@minecraft/server";

export class LevelSeconds {
  /** The seconds each player's level shows, so it's set only when it changes. */
  private readonly shown = new Map<string, number>();

  /**
   * Shows the seconds as the player's level, 0 for none. Minecraft chimes when a level goes up onto
   * a multiple of 5, so going from 0 to 10 sounded on every shot: once set, the level only goes
   * down, and it goes up to 11 and down one rather than up to 10.
   */
  show(player: Player, seconds: number): void {
    const key = player.name.toLowerCase();
    const shown = this.shown.get(key);
    if (shown === seconds) return;
    this.shown.set(key, seconds);
    try {
      if (shown !== undefined && seconds < shown) {
        player.addLevels(seconds - shown);
        return;
      }
      player.resetLevel();
      if (seconds === 0) return;
      const chime = seconds % 5 === 0;
      player.addLevels(chime ? seconds + 1 : seconds);
      if (chime) player.addLevels(-1);
    } catch {
      // left
    }
  }

  /** Forgets what a player's level shows: a spawn puts it back to 0. */
  forget(name: string): void {
    this.shown.delete(name.toLowerCase());
  }
}
