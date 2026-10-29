// Minimal fake of @minecraft/server-ui for unit tests, swapped in by vitest.config.ts. Each
// show() takes the next queued response; with nothing queued it stays open until a test
// answers it through openForms.

export const FormCancelationReason = { UserBusy: "UserBusy", UserClosed: "UserClosed" } as const;
export type FormCancelationReason = (typeof FormCancelationReason)[keyof typeof FormCancelationReason];

export interface FakeResponse {
  canceled: boolean;
  cancelationReason?: FormCancelationReason;
  selection?: number;
}

interface OpenForm {
  form: FakeForm;
  player: { name: string };
  respond(response: FakeResponse): void;
  reject(error: Error): void;
}

const queued: (FakeResponse | Error)[] = [];
/** Forms waiting for an answer, oldest first. */
export const openForms: OpenForm[] = [];
/** Every form shown, in order. */
export const shownForms: FakeForm[] = [];
/** Names of players whose forms were closed with uiManager.closeAllForms. */
export const closedFor: string[] = [];

/** Queues the answers for the next show() calls; an Error makes show() reject. */
export function queueFormResponses(...responses: (FakeResponse | Error)[]): void {
  queued.push(...responses);
}

export function resetForms(): void {
  queued.length = 0;
  openForms.length = 0;
  shownForms.length = 0;
  closedFor.length = 0;
}

class FakeForm {
  titleText = "";
  bodyText = "";
  readonly buttons: string[] = [];

  title(text: string): this {
    this.titleText = text;
    return this;
  }

  body(text: string): this {
    this.bodyText = text;
    return this;
  }

  button(text: string): this {
    this.buttons.push(text);
    return this;
  }

  show(player: { name: string }): Promise<FakeResponse> {
    shownForms.push(this);
    const next = queued.shift();
    if (next instanceof Error) return Promise.reject(next);
    if (next) return Promise.resolve(next);
    return new Promise((respond, reject) => openForms.push({ form: this, player, respond, reject }));
  }
}

export class ActionFormData extends FakeForm {}

export const uiManager = {
  /** Records the call and closes that player's open forms, which then resolve as closed. */
  closeAllForms(player: { name: string }): void {
    closedFor.push(player.name);
    for (const open of openForms.filter((form) => form.player.name === player.name)) {
      openForms.splice(openForms.indexOf(open), 1);
      open.respond({ canceled: true, cancelationReason: FormCancelationReason.UserClosed });
    }
  },
};
