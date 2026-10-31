// The region tool. Hit a block to start a selection there (that one block), then use the tool on
// blocks, up to REACH away, to grow the selection to them, so any box can be picked without placing
// blocks. Using it at the air, or Selection in the map menu, opens the region form: save the box
// as the bounds, a region or a kill region, nudge its sides, or put its bottom at kill Y. The map
// menu's Bounds and regions list edits, nudges, visits and deletes the boxes a map already has.
import { world, type Block, type Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { Box, MapEdit, Scope, Vec3 } from "@minecade/minigame-core";
import { blockBox, describeBox, floorAt, growBox, nudgeBox, sameBox, sizeText, topCenter, type Sides } from "./boxes.ts";
import { sideTitle } from "./menu.ts";
import { entryBox, regionEntries, regionLabel, regionName, regionTargets, type RegionEntry } from "./regions.ts";
import { actionBar, heldTool, type ToolHost } from "./tool-host.ts";

/** How far a use reaches to grow the selection, in blocks. */
const REACH = 64;
/** How many steps Back one step can go. */
const HISTORY = 50;
/** How far one nudge can move a side, in blocks. */
const NUDGE = 16;

const SIDES: [keyof Sides, string][] = [
  ["west", "West side (x -). Above 0 moves a side out, below 0 in"],
  ["east", "East side (x +)"],
  ["down", "Bottom"],
  ["up", "Top"],
  ["north", "North side (z -)"],
  ["south", "South side (z +)"],
];

interface Selection {
  box: Box;
  /** Earlier boxes, newest last, for Back one step. */
  history: Box[];
  /** The saved box this one was loaded from or saved as: Save changes writes it back. */
  editing?: RegionEntry;
}

type SelectionAction = "saveChanges" | "saveAs" | "nudge" | "floor" | "back" | "clear";
type EntryAction = "edit" | "nudge" | "goTo" | "delete";

export class RegionTool {
  private readonly host: ToolHost;
  private readonly selections = new Map<string, Selection>();
  /** The Save as target each player last chose (or a checklist row picked), by its key. */
  private readonly targets = new Map<string, string>();

  constructor(scope: Scope, host: ToolHost) {
    this.host = host;
    scope.subscribe(world.afterEvents.entityHitBlock, ({ damagingEntity, hitBlock }) => {
      if (damagingEntity.typeId !== "minecraft:player") return;
      const player = damagingEntity as Player;
      if (heldTool(player) === "region" && host.isEditor(player)) this.start(player, hitBlock);
    });
    scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
      this.selections.delete(playerName.toLowerCase());
      this.targets.delete(playerName.toLowerCase());
    });
  }

  /** Puts the tool in hand, set to save into `target` (a checklist row's key), for the checklist. */
  equip(player: Player, target: string): void {
    this.host.equip(player, "region");
    const label = regionTargets(this.host.map(), this.host.rules).find((candidate) => candidate.key === target)?.label;
    if (label) this.targets.set(keyOf(player), target);
    this.host.tell(player, `${label ? `Region tool set to ${label}: hit` : "Region tool: hit"} a block to start a box, use the tool on blocks to grow it, and use it at the air to save it.`);
  }

  /** The player's selection, and the key of the entry it edits, for the outlines. */
  selectionOf(player: Player): { box: Box; editing?: string } | undefined {
    const selection = this.selections.get(keyOf(player));
    return selection && { box: selection.box, editing: selection.editing?.key };
  }

  /** The size of the player's selection ("12 x 5 x 30"), for the map menu. */
  selectionText(player: Player): string | undefined {
    const selection = this.selections.get(keyOf(player));
    return selection && sizeText(selection.box);
  }

  /** A use: grows the selection to the block in view, or opens the region form when there's none in reach. */
  async use(player: Player): Promise<void> {
    const block = player.getBlockFromViewDirection({ maxDistance: REACH, includeLiquidBlocks: true, includePassableBlocks: true })?.block;
    const selection = this.selections.get(keyOf(player));
    if (!block) {
      if (selection) await this.selectionForm(player);
      else this.host.tell(player, "No selection yet: hit a block with the region tool to start one.");
      return;
    }
    if (!selection) {
      this.start(player, block);
      return;
    }
    const box = growBox(selection.box, xyz(block));
    if (sameBox(box, selection.box)) {
      actionBar(player, `Already in the selection: ${describeBox(box)}`);
      return;
    }
    change(selection, box);
    actionBar(player, `Selection: ${describeBox(box)}`);
  }

  /** The region form: save the selection, nudge it, floor it at kill Y, step back, or clear it. */
  async selectionForm(player: Player): Promise<void> {
    const selection = this.selections.get(keyOf(player));
    if (!selection) {
      this.host.tell(player, "No selection yet: hit a block with the region tool to start one.");
      return;
    }
    const killY = this.host.map().killY;
    const editing = selection.editing && this.current(selection.editing) ? selection.editing : undefined;
    const actions: { action: SelectionAction; text: string }[] = [
      ...(editing ? [{ action: "saveChanges" as const, text: `Save changes\n§7to ${editing.label}` }] : []),
      { action: "saveAs", text: "Save as...\n§7bounds, a region or a kill region" },
      { action: "nudge", text: "Nudge sides" },
      ...(killY === undefined ? [] : [{ action: "floor" as const, text: `Floor at kill Y\n§7bottom at y ${killY}` }]),
      ...(selection.history.length > 0 ? [{ action: "back" as const, text: "Back one step" }] : []),
      { action: "clear", text: "Clear selection" },
    ];
    const form = new ActionFormData().title(sideTitle("Selection")).body(`${describeBox(selection.box)}${editing ? `\nEditing ${editing.label}.` : ""}`);
    for (const { text } of actions) form.button(text);
    const response = await this.host.show(player, form);
    const action = response?.selection === undefined ? undefined : actions[response.selection]?.action;
    if (!action || !player.isValid || this.selections.get(keyOf(player)) !== selection) return;
    switch (action) {
      case "saveChanges":
        this.saveChanges(player, selection);
        return;
      case "saveAs":
        return this.saveAs(player, selection);
      case "nudge": {
        const box = await this.nudge(player, selection.box, "Nudge the selection");
        if (!box || sameBox(box, selection.box) || this.selections.get(keyOf(player)) !== selection) return;
        change(selection, box);
        actionBar(player, `Selection: ${describeBox(box)}`);
        return;
      }
      case "floor": {
        const box = killY === undefined ? undefined : floorAt(selection.box, killY);
        if (!box) {
          this.host.tell(player, `§cKill Y (${killY}) is above the selection.`);
          return;
        }
        change(selection, box);
        actionBar(player, `Selection: ${describeBox(box)}`);
        return;
      }
      case "back": {
        const box = selection.history.pop();
        if (box) selection.box = box;
        actionBar(player, `Selection: ${describeBox(selection.box)}`);
        return;
      }
      case "clear":
        this.selections.delete(keyOf(player));
        this.host.tell(player, "Selection cleared.");
        return;
    }
  }

  /** The map menu's list of the map's boxes: tap one to edit, nudge, visit or delete it. */
  async regionsMenu(player: Player): Promise<void> {
    const entries = regionEntries(this.host.map(), this.host.rules);
    if (entries.length === 0) {
      this.host.tell(player, "This map has no bounds or regions yet: make them with the region tool.");
      return;
    }
    const form = new ActionFormData().title(sideTitle("Bounds and regions")).body("Tap one to edit, nudge, visit or delete it.");
    for (const entry of entries) form.button(`${entry.label}\n§7${sizeText(entry.box)}`);
    const response = await this.host.show(player, form);
    const entry = response?.selection === undefined ? undefined : entries[response.selection];
    if (entry && player.isValid) await this.entryMenu(player, entry);
  }

  private async entryMenu(player: Player, entry: RegionEntry): Promise<void> {
    const actions: { action: EntryAction; text: string }[] = [
      { action: "edit", text: "Edit\n§7load it into your selection" },
      { action: "nudge", text: "Nudge sides" },
      { action: "goTo", text: "Go to\n§7on top, over its middle" },
      { action: "delete", text: "§cDelete" },
    ];
    const form = new ActionFormData().title(sideTitle(entry.label)).body(describeBox(entry.box));
    for (const { text } of actions) form.button(text);
    const response = await this.host.show(player, form);
    const action = response?.selection === undefined ? undefined : actions[response.selection]?.action;
    if (!action || !player.isValid || !this.unchanged(player, entry)) return;
    switch (action) {
      case "edit":
        this.selections.set(keyOf(player), { box: entry.box, history: [], editing: entry });
        this.host.equip(player, "region");
        this.host.tell(player, `${entry.label} is in your selection. Change it with the region tool, then use the tool at the air and choose Save changes.`);
        return;
      case "nudge": {
        const box = await this.nudge(player, entry.box, `Nudge ${entry.label}`);
        if (!box || sameBox(box, entry.box) || !player.isValid || !this.unchanged(player, entry)) return;
        if (!this.host.edit(player, saveEdit(entry, box), `${entry.label} nudged: ${describeBox(box)}.`)) return;
        // Their own selection of this box follows it.
        const selection = this.selections.get(keyOf(player));
        if (selection?.editing?.key === entry.key) {
          selection.box = box;
          selection.editing = { ...entry, box };
        }
        return;
      }
      case "goTo":
        player.teleport(topCenter(entry.box));
        this.host.tell(player, `On top of ${entry.label}.`);
        return;
      case "delete": {
        const edit: MapEdit = entry.region ? { op: "removeRegion", name: entry.region.name, index: entry.region.index } : { op: "bounds" };
        if (!this.host.edit(player, edit, `${entry.label} deleted.`)) return;
        const selection = this.selections.get(keyOf(player));
        if (selection?.editing?.key === entry.key) selection.editing = undefined;
        return;
      }
    }
  }

  /** Starts a new selection of one block. */
  private start(player: Player, block: Block): void {
    const at = xyz(block);
    this.selections.set(keyOf(player), { box: blockBox(at), history: [] });
    actionBar(player, `New selection at ${at.join(" ")}: use the tool on blocks to grow it`);
  }

  private saveChanges(player: Player, selection: Selection): void {
    const entry = selection.editing;
    if (!entry || !this.unchanged(player, entry)) return;
    const box = selection.box;
    if (this.host.edit(player, saveEdit(entry, box), `${entry.label} saved: ${describeBox(box)}.`)) selection.editing = { ...entry, box };
  }

  private async saveAs(player: Player, selection: Selection): Promise<void> {
    const targets = regionTargets(this.host.map(), this.host.rules);
    const last = this.targets.get(keyOf(player));
    const form = new ModalFormData()
      .title("Save the selection")
      .dropdown("Save as", targets.map((target) => target.label), { defaultValueIndex: Math.max(0, targets.findIndex((target) => target.key === last)) })
      .textField("Name, for a new region", "letters, digits and _", { defaultValue: "" })
      .submitButton("Save");
    const response = await this.host.show(player, form);
    if (!response?.formValues || !player.isValid || this.selections.get(keyOf(player)) !== selection) return;
    const target = targets[response.formValues[0] as number];
    if (!target) return;
    this.targets.set(keyOf(player), target.key);
    const box = selection.box;
    if (target.kind === "bounds") {
      const done = `Bounds ${this.host.map().bounds ? "replaced" : "set"}: ${describeBox(box)}.`;
      if (this.host.edit(player, { op: "bounds", box }, done)) selection.editing = { key: "bounds", label: "Bounds", box };
      return;
    }
    const name = target.kind === "new" ? regionName(String(response.formValues[1] ?? "")) : target.name;
    if (!name) {
      this.host.tell(player, "§cA new region needs a name: letters, digits and _, starting with a letter.");
      return;
    }
    const list: unknown = this.host.map().regions?.[name];
    const index = Array.isArray(list) ? list.length : 0;
    const label = `${regionLabel(name, this.host.rules)} ${index + 1}`;
    if (this.host.edit(player, { op: "addRegion", name, box }, `${label} saved: ${describeBox(box)}.`)) {
      selection.editing = { key: `regions.${name}#${index}`, label, box, region: { name, index } };
    }
  }

  /** Asks how far to move each side; the moved box, or undefined (and a message) when it doesn't work. */
  private async nudge(player: Player, box: Box, title: string): Promise<Box | undefined> {
    const form = new ModalFormData().title(title);
    for (const [, label] of SIDES) form.slider(label, -NUDGE, NUDGE, { valueStep: 1, defaultValue: 0 });
    form.submitButton("Nudge");
    const response = await this.host.show(player, form);
    const values = response?.formValues;
    if (!values || !player.isValid) return undefined;
    const sides = Object.fromEntries(SIDES.map(([side], i) => [side, Number(values[i]) || 0])) as unknown as Sides;
    const nudged = nudgeBox(box, sides);
    if (!nudged) this.host.tell(player, "§cThat would turn the box inside out: a side can't pass the one across from it.");
    return nudged;
  }

  /** True when the map still has this entry's box where it was. */
  private current(entry: RegionEntry): boolean {
    const box = entryBox(this.host.map(), entry);
    return box !== undefined && sameBox(box, entry.box);
  }

  /** False (and a message) when the entry changed since it was picked. */
  private unchanged(player: Player, entry: RegionEntry): boolean {
    if (this.current(entry)) return true;
    this.host.tell(player, `${entry.label} changed since you picked it. Pick it again from Bounds and regions in the map menu.`);
    return false;
  }
}

/** The edit that writes `box` over a saved entry. */
function saveEdit(entry: RegionEntry, box: Box): MapEdit {
  return entry.region ? { op: "setRegion", name: entry.region.name, index: entry.region.index, box } : { op: "bounds", box };
}

/** Moves a selection to a new box, keeping the old one for Back one step. */
function change(selection: Selection, box: Box): void {
  selection.history.push(selection.box);
  if (selection.history.length > HISTORY) selection.history.shift();
  selection.box = box;
}

function xyz(block: Block): Vec3 {
  return [block.location.x, block.location.y, block.location.z];
}

function keyOf(player: Player): string {
  return player.name.toLowerCase();
}
