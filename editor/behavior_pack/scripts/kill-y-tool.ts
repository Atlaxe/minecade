// The Kill Y tool. Players below kill Y are out. A use sets it at once, one block below your feet
// (no tool opens a menu where it's aimed). With the tool picked, the map menu opens its screen: type
// a height or nudge it, with the plane drawn at it (outlines.ts), and Set kill Y saves it; and it
// removes kill Y.
import type { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { showKillY } from "./box-picker.ts";
import { MAX_HEIGHT, MIN_HEIGHT, parseHeight } from "./boxes.ts";
import { blockPosition } from "./lists.ts";
import { sideTitle } from "./marks.ts";
import { NUDGE_STEPS, killYScreenEntries } from "./menu.ts";
import type { ToolHost } from "./tool-host.ts";

export class KillYTool {
  private readonly host: ToolHost;

  constructor(host: ToolHost) {
    this.host = host;
  }

  /** Puts the tool in hand, for the checklist's Kill Y row. */
  equip(player: Player): void {
    this.host.equip(player, "killY");
    this.host.tell(player, "Kill Y tool: use it to set the height players are out below to one block below your feet; fine-tune it in the map menu. While you hold it, the plane shows in red.");
  }

  /** A use: kill Y one block below the player's feet, at once (Undo takes it back). */
  use(player: Player): void {
    this.set(player, below(player));
  }

  /** The screen: the height (typed or nudged, the plane drawn there), Remove, and Set kill Y at the bottom. */
  async screen(player: Player, start = this.host.map().killY ?? below(player), back?: () => Promise<void>): Promise<void> {
    let y = start;
    let step: number = NUDGE_STEPS[0];
    try {
      for (;;) {
        showKillY(player, y);
        const set = this.host.map().killY !== undefined;
        const entries = killYScreenEntries({ y, set, step, back: back !== undefined });
        const form = new ActionFormData().title(sideTitle("Kill Y"));
        for (const entry of entries) form.button(entry.text, entry.icon);
        const response = await this.host.show(player, form);
        const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
        if (!action || !player.isValid) return;
        if (action.kind === "back") return back?.();
        if (action.kind === "save") return this.set(player, y);
        if (action.kind === "remove") return this.remove(player);
        if (action.kind === "type") y = (await this.typeHeight(player, y)) ?? y;
        else if (action.kind === "height") y = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, y + action.by * step));
        else if (action.kind === "step") step = action.step;
      }
    } finally {
      showKillY(player, undefined);
    }
  }

  /** The action bar line while the tool is held: what a use does. */
  hint(player: Player): string {
    const now = this.host.map().killY;
    return `Use: set kill Y to ${below(player)}, one below your feet   Now: ${now === undefined ? "not set" : now}`;
  }

  /** A height typed into a side form; undefined (and why) when it isn't one. */
  private async typeHeight(player: Player, start: number): Promise<number | undefined> {
    const form = new ModalFormData()
      .title(sideTitle("Kill Y"))
      .textField(`Height (a whole number from ${MIN_HEIGHT} to ${MAX_HEIGHT})`, String(start), { defaultValue: String(start) })
      .submitButton("Done");
    const response = await this.host.show(player, form);
    if (!response?.formValues || !player.isValid) return undefined;
    const y = parseHeight(String(response.formValues[0] ?? ""));
    if (y === undefined) this.host.tell(player, `§cKill Y must be a whole number from ${MIN_HEIGHT} to ${MAX_HEIGHT}.`);
    return y;
  }

  /** Removes kill Y (from the map menu). */
  remove(player: Player): void {
    if (this.host.map().killY === undefined) this.host.tell(player, "This map has no kill Y.");
    else this.host.edit(player, { op: "killY" }, "Kill Y removed.");
  }

  private set(player: Player, y: number): void {
    if (this.host.map().killY === y) this.host.tell(player, `Kill Y is already ${y}.`);
    else this.host.edit(player, { op: "killY", y }, `Kill Y set to ${y}.`);
  }
}

function below(player: Player): number {
  return blockPosition(player.location)[1] - 1;
}
