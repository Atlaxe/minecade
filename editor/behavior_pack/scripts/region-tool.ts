// The region tool. Hit a block to start a selection there (that one block), then use the tool on
// blocks, up to REACH away, to grow the selection to them, so any box can be picked without placing
// blocks. Using it at the air opens the region form: save the box as the bounds, a region or a kill
// region, nudge its sides, or put its bottom at kill Y. With the tool picked, the map menu offers
// the same, and lists the map's boxes to edit, nudge, visit or delete.
import { world, type Block, type Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { Box, MapEdit, Scope } from "@minecade/minigame-core";
import { blockInView, change, keyOf, nudgeForm, xyz, type Picking } from "./box-picker.ts";
import { blockBox, describeBox, floorAt, growBox, sameBox, sizeText, topCenter } from "./boxes.ts";
import { dangerText, sideTitle } from "./marks.ts";
import { entryBox, regionEntries, regionLabel, regionName, regionTargets, selectionActions, type RegionEntry, type SelectionAction } from "./regions.ts";
import { actionBar, heldTool, type ToolHost } from "./tool-host.ts";

interface Selection extends Picking {
  /** The saved box this one was loaded from or saved as: Save changes writes it back. */
  editing?: RegionEntry;
}

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

  /** The player's selection for the map menu: the box, the label of the saved box it edits, and how many steps back it has. */
  menuSelection(player: Player): { box: Box; editing?: string; steps: number } | undefined {
    const selection = this.selections.get(keyOf(player));
    if (!selection) return undefined;
    const editing = selection.editing && this.current(selection.editing) ? selection.editing.label : undefined;
    return { box: selection.box, editing, steps: selection.history.length };
  }

  /** The action bar line while the tool is held: what hitting and using it do. */
  hint(player: Player): string {
    const selection = this.selections.get(keyOf(player));
    if (!selection) return "Region tool: hit a block to start a box";
    return `Selection ${sizeText(selection.box)}   Use on a block: grow   Use at the sky: save   Hit: new box`;
  }

  /** A use: grows the selection to the block in view, or opens the region form when there's none in reach. */
  async use(player: Player): Promise<void> {
    const block = blockInView(player);
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
    const editing = selection.editing && this.current(selection.editing) ? selection.editing : undefined;
    const actions = selectionActions(editing?.label, selection.history.length, this.host.map().killY);
    const form = new ActionFormData().title(sideTitle("Selection")).body(`${describeBox(selection.box)}${editing ? `\nEditing ${editing.label}.` : ""}`);
    for (const { text } of actions) form.button(text);
    const response = await this.host.show(player, form);
    const action = response?.selection === undefined ? undefined : actions[response.selection]?.action;
    if (action && player.isValid && this.selections.get(keyOf(player)) === selection) await this.selectionAction(player, action);
  }

  /** Does one of the selection's actions (from the region form or the map menu). */
  async selectionAction(player: Player, action: SelectionAction): Promise<void> {
    const selection = this.selections.get(keyOf(player));
    if (!selection) {
      this.host.tell(player, "No selection yet: hit a block with the region tool to start one.");
      return;
    }
    const killY = this.host.map().killY;
    switch (action) {
      case "saveChanges":
        this.saveChanges(player, selection);
        return;
      case "saveAs":
        return this.saveAs(player, selection);
      case "nudge": {
        const box = await nudgeForm(this.host, player, selection.box, "Nudge the selection");
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

  /** The map's boxes, for the map menu. */
  entries(): RegionEntry[] {
    return regionEntries(this.host.map(), this.host.rules);
  }

  /** A box's menu (edit, nudge, go to, delete), by its key, from the map menu. */
  async boxMenu(player: Player, key: string): Promise<void> {
    const entry = this.entries().find((candidate) => candidate.key === key);
    if (entry) await this.entryMenu(player, entry);
    else this.host.tell(player, "That box changed since the menu opened. Open the map menu again.");
  }

  private async entryMenu(player: Player, entry: RegionEntry): Promise<void> {
    const actions: { action: EntryAction; text: string }[] = [
      { action: "edit", text: "Edit\n§7load it into your selection" },
      { action: "nudge", text: "Nudge sides" },
      { action: "goTo", text: "Go to\n§7on top, over its middle" },
      { action: "delete", text: dangerText("Delete") },
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
        const box = await nudgeForm(this.host, player, entry.box, `Nudge ${entry.label}`);
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

  /** True when the map still has this entry's box where it was. */
  private current(entry: RegionEntry): boolean {
    const box = entryBox(this.host.map(), entry);
    return box !== undefined && sameBox(box, entry.box);
  }

  /** False (and a message) when the entry changed since it was picked. */
  private unchanged(player: Player, entry: RegionEntry): boolean {
    if (this.current(entry)) return true;
    this.host.tell(player, `${entry.label} changed since you picked it. Pick it again in the map menu, with the region tool picked.`);
    return false;
  }
}

/** The edit that writes `box` over a saved entry. */
function saveEdit(entry: RegionEntry, box: Box): MapEdit {
  return entry.region ? { op: "setRegion", name: entry.region.name, index: entry.region.index, box } : { op: "bounds", box };
}
