// The live kit form: the Minecraft side of kit-picker.ts. Like the lobby's team form, it's a
// data-driven CustomForm, one per player, built once with observable text that updates as players
// pick; its buttons don't close it. It's styled like the team form, with the player's team color
// where the team form has each team's: each kit shows its picture (its items in hotbar slots with
// their counts, drawn into the game's resource pack by the build), its name in the team's color
// (white without a team) over who picked it, and a Pick button, green once picked. Not unit-tested;
// the logic it shows is.
import { system, type Player } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableBoolean, ObservableString } from "@minecraft/server-ui";
import { describeError, log } from "../log.ts";
import type { KitPickView } from "./kit-picker.ts";

/** Tries while the player is busy with another screen, 10 ticks apart (like showForm). */
const BUSY_RETRIES = 10;
/** A picture's width, as a share of the form's: all of it, a full row of hotbar slots, so its items start at the left. */
const PICTURE_WIDTH = 1;

/** One kit as the form shows it, for this player (team colors resolved). */
export interface KitCard {
  id: string;
  name: string;
  /** "8x Snowball", one per item: shown only when the form has no pictures. */
  lines: string[];
  /** The picture's path in `pack`, if there is one. */
  picture?: string;
}

export interface KitFormContent {
  title: string;
  /** The player's team color, for the kit names (white without a team). */
  accent?: string;
  kits: KitCard[];
  /** The resource pack the pictures are in (its UUID), or undefined for no pictures. */
  pack?: string;
}

interface KitRow {
  label: ObservableString;
  button: ObservableString;
  disabled: ObservableBoolean;
}

export class KitForm {
  /** Set once a form with pictures couldn't show: every form after it goes without. */
  private static noPictures = false;
  private readonly player: Player;
  private readonly content: KitFormContent;
  private readonly onPick: (kitId: string) => void;
  private readonly status = new ObservableString("");
  private readonly rows: KitRow[];
  private form: CustomForm;
  private pictures: boolean;
  private view: KitPickView;
  private showingNow = false;
  private closed = false;

  constructor(player: Player, content: KitFormContent, view: KitPickView, onPick: (kitId: string) => void) {
    this.player = player;
    this.content = content;
    this.onPick = onPick;
    this.rows = content.kits.map(() => ({ label: new ObservableString(""), button: new ObservableString(""), disabled: new ObservableBoolean(false) }));
    this.pictures = content.pack !== undefined && !KitForm.noPictures;
    this.view = view;
    this.form = this.build();
    this.update(view);
  }

  /**
   * True while it's up (or about to be, waiting for the player to be free) for this player. Once the
   * player closes it, a new form takes its place, as the lobby's team form does (a rejoining player
   * is a new Player, too).
   */
  showingTo(player: Player): boolean {
    return !this.closed && this.showingNow && this.player === player && player.isValid;
  }

  /** Shows the form unless it's already up (or closed for good). */
  show(): void {
    if (this.closed || this.showingNow) return;
    this.showingNow = true;
    void this.showUntilClosed().finally(() => (this.showingNow = false));
  }

  update(view: KitPickView): void {
    this.view = view;
    const mine = view.picks[this.player.name];
    const accent = this.content.accent ?? "§f";
    this.status.setData(view.status);
    this.content.kits.forEach((kit, index) => {
      const row = this.rows[index];
      const pickers = view.pickedBy[kit.id] ?? [];
      const lines = [`${accent}${kit.name}`];
      if (!this.pictures || kit.picture === undefined) lines.push(`§7${kit.lines.join("§7, ")}`);
      if (pickers.length > 0) lines.push(`§7${pickers.join("§7, ")}`);
      row.label.setData(lines.join("\n"));
      row.button.setData(kit.id === mine ? `§aPicked ${kit.name}` : `Pick ${kit.name}`);
      row.disabled.setData(kit.id === mine);
    });
  }

  close(): void {
    this.closed = true;
    try {
      if (this.form.isShowing()) this.form.close();
    } catch {
      // The player left, or it closed meanwhile.
    }
  }

  private async showUntilClosed(): Promise<void> {
    for (let attempt = 0; attempt <= BUSY_RETRIES && !this.closed; attempt++) {
      try {
        if ((await this.form.show()) !== DataDrivenScreenClosedReason.UserBusy) return;
      } catch (error) {
        if (!this.pictures || !this.player.isValid) {
          log.warn(`kit form for ${this.player.name}: ${describeError(error)}`);
          return;
        }
        // The pictures may be what it can't show: the same form without them.
        log.warn(`kit form for ${this.player.name} (showing it again without pictures): ${describeError(error)}`);
        this.pictures = false;
        KitForm.noPictures = true;
        this.form = this.build();
        this.update(this.view);
        continue;
      }
      await new Promise<void>((resolve) => system.runTimeout(resolve, 10));
    }
  }

  private build(): CustomForm {
    const { kits, pack } = this.content;
    const form = new CustomForm(this.player, this.content.title).label(this.status);
    kits.forEach((kit, index) => {
      const row = this.rows[index];
      form.divider();
      if (this.pictures && pack !== undefined && kit.picture !== undefined) form.image(kit.picture, pack, { width: PICTURE_WIDTH });
      form.label(row.label);
      form.button(row.button, () => this.onPick(kit.id), { disabled: row.disabled });
    });
    return form;
  }
}
