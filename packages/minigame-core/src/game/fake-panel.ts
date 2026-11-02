// A preview's fake player's side panel (right click it): the green "wins the round" in a best-of
// round being played and the red "kills you", then Display (its skin, what it holds and its pose,
// each a list that opens under its row) and Position (nudge rows for X, Y and Z and a turn, Step,
// and Gravity, while it has a body). Every tap but the first two changes it at once and opens the
// panel again. Pure, so it can be tested: Minigame shows it and does what's tapped.
import type { Vector3 } from "@minecraft/server";
import { FAKE_POSES, FAKE_SKINS, type FakeLook } from "./fakes.ts";
import { DANGER_BUTTON, FORM_MARKS, GO_BUTTON, NUDGE_ICONS, SEGMENT_COLUMNS } from "./preview.ts";

/** How far a Position nudge moves it: Step's tiles (as the map editor's point nudges). */
export const FAKE_STEPS = [1, 0.5, 5] as const;
/** How far a turn turns it, in degrees. */
export const FAKE_TURN = 15;

export type FakeList = "skin" | "hold" | "pose";

export interface FakePanelView {
  name: string;
  /** In a best-of round being played, it can win it: for its team (by name) in team games. */
  round?: { team?: string };
  look: FakeLook;
  /** What it can hold: the game's kit items, by their id in the config. */
  items: { item: string; label: string }[];
  /** Its body's place and facing, and whether it floats, while it has one. */
  body?: { at: Vector3; yaw: number; floating: boolean };
  step: number;
  open?: FakeList;
}

export type FakePanelAction =
  | { kind: "win" }
  | { kind: "kill" }
  | { kind: "open"; which: FakeList }
  | { kind: "skin"; skin: number }
  | { kind: "hold"; item?: string }
  | { kind: "pose"; pose: number }
  | { kind: "move"; axis: 0 | 1 | 2; by: 1 | -1 }
  | { kind: "turn"; by: 1 | -1 }
  | { kind: "step"; step: number }
  | { kind: "gravity" }
  | { kind: "none" }
  | { kind: "cancel" };

const AXES = [
  { axis: 0, name: "X", plus: "east" },
  { axis: 1, name: "Y", plus: "up" },
  { axis: 2, name: "Z", plus: "south" },
] as const;

export function fakePanelEntries(view: FakePanelView): { action: FakePanelAction; text: string; icon?: string }[] {
  const entries: { action: FakePanelAction; text: string; icon?: string }[] = [];
  const lead = (action: FakePanelAction, text: string) => entries.push({ action, text: `${FORM_MARKS.lead}${text}` });
  const list = (which: FakeList, label: string, options: { action: FakePanelAction; label: string; on: boolean }[]) => {
    const open = view.open === which;
    lead({ kind: "open", which }, `${FORM_MARKS.dropdown}${open ? FORM_MARKS.on : ""}${label}: ${options.find((option) => option.on)?.label ?? ""}`);
    if (open) for (const option of options) lead(option.action, `${option.on ? FORM_MARKS.picked : ""}${option.label}`);
  };
  if (view.round) entries.push({ action: { kind: "win" }, text: `${GO_BUTTON}${view.name} wins the round${view.round.team ? `\n§7for ${view.round.team}` : ""}` });
  entries.push({ action: { kind: "kill" }, text: `${DANGER_BUTTON}${view.name} kills you` });
  lead({ kind: "none" }, `${FORM_MARKS.heading}Display`);
  list("skin", "Skin", FAKE_SKINS.map((label, skin) => ({ action: { kind: "skin", skin }, label, on: view.look.skin === skin })));
  if (view.items.length > 0) {
    const items = view.items.map(({ item, label }) => ({ action: { kind: "hold", item } as const, label, on: view.look.hold === item }));
    list("hold", "Hold", [{ action: { kind: "hold" }, label: "Nothing", on: view.look.hold === undefined }, ...items]);
  }
  list("pose", "Pose", FAKE_POSES.map((label, pose) => ({ action: { kind: "pose", pose }, label, on: view.look.pose === pose })));
  const body = view.body;
  if (body) {
    lead({ kind: "none" }, `${FORM_MARKS.heading}Position`);
    for (const { axis, name, plus } of AXES) {
      const value = [body.at.x, body.at.y, body.at.z][axis];
      entries.push(
        { action: { kind: "move", axis, by: -1 }, text: `${FORM_MARKS.minus}${name} (${plus} +): ${coordinate(value)}`, icon: NUDGE_ICONS.minus },
        { action: { kind: "move", axis, by: 1 }, text: `${FORM_MARKS.plus}${name} ${plus}`, icon: NUDGE_ICONS.plus },
      );
    }
    entries.push(
      { action: { kind: "turn", by: -1 }, text: `${FORM_MARKS.minus}Turn (right +): ${Math.round(((body.yaw % 360) + 360) % 360)}°`, icon: NUDGE_ICONS.minus },
      { action: { kind: "turn", by: 1 }, text: `${FORM_MARKS.plus}Turn right`, icon: NUDGE_ICONS.plus },
    );
    FAKE_STEPS.forEach((value, i) => {
      const on = value === view.step ? FORM_MARKS.on : "";
      entries.push({ action: { kind: "step", step: value }, text: `${FORM_MARKS.stepTile}${SEGMENT_COLUMNS[i % SEGMENT_COLUMNS.length]}${on}${value} block${value === 1 ? "" : "s"}` });
    });
    lead({ kind: "gravity" }, `${FORM_MARKS.toggle}${body.floating ? "" : FORM_MARKS.on}Gravity\n§7off: it stays where you put it`);
  }
  entries.push({ action: { kind: "cancel" }, text: "Cancel" });
  return entries;
}

/** The step a Position nudge moves along an axis. */
export function nudgeOffset(axis: 0 | 1 | 2, by: 1 | -1, step: number): Vector3 {
  const offset = { x: 0, y: 0, z: 0 };
  offset[(["x", "y", "z"] as const)[axis]] = by * step;
  return offset;
}

/** A number as a position shows it: up to two decimals. */
function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}
