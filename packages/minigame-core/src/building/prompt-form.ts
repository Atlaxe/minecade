// The building games' text form: a live form (a data-driven CustomForm, like the kit form and the
// lobby's team form) with a status line, text boxes (Build Swap's prompt and twist before the match,
// Guess the Build's prompt, and its guess while looking at a build), a line for what's wrong with an
// answer, then Submit and, where the game allows it, Skip. The game decides when it comes back after
// it's closed. Live forms show color codes as typed, so nothing on it has any (docs/ui.md). What's
// typed goes through Minecraft's text filter when it can (the writer's own settings), since it's
// shown to other players later. The rules around it are the games', tested there.
import { system, type Player } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableString } from "@minecraft/server-ui";
import { describeError, log } from "../log.ts";
import { stripColors } from "../text.ts";

/** Tries while the player is busy with another screen, 10 ticks apart (like the kit form). */
const BUSY_RETRIES = 10;
/** How long the text filter gets before the text is taken as typed. */
const FILTER_TICKS = 60;

/** One text box: its key in the answer, its label and the example under it. */
export interface TextField {
  key: string;
  label: string;
  description: string;
}

/** What was typed in each box, by key. */
export type TextAnswer = Record<string, string>;

export interface PromptFormHandlers {
  /** The player submitted: undefined when it's taken, else what's wrong (shown under the boxes). */
  submit(answer: TextAnswer): string | undefined;
  /** With it, the form has a Skip button. */
  skip?(): void;
}

export class PromptForm {
  private readonly player: Player;
  private readonly handlers: PromptFormHandlers;
  private readonly title: string;
  private readonly fields: readonly TextField[];
  private readonly status = new ObservableString("");
  private readonly note = new ObservableString("");
  private readonly boxes: ObservableString[];
  private form: CustomForm | undefined;
  private showingNow = false;
  private closed = false;
  private busy = false;

  constructor(player: Player, title: string, status: string, fields: readonly TextField[], handlers: PromptFormHandlers) {
    this.player = player;
    this.title = title;
    this.fields = fields;
    this.handlers = handlers;
    this.boxes = fields.map(() => new ObservableString("", { clientWritable: true }));
    this.status.setData(stripColors(status));
  }

  /** True while it's up (or about to be) for this player; a rejoining player is a new Player, with a new form. */
  showingTo(player: Player): boolean {
    return !this.closed && this.showingNow && this.player === player && player.isValid;
  }

  /** Shows the form unless it's already up (or closed for good). What was typed stays in the boxes. */
  show(): void {
    if (this.closed || this.showingNow) return;
    this.showingNow = true;
    void this.showUntilClosed().finally(() => (this.showingNow = false));
  }

  update(status: string): void {
    this.status.setData(stripColors(status));
  }

  /** Closes it for good. */
  close(): void {
    this.closed = true;
    this.hide();
  }

  /** Takes it off the screen; show() brings it back with what was typed. */
  hide(): void {
    try {
      if (this.form?.isShowing()) this.form.close();
    } catch {
      // The player left, or it closed meanwhile.
    }
  }

  /** What's in the boxes now, submitted or not, through the text filter. */
  async typed(): Promise<TextAnswer> {
    const texts = await Promise.all(this.boxes.map((box) => filtered(box, this.player)));
    return Object.fromEntries(this.fields.map((field, i) => [field.key, texts[i]]));
  }

  private async showUntilClosed(): Promise<void> {
    for (let attempt = 0; attempt <= BUSY_RETRIES && !this.closed; attempt++) {
      try {
        this.form = this.build();
        if ((await this.form.show()) !== DataDrivenScreenClosedReason.UserBusy) return;
      } catch (error) {
        log.warn(`text form for ${this.player.name}: ${describeError(error)}`);
        return;
      }
      await new Promise<void>((resolve) => system.runTimeout(resolve, 10));
    }
  }

  private build(): CustomForm {
    let form = new CustomForm(this.player, this.title).label(this.status).divider();
    this.fields.forEach((field, i) => {
      form = form.textField(field.label, this.boxes[i], { description: field.description });
    });
    form = form.label(this.note).button("Submit", () => void this.submit());
    const skip = this.handlers.skip;
    if (skip) {
      form = form.button("Skip", () => {
        if (!this.closed) skip.call(this.handlers);
      });
    }
    return form;
  }

  private async submit(): Promise<void> {
    if (this.closed || this.busy) return;
    this.busy = true;
    try {
      const answer = await this.typed();
      if (this.closed) return;
      this.note.setData(stripColors(this.handlers.submit(answer) ?? ""));
    } finally {
      this.busy = false;
    }
  }
}

/** The text as Minecraft's filter passes it for this player, or as typed when the filter can't (turned off, unreachable, slow). */
async function filtered(text: ObservableString, player: Player): Promise<string> {
  const typed = text.getData();
  if (!typed.trim()) return typed;
  try {
    const result = await Promise.race([
      text.getFilteredText(player),
      new Promise<undefined>((resolve) => system.runTimeout(() => resolve(undefined), FILTER_TICKS)),
    ]);
    return typeof result === "string" ? result : typed;
  } catch {
    return typed;
  }
}
