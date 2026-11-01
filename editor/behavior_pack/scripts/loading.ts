// The loading screen, as in the editor lobby: a side menu titled "Loading" with five dots lighting
// up after it, open (and opened again whenever it closes) while a player waits. The host says who
// waits for another server ("loading") and when to stop ("loaded"); moving them ends it, and it
// gives up after a while. Select also uses it while an export is cut out.
import { system, type Player } from "@minecraft/server";
import { ActionFormData, uiManager } from "@minecraft/server-ui";
import type { Scope } from "@minecade/minigame-core";
import { headingText, loadingTitle } from "./marks.ts";

/** The screen opens again this soon after it closes. */
const REOPEN_TICKS = 5;
/** How long a player waits for a server before it gives up (the host says when it fails). */
const WAIT_TICKS = 20 * 120;

type Show = <R extends { canceled: boolean }>(player: Player, form: { show(player: Player): Promise<R> }) => Promise<R | undefined>;

export interface LoadingOptions {
  /** The title before the dots: "Loading" unless said. */
  title?: string;
  /** The text under it: what's loading, and how long it takes. */
  body?: string;
  /** Ends the wait when it turns true (an export that's ready). */
  done?: () => boolean;
  /** How long to wait at most, in ticks. */
  ticks?: number;
}

export class LoadingScreens {
  private readonly scope: Scope;
  private readonly show: Show;
  private readonly waiting = new Map<string, { label: string; until: number; options: LoadingOptions }>();

  constructor(scope: Scope, show: Show) {
    this.scope = scope;
    this.show = show;
  }

  /** Waiting players, by lower-case name. */
  isWaiting(player: Player): boolean {
    return this.waiting.has(player.name.toLowerCase());
  }

  /** Shows the screen until the wait ends: moved, stopped, done or timed out. Resolves then. */
  async wait(player: Player, label: string, options: LoadingOptions = {}): Promise<void> {
    const key = player.name.toLowerCase();
    const already = this.waiting.has(key);
    this.waiting.set(key, { label, until: system.currentTick + (options.ticks ?? WAIT_TICKS), options });
    if (already) return;
    // Whatever menu is open makes way.
    uiManager.closeAllForms(player);
    await this.scope.wait(1);
    try {
      while (player.isValid) {
        const now = this.waiting.get(key);
        if (!now || system.currentTick > now.until || now.options.done?.()) break;
        const body = now.options.body ?? `Loading ${now.label}...\n\nYou'll be moved there as soon as it's ready: that takes about 20 seconds.`;
        const form = new ActionFormData()
          .title(loadingTitle(now.options.title ?? "Loading"))
          .body(body)
          .button(headingText("Please wait"));
        await this.show(player, form);
        await this.scope.wait(REOPEN_TICKS);
      }
    } finally {
      this.waiting.delete(key);
    }
  }

  /** Ends a player's wait (the host's "loaded": what they waited for didn't start), closing the screen. */
  stop(player: Player): void {
    if (!this.waiting.delete(player.name.toLowerCase())) return;
    uiManager.closeAllForms(player);
  }

  /** Closes the screen of a player waiting for `done`, once it's true (checked by the caller). */
  poke(player: Player): void {
    const now = this.waiting.get(player.name.toLowerCase());
    if (now?.options.done?.()) uiManager.closeAllForms(player);
  }
}
