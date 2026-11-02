// Build Swap's prompt form, before the match: a live form (a data-driven CustomForm, like the kit
// form and the lobby's team form) with a status line (who's still writing, and the time left), two
// text boxes (a prompt to build and a twist), a line for what's wrong with an answer, then Submit
// and Skip. It comes back when closed until the player submits or skips; then it's closed for good.
// What's typed goes through Minecraft's text filter when it can (the writer's own settings), since
// prompts are shown to other players later. The rules around it are the game's, tested there.
import { system, type Player } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableString } from "@minecraft/server-ui";
import { describeError, log } from "@minecade/minigame-core";

/** Tries while the player is busy with another screen, 10 ticks apart (like the kit form). */
const BUSY_RETRIES = 10;
/** How long the text filter gets before the text is taken as typed. */
const FILTER_TICKS = 60;

export interface PromptAnswer {
  starter: string;
  twist: string;
}

export interface PromptFormHandlers {
  /** The player submitted: undefined when it's taken, else what's wrong (shown under the boxes). */
  submit(answer: PromptAnswer): string | undefined;
  skip(): void;
}

export class PromptForm {
  private readonly player: Player;
  private readonly handlers: PromptFormHandlers;
  private readonly title: string;
  private readonly status = new ObservableString("");
  private readonly note = new ObservableString("");
  private readonly starter = new ObservableString("", { clientWritable: true });
  private readonly twist = new ObservableString("", { clientWritable: true });
  private form: CustomForm | undefined;
  private showingNow = false;
  private closed = false;
  private busy = false;

  constructor(player: Player, title: string, status: string, handlers: PromptFormHandlers) {
    this.player = player;
    this.title = title;
    this.handlers = handlers;
    this.status.setData(status);
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
    this.status.setData(status);
  }

  close(): void {
    this.closed = true;
    try {
      if (this.form?.isShowing()) this.form.close();
    } catch {
      // The player left, or it closed meanwhile.
    }
  }

  private async showUntilClosed(): Promise<void> {
    for (let attempt = 0; attempt <= BUSY_RETRIES && !this.closed; attempt++) {
      try {
        this.form = this.build();
        if ((await this.form.show()) !== DataDrivenScreenClosedReason.UserBusy) return;
      } catch (error) {
        log.warn(`prompt form for ${this.player.name}: ${describeError(error)}`);
        return;
      }
      await new Promise<void>((resolve) => system.runTimeout(resolve, 10));
    }
  }

  private build(): CustomForm {
    return new CustomForm(this.player, this.title)
      .label(this.status)
      .divider()
      .textField("Build prompt", this.starter, { description: "§7Something to build: a pirate ship" })
      .textField("Twist prompt", this.twist, { description: "§7Something to add or change: it's on fire" })
      .label(this.note)
      .button("Submit", () => void this.submit())
      .button("Skip", () => {
        if (!this.closed) this.handlers.skip();
      });
  }

  private async submit(): Promise<void> {
    if (this.closed || this.busy) return;
    this.busy = true;
    try {
      const [starter, twist] = await Promise.all([filtered(this.starter, this.player), filtered(this.twist, this.player)]);
      if (this.closed) return;
      this.note.setData(this.handlers.submit({ starter, twist }) ?? "");
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
