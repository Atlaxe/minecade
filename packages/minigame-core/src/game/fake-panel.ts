// A preview's fake player's side panel (right click it): the green "wins the round" in a best-of
// round being played, and the red "kills you". How it looks and where it stands are the map
// editor's (its Mannequin tool); in a preview, sneaking and right clicking it changes its pose.
// Pure, so it can be tested: Minigame shows it and does what's tapped.
import { DANGER_BUTTON, GO_BUTTON } from "./preview.ts";

export interface FakePanelView {
  name: string;
  /** In a best-of round being played, it can win it: for its team (by name) in team games. */
  round?: { team?: string };
}

export type FakePanelAction = { kind: "win" } | { kind: "kill" } | { kind: "cancel" };

export function fakePanelEntries(view: FakePanelView): { action: FakePanelAction; text: string }[] {
  const entries: { action: FakePanelAction; text: string }[] = [];
  if (view.round) entries.push({ action: { kind: "win" }, text: `${GO_BUTTON}${view.name} wins the round${view.round.team ? `\n§7for ${view.round.team}` : ""}` });
  entries.push({ action: { kind: "kill" }, text: `${DANGER_BUTTON}${view.name} kills you` });
  entries.push({ action: { kind: "cancel" }, text: "Cancel" });
  return entries;
}
