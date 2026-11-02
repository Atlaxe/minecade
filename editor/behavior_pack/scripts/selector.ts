// Select mode in game: map editors box maps in a copy of a converted world. The Select tool (always
// in slot 1) picks a box the way the region tool does (hit a block to start, use on blocks to grow;
// the map menu exports it), and Export to Map sends it to the host
// (tools/editor/select-session.ts), which cuts it out and moves it to the middle in the background.
// The maps from this world and how each is going arrive as "selection" messages; the map menu
// lists them, and a ready one can be edited (it opens on the Edit server, and the host moves the
// player there while the loading screen shows). After Export to Map, the loading screen shows
// until the map is cut out, then asks whether to edit it. The world can't be changed here: blocks
// can't be broken or placed, and the host never saves it. Maps are changed and deleted in Edit.
// Every 10 seconds, a map editor missing the map menu or the Select tool gets it back (command
// blocks in some worlds clear inventories); /reset does it at once, with creative mode.
import { EntityComponentTypes, GameMode, ItemLockMode, ItemStack, world, type Block, type Container, type Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { chatMapName, describeError, log, playChime, showForm, type Scope, type SelectInfo, type SelectionInfo } from "@minecade/minigame-core";
import type { HostMessage } from "@minecade/minigame-core/config";
import { blockInView, change, keyOf, nudgeMenu, nudgePreview, xyz, type Picking } from "./box-picker.ts";
import { blockBox, describeBox, growBox, sameBox, sizeText } from "./boxes.ts";
import { goto } from "./goto.ts";
import { keepModeLine, modeLine } from "./hud.ts";
import { HostLink } from "./link.ts";
import { LoadingScreens } from "./loading.ts";
import { Cursors } from "./cursor.ts";
import { iconsTitle, sideTitle } from "./marks.ts";
import {
  SELECT_HELP,
  editBody,
  mapActions,
  uniqueMapId,
  selectMenuEntries,
  statusLine,
  type ExportDraft,
  type MapAction,
  type MenuAction,
  type MenuEntry,
  type PickAction,
} from "./menu.ts";
import { Outlines } from "./outlines.ts";
import { PlayersMenu, isMapEditor } from "./players.ts";
import { onReset } from "./commands.ts";
import { BOUNDS_COLOR, KILL_COLOR, type Rgb } from "./regions.ts";
import { actionBar, heldTool, hintBar, notice } from "./tool-host.ts";
import { SELECT_TOOL } from "./tools.ts";

const MAP_MENU = "minecade:map_menu";
const ITEMS = new Set([MAP_MENU, SELECT_TOOL.item]);
/** The map menu's hotbar slot (0-based): the last one, slot 9 on screen. */
const MENU_SLOT = 8;
/** The Select tool's: slot 1 on screen, locked there (Select mode has no other tool). */
const TOOL_SLOT = 0;
const PREFIX = "§b[Editor]§r ";
/** How often the held tool's hint is put back on the action bar (it fades otherwise). */
const HINT_TICKS = 10;
/** A ready map's outline. Queued and running ones are white, failed ones red. */
const READY_COLOR: Rgb = { red: 0x55 / 255, green: 1, blue: 0x55 / 255 };
/** How often map editors are checked for their items (a command block may have cleared them). */
const ITEMS_TICKS = 200;
/** How long the loading screen waits for an export: a big one takes minutes. */
const EXPORT_TICKS = 20 * 60 * 15;

export class Selector {
  private readonly scope: Scope;
  private readonly info: SelectInfo;
  private readonly link: HostLink;
  private readonly players: PlayersMenu;
  private readonly selections = new Map<string, Picking>();
  private readonly formOpen = new Set<string>();
  /** Export to Map as each player left it: the name, the map id, and the target (kept after an export). */
  private readonly drafts = new Map<string, ExportDraft>();
  private readonly loading: LoadingScreens;
  private maps: SelectionInfo[];

  constructor(scope: Scope, info: SelectInfo) {
    this.scope = scope;
    this.info = info;
    this.maps = [...info.selections];
    this.link = new HostLink(scope, { config: () => {}, message: (message) => this.receive(message) });
    this.players = new PlayersMenu(this.link, (player, form) => this.show(player, form));
    this.loading = new LoadingScreens(scope, (player, form) => this.show(player, form));
    // Where a use of the Select tool would grow the box to: the block's outline.
    new Cursors(scope, world.getDimension("overworld"), (player) => {
      if (heldTool(player) !== "select" || !isMapEditor(player)) return undefined;
      const block = blockInView(player);
      return block ? { kind: "block", at: block.location } : undefined;
    });
    new Outlines(
      scope,
      {
        selection: (player) => {
          const selection = this.selections.get(keyOf(player));
          return selection && { box: selection.box };
        },
        boxes: () => this.maps.map((map) => ({ key: `${map.target}/${map.map}`, group: "maps", box: map.box, color: colorOf(map) })),
        // A side menu open shows them too.
        showing: (player) => this.formOpen.has(keyOf(player)),
      },
      ["select"],
    );
  }

  start(): void {
    const scope = this.scope;
    world.gameRules.doWeatherCycle = false;
    world.gameRules.doMobSpawning = false;
    // A converted world's command blocks could clear the Select tool or change game modes.
    world.gameRules.commandBlocksEnabled = false;
    scope.subscribe(world.afterEvents.playerSpawn, ({ player, initialSpawn }) => {
      if (initialSpawn) scope.defer(() => this.welcome(player));
    });
    scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
      const key = playerName.toLowerCase();
      this.selections.delete(key);
      this.formOpen.delete(key);
      this.drafts.delete(key);
    });
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (!ITEMS.has(itemStack.typeId) || !isMapEditor(source)) return;
      if (itemStack.typeId === MAP_MENU) void this.menu(source);
      else this.use(source);
    });
    scope.subscribe(world.afterEvents.entityHitBlock, ({ damagingEntity, hitBlock }) => {
      if (damagingEntity.typeId !== "minecraft:player") return;
      const player = damagingEntity as Player;
      if (heldTool(player) === "select" && isMapEditor(player)) this.begin(player, hitBlock);
    });
    // The world can't be changed here: maps are changed in Edit. No block breaks (a hit with the
    // Select tool starts a box instead), and nothing is placed or used on blocks but the tools.
    scope.subscribeBefore(world.beforeEvents.playerBreakBlock, (event) => {
      event.cancel = true;
    });
    scope.subscribeBefore(world.beforeEvents.playerInteractWithBlock, (event) => {
      if (!event.itemStack || !ITEMS.has(event.itemStack.typeId)) event.cancel = true;
    });
    scope.interval(() => this.hints(), HINT_TICKS);
    scope.interval(() => this.checkItems(), ITEMS_TICKS);
    onReset((player) => this.reset(player));
    keepModeLine(scope, () => modeLine("select", this.info.world));
    this.link.send({ t: "ready" });
  }

  private receive(message: Exclude<HostMessage, { t: "config" | "home" }>): void {
    switch (message.t) {
      case "selection": {
        const same = (map: SelectionInfo) => map.target === message.item.target && map.map === message.item.map;
        this.maps = this.maps.some(same) ? this.maps.map((map) => (same(map) ? message.item : map)) : [...this.maps, message.item];
        // An export that's done ends its loading screen.
        for (const player of world.getAllPlayers()) this.loading.poke(player);
        return;
      }
      case "forgotten":
        this.maps = this.maps.filter((map) => !(map.target === message.target && map.map === message.map));
        return;
      case "say":
        for (const player of world.getAllPlayers()) if (!message.to || player.name === message.to) tell(player, message.text);
        return;
      case "loading":
        for (const player of world.getAllPlayers()) if (message.players.includes(player.name)) void this.loading.wait(player, message.label);
        return;
      case "loaded":
        for (const player of world.getAllPlayers()) if (message.players.includes(player.name)) this.loading.stop(player);
        return;
      case "notice":
        for (const player of world.getAllPlayers()) notice(this.scope, player, message.text);
        return;
      case "goto":
        goto(message.players, message.port, message.label, tell);
        return;
      case "guests":
        this.players.update(message.guests);
        return;
      case "cleanup":
        // Select mode has no markers.
        this.link.send({ t: "clean", id: message.id, left: 0 });
        return;
    }
  }

  private welcome(player: Player): void {
    if (!player.isValid) return;
    player.setGameMode(GameMode.Creative);
    if (!isMapEditor(player)) {
      // A guest: look around, with no tools.
      tell(player, `Welcome to "${this.info.world}" in the map editor's Select mode. Fly around and look: this is a copy, and it can't be changed here.`);
      return;
    }
    this.giveItems(player);
    tell(player, `Select mode on "${this.info.world}". The map menu in slot 9 has Help, and lists the maps from this world.`);
  }

  /** /reset: the map menu, the Select tool and creative mode, at once. */
  private reset(player: Player): void {
    if (!player.isValid) return;
    player.setGameMode(GameMode.Creative);
    if (isMapEditor(player)) this.giveItems(player);
    tell(player, "Reset: creative mode, and your map editor items.");
  }

  /** Map editors missing the map menu or the Select tool get them back (a command block may have cleared them). */
  private checkItems(): void {
    for (const player of world.getAllPlayers()) {
      const inventory = inventoryOf(player);
      if (!inventory || !isMapEditor(player) || [MAP_MENU, SELECT_TOOL.item].every((item) => holds(inventory, item))) continue;
      this.giveItems(player);
      tell(player, "Your map editor items were gone: they're back. /reset also brings back creative mode.");
    }
  }

  private giveItems(player: Player): void {
    const inventory = inventoryOf(player);
    if (inventory && !holds(inventory, MAP_MENU)) {
      const menu = new ItemStack(MAP_MENU, 1);
      menu.lockMode = ItemLockMode.slot;
      menu.keepOnDeath = true;
      inventory.setItem(MENU_SLOT, menu);
    }
    this.giveTool(player);
  }

  /** The Select tool, locked in slot 1. */
  private giveTool(player: Player): void {
    const inventory = inventoryOf(player);
    if (!inventory || holds(inventory, SELECT_TOOL.item)) return;
    const old = inventory.getItem(TOOL_SLOT);
    const tool = new ItemStack(SELECT_TOOL.item, 1);
    tool.lockMode = ItemLockMode.slot;
    tool.keepOnDeath = true;
    inventory.setItem(TOOL_SLOT, tool);
    if (old) inventory.addItem(old);
    player.selectedSlotIndex = TOOL_SLOT;
  }

  private hints(): void {
    for (const player of world.getAllPlayers()) {
      // Nudge sides puts the way the player faces there instead.
      if (heldTool(player) !== "select" || nudgePreview(player)) continue;
      const selection = this.selections.get(keyOf(player));
      hintBar(
        player,
        selection
          ? `Selection ${sizeText(selection.box)}   Use on a block: grow   Hit: new box   Export: map menu`
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

  /** A use: grows the selection to the block in view. Exporting it is in the map menu. */
  private use(player: Player): void {
    const block = blockInView(player);
    const selection = this.selections.get(keyOf(player));
    if (!block) {
      actionBar(player, selection ? "Export it from the map menu (slot 9)" : "No selection yet: hit a block with the Select tool to start one");
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

  /** How to box a map, in chat, with a chime. */
  private help(player: Player): void {
    tell(player, `§f${SELECT_HELP}`);
    playChime(player, "go");
  }

  private async pick(player: Player, action: PickAction): Promise<void> {
    const selection = this.selections.get(keyOf(player));
    if (!selection) {
      tell(player, "No selection yet: hit a block with the Select tool to start one.");
      return;
    }
    switch (action) {
      case "saveMap":
        return this.exportMenu(player, selection);
      case "nudge": {
        const box = await nudgeMenu({ show: (who, form) => this.show(who, form), tell }, player, selection.box, "Nudge sides");
        if (box === "back") return this.menu(player);
        if (!box || sameBox(box, selection.box) || this.selections.get(keyOf(player)) !== selection) return;
        change(selection, box);
        actionBar(player, `Selection: ${describeBox(box)}`);
        return;
      }
      case "back": {
        const box = selection.history.pop();
        if (box) selection.box = box;
        actionBar(player, box ? `Selection: ${describeBox(selection.box)}` : "Nothing to step back");
        return;
      }
      case "clear":
        this.selections.delete(keyOf(player));
        tell(player, "Selection cleared.");
        return;
    }
  }

  // ---- Export to Map ------------------------------------------------------------------------

  /**
   * Export to Map, in the side panel: the Name box, the Map id once there's a name (made from it,
   * not typed), what it's for, Open in Edit, and Export to Map (green). A first name opens it again
   * with the Map id.
   */
  private async exportMenu(player: Player, selection: Picking): Promise<void> {
    const key = keyOf(player);
    const targets = this.info.targets;
    const draft = this.drafts.get(key) ?? { name: "", target: targets[0]?.id ?? "lobby", edit: true };
    this.drafts.set(key, draft);
    const named = draft.name !== "";
    const form = new ModalFormData().title(sideTitle("Export to Map")).textField("Name", "Castle", { defaultValue: draft.name });
    if (named) form.label(`Map id: ${this.exportId(draft)}`);
    form.dropdown("For", targets.map((target) => target.name), { defaultValueIndex: Math.max(0, targets.findIndex((target) => target.id === draft.target)) });
    form.toggle("Open in Edit", { defaultValue: draft.edit });
    form.submitButton(named ? "Export to Map" : "Next");
    const response = await this.show(player, form);
    if (!response?.formValues || !player.isValid || this.selections.get(key) !== selection) return;
    // A label has no value (or an empty one, depending on the game's version): only the fields count.
    const [typed, forIndex, edit] = response.formValues.filter((value) => value !== undefined);
    const name = String(typed ?? "").trim();
    draft.target = targets[Number(forIndex)]?.id ?? draft.target;
    draft.edit = edit !== false;
    draft.name = name;
    if (!name) tell(player, "§cThe map needs a name.");
    if (!name || !named) return this.exportMenu(player, selection);
    const exported = this.export(player, selection, draft);
    if (exported) return this.waitForExport(player, exported.target, exported.map, draft.edit);
    return this.exportMenu(player, selection);
  }

  /** The map id an export gets: its name's, made unique among the target's maps (and this world's list). */
  private exportId(draft: ExportDraft): string {
    const target = this.info.targets.find((candidate) => candidate.id === draft.target);
    const taken = [...(target?.maps ?? []), ...this.maps.filter((candidate) => candidate.target === draft.target).map((candidate) => candidate.map)];
    return uniqueMapId(draft.name, taken);
  }

  /** Sends the export to the host; what it exported, or undefined (and why) when it can't go yet. */
  private export(player: Player, selection: Picking, draft: ExportDraft): { target: string; map: string } | undefined {
    const target = this.info.targets.find((candidate) => candidate.id === draft.target);
    const map = this.exportId(draft);
    if (!target) return undefined;
    if (!draft.name) {
      tell(player, "§cThe map needs a name.");
      return undefined;
    }
    this.link.send({ t: "saveMap", by: player.name, box: selection.box, target: target.id, map, name: draft.name, ...(draft.edit ? { edit: true } : {}) });
    this.selections.delete(keyOf(player));
    // The next export starts empty, for the same target, opening in Edit or not as this one did.
    this.drafts.set(keyOf(player), { name: "", target: target.id, edit: draft.edit });
    tell(player, `${chatMapName(target.name, draft.name)} (${map}): ${sizeText(selection.box)} blocks, exporting${draft.edit ? ", then opening in Edit" : ""}.`);
    return { target: target.id, map };
  }

  /**
   * The loading screen while an export is cut out. Then, ready: with `edit`, the host opens it in
   * Edit and moves the player there (its own loading screen carries on); without, whether to edit
   * it. Failed: why.
   */
  private async waitForExport(player: Player, target: string, id: string, edit: boolean): Promise<void> {
    const status = () => this.maps.find((candidate) => candidate.target === target && candidate.map === id)?.status;
    const finished = () => status() === "failed" || (!edit && status() === "ready");
    const name = this.info.targets.find((candidate) => candidate.id === target)?.name ?? target;
    await this.loading.wait(player, id, {
      title: "Exporting",
      body: `Exporting ${name}: ${id}...\n\nIt's cut out and moved to the middle: about 20 seconds for a mid-size build.${edit ? " Then it opens in Edit, and you're moved there." : ""}`,
      done: finished,
      ticks: EXPORT_TICKS,
    });
    if (player.isValid && finished()) await this.mapMenu(player, target, id);
  }

  // ---- The map menu -------------------------------------------------------------------------

  private async menu(player: Player): Promise<void> {
    const selection = this.selections.get(keyOf(player));
    const entries = selectMenuEntries({ selection: selection && { box: selection.box, steps: selection.history.length }, maps: this.maps });
    const form = new ActionFormData().title(iconsTitle("Map menu"));
    for (const entry of entries) form.button(entry.text, entry.icon);
    const response = await this.show(player, form);
    const entry: MenuEntry | undefined = response?.selection === undefined ? undefined : entries[response.selection];
    if (!entry || !player.isValid) return;
    try {
      await this.menuAction(player, entry.action);
    } catch (error) {
      log.error(`map menu: ${describeError(error)}`);
    }
  }

  private async menuAction(player: Player, action: MenuAction): Promise<void> {
    switch (action.kind) {
      case "none":
        return this.menu(player);
      case "help":
        this.help(player);
        return this.menu(player);
      case "pick":
        await this.pick(player, action.action);
        // Back one step is an icon: the menu stays open.
        if (action.action === "back") return this.menu(player);
        return;
      case "map":
        return this.mapMenu(player, action.target, action.map);
      case "lobby":
        this.link.send({ t: "open", by: player.name, request: { to: "home" } });
        return;
      case "players":
        return this.players.open(player, () => this.menu(player));
      default:
        return;
    }
  }

  /** A map from this world: edit it (after asking), or try a failed export again. */
  private async mapMenu(player: Player, target: string, id: string): Promise<void> {
    const map = this.maps.find((candidate) => candidate.target === target && candidate.map === id);
    if (!map) return;
    const actions = mapActions(map);
    if (actions.length === 0) {
      tell(player, `${map.name} (${map.map}) is ${statusLine(map)}§r: it can be edited once it's ready.`);
      return this.menu(player);
    }
    const ready = map.status === "ready";
    const body = ready ? editBody(map) : `${map.name} (${map.map}) for ${map.targetName}: ${statusLine(map)}§r${map.error ? `\n§c${map.error}` : ""}`;
    const form = new ActionFormData().title(sideTitle(ready ? `Edit ${map.name}?` : map.name)).body(body);
    for (const { text } of actions) form.button(text);
    const response = await this.show(player, form);
    const action = response?.selection === undefined ? undefined : actions[response.selection]?.action;
    if (!action || !player.isValid) return;
    await this.mapAction(player, map, action);
  }

  private async mapAction(player: Player, map: SelectionInfo, action: MapAction): Promise<void> {
    if (action === "cancel") return this.menu(player);
    if (action === "edit") {
      // The loading screen takes over at once; the host keeps it up until the player is moved.
      this.link.send({ t: "open", by: player.name, request: { to: "edit", target: map.target, map: map.map } });
      void this.loading.wait(player, `${map.targetName}: ${map.name} (${map.map})`);
      return;
    }
    this.link.send({ t: "mapAction", by: player.name, action, target: map.target, map: map.map });
  }
}

/** A map's outline color by how its extraction is going. */
function colorOf(map: SelectionInfo): Rgb {
  if (map.status === "ready") return READY_COLOR;
  return map.status === "failed" ? KILL_COLOR : BOUNDS_COLOR;
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
