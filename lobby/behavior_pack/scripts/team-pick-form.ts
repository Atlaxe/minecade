// The live team form: the Minecraft side of team-pick-controller.ts. It's a data-driven
// CustomForm, one per player. Its layout can't change once shown, so it's built once with
// observable text that updates as players pick. Its buttons don't close it. Not unit-tested;
// the logic it shows is.
//
// The form draws in Minecraft's Ore UI, whose buttons can't take a color (their text shows color
// codes as they are), so each button is a clickable picture from the lobby pack instead
// (teamButtonPath(), drawn by the build): the team's color with white text, framed on the player's
// own team, dimmed when full. If a form with pictures can't show, it's shown again with plain buttons.
import { system, type Player } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableBoolean, ObservableString } from "@minecraft/server-ui";
import { describeError, log, teamButtonPath, type TeamButtonState } from "@minecade/minigame-core";
import type { TeamPickView } from "./team-pick-controller.ts";

/** Tries while the player is busy with another screen, 10 ticks apart (like showForm). */
const BUSY_RETRIES = 10;

interface TeamRow {
  label: ObservableString;
  button: ObservableString;
  picture: ObservableString;
  disabled: ObservableBoolean;
}

export class TeamPickForm {
  /** Set once a form with pictures couldn't show: every form after it has plain buttons. */
  private static noPictures = false;
  private readonly player: Player;
  /** The lobby resource pack's UUID, which has the button pictures. */
  private readonly pack: string;
  private readonly onPick: (team: string | undefined) => void;
  private readonly status = new ObservableString("");
  private readonly rows: TeamRow[];
  private readonly random = new ObservableString("");
  private readonly randomPicture = new ObservableString("");
  private readonly randomDisabled = new ObservableBoolean(false);
  private readonly unpicked = new ObservableString("");
  private form: CustomForm;
  private pictures: boolean;
  private view: TeamPickView;
  private closed = false;

  constructor(player: Player, view: TeamPickView, pack: string, onPick: (team: string | undefined) => void) {
    this.player = player;
    this.pack = pack;
    this.onPick = onPick;
    this.view = view;
    this.rows = view.teams.map(() => ({ label: new ObservableString(""), button: new ObservableString(""), picture: new ObservableString(""), disabled: new ObservableBoolean(false) }));
    this.pictures = !TeamPickForm.noPictures;
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
        if (!this.pictures || !this.player.isValid) {
          log.warn(`team form for ${this.player.name}: ${describeError(error)}`);
          return;
        }
        // The pictures may be what it can't show: the same form with plain buttons.
        log.warn(`team form for ${this.player.name} (showing it again with plain buttons): ${describeError(error)}`);
        this.pictures = false;
        TeamPickForm.noPictures = true;
        this.form = this.build();
        this.update(this.view);
        continue;
      }
      await new Promise<void>((resolve) => system.runTimeout(resolve, 10));
    }
  }

  update(view: TeamPickView): void {
    this.view = view;
    const mine = this.mine();
    this.status.setData(view.status);
    view.teams.forEach((team, index) => {
      const row = this.rows[index];
      if (!row) return;
      const members = team.members.length > 0 ? team.members.join(", ") : "Nobody yet";
      const state: TeamButtonState = team.id === mine ? "on" : team.full ? "full" : "join";
      row.label.setData(`${team.color}${team.name}§r  ${team.members.length}/${team.cap}\n§7${members}`);
      row.button.setData(state === "on" ? `On ${team.name}` : state === "full" ? `${team.name} is full` : `Join ${team.name}`);
      row.picture.setData(teamButtonPath(team, state));
      row.disabled.setData(state !== "join");
    });
    this.random.setData("Random team");
    this.randomPicture.setData(teamButtonPath(undefined, mine === undefined ? "on" : "join"));
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

  /** The player's team, if they picked one. */
  private mine(): string | undefined {
    return this.view.teams.find((team) => team.members.includes(this.player.name))?.id;
  }

  private build(): CustomForm {
    const form = new CustomForm(this.player, `${this.view.game}: pick a team`).label(this.status).divider();
    this.view.teams.forEach((team, index) => {
      const row = this.rows[index];
      form.label(row.label).spacer();
      // A picture can't be disabled: a tap on your own team or a full one does nothing.
      const pick = () => {
        if (!row.disabled.getData()) this.onPick(team.id);
      };
      if (this.pictures) form.image(row.picture, this.pack, { width: 1, onClick: pick });
      else form.button(row.button, pick, { disabled: row.disabled });
    });
    const random = () => {
      if (!this.randomDisabled.getData()) this.onPick(undefined);
    };
    form.divider();
    if (this.pictures) form.image(this.randomPicture, this.pack, { width: 1, onClick: random });
    else form.button(this.random, random, { disabled: this.randomDisabled });
    return form.label(this.unpicked);
  }
}
