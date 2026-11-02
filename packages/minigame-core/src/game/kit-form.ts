// The live kit form: the Minecraft side of kit-picker.ts. Like the lobby's team form, it's a
// data-driven CustomForm, one per player, built once with observable text that updates as players
// pick; its buttons don't close it. Each kit shows its picture (its items and how many, drawn into
// the game's resource pack by the build) over its name, items and Pick button. Not unit-tested;
// the logic it shows is.
import { system, type Player } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableBoolean, ObservableString } from "@minecraft/server-ui";
import { describeError, log } from "../log.ts";
import type { KitPickView } from "./kit-picker.ts";

/** Tries while the player is busy with another screen, 10 ticks apart (like showForm). */
const BUSY_RETRIES = 10;
/** A picture's width, as a share of the form's, per item it shows (at most the whole form). */
const PICTURE_WIDTH_PER_ITEM = 0.14;

/** One kit as the form shows it, for this player (team colors resolved). */
export interface KitCard {
  id: string;
  name: string;
  /** "8x Snowball", one per item. */
  lines: string[];
  /** The picture's path in `pack`, if there is one. */
  picture?: string;
}

export interface KitFormContent {
  title: string;
  /** What everyone gets on top of their pick. */
  base?: KitCard;
  kits: KitCard[];
  /** The resource pack the pictures are in (its UUID), or undefined for no pictures. */
  pack?: string;
}

interface KitRow {
  button: ObservableString;
  disabled: ObservableBoolean;
  pickedBy: ObservableString;
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
  private showingNow = false;
  private closed = false;

  constructor(player: Player, content: KitFormContent, view: KitPickView, onPick: (kitId: string) => void) {
    this.player = player;
    this.content = content;
    this.onPick = onPick;
    this.rows = content.kits.map(() => ({ button: new ObservableString(""), disabled: new ObservableBoolean(false), pickedBy: new ObservableString("") }));
    this.pictures = content.pack !== undefined && !KitForm.noPictures;
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
    const mine = view.picks[this.player.name];
    this.status.setData(view.status);
    this.content.kits.forEach((kit, index) => {
      const row = this.rows[index];
      const pickers = view.pickedBy[kit.id] ?? [];
      row.button.setData(kit.id === mine ? `§aPicked ${kit.name}` : `Pick ${kit.name}`);
      row.disabled.setData(kit.id === mine);
      row.pickedBy.setData(pickers.length > 0 ? `§7${pickers.join("§7, ")}` : "");
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
        continue;
      }
      await new Promise<void>((resolve) => system.runTimeout(resolve, 10));
    }
  }

  private build(): CustomForm {
    const { base, kits, pack } = this.content;
    const form = new CustomForm(this.player, this.content.title).label(this.status);
    if (base) {
      form.divider();
      this.picture(form, base, pack);
      form.label(`${base.name}\n§7${base.lines.join("§7, ")}`);
    }
    kits.forEach((kit, index) => {
      const row = this.rows[index];
      form.divider();
      this.picture(form, kit, pack);
      form.label(`${kit.name}\n§7${kit.lines.join("§7, ")}`);
      form.button(row.button, () => this.onPick(kit.id), { disabled: row.disabled });
      form.label(row.pickedBy);
    });
    return form;
  }

  private picture(form: CustomForm, card: KitCard, pack: string | undefined): void {
    if (!this.pictures || pack === undefined || card.picture === undefined) return;
    form.image(card.picture, pack, { width: Math.min(1, PICTURE_WIDTH_PER_ITEM * Math.max(1, card.lines.length)) });
  }
}
