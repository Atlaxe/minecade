// The live team form: the Minecraft side of team-pick-controller.ts. It's a data-driven
// CustomForm, one per player. Its layout can't change once shown, so it's built once with
// observable text that updates as players pick. Its buttons don't close it. Not unit-tested;
// the logic it shows is.
import { system, type Player } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableBoolean, ObservableString } from "@minecraft/server-ui";
import { describeError, log } from "@minecade/minigame-core";
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
  private readonly form: CustomForm;
  private readonly status = new ObservableString("");
  private readonly rows: TeamRow[];
  private readonly random = new ObservableString("");
  private readonly randomDisabled = new ObservableBoolean(false);
  private readonly unpicked = new ObservableString("");
  private closed = false;

  constructor(player: Player, view: TeamPickView, onPick: (team: string | undefined) => void) {
    this.player = player;
    this.form = new CustomForm(player, `${view.game}: pick a team`).label(this.status).divider();
    this.rows = view.teams.map((team) => {
      const row = { label: new ObservableString(""), button: new ObservableString(""), disabled: new ObservableBoolean(false) };
      this.form.label(row.label).button(row.button, () => onPick(team.id), { disabled: row.disabled });
      return row;
    });
    this.form.divider().button(this.random, () => onPick(undefined), { disabled: this.randomDisabled }).label(this.unpicked);
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
  }

  update(view: TeamPickView): void {
    const mine = view.teams.find((team) => team.members.includes(this.player.name))?.id;
    this.status.setData(view.status);
    view.teams.forEach((team, index) => {
      const row = this.rows[index];
      if (!row) return;
      const members = team.members.length > 0 ? team.members.join(", ") : "Nobody yet";
      row.label.setData(`${team.color}${team.name}§r  ${team.members.length}/${team.cap}\n§7${members}`);
      row.button.setData(team.id === mine ? `§aOn ${team.name}` : team.full ? `§7${team.name} is full` : `Join ${team.name}`);
      row.disabled.setData(team.id === mine || team.full);
    });
    this.random.setData(mine === undefined ? "§aRandom team" : "Random team");
    this.randomDisabled.setData(mine === undefined);
    this.unpicked.setData(view.unpicked.length > 0 ? `§7Random: ${view.unpicked.join(", ")}` : "");
  }

  close(): void {
    this.closed = true;
    try {
      if (this.form.isShowing()) this.form.close();
    } catch {
      // The player left, or it closed meanwhile.
    }
  }
}
