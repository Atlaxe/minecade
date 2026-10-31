// The Kill Y tool. Players below kill Y are out; a use sets it one block below your feet at once.
// With the tool picked, the map menu offers typing a height and removing it. While it's held, the
// plane shows in red (outlines.ts).
import type { Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { MAX_HEIGHT, MIN_HEIGHT, parseHeight } from "./boxes.ts";
import { blockPosition } from "./lists.ts";
import type { ToolHost } from "./tool-host.ts";

export class KillYTool {
  private readonly host: ToolHost;

  constructor(host: ToolHost) {
    this.host = host;
  }

  /** Puts the tool in hand, for the checklist's Kill Y row. */
  equip(player: Player): void {
    this.host.equip(player, "killY");
    this.host.tell(player, "Kill Y tool: use it to set the height players are out below, one block below your feet. While you hold it, the plane shows in red.");
  }

  /** A use: kill Y one block below the player's feet. */
  use(player: Player): void {
    this.set(player, below(player));
  }

  /** The action bar line while the tool is held: what a use does. */
  hint(player: Player): string {
    const now = this.host.map().killY;
    return `Use: kill Y to ${below(player)}, one below your feet   Now: ${now === undefined ? "not set" : now}`;
  }

  /** Asks for a height (from the map menu). */
  async typeHeight(player: Player): Promise<void> {
    const start = this.host.map().killY ?? below(player);
    const form = new ModalFormData()
      .title("Kill Y")
      .textField(`Height (a whole number from ${MIN_HEIGHT} to ${MAX_HEIGHT})`, String(start), { defaultValue: String(start) })
      .submitButton("Set");
    const response = await this.host.show(player, form);
    if (!response?.formValues || !player.isValid) return;
    const y = parseHeight(String(response.formValues[0] ?? ""));
    if (y === undefined) this.host.tell(player, `§cKill Y must be a whole number from ${MIN_HEIGHT} to ${MAX_HEIGHT}.`);
    else this.set(player, y);
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
