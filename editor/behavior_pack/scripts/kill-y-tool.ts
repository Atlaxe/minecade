// The Kill Y tool. Players below kill Y are out; use the tool to set it one block below your feet,
// to a height you type, or to remove it. While it's held, the plane shows in red (outlines.ts).
import type { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { MAX_HEIGHT, MIN_HEIGHT, parseHeight } from "./boxes.ts";
import { blockPosition } from "./lists.ts";
import { sideTitle } from "./menu.ts";
import type { ToolHost } from "./tool-host.ts";

type KillYAction = "below" | "type" | "remove";

export class KillYTool {
  private readonly host: ToolHost;

  constructor(host: ToolHost) {
    this.host = host;
  }

  /** Puts the tool in hand, for the checklist's Kill Y row. */
  equip(player: Player): void {
    this.host.equip(player, "killY");
    this.host.tell(player, "Kill Y tool: use it to set the height players are out below. While you hold it, the plane shows in red.");
  }

  async use(player: Player): Promise<void> {
    // Where they are now, before the form opens.
    const feet = blockPosition(player.location)[1];
    const below = feet - 1;
    const now = this.host.map().killY;
    const actions: { action: KillYAction; text: string }[] = [
      { action: "below", text: `Set to ${below}\n§7one block below your feet` },
      { action: "type", text: "Type a height" },
      ...(now === undefined ? [] : [{ action: "remove" as const, text: "§cRemove kill Y" }]),
    ];
    const form = new ActionFormData().title(sideTitle("Kill Y")).body(`Players below kill Y are out. It is ${now === undefined ? "not set" : now}, and you stand at y ${feet}.`);
    for (const { text } of actions) form.button(text);
    const response = await this.host.show(player, form);
    const action = response?.selection === undefined ? undefined : actions[response.selection]?.action;
    if (!action || !player.isValid) return;
    switch (action) {
      case "below":
        this.set(player, below);
        return;
      case "type":
        return this.typeHeight(player, now ?? below);
      case "remove":
        this.host.edit(player, { op: "killY" }, "Kill Y removed.");
        return;
    }
  }

  private set(player: Player, y: number): void {
    if (this.host.map().killY === y) this.host.tell(player, `Kill Y is already ${y}.`);
    else this.host.edit(player, { op: "killY", y }, `Kill Y set to ${y}.`);
  }

  private async typeHeight(player: Player, start: number): Promise<void> {
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
}
