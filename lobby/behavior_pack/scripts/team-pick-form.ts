// The live team form: the Minecraft side of team-pick-controller.ts. It's a data-driven
// CustomForm, one per player. Its layout can't change once shown, so it's built once with
// observable text that updates as players pick. Its buttons don't close it. Not unit-tested;
// the logic it shows is.
//
// Each team has a plain Ore UI button: Join <team>, On <team> for the player's own (disabled), or
// <team> is full (disabled), then Random team. Ore UI's buttons take no color (codes show as typed).
// The buttons were pictures in the team's color (the lobby pack's teamButtonPath(), drawn by the
// build) until 2026-11-13, when the user saw that pictures don't show in a live form at all: every
// team game's form had no buttons to tap, only the teams' text.
import { system, type Player } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableBoolean, ObservableString } from "@minecraft/server-ui";
import { describeError, log, stripColors } from "@minecade/minigame-core";
import type { TeamPickView } from "./team-pick-controller.ts";

/** Tries while the player is busy with another screen, 10 ticks apart (like showForm). */
const BUSY_RETRIES = 10;

interface TeamRow {
  label: ObservableString;
  button: ObservableString;
  disabled: ObservableBoolean;
}

export class TeamPickForm {
  private readonly player: Player;
  private readonly onPick: (team: string | undefined) => void;
  private readonly status = new ObservableString("");
  private readonly rows: TeamRow[];
  private readonly random = new ObservableString("Random team");
  private readonly randomDisabled = new ObservableBoolean(false);
  private readonly unpicked = new ObservableString("");
  private readonly form: CustomForm;
  private view: TeamPickView;
  private closed = false;

  constructor(player: Player, view: TeamPickView, onPick: (team: string | undefined) => void) {
    this.player = player;
    this.onPick = onPick;
    this.view = view;
    this.rows = view.teams.map(() => ({ label: new ObservableString(""), button: new ObservableString(""), disabled: new ObservableBoolean(false) }));
    this.form = this.build();
    this.update(view);
  }

  /** False once the player closed it (or it was closed). */
  get showing(): boolean {
    return !this.closed && this.form.isShowing();
  }

  async show(): Promise<void> {
    for (let attempt = 0; attempt <= BUSY_RETRIES && !this.closed; attempt++) {
      try {
        if ((await this.form.show()) !== DataDrivenScreenClosedReason.UserBusy) return;
      } catch (error) {
        log.warn(`team form for ${this.player.name}: ${describeError(error)}`);
        return;
      }
      await new Promise<void>((resolve) => system.runTimeout(resolve, 10));
    }
    if (!this.closed) log.warn(`team form for ${this.player.name}: still busy with another screen, gave up`);
  }

  update(view: TeamPickView): void {
    this.view = view;
    const mine = this.mine();
    // Live forms show color codes as typed (docs/ui.md), so none go in.
    this.status.setData(stripColors(view.status));
    view.teams.forEach((team, index) => {
      const row = this.rows[index];
      if (!row) return;
      const members = team.members.length > 0 ? team.members.join(", ") : "Nobody yet";
      const state = team.id === mine ? "on" : team.full ? "full" : "join";
      row.label.setData(`${team.name}  ${team.members.length}/${team.cap}\n${members}`);
      row.button.setData(state === "on" ? `On ${team.name}` : state === "full" ? `${team.name} is full` : `Join ${team.name}`);
      row.disabled.setData(state !== "join");
    });
    this.randomDisabled.setData(mine === undefined);
    this.unpicked.setData(view.unpicked.length > 0 ? `Random: ${view.unpicked.join(", ")}` : "");
  }

  close(): void {
    this.closed = true;
    try {
      if (this.form.isShowing()) this.form.close();
    } catch {
      // The player left, or it closed meanwhile.
    }
  }

  /** The player's team, if they picked one. */
  private mine(): string | undefined {
    return this.view.teams.find((team) => team.members.includes(this.player.name))?.id;
  }

  private build(): CustomForm {
    const form = new CustomForm(this.player, `${this.view.game}: pick a team`).label(this.status).divider();
    this.view.teams.forEach((team, index) => {
      const row = this.rows[index];
      form.label(row.label);
      form.button(row.button, () => this.onPick(team.id), { disabled: row.disabled });
      form.spacer();
    });
    form.divider();
    form.button(this.random, () => this.onPick(undefined), { disabled: this.randomDisabled });
    return form.label(this.unpicked);
  }
}
