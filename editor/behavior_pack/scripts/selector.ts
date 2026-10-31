// Select mode in game: map editors box maps in a copy of a converted world. The Select tool picks a
// box the way the region tool does (hit a block to start, use on blocks to grow, use at the sky for
// its form), and Save as map sends it to the host (tools/editor/select-session.ts), which cuts it
// out and moves it to the middle in the background. The maps from this world and how each is going
// arrive as "selection" messages; the map menu lists them, and a ready one can be edited (the
// editor restarts on it). Nothing here changes the world: the host never saves it.
import { EntityComponentTypes, GameMode, ItemLockMode, ItemStack, world, type Block, type Container, type Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { describeError, log, showForm, type Scope, type SelectInfo, type SelectionInfo } from "@minecade/minigame-core";
import type { HostMessage } from "@minecade/minigame-core/config";
import { blockInView, change, keyOf, nudgeForm, xyz, type Picking } from "./box-picker.ts";
import { blockBox, describeBox, growBox, sameBox, sizeText } from "./boxes.ts";
import { HostLink } from "./link.ts";
import { blockPosition } from "./lists.ts";
import { dangerText, mapTitle, sideTitle } from "./marks.ts";
import { mapActions, selectMenuBody, selectMenuEntries, statusLine, type MapAction, type MenuAction, type PickAction } from "./menu.ts";
import { Outlines } from "./outlines.ts";
import { BOUNDS_COLOR, KILL_COLOR, type Rgb } from "./regions.ts";
import { actionBar, heldTool, hintBar } from "./tool-host.ts";
import { SELECT_TOOL } from "./tools.ts";

const MAP_MENU = "minecade:map_menu";
const ITEMS = new Set([MAP_MENU, SELECT_TOOL.item]);
/** The map menu's hotbar slot (0-based): the last one, slot 9 on screen. */
const MENU_SLOT = 8;
/** The Select tool's: slot 1 on screen, never locked. */
const TOOL_SLOT = 0;
const PREFIX = "§b[Editor]§r ";
/** How often the held tool's hint is put back on the action bar (it fades otherwise). */
const HINT_TICKS = 10;
/** A ready map's outline. Queued and running ones are white, failed ones red. */
const READY_COLOR: Rgb = { red: 0x55 / 255, green: 1, blue: 0x55 / 255 };

export class Selector {
  private readonly scope: Scope;
  private readonly info: SelectInfo;
  private readonly link: HostLink;
  private readonly editors: Set<string>;
  private readonly selections = new Map<string, Picking>();
  private readonly formOpen = new Set<string>();
  /** The target each player last saved a map for. */
  private readonly lastTarget = new Map<string, string>();
  private maps: SelectionInfo[];

  constructor(scope: Scope, info: SelectInfo) {
    this.scope = scope;
    this.info = info;
    this.editors = new Set(info.editors.map((name) => name.toLowerCase()));
    this.maps = [...info.selections];
    this.link = new HostLink(scope, { config: () => {}, message: (message) => this.receive(message) });
    new Outlines(
      scope,
      {
        isEditor: (player) => this.isEditor(player),
        selection: (player) => {
          const selection = this.selections.get(keyOf(player));
          return selection && { box: selection.box };
        },
        boxes: () => this.maps.map((map) => ({ key: `${map.target}/${map.map}`, box: map.box, color: colorOf(map) })),
      },
      ["select"],
    );
  }

  start(): void {
    const scope = this.scope;
    world.gameRules.doWeatherCycle = false;
    world.gameRules.doMobSpawning = false;
    scope.subscribe(world.afterEvents.playerSpawn, ({ player, initialSpawn }) => {
      if (initialSpawn) scope.defer(() => this.welcome(player));
    });
    scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
      const key = playerName.toLowerCase();
      this.selections.delete(key);
      this.formOpen.delete(key);
      this.lastTarget.delete(key);
    });
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (!ITEMS.has(itemStack.typeId)) return;
      if (!this.isEditor(source)) {
        takeItems(source);
        return;
      }
      if (itemStack.typeId === MAP_MENU) void this.menu(source);
      else void this.use(source);
    });
    scope.subscribe(world.afterEvents.entityHitBlock, ({ damagingEntity, hitBlock }) => {
      if (damagingEntity.typeId !== "minecraft:player") return;
      const player = damagingEntity as Player;
      if (heldTool(player) === "select" && this.isEditor(player)) this.begin(player, hitBlock);
    });
    // The Select tool never breaks the block it hits, which creative mode would.
    scope.subscribeBefore(world.beforeEvents.playerBreakBlock, (event) => {
      if (event.itemStack && ITEMS.has(event.itemStack.typeId)) event.cancel = true;
    });
    scope.interval(() => this.hints(), HINT_TICKS);
    this.link.send({ t: "ready" });
  }

  private receive(message: Exclude<HostMessage, { t: "config" }>): void {
    switch (message.t) {
      case "selection": {
        const same = (map: SelectionInfo) => map.target === message.item.target && map.map === message.item.map;
        this.maps = this.maps.some(same) ? this.maps.map((map) => (same(map) ? message.item : map)) : [...this.maps, message.item];
        return;
      }
      case "forgotten":
        this.maps = this.maps.filter((map) => !(map.target === message.target && map.map === message.map));
        return;
      case "say":
        for (const player of world.getAllPlayers()) if (!message.to || player.name === message.to) tell(player, message.text);
        return;
      case "cleanup":
        // Select mode has no markers.
        this.link.send({ t: "clean", id: message.id, left: 0 });
        return;
    }
  }

  private isEditor(player: Player): boolean {
    return this.editors.has(player.name.toLowerCase());
  }

  private welcome(player: Player): void {
    if (!player.isValid) return;
    player.setGameMode(GameMode.Creative);
    if (!this.isEditor(player)) {
      takeItems(player);
      tell(player, `Select mode on "${this.info.world}": map editors box maps here. Look around in creative.`);
      return;
    }
    const inventory = inventoryOf(player);
    const menu = new ItemStack(MAP_MENU, 1);
    menu.lockMode = ItemLockMode.slot;
    menu.keepOnDeath = true;
    inventory?.setItem(MENU_SLOT, menu);
    this.giveTool(player);
    tell(player, `Select mode on "${this.info.world}". ${SELECT_TOOL.howTo} The map menu in slot 9 lists the maps from this world.`);
  }

  private giveTool(player: Player): void {
    const inventory = inventoryOf(player);
    if (!inventory || holds(inventory, SELECT_TOOL.item)) return;
    const old = inventory.getItem(TOOL_SLOT);
    const tool = new ItemStack(SELECT_TOOL.item, 1);
    tool.keepOnDeath = true;
    inventory.setItem(TOOL_SLOT, tool);
    if (old) inventory.addItem(old);
    player.selectedSlotIndex = TOOL_SLOT;
  }

  private hints(): void {
    for (const player of world.getAllPlayers()) {
      if (heldTool(player) !== "select" || !this.isEditor(player)) continue;
      const selection = this.selections.get(keyOf(player));
      hintBar(
        player,
        selection
          ? `Selection ${sizeText(selection.box)}   Use on a block: grow   Use at the sky: save as a map   Hit: new box`
          : "Select tool: hit a block to start a box around a map",
      );
    }
  }

  /** Shows a form unless this player has one open already. */
  private async show<R extends { canceled: boolean }>(player: Player, form: { show(player: Player): Promise<R> }): Promise<R | undefined> {
    const key = keyOf(player);
    if (this.formOpen.has(key)) return undefined;
    this.formOpen.add(key);
    try {
      return await showForm(this.scope, player, form);
    } finally {
      this.formOpen.delete(key);
    }
  }

  // ---- The Select tool ----------------------------------------------------------------------

  private begin(player: Player, block: Block): void {
    const at = xyz(block);
    this.selections.set(keyOf(player), { box: blockBox(at), history: [] });
    actionBar(player, `New selection at ${at.join(" ")}: use the tool on blocks to grow it`);
  }

  /** A use: grows the selection to the block in view, or opens the selection's form at the sky. */
  private async use(player: Player): Promise<void> {
    const block = blockInView(player);
    const selection = this.selections.get(keyOf(player));
    if (!block) {
      if (selection) await this.selectionForm(player);
      else tell(player, "No selection yet: hit a block with the Select tool to start one.");
      return;
    }
    if (!selection) {
      this.begin(player, block);
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

  private async selectionForm(player: Player): Promise<void> {
    const selection = this.selections.get(keyOf(player));
    if (!selection) return;
    const entries = selectMenuEntries({ world: this.info.world, toolOut: true, selection: { box: selection.box, steps: selection.history.length }, maps: [] }).filter(
      (entry): entry is { action: Extract<MenuAction, { kind: "pick" }>; text: string } => entry.action.kind === "pick",
    );
    const form = new ActionFormData().title(sideTitle("Selection")).body(describeBox(selection.box));
    for (const { text } of entries) form.button(text);
    const response = await this.show(player, form);
    const entry = response?.selection === undefined ? undefined : entries[response.selection];
    if (entry && player.isValid) await this.pick(player, entry.action.action);
  }

  private async pick(player: Player, action: PickAction): Promise<void> {
    const selection = this.selections.get(keyOf(player));
    if (!selection) {
      tell(player, "No selection yet: hit a block with the Select tool to start one.");
      return;
    }
    switch (action) {
      case "saveMap":
        return this.saveMapForm(player, selection);
      case "nudge": {
        const box = await nudgeForm({ show: (who, form) => this.show(who, form), tell }, player, selection.box, "Nudge the selection");
        if (!box || sameBox(box, selection.box) || this.selections.get(keyOf(player)) !== selection) return;
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
        tell(player, "Selection cleared.");
        return;
    }
  }

  /** Save as map: the target, the name and the map id. The first spawn is where the player stands. */
  private async saveMapForm(player: Player, selection: Picking): Promise<void> {
    const spawn = blockPosition(player.location);
    const box = selection.box;
    if (!spawn.every((value, axis) => value >= box.min[axis] && value <= box.max[axis])) {
      tell(player, "§cStand inside the box when you save it: where you stand becomes the map's first spawn.");
      return;
    }
    const targets = this.info.targets;
    const last = this.lastTarget.get(keyOf(player));
    const form = new ModalFormData()
      .title("Save as map")
      .dropdown("For", targets.map((target) => target.name), { defaultValueIndex: Math.max(0, targets.findIndex((target) => target.id === last)) })
      .textField("Name", "Castle", { defaultValue: "" })
      .textField("Map id (empty: from the name)", "castle", { defaultValue: "" })
      .submitButton("Save as map");
    const response = await this.show(player, form);
    if (!response?.formValues || !player.isValid || this.selections.get(keyOf(player)) !== selection) return;
    const target = targets[response.formValues[0] as number];
    const name = String(response.formValues[1] ?? "").trim();
    const map = String(response.formValues[2] ?? "").trim() || mapIdFrom(name);
    if (!target) return;
    this.lastTarget.set(keyOf(player), target.id);
    if (!name) {
      tell(player, "§cThe map needs a name.");
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(map)) {
      tell(player, `§c"${map}" is not a map id: use lower case letters, digits, _ and -.`);
      return;
    }
    if (target.maps.includes(map) || this.maps.some((candidate) => candidate.target === target.id && candidate.map === map)) {
      tell(player, `§c${target.name} has a map "${map}" already: pick another id.`);
      return;
    }
    this.link.send({ t: "saveMap", by: player.name, box, target: target.id, map, name, spawn });
    this.selections.delete(keyOf(player));
    tell(player, `${name} (${map}) for ${target.name}: ${sizeText(box)} blocks, sent to be cut out.`);
  }

  // ---- The map menu -------------------------------------------------------------------------

  private async menu(player: Player): Promise<void> {
    const inventory = inventoryOf(player);
    const toolOut = inventory !== undefined && holds(inventory, SELECT_TOOL.item);
    const selection = this.selections.get(keyOf(player));
    const entries = selectMenuEntries({
      world: this.info.world,
      toolOut,
      selection: selection && { box: selection.box, steps: selection.history.length },
      maps: this.maps,
    });
    const form = new ActionFormData().title(mapTitle("Map menu")).body(selectMenuBody(this.info.world, toolOut));
    for (const entry of entries) form.button(entry.text, entry.icon);
    const response = await this.show(player, form);
    const entry = response?.selection === undefined ? undefined : entries[response.selection];
    if (!entry || !player.isValid) return;
    try {
      await this.menuAction(player, entry.action);
    } catch (error) {
      log.error(`map menu: ${describeError(error)}`);
    }
  }

  private async menuAction(player: Player, action: MenuAction): Promise<void> {
    switch (action.kind) {
      case "tool": {
        const inventory = inventoryOf(player);
        if (inventory && holds(inventory, SELECT_TOOL.item)) {
          removeItems(inventory, new Set([SELECT_TOOL.item]));
          actionBar(player, `${SELECT_TOOL.label} put away`);
        } else {
          this.giveTool(player);
          actionBar(player, `${SELECT_TOOL.label} in slot 1`);
        }
        return this.menu(player);
      }
      case "none":
        return this.menu(player);
      case "pick":
        return this.pick(player, action.action);
      case "map":
        return this.mapMenu(player, action.target, action.map);
      default:
        return;
    }
  }

  /** A map from this world: edit it, update it, try again or forget it, by its status. */
  private async mapMenu(player: Player, target: string, id: string): Promise<void> {
    const map = this.maps.find((candidate) => candidate.target === target && candidate.map === id);
    if (!map) return;
    const actions = mapActions(map);
    const body = `${map.name} (${map.map}) for ${map.targetName}: ${statusLine(map)}§r${map.error ? `\n§c${map.error}` : ""}\n§7${sizeText(map.box)} blocks, from ${map.box.min.join(" ")}.`;
    const form = new ActionFormData().title(sideTitle(map.name)).body(body);
    for (const { text } of actions) form.button(text);
    const response = await this.show(player, form);
    const action = response?.selection === undefined ? undefined : actions[response.selection]?.action;
    if (!action || !player.isValid) return;
    await this.mapAction(player, map, action);
  }

  private async mapAction(player: Player, map: SelectionInfo, action: MapAction): Promise<void> {
    if (action === "edit") {
      this.link.send({ t: "switch", by: player.name, to: "edit", target: map.target, map: map.map });
      return;
    }
    if (action === "update") {
      const form = new ActionFormData()
        .title(sideTitle(`Update ${map.name}`))
        .body(`This cuts ${map.map} out of this world again and replaces its blocks. Spawns, regions and the rest of map.json stay. Block changes made in Edit mode are lost.`)
        .button(dangerText("Update it"))
        .button("Cancel");
      const response = await this.show(player, form);
      if (response?.selection !== 0 || !player.isValid) return;
    }
    this.link.send({ t: "mapAction", by: player.name, action, target: map.target, map: map.map });
  }
}

/** A map's outline color by how its extraction is going. */
function colorOf(map: SelectionInfo): Rgb {
  if (map.status === "ready") return READY_COLOR;
  return map.status === "failed" ? KILL_COLOR : BOUNDS_COLOR;
}

/** A map id from a name: "Castle Keep" is castle_keep. */
function mapIdFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 48);
}

function tell(player: Player, text: string): void {
  player.sendMessage(`${PREFIX}${text}`);
}

function inventoryOf(player: Player): Container | undefined {
  return player.getComponent(EntityComponentTypes.Inventory)?.container;
}

function holds(inventory: Container, typeId: string): boolean {
  for (let slot = 0; slot < inventory.size; slot++) if (inventory.getItem(slot)?.typeId === typeId) return true;
  return false;
}

function removeItems(inventory: Container, typeIds: Set<string>): void {
  for (let slot = 0; slot < inventory.size; slot++) {
    const item = inventory.getItem(slot);
    if (item && typeIds.has(item.typeId)) inventory.setItem(slot, undefined);
  }
}

/** Builders never keep an editor item. */
function takeItems(player: Player): void {
  const inventory = inventoryOf(player);
  if (inventory) removeItems(inventory, ITEMS);
}
