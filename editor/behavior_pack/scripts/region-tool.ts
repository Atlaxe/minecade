// The region tool. Hit a block to start a selection there (that one block), then use the tool on
// blocks, up to REACH away, to grow the selection to them, so any box can be picked without placing
// blocks. The tool only sets the box: used at the sky it does nothing. With the tool picked, the
// map menu opens the selection's screen (what to save it as: the bounds, the kill region, the
// spectator bounds, one of the game's regions and its team, a new region; its sides nudged with the
// outline following, Floor at kill Y and Back one step, and Save at the bottom), and lists the map's
// boxes: tapping one opens the same screen for it (what it is, its sides, Go to, Delete). Saving a
// selection starts the next one over, from the first choices.
import { world, type Block, type Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { bigEnough, regionMinSize, type Box, type MapEdit, type Scope } from "@minecade/minigame-core";
import { blockInView, change, keyOf, showPreview, xyz, type Picking } from "./box-picker.ts";
import { blockBox, describeBox, floorAt, growBox, nudgeBox, sameBox, sizeText, topCenter } from "./boxes.ts";
import { sideTitle } from "./marks.ts";
import { NUDGE_STEPS, regionScreenEntries } from "./menu.ts";
import { entryBox, regionEntries, regionLabel, regionName, regionTargets, targetKeyOf, type RegionEntry, type RegionTarget, type SelectionAction } from "./regions.ts";
import { actionBar, heldTool, type ToolHost } from "./tool-host.ts";

export class RegionTool {
  private readonly host: ToolHost;
  private readonly selections = new Map<string, Picking>();
  /** The target each player picked for their selection (or a checklist row picked), by its key, until it's saved. */
  private readonly targets = new Map<string, string>();
  /** A new region's name, as each player typed it, until the selection is saved. */
  private readonly names = new Map<string, string>();

  constructor(scope: Scope, host: ToolHost) {
    this.host = host;
    scope.subscribe(world.afterEvents.entityHitBlock, ({ damagingEntity, hitBlock }) => {
      if (damagingEntity.typeId !== "minecraft:player") return;
      const player = damagingEntity as Player;
      if (heldTool(player) === "region") this.start(player, hitBlock);
    });
    scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
      this.selections.delete(playerName.toLowerCase());
      this.targets.delete(playerName.toLowerCase());
      this.names.delete(playerName.toLowerCase());
    });
  }

  /** Puts the tool in hand, set to save into `target` (a checklist row's key), for the checklist. */
  equip(player: Player, target: string): void {
    this.host.equip(player, "region");
    const label = regionTargets(this.host.map(), this.host.rules).find((candidate) => candidate.key === target)?.label;
    if (label) this.targets.set(keyOf(player), target);
    this.host.tell(player, `${label ? `Region tool set to ${label}: hit` : "Region tool: hit"} a block to start a box, use the tool on blocks to grow it, and save it from the map menu.`);
  }

  /** The player's selection, for the outlines. */
  selectionOf(player: Player): { box: Box } | undefined {
    const selection = this.selections.get(keyOf(player));
    return selection && { box: selection.box };
  }

  /** The player's selection for the map menu: the box, and how many steps back it has. */
  menuSelection(player: Player): { box: Box; steps: number } | undefined {
    const selection = this.selections.get(keyOf(player));
    return selection && { box: selection.box, steps: selection.history.length };
  }

  /** The action bar line while the tool is held: what hitting and using it do. */
  hint(player: Player): string {
    const selection = this.selections.get(keyOf(player));
    if (!selection) return "Region tool: hit a block to start a box";
    return `Selection ${sizeText(selection.box)}   Use on a block: grow   Hit: new box   Save: map menu`;
  }

  /** A use: grows the selection to the block in view. At the sky it only says where saving is: no tool opens a menu there. */
  use(player: Player): void {
    const block = blockInView(player);
    const selection = this.selections.get(keyOf(player));
    if (!block) {
      actionBar(player, selection ? "Save the selection from the map menu" : "Hit a block to start a box");
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

  /** One of the selection's actions from the map menu: its screen, or clearing it. */
  async selectionAction(player: Player, action: SelectionAction, back?: () => Promise<void>): Promise<void> {
    if (!this.selections.has(keyOf(player))) {
      this.host.tell(player, "No selection yet: hit a block with the region tool to start one.");
      return;
    }
    if (action === "saveAs") return this.screen(player, undefined, back);
    this.selections.delete(keyOf(player));
    this.host.tell(player, "Selection cleared.");
  }

  /** The map's boxes, for the map menu. */
  entries(): RegionEntry[] {
    return regionEntries(this.host.map(), this.host.rules);
  }

  /** A box's screen, by its key, from the map menu. */
  async boxMenu(player: Player, key: string, back?: () => Promise<void>): Promise<void> {
    const entry = this.entries().find((candidate) => candidate.key === key);
    if (entry) await this.screen(player, entry, back);
    else this.host.tell(player, "That box changed since the menu opened. Open the map menu again.");
  }

  /**
   * The region tool's screen, for the player's selection or for a box the map has (`existing`,
   * changed on a copy until Save): what it is (tiles for the bounds, the kill region and the
   * spectator bounds, a Region list for the rest, a Team list for a team's region), a new region's name, Floor at kill Y and
   * Back one step (Go to, for a box the map has), nudge rows for each side, Step, Clear selection or
   * Delete (red), and Save at the bottom. The box shows as the selection meanwhile, with every
   * boundary.
   */
  private async screen(player: Player, existing?: RegionEntry, back?: () => Promise<void>): Promise<void> {
    const key = keyOf(player);
    const copy: Picking | undefined = existing && { box: existing.box, history: [] };
    let picked = existing ? targetKeyOf(existing) : undefined;
    let name = "";
    let open: "group" | "team" | undefined;
    let step: number = NUDGE_STEPS[0];
    try {
      for (;;) {
        const selection = copy ?? this.selections.get(key);
        if (!selection) {
          this.host.tell(player, "No selection yet: hit a block with the region tool to start one.");
          return;
        }
        showPreview(player, selection.box, existing?.key);
        const targets = regionTargets(this.host.map(), this.host.rules).filter((target) => !existing || target.kind !== "addBounds");
        let target = (existing ? picked : this.targets.get(key)) ?? targets[0].key;
        if (!targets.some((candidate) => candidate.key === target)) target = targets[0].key;
        const typed = existing ? name : (this.names.get(key) ?? "");
        const killY = this.host.map().killY;
        const entries = regionScreenEntries({ targets, target, ...(open ? { open } : {}), existing: existing?.label, name: typed, box: selection.box, steps: selection.history.length, killY, step, back: back !== undefined });
        const form = new ActionFormData().title(sideTitle(existing?.label ?? "Selection"));
        for (const entry of entries) form.button(entry.text, entry.icon);
        const response = await this.host.show(player, form);
        const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
        if (!action || !player.isValid || (!copy && this.selections.get(key) !== selection)) return;
        switch (action.kind) {
          case "back":
            return back?.();
          case "target":
            if (existing) picked = action.key;
            else this.targets.set(key, action.key);
            open = undefined;
            break;
          case "open":
            open = open === action.which ? undefined : action.which;
            break;
          case "name": {
            const next = await this.typedName(player, typed);
            if (next === undefined) break;
            if (existing) name = next;
            else this.names.set(key, next);
            break;
          }
          case "floor": {
            const box = killY === undefined ? undefined : floorAt(selection.box, killY);
            if (box) change(selection, box);
            else this.host.tell(player, `§cKill Y (${killY}) is above the box.`);
            break;
          }
          case "undo": {
            const box = selection.history.pop();
            if (box) selection.box = box;
            break;
          }
          case "goTo":
            player.teleport(topCenter(selection.box));
            break;
          case "side": {
            const box = nudgeBox(selection.box, { west: 0, east: 0, down: 0, up: 0, north: 0, south: 0, [action.side]: action.by * step });
            if (box) change(selection, box);
            else this.host.tell(player, "§cThat would turn the box inside out: a side can't pass the one across from it.");
            break;
          }
          case "step":
            step = action.step;
            break;
          case "clear":
            this.selections.delete(key);
            this.host.tell(player, "Selection cleared.");
            return;
          case "delete":
            if (existing) this.deleteBox(player, existing);
            return;
          case "save": {
            const into = targets.find((candidate) => candidate.key === target);
            if (!into) return;
            if (existing) {
              this.saveBox(player, existing, selection.box, into, typed);
              return;
            }
            // Saved: the next selection starts over, from the first choices.
            if (this.saveAs(player, selection.box, into, typed)) {
              this.selections.delete(key);
              this.targets.delete(key);
              this.names.delete(key);
            }
            return;
          }
        }
      }
    } finally {
      showPreview(player, undefined);
    }
  }

  /** A new region's name, typed in a side form; undefined when closed. */
  private async typedName(player: Player, name: string): Promise<string | undefined> {
    const form = new ModalFormData().title(sideTitle("New region")).textField("Name (letters, digits and _, starting with a letter)", "buy_zone", { defaultValue: name }).submitButton("Done");
    const response = await this.host.show(player, form);
    return response?.formValues ? String(response.formValues[0] ?? "").trim() : undefined;
  }

  /** Starts a new selection of one block. */
  private start(player: Player, block: Block): void {
    const at = xyz(block);
    this.selections.set(keyOf(player), { box: blockBox(at), history: [] });
    actionBar(player, `New selection at ${at.join(" ")}: use the tool on blocks to grow it`);
  }

  /** Saves the selection as `target` (the bounds, another bounds box, a spectator bounds box, a region, or a new region named `typed`). False when it couldn't be. */
  private saveAs(player: Player, box: Box, target: RegionTarget, typed: string): boolean {
    if (target.kind === "bounds") return this.host.edit(player, { op: "bounds", box }, `Bounds ${this.host.map().bounds ? "replaced" : "set"}: ${describeBox(box)}.`);
    const into = this.into(player, target, box, typed);
    return into !== undefined && this.host.edit(player, into.edit, `${into.label} saved: ${describeBox(box)}.`);
  }

  /** Saves a box the map has: its sides, and what it is when that changed (it moves to the end of its new list). */
  private saveBox(player: Player, entry: RegionEntry, box: Box, target: RegionTarget, typed: string): void {
    if (!this.unchanged(player, entry)) return;
    if (target.key === targetKeyOf(entry)) {
      if (entry.region && !this.bigEnough(player, entry.region.name, box)) return;
      if (!sameBox(box, entry.box)) this.host.edit(player, saveEdit(entry, box), `${entry.label} saved: ${describeBox(box)}.`);
      return;
    }
    const into = target.kind === "bounds" ? { edit: this.host.map().bounds ? ({ op: "addBounds", box } as const) : ({ op: "bounds", box } as const), label: "a bounds box" } : this.into(player, target, box, typed);
    if (!into) return;
    this.host.edit(player, { op: "batch", edits: [removeEdit(entry), into.edit] }, `${entry.label} is now ${into.label}: ${describeBox(box)}.`);
  }

  /** The edit that adds `box` to another bounds box, the spectator bounds or a region (a new one named `typed`), with the entry's label; undefined (and why) without a name. */
  private into(player: Player, target: RegionTarget, box: Box, typed: string): { edit: MapEdit; label: string } | undefined {
    if (target.kind === "addBounds" || target.kind === "spectatorBounds") {
      const spectators = target.kind === "spectatorBounds";
      const index = regionEntries(this.host.map(), this.host.rules).filter((entry) => entry.bounds !== undefined && entry.spectators === spectators).length;
      const name = spectators ? "Spectator bounds" : "Bounds";
      return { edit: { op: "addBounds", box, ...(spectators ? { spectators } : {}) }, label: index === 0 ? name : `${name} ${index + 1}` };
    }
    const name = target.kind === "new" ? regionName(typed) : target.name;
    if (!name) {
      this.host.tell(player, "§cA new region needs a name: letters, digits and _, starting with a letter.");
      return undefined;
    }
    if (!this.bigEnough(player, name, box)) return undefined;
    const list: unknown = this.host.map().regions?.[name];
    const index = Array.isArray(list) ? list.length : 0;
    return { edit: { op: "addRegion", name, box }, label: `${regionLabel(name, this.host.rules)} ${index + 1}` };
  }

  /** False (and why) when the game asks for bigger boxes in this region (Build Swap's building boundaries). */
  private bigEnough(player: Player, name: string, box: Box): boolean {
    const minSize = regionMinSize(this.host.rules.requires, name);
    if (bigEnough(box, minSize)) return true;
    this.host.tell(player, `§c${regionLabel(name, this.host.rules)} needs at least ${minSize} blocks on every side. This box is ${sizeText(box)}.`);
    return false;
  }

  private deleteBox(player: Player, entry: RegionEntry): void {
    if (this.unchanged(player, entry)) this.host.edit(player, removeEdit(entry), `${entry.label} deleted.`);
  }

  /** False (and a message) when the entry changed since it was picked. */
  private unchanged(player: Player, entry: RegionEntry): boolean {
    const box = entryBox(this.host.map(), entry);
    if (box !== undefined && sameBox(box, entry.box)) return true;
    this.host.tell(player, `${entry.label} changed since you picked it. Pick it again in the map menu, with the region tool picked.`);
    return false;
  }
}

/** The edit that writes `box` over a saved entry. */
function saveEdit(entry: RegionEntry, box: Box): MapEdit {
  return entry.region ? { op: "setRegion", name: entry.region.name, index: entry.region.index, box } : { op: "setBounds", index: entry.bounds ?? 0, box, ...spectatorsOf(entry) };
}

/** The edit that removes a saved entry. */
function removeEdit(entry: RegionEntry): MapEdit {
  return entry.region ? { op: "removeRegion", name: entry.region.name, index: entry.region.index } : { op: "removeBounds", index: entry.bounds ?? 0, ...spectatorsOf(entry) };
}

/** A bounds edit's `spectators` for a spectator bounds box (nothing for a bounds box). */
function spectatorsOf(entry: RegionEntry): { spectators?: true } {
  return entry.spectators ? { spectators: true } : {};
}
