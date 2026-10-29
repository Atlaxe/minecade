// Forms that respect scopes. showForm retries while the player has another screen open (chat,
// inventory), but only briefly, so a form never pops up long after they gave up on it.
import type { Player } from "@minecraft/server";
import { FormCancelationReason, uiManager } from "@minecraft/server-ui";
import type { Scope } from "./scope.ts";

const BUSY_RETRY_TICKS = 10;
/** About 5 seconds of retries. */
const BUSY_RETRIES = 10;

interface Showable<R> {
  show(player: Player): Promise<R>;
}

interface FormResult {
  canceled: boolean;
  cancelationReason?: FormCancelationReason;
}

/**
 * Shows `form` and returns the response, or undefined if the player closed it or left. If
 * `scope` is disposed first the form is closed and the returned promise never settles.
 */
export async function showForm<R extends FormResult>(scope: Scope, player: Player, form: Showable<R>): Promise<R | undefined> {
  const release = scope.add(() => {
    if (player.isValid) uiManager.closeAllForms(player);
  });
  try {
    for (let attempt = 0; ; attempt++) {
      let response: R;
      try {
        response = await scope.guard(form.show(player));
      } catch {
        return undefined; // FormRejectError: the player left, or the server is stopping
      }
      if (!response.canceled) return response;
      if (response.cancelationReason !== FormCancelationReason.UserBusy || attempt >= BUSY_RETRIES) return undefined;
      await scope.wait(BUSY_RETRY_TICKS);
    }
  } finally {
    release();
  }
}
