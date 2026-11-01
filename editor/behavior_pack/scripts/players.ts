// Guests: players a map editor invited, by gamertag, from the Players menu (the editor lobby's menu,
// Select's map menu, Edit's gear). They may join the editor lobby and whatever runs on Select's port
// (Select, or a preview), never Edit; the host (tools/editor/runner.ts) keeps the list, opens those
// servers to them, and moves them on. Everyone not in LAN_PLAYERS is a guest.
import type { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { readServerVars, type GuestInfo } from "@minecade/minigame-core";
import type { HostLink } from "./link.ts";
import { dangerText, sideTitle } from "./marks.ts";
import { BACK_TEXT, ICONS, PLAYERS_BODY, guestEntries, guestWhere } from "./menu.ts";

let editors: Set<string> | undefined;

/** A map editor (in LAN_PLAYERS); anyone else here was invited. */
export function isMapEditor(player: Player): boolean {
  editors ??= new Set(readServerVars().lanPlayers.map((name) => name.toLowerCase()));
  return editors.has(player.name.toLowerCase());
}

type Show = <R extends { canceled: boolean }>(player: Player, form: { show(player: Player): Promise<R> }) => Promise<R | undefined>;

export class PlayersMenu {
  private readonly link: HostLink;
  private readonly show: Show;
  private guests: GuestInfo[] = [];

  constructor(link: HostLink, show: Show) {
    this.link = link;
    this.show = show;
  }

  /** The host's latest list (the "guests" message). */
  update(guests: GuestInfo[]): void {
    this.guests = guests;
  }

  /** The Players menu; `back` (the back arrow) opens the menu it came from. */
  async open(player: Player, back?: () => Promise<void>): Promise<void> {
    const entries = guestEntries(this.guests);
    const form = new ActionFormData().title(sideTitle("Players")).body(PLAYERS_BODY);
    if (back) form.button(BACK_TEXT, ICONS.back);
    for (const entry of entries) form.button(entry.text);
    const response = await this.show(player, form);
    if (back && response?.selection === 0 && player.isValid) return back();
    const picked = response?.selection === undefined ? undefined : entries[response.selection - (back ? 1 : 0)];
    if (!picked || !player.isValid) return;
    if (picked.name === undefined) return this.invite(player);
    return this.remove(player, picked.name);
  }

  private async invite(player: Player): Promise<void> {
    const form = new ModalFormData().title(sideTitle("Invite a player")).textField("Gamertag", "Steve", { defaultValue: "" }).submitButton("Invite");
    const response = await this.show(player, form);
    const name = String(response?.formValues?.[0] ?? "").trim();
    if (!name || !player.isValid) return;
    this.link.send({ t: "invite", by: player.name, name, on: true });
  }

  private async remove(player: Player, name: string): Promise<void> {
    const guest = this.guests.find((candidate) => candidate.name === name);
    const body = `${name} is ${guest ? guestWhere(guest) : "not on"}. Removing them takes the invitation back, and disconnects them if they're on.`;
    const form = new ActionFormData().title(sideTitle(name)).body(body).button(dangerText("Remove")).button("Back");
    const response = await this.show(player, form);
    if (!player.isValid) return;
    if (response?.selection === 0) this.link.send({ t: "invite", by: player.name, name, on: false });
    else if (response?.selection === 1) return this.open(player);
  }
}
